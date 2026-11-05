/**
 * Público (sin sesión) — el alumno con SU link (receta 155): /a/<token>.
 *   POST /api/publico/asistencia/<token> { accion: "ver" }                                  → { alumno }
 *   POST /api/publico/asistencia/<token> { accion: "reservar" | "cancelar" | "marcar", cita_id } → { hecho, alumno }
 *   POST /api/publico/asistencia/<token> { accion: "libre" }                                → { hecho, alumno }
 * La base valida el link en cada llamada.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { ipDe, mensajeDb, TOKEN_RE } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };

const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("ver") }),
  z.object({ accion: z.literal("libre") }),
  z.object({ accion: z.enum(["reservar", "cancelar", "marcar"]), cita_id: z.string().uuid() }),
]);

const responder = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: SIN_CACHE });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return responder(404, "Este link no es válido.");
  if (!permitirIp(`asistencia|${ipDe(req)}`, 60, 60_000)) return responder(429, "Demasiados intentos. Probá en un minuto.");
  const r = cuerpo.safeParse(await req.json().catch(() => null));
  if (!r.success) return responder(422, "Pedido inválido.");
  const b = r.data;
  const { data, error } = b.accion === "ver"
    ? await clientePublico().rpc("gim_publico_mio", { p_token: token })
    : await clientePublico().rpc("gim_publico_accion", { p_token: token, p_accion: b.accion, p_cita: "cita_id" in b ? b.cita_id : null });
  if (error) return responder(error.code === "42501" ? 403 : 400, mensajeDb(error.message, "No se pudo completar"));
  const d = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!d?.ok) return responder(400, d?.error ?? "No se pudo completar");
  return NextResponse.json({ ok: true, data: d }, { headers: SIN_CACHE });
}
