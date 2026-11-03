"use client";

/**
 * Aviso del navegador (Notification API) para los recordatorios de la Agenda: aparece aunque la
 * persona esté en otra pestaña o en otro programa, mientras el ERP siga abierto en alguna.
 * No es push: con el navegador cerrado no llega.
 *
 * Cada recordatorio se avisa UNA vez por sesión del navegador (sessionStorage), aunque la
 * página se recargue o la campanita lo vuelva a traer en cada poll.
 */

const CLAVE = "erp:avisos-navegador";

const soportado = () => typeof window !== "undefined" && "Notification" in window;

/** Pide el permiso si todavía no se decidió (tiene que ser después de un click). */
export function pedirPermisoAvisos(): void {
  if (!soportado() || Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => {});
}

function yaAvisados(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(CLAVE) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Muestra los que todavía no se avisaron. */
export function avisarEnNavegador(items: { id: string; titulo: string; cuerpo: string | null; url: string | null }[]): void {
  if (!soportado() || Notification.permission !== "granted" || items.length === 0) return;
  const vistos = yaAvisados();
  const nuevos = items.filter((n) => !vistos.has(n.id));
  if (nuevos.length === 0) return;
  for (const n of nuevos) {
    try {
      const aviso = new Notification(n.titulo, { body: n.cuerpo ?? undefined, tag: n.id, icon: "/brand/zentra-logo-360.webp" });
      aviso.onclick = () => {
        window.focus();
        if (n.url) window.location.assign(n.url);
        aviso.close();
      };
    } catch {
      // Algunos navegadores (Android) solo avisan desde un service worker: queda la campanita.
    }
    vistos.add(n.id);
  }
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify([...vistos].slice(-200)));
  } catch {
    /* sin almacenamiento: a lo sumo se repite al recargar */
  }
}
