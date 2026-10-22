/**
 * API PÚBLICA: estado de los pedidos que mandó este celular en esta mesa.
 *   POST /api/publico/mesas/<token>/estado { seguimientos: string[] } → [{ seguimiento, numero, estado, … }]
 * Solo los pedidos de ESA mesa cuyos códigos de seguimiento conoce el celular (32 hex, no se
 * pueden adivinar). POST para que los códigos no queden en logs de URL.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { estadoPedidos } from "@/modules/mesas/publico";
import { SEGUIMIENTO_RE, TOKEN_MESA_RE } from "@/modules/mesas/tipos";
import { permitirIp } from "../../limite";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };

const cuerpo = z.object({ seguimientos: z.array(z.string().regex(SEGUIMIENTO_RE)).max(20) });

export async function POST(req: NextRequest) {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const token = segs[segs.indexOf("mesas") + 1] ?? "";
  if (!TOKEN_MESA_RE.test(token)) return NextResponse.json({ ok: false, error: { message: "Mesa no encontrada" } }, { status: 404, headers: SIN_CACHE });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  // Polling cada ~5 s: holgado para varios celulares detrás de la misma red del local.
  if (!permitirIp(`estado|${ip}`, 240, 60_000)) {
    return NextResponse.json({ ok: false, error: { message: "Demasiadas consultas" } }, { status: 429, headers: SIN_CACHE });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = null;
  }
  const p = cuerpo.safeParse(json);
  if (!p.success) return NextResponse.json({ ok: false, error: { message: "Consulta inválida" } }, { status: 422, headers: SIN_CACHE });
  try {
    return NextResponse.json({ ok: true, data: await estadoPedidos(token, p.data.seguimientos) }, { headers: SIN_CACHE });
  } catch {
    return NextResponse.json({ ok: false, error: { message: "No se pudo consultar el pedido" } }, { status: 500, headers: SIN_CACHE });
  }
}
