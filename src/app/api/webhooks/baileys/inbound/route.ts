/**
 * Entrada del puente de WhatsApp por QR (público, sin sesión): POST /api/webhooks/baileys/inbound
 * Es la URL que va en ERP_INBOUND_URL del puente. Valida x-bridge-secret contra el canal, guarda el
 * payload crudo en chat_eventos, responde 200 y procesa en segundo plano (igual que YCloud y Meta).
 * Cualquier respuesta que no sea 2xx hace que el puente reintente.
 */
import { after, type NextRequest, NextResponse } from "next/server";
import { canalDelPuente } from "@/lib/conversaciones/baileys";
import { guardarEventoChat } from "@/lib/conversaciones/servidor";
import { procesarEvento } from "@/lib/conversaciones/webhook";
import { urlBase } from "@/lib/usuarios/cuentas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();
  if (cuerpo.length > 1024 * 1024) return NextResponse.json({ ok: false, error: "Mensaje demasiado grande" }, { status: 413 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(cuerpo) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const canal = await canalDelPuente(req.headers, { canalId: payload?.channelId });
  if (!canal) return NextResponse.json({ ok: false, error: "Canal o secreto incorrecto (ERP_CHANNEL_ID / ERP_SHARED_SECRET)" }, { status: 401 });

  const eventoId = await guardarEventoChat("baileys", payload, canal);
  if (!eventoId) return NextResponse.json({ ok: false, error: "No se pudo guardar el mensaje" }, { status: 503 });
  const base = urlBase(req);
  after(() => procesarEvento(eventoId, "baileys", payload, base));
  return NextResponse.json({ ok: true });
}
