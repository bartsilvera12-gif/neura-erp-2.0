/**
 * Archivo de un mensaje entrante por QR: POST /api/webhooks/baileys/inbound/media (multipart:
 * channelId, waMessageId, tipo, file). El puente lo sube después de entregar el mensaje; si el
 * mensaje todavía no se registró responde 409 y el puente reintenta solo.
 */
import { type NextRequest, NextResponse } from "next/server";
import { adjuntarMediaEntrante, canalDelPuente, MAX_MEDIA_PUENTE } from "@/lib/conversaciones/baileys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_MEDIA_PUENTE + 1024 * 1024) return NextResponse.json({ ok: false, error: "Archivo demasiado grande" }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Formulario inválido" }, { status: 400 });
  }
  const canal = await canalDelPuente(req.headers, { canalId: form.get("channelId") });
  if (!canal) return NextResponse.json({ ok: false, error: "Canal o secreto incorrecto" }, { status: 401 });
  const externoId = String(form.get("waMessageId") ?? "").trim().slice(0, 200);
  const archivo = form.get("file");
  if (!externoId || !(archivo instanceof Blob)) return NextResponse.json({ ok: false, error: "Faltan waMessageId o file" }, { status: 400 });
  if (archivo.size > MAX_MEDIA_PUENTE) return NextResponse.json({ ok: false, error: "Archivo demasiado grande" }, { status: 413 });
  try {
    const r = await adjuntarMediaEntrante(canal, externoId, String(form.get("tipo") ?? ""), {
      datos: Buffer.from(await archivo.arrayBuffer()),
      mime: archivo.type || "application/octet-stream",
      nombre: (archivo instanceof File && archivo.name) || `archivo-${externoId.slice(0, 12)}`,
    });
    if (r === "pendiente") return NextResponse.json({ ok: false, error: "El mensaje todavía no se registró" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[chat/baileys] media", (e as Error).message);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el archivo" }, { status: 503 });
  }
}
