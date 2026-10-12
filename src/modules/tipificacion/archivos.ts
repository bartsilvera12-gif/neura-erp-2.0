"use client";

/**
 * Sube evidencias a un ticket YA creado (como el actual: primero el ticket, después los
 * archivos). Por cada archivo: firma → subida directa al Storage → registro. Si uno falla
 * se sigue con el resto y se devuelve el motivo: se pueden volver a subir desde el ticket.
 */
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";

export async function subirArchivos(
  ticketId: string,
  archivos: File[],
  alAvanzar?: (hechos: number, total: number) => void,
): Promise<{ subidos: number; errores: string[] }> {
  const errores: string[] = [];
  let subidos = 0;
  for (const [i, f] of archivos.entries()) {
    try {
      const firma = await apiFetch<{ bucket: string; path: string; token: string }>("/api/tipificaciones/archivos", {
        method: "POST",
        body: JSON.stringify({ accion: "firmar", ticket_id: ticketId, nombre: f.name, mime_type: f.type, size: f.size }),
      });
      const up = await browserClient().storage.from(firma.bucket).uploadToSignedUrl(firma.path, firma.token, f, {
        contentType: f.type || "application/octet-stream",
      });
      if (up.error) throw new Error(`"${f.name}": ${up.error.message}`);
      await apiFetch("/api/tipificaciones/archivos", {
        method: "POST",
        body: JSON.stringify({ accion: "registrar", ticket_id: ticketId, path: firma.path, nombre: f.name, mime_type: f.type }),
      });
      subidos++;
    } catch (e) {
      errores.push(e instanceof Error ? e.message : `No se pudo subir "${f.name}"`);
    }
    alAvanzar?.(i + 1, archivos.length);
  }
  return { subidos, errores };
}
