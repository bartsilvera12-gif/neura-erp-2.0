"use client";

/**
 * Llamadas del front de Proyectos que no son un GET/POST simple: subida de archivos
 * directo al Storage (sin pasar el archivo por el servidor).
 */
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Sube archivos a un proyecto: pedir URL firmada (el servidor valida tipo y tamaño y
 * decide la ruta), subir desde el navegador y registrar. Si uno falla, los demás siguen.
 * Con `comentarioId` quedan además como adjuntos de ese comentario.
 */
export async function subirArchivos(
  proyectoId: string,
  archivos: File[],
  opciones?: { comentarioId?: string | null; alAvanzar?: (hechos: number, total: number) => void },
): Promise<{ subidos: number; errores: string[] }> {
  const base = `/api/proyectos/${proyectoId}/archivos`;
  const errores: string[] = [];
  let subidos = 0;
  for (const [i, f] of archivos.entries()) {
    try {
      const firma = await apiFetch<{ bucket: string; path: string; token: string }>(`${base}/firmar`, {
        method: "POST",
        body: JSON.stringify({ nombre: f.name, mime_type: f.type, size: f.size }),
      });
      const up = await browserClient()
        .storage.from(firma.bucket)
        .uploadToSignedUrl(firma.path, firma.token, f, { contentType: f.type || "application/octet-stream" });
      if (up.error) throw new Error(`"${f.name}": ${up.error.message}`);
      await apiFetch(base, {
        method: "POST",
        body: JSON.stringify({ path: firma.path, nombre: f.name, mime_type: f.type, comentario_id: opciones?.comentarioId ?? null }),
      });
      subidos++;
    } catch (e) {
      errores.push(e instanceof Error ? e.message : `No se pudo subir "${f.name}"`);
    }
    opciones?.alAvanzar?.(i + 1, archivos.length);
  }
  return { subidos, errores };
}

/** Abre un archivo (adjunto de comentario) pidiendo su URL firmada en el momento. */
export async function abrirArchivo(proyectoId: string, archivoId: string, descargar = false): Promise<void> {
  // La pestaña se abre en el click (sincrónico) para que el navegador no la bloquee.
  const w = window.open("", "_blank");
  try {
    const r = await apiFetch<{ url: string | null; url_descarga: string | null }>(`/api/proyectos/${proyectoId}/archivos/${archivoId}`);
    const url = descargar ? r.url_descarga : r.url;
    if (!url) throw new Error("No se pudo abrir el archivo");
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}
