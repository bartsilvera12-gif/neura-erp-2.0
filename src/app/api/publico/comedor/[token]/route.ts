/**
 * API PÚBLICA (sin sesión) del menú del comedor por token: la usa /menu/<token> desde el celular.
 *   GET  /api/publico/comedor/<token>  → el menú de la semana (comedor_publico_menu)
 *   POST /api/publico/comedor/<token>  { accion: "identificar", documento }  → nombre + reservas
 *                                      { accion: "reservar", documento, fecha, opcion_id? }
 * Solo reenvía a funciones de la base habilitadas a `anon` (validan token, CI contra el padrón,
 * cierre y que la opción sea de ese día). Tope por IP en memoria como defensa extra.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "../../mesas/limite";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const TOKEN_RE = /^[0-9a-f]{64}$/;

const tokenDe = (url: string) => {
  const segs = new URL(url).pathname.split("/").filter(Boolean);
  const t = segs[segs.indexOf("comedor") + 1] ?? "";
  return TOKEN_RE.test(t) ? t : null;
};
const error = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status, headers: SIN_CACHE });
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export async function GET(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Enlace no encontrado", 404);
  try {
    const { data, error: e } = await clientePublico().rpc("comedor_publico_menu", { p_token: token });
    if (e) return error("Este enlace no está disponible", 404);
    return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
  } catch {
    return error("No se pudo cargar el menú", 500);
  }
}

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("identificar"), documento: z.string().trim().min(1).max(30) }),
  z.object({
    accion: z.literal("reservar"),
    documento: z.string().trim().min(1).max(30),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    opcion_id: z.string().uuid().nullable().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Enlace no encontrado", 404);
  if (!permitirIp(`comedor:${ip(req)}`, 40, 60_000)) return error("Demasiados intentos, probá en un momento", 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Pedido inválido", 400);
  }
  const parsed = cuerpo.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues.map((i) => i.message).join("; "), 422);
  const input = parsed.data;

  try {
    const sb = clientePublico();
    if (input.accion === "identificar") {
      const { data, error: e } = await sb.rpc("comedor_publico_mis_reservas", { p_token: token, p_documento: input.documento });
      if (e) return error(mensajeDb(e.message), 400);
      return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
    }
    const { data, error: e } = await sb.rpc("comedor_publico_reservar", {
      p_token: token, p_documento: input.documento, p_fecha: input.fecha, p_opcion: input.opcion_id ?? null,
    });
    if (e) return error(mensajeDb(e.message), 400);
    return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
  } catch {
    return error("No se pudo guardar", 500);
  }
}

/** Los `raise exception ... using message` de la base llegan como mensaje legible; lo pasamos tal cual. */
function mensajeDb(m: string): string {
  const limpio = m.replace(/^.*?:\s*/, "").trim();
  return limpio.length > 2 && limpio.length < 160 ? limpio : "No se pudo completar";
}
