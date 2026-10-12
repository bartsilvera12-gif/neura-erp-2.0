/**
 * Webhook de chat por proveedor (público): /api/webhooks/chat/meta | ycloud | baileys | simulador
 *   POST → valida firma, guarda el payload crudo en chat_eventos, responde 200 y procesa
 *          en segundo plano con after(). Nunca procesa antes de responder.
 *   GET  → verificación de suscripción de Meta (hub.challenge).
 */
import { after, type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { encolarEvento, esProveedor, firmaValida, procesarEvento, verificarSuscripcionMeta } from "@/lib/conversaciones/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function proveedorDe(req: NextRequest): string {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  return segs[segs.length - 1] ?? "";
}

export async function GET(req: NextRequest) {
  if (proveedorDe(req) !== "meta") return new NextResponse(null, { status: 404 });
  const challenge = verificarSuscripcionMeta(new URL(req.url).searchParams);
  return challenge ? new NextResponse(challenge, { status: 200 }) : new NextResponse(null, { status: 403 });
}

export async function POST(req: NextRequest) {
  const proveedor = proveedorDe(req);
  if (!esProveedor(proveedor)) return NextResponse.json({ ok: false }, { status: 404 });

  const cuerpo = await req.text();
  if (cuerpo.length > 1024 * 1024) return NextResponse.json({ ok: false }, { status: 413 });
  const firma = firmaValida(proveedor, req.headers, cuerpo);
  if (!firma.ok) return NextResponse.json({ ok: false }, { status: firma.status });

  let payload: unknown;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const eventoId = await encolarEvento(proveedor, payload);
  if (eventoId) after(() => procesarEvento(eventoId, proveedor, payload));
  return NextResponse.json({ ok: true });
}
