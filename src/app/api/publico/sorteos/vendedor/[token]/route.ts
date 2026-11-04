/**
 * Público (sin sesión) — punto de venta del vendedor (receta 123): link /rv/<token> + PIN.
 *   POST /api/publico/sorteos/vendedor/<token> { accion: "entrar", pin }
 *        → { vendedor, sorteos[], ultimas[] }
 *   POST /api/publico/sorteos/vendedor/<token> { accion: "vender", pin, venta: { sorteo_id, cantidad, comprador,
 *        metodo_pago: efectivo | transferencia, referencia_pago?, idempotency_key } } → { orden }
 * La base valida el link y el PIN en cada llamada (5 PIN mal = 15 minutos bloqueado).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { ipDe, mensajeDb, TOKEN_RE } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("entrar"), pin: z.string().regex(/^\d{4,8}$/) }),
  z.object({
    accion: z.literal("vender"),
    pin: z.string().regex(/^\d{4,8}$/),
    venta: z.object({
      sorteo_id: z.string().uuid(),
      cantidad: z.number().int().min(1).max(100000),
      comprador: z.object({
        nombre: z.string().trim().min(2).max(120),
        documento: z.string().trim().max(20).nullish(),
        telefono: z.string().trim().max(30).nullish(),
        ciudad: z.string().trim().max(80).nullish(),
      }),
      metodo_pago: z.enum(["efectivo", "transferencia"]),
      referencia_pago: z.string().trim().max(60).nullish(),
      idempotency_key: z.string().min(8).max(80),
    }),
  }),
]);

const responder = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: SIN_CACHE });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return responder(404, "Este link no es válido.");
  if (!permitirIp(`sorteo-pv|${ipDe(req)}`, 30, 60_000)) return responder(429, "Demasiados intentos. Probá en un minuto.");
  const r = cuerpo.safeParse(await req.json().catch(() => null));
  if (!r.success) return responder(422, r.error.issues.some((i) => i.path.includes("pin")) ? "El PIN tiene de 4 a 8 números." : "Revisá los datos de la venta.");

  const b = r.data;
  const { data, error } = b.accion === "entrar"
    ? await clientePublico().rpc("sorteo_vendedor_entrar", { p_token: token, p_pin: b.pin })
    : await clientePublico().rpc("sorteo_vendedor_vender", { p_token: token, p_pin: b.pin, p: b.venta });
  if (error) {
    const msg = mensajeDb(error.message, b.accion === "entrar" ? "No se pudo entrar" : "No se pudo registrar la venta");
    return responder(error.code === "42501" ? 403 : 400, msg);
  }
  const d = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!d?.ok) return responder(401, d?.error ?? "PIN incorrecto");
  return NextResponse.json({ ok: true, data: d }, { headers: SIN_CACHE });
}
