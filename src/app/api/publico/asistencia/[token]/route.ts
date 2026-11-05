/**
 * Público (sin sesión) — el alumno marca su asistencia (receta 153): link /a/<token> + CI + PIN.
 *   POST /api/publico/asistencia/<token> { accion: "entrar", documento, pin } → { alumno }
 *   POST /api/publico/asistencia/<token> { accion: "marcar", documento, pin, cita_id | null } → { marcada, alumno }
 * La base valida el link, la CI y el PIN en cada llamada (5 PIN mal = 15 minutos bloqueado).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientePublico } from "@/lib/supabase/publico";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { ipDe, mensajeDb, TOKEN_RE } from "@/modules/sorteos/publico";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };

const base = { documento: z.string().trim().min(4).max(20), pin: z.string().regex(/^\d{4}$/) };
const cuerpo = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("entrar"), ...base }),
  z.object({ accion: z.literal("marcar"), ...base, cita_id: z.string().uuid().nullable() }),
]);

const responder = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: SIN_CACHE });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return responder(404, "Este link no es válido.");
  if (!permitirIp(`asistencia|${ipDe(req)}`, 30, 60_000)) return responder(429, "Demasiados intentos. Probá en un minuto.");
  const r = cuerpo.safeParse(await req.json().catch(() => null));
  if (!r.success) return responder(422, r.error.issues.some((i) => i.path.includes("pin")) ? "El PIN tiene 4 números." : "Escribí tu CI.");
  const b = r.data;
  const { data, error } = b.accion === "entrar"
    ? await clientePublico().rpc("gim_publico_entrar", { p_token: token, p_documento: b.documento, p_pin: b.pin })
    : await clientePublico().rpc("gim_publico_marcar", { p_token: token, p_documento: b.documento, p_pin: b.pin, p_cita: b.cita_id });
  if (error) return responder(error.code === "42501" ? 403 : 400, mensajeDb(error.message, "No se pudo marcar la asistencia"));
  const d = data as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!d?.ok) return responder(400, d?.error ?? "La CI o el PIN no coinciden");
  return NextResponse.json({ ok: true, data: d }, { headers: SIN_CACHE });
}