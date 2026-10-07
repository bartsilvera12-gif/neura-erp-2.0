"use client";

import { browserClient } from "@/lib/supabase/browser";

/**
 * Sube una imagen de producto al bucket "productos" (público) y devuelve su URL.
 * El bucket es global del Supabase; el path lleva un uuid para no colisionar.
 */
export async function subirImagenProducto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo debe ser una imagen.");
  if (file.size > 5 * 1024 * 1024) throw new Error("La imagen no puede superar 5 MB.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `prod/${crypto.randomUUID()}.${ext}`;
  const sb = browserClient();
  const { error } = await sb.storage.from("productos").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
}
