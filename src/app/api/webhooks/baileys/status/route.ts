/**
 * Tildes de lo que mandamos por QR: POST /api/webhooks/baileys/status
 * { empresaId, waMessageId, status: sent | delivered | read | failed }.
 */
import { type NextRequest, NextResponse } from "next/server";
import { anotarEstadoSaliente, canalDelPuente } from "@/lib/conversaciones/baileys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => null)) as { empresaId?: unknown; waMessageId?: unknown; status?: unknown } | null;
  if (!b) return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  const canal = await canalDelPuente(req.headers, { empresaId: b.empresaId });
  if (!canal) return NextResponse.json({ ok: false, error: "Empresa o secreto incorrecto" }, { status: 401 });
  const externoId = typeof b.waMessageId === "string" ? b.waMessageId.trim().slice(0, 200) : "";
  if (externoId) await anotarEstadoSaliente(canal.empresa_id, externoId, String(b.status ?? ""));
  return NextResponse.json({ ok: true });
}
