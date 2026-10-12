"use client";

/**
 * URLs firmadas de los adjuntos, cacheadas EN MEMORIA por mensaje (duran 1 h; se renuevan a
 * los 50 min). Se piden en lote solo las que faltan, una vez por mensaje.
 */
import { useEffect, useState } from "react";
import { pedirUrlsMedia } from "@/modules/conversaciones/api";
import type { Mensaje } from "@/modules/conversaciones/dominio";

const VIGENCIA_MS = 50 * 60_000;
const cache = new Map<string, { url: string; hasta: number }>();
const enCurso = new Set<string>();

function vigente(id: string): string | null {
  const c = cache.get(id);
  if (c && c.hasta > Date.now()) return c.url;
  if (c) cache.delete(id);
  return null;
}

/** El adjunto recién enviado ya está en memoria (blob local): se usa ese, sin pedir URL. */
export function sembrarUrl(mensajeId: string, url: string) {
  cache.set(mensajeId, { url, hasta: Date.now() + VIGENCIA_MS });
}

export function useUrlsMedia(conversacionId: string, mensajes: Mensaje[]): Record<string, string> {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const faltan = mensajes
      .filter((m) => m.media_path && !m.local && !vigente(m.id) && !enCurso.has(m.id))
      .map((m) => m.id);
    if (!faltan.length) return;
    for (let i = 0; i < faltan.length; i += 100) {
      const lote = faltan.slice(i, i + 100);
      lote.forEach((id) => enCurso.add(id));
      pedirUrlsMedia(conversacionId, lote)
        .then((urls) => {
          const hasta = Date.now() + VIGENCIA_MS;
          for (const [id, url] of Object.entries(urls)) cache.set(id, { url, hasta });
          setVersion((v) => v + 1);
        })
        .catch(() => {})
        .finally(() => lote.forEach((id) => enCurso.delete(id)));
    }
  }, [conversacionId, mensajes]);

  const out: Record<string, string> = {};
  for (const m of mensajes) {
    if (m.local?.url) out[m.id] = m.local.url;
    else if (m.media_path) {
      const u = vigente(m.id);
      if (u) out[m.id] = u;
    }
  }
  return out;
}

/** Descarga con el nombre del archivo (la URL firmada es de otro origen: se baja como blob). */
export async function descargar(url: string, nombre: string): Promise<void> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = nombre || "archivo";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
