/**
 * API PÚBLICA (sin sesión) de la terminal de retiro del comedor (autoservicio).
 *   POST /api/publico/comedor-retiro/<token>  { accion: "identificar", documento }
 *                                             { accion: "confirmar", documento }
 * Reenvía a funciones habilitadas a `anon` (validan token, CI contra el padrón, la reserva de hoy,
 * el doble retiro y el reparto del subsidio). Tope por IP en memoria.
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
  const t = segs[segs.indexOf("comedor-retiro") + 1] ?? "";
  return TOKEN_RE.test(t) ? t : null;
};
const error = (message: string, status: number) => NextResponse.json({ ok: false, error: { message } }, { status, headers: SIN_CACHE });
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

const cuerpo = z.object({
  accion: z.enum(["identificar", "confirmar"]),
  documento: z.string().trim().min(1).max(30),
});

export async function POST(req: NextRequest) {
  const token = tokenDe(req.url);
  if (!token) return error("Terminal no encontrada", 404);
  if (!permitirIp(`comedor-retiro:${ip(req)}`, 60, 60_000)) return error("Demasiados intentos, probá en un momento", 429);
  let body: unknown;
  try { body = await req.json(); } catch { return error("Pedido inválido", 400); }
  const parsed = cuerpo.safeParse(body);
  if (!parsed.success) return error(parsed.error.issues.map((i) => i.message).join("; "), 422);

  try {
    const sb = clientePublico();
    const fn = parsed.data.accion === "identificar" ? "comedor_retiro_identificar" : "comedor_retiro_confirmar";
    const { data, error: e } = await sb.rpc(fn, { p_token: token, p_documento: parsed.data.documento });
    if (e) return error(mensajeDb(e.message), 400);
    return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
  } catch {
    return error("No se pudo completar", 500);
  }
}

function mensajeDb(m: string): string {
  const limpio = m.replace(/^.*?:\s*/, "").trim();
  return limpio.length > 2 && limpio.length < 160 ? limpio : "No se pudo completar";
}
