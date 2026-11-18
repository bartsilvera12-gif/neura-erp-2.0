/**
 * Público — una compra por su link privado (receta 123).
 *   GET  /api/publico/sorteos/compra/<token> → estado, números, datos para transferir (si falta pagar)
 *   POST /api/publico/sorteos/compra/<token> multipart `file` (JPG/PNG/WEBP/PDF ≤ 8 MB) + `referencia`?
 *        → sube el comprobante al bucket privado erp-sorteos y la compra pasa a "por revisar".
 * El archivo lo sube el SERVIDOR en {schema}/{empresa}/{compra}/comprobante-<uuid>.<ext>; la base
 * vuelve a validar que la ruta sea la de esa compra.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { clientePublico } from "@/lib/supabase/publico";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { permitirIp } from "@/app/api/publico/mesas/limite";
import { compraPublica, ipDe, mensajeDb, TOKEN_RE } from "@/modules/sorteos/publico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SIN_CACHE = { "cache-control": "no-store" };
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const c = await compraPublica(token);
    if (!c) return NextResponse.json({ ok: false, error: "Compra no encontrada" }, { status: 404, headers: SIN_CACHE });
    return NextResponse.json({ ok: true, data: c }, { headers: SIN_CACHE });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo cargar la compra" }, { status: 502, headers: SIN_CACHE });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return NextResponse.json({ ok: false, error: "Compra no encontrada" }, { status: 404 });
  if (!permitirIp(`sorteo-comprobante|${ipDe(req)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiados intentos. Probá en unos minutos." }, { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const referencia = String(form?.get("referencia") ?? "").trim().slice(0, 60) || null;
  if (!(file instanceof File) || file.size < 1) return NextResponse.json({ ok: false, error: "Elegí la foto o el PDF del comprobante." }, { status: 422 });
  const ext = TIPOS[file.type];
  if (!ext) return NextResponse.json({ ok: false, error: "El comprobante tiene que ser una foto (JPG, PNG, WEBP) o un PDF." }, { status: 422 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ ok: false, error: "El archivo no puede superar 8 MB." }, { status: 422 });

  // La carpeta es la de esa compra (empresa y id): el servidor la lee, el comprador no la elige.
  const sistema = systemClient();
  const { data: fila } = await sistema.from("sorteo_ordenes").select("id, empresa_id, estado").eq("token", token).maybeSingle();
  if (!fila) return NextResponse.json({ ok: false, error: "Compra no encontrada" }, { status: 404 });
  if (fila.estado !== "pendiente_pago" && fila.estado !== "en_revision") {
    return NextResponse.json({ ok: false, error: "Esta compra ya no espera un comprobante." }, { status: 409 });
  }
  const path = `${tenantSchema()}/${fila.empresa_id}/${fila.id}/comprobante-${randomUUID()}.${ext}`;
  const bucket = sistema.storage.from("erp-sorteos");
  const { error: errSubir } = await bucket.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (errSubir) return NextResponse.json({ ok: false, error: "No se pudo guardar el comprobante. Probá de nuevo." }, { status: 502 });

  const { data, error } = await clientePublico().rpc("sorteo_publico_comprobante", { p_token: token, p_path: path, p_referencia: referencia });
  if (error) {
    await bucket.remove([path]).catch(() => {});
    return NextResponse.json({ ok: false, error: mensajeDb(error.message, "No se pudo registrar el comprobante") }, { status: 400 });
  }
  return NextResponse.json({ ok: true, data }, { headers: SIN_CACHE });
}
