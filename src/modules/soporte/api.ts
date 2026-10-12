"use client";

/**
 * Soporte — llamadas del navegador a /api/soporte (con memoria corta y "en vuelo"):
 * entrar a una pantalla no dispara dos veces lo mismo, y el detalle de un ticket
 * precargado al pasar el mouse por la fila abre armado.
 */
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import type { CatalogosSoporte, ConfigSoporte, Persona } from "@/modules/soporte/dominio";

export type { Persona };

/** Llamada a la API de Soporte. `json` se manda como body. Tira Error con el mensaje del servidor. */
export function apiSoporte<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...resto } = init ?? {};
  return apiFetch<T>(url, { cache: "no-store", ...resto, body: json !== undefined ? JSON.stringify(json) : resto.body });
}

export type CatalogosConEquipo = CatalogosSoporte & {
  personas: Persona[];
  config: ConfigSoporte;
  hay_equipo: boolean;
  puede_configurar: boolean;
  usuario_id: string;
};

function memoria<T>(ttlMs: number) {
  const datos = new Map<string, { valor: T; vence: number }>();
  const enVuelo = new Map<string, Promise<T>>();
  return {
    obtener(clave: string, cargar: () => Promise<T>, forzar = false): Promise<T> {
      const e = datos.get(clave);
      if (!forzar && e && e.vence > Date.now()) return Promise.resolve(e.valor);
      const vuelo = enVuelo.get(clave);
      if (!forzar && vuelo) return vuelo;
      const p = cargar()
        .then((valor) => {
          datos.set(clave, { valor, vence: Date.now() + ttlMs });
          return valor;
        })
        .finally(() => enVuelo.delete(clave));
      enVuelo.set(clave, p);
      return p;
    },
    ya(clave: string): T | undefined {
      return datos.get(clave)?.valor;
    },
    borrar(clave?: string) {
      if (clave) datos.delete(clave);
      else datos.clear();
    },
  };
}

const memCatalogos = memoria<CatalogosConEquipo>(5 * 60_000);
const memClientes = memoria<{ id: string; nombre: string }[]>(5 * 60_000);

export function obtenerCatalogos(forzar = false): Promise<CatalogosConEquipo> {
  return memCatalogos.obtener("c", () => apiSoporte<CatalogosConEquipo>("/api/soporte/catalogos"), forzar);
}
export const catalogosEnMemoria = () => memCatalogos.ya("c");
export const invalidarCatalogos = () => memCatalogos.borrar();

export function obtenerClientes(): Promise<{ id: string; nombre: string }[]> {
  return memClientes.obtener("c", () => apiSoporte<{ clientes: { id: string; nombre: string }[] }>("/api/soporte/opciones").then((r) => r.clientes));
}
export const clientesEnMemoria = () => memClientes.ya("c");

const memTicket = memoria<unknown>(20_000);
const memComentarios = memoria<unknown>(20_000);
const memSubtareas = memoria<unknown>(20_000);
const memHistorial = memoria<unknown>(20_000);
const memArchivos = memoria<unknown>(20_000);
const memRelaciones = memoria<unknown>(20_000);

const base = (id: string) => `/api/soporte/tickets/${id}`;

/** Precarga lo que pinta el detalle (ticket, comentarios y subtareas). */
export function precargarTicket(id: string): void {
  void memTicket.obtener(id, () => apiSoporte(base(id))).catch(() => {});
  void memComentarios.obtener(id, () => apiSoporte(`${base(id)}/comentarios`)).catch(() => {});
  void memSubtareas.obtener(id, () => apiSoporte(`${base(id)}/subtareas`)).catch(() => {});
}

/** Las pestañas del detalle se preparan apenas se abre el ticket. */
export function precargarPestanas(id: string): void {
  void memHistorial.obtener(id, () => apiSoporte(`${base(id)}/historial`)).catch(() => {});
  void memArchivos.obtener(id, () => apiSoporte(`${base(id)}/archivos`)).catch(() => {});
  void memRelaciones.obtener(id, () => apiSoporte(`${base(id)}/relaciones`)).catch(() => {});
}

export const obtenerTicket = <T,>(id: string, forzar = false) => memTicket.obtener(id, () => apiSoporte(base(id)), forzar) as Promise<T>;
export const ticketEnMemoria = <T,>(id: string) => memTicket.ya(id) as T | undefined;
export const obtenerComentarios = <T,>(id: string, forzar = false) =>
  memComentarios.obtener(id, () => apiSoporte(`${base(id)}/comentarios`), forzar) as Promise<T>;
export const comentariosEnMemoria = <T,>(id: string) => memComentarios.ya(id) as T | undefined;
export const obtenerSubtareas = <T,>(id: string, forzar = false) =>
  memSubtareas.obtener(id, () => apiSoporte(`${base(id)}/subtareas`), forzar) as Promise<T>;
export const subtareasEnMemoria = <T,>(id: string) => memSubtareas.ya(id) as T | undefined;
export const obtenerHistorial = <T,>(id: string, forzar = false) =>
  memHistorial.obtener(id, () => apiSoporte(`${base(id)}/historial`), forzar) as Promise<T>;
export const historialEnMemoria = <T,>(id: string) => memHistorial.ya(id) as T | undefined;
export const obtenerArchivos = <T,>(id: string, forzar = false) =>
  memArchivos.obtener(id, () => apiSoporte(`${base(id)}/archivos`), forzar) as Promise<T>;
export const archivosEnMemoria = <T,>(id: string) => memArchivos.ya(id) as T | undefined;
export const obtenerRelaciones = <T,>(id: string, forzar = false) =>
  memRelaciones.obtener(id, () => apiSoporte(`${base(id)}/relaciones`), forzar) as Promise<T>;
export const relacionesEnMemoria = <T,>(id: string) => memRelaciones.ya(id) as T | undefined;

/** Lo común del módulo, apenas se entra: la siguiente pantalla ya lo tiene. */
export function precargarModulo(): void {
  void obtenerCatalogos().catch(() => {});
  void obtenerClientes().catch(() => {});
}

/**
 * Sube archivos a un ticket, directo al Storage (sin pasar por el servidor):
 * pedir URL firmada (el servidor valida tipo y tamaño y decide la ruta), subir
 * desde el navegador y registrar. Si uno falla, los demás siguen.
 */
export async function subirArchivos(
  ticketId: string,
  archivos: File[],
  opciones?: { comentarioId?: string | null; alAvanzar?: (hechos: number, total: number) => void },
): Promise<{ subidos: number; errores: string[] }> {
  const errores: string[] = [];
  let subidos = 0;
  for (const [i, f] of archivos.entries()) {
    try {
      const firma = await apiSoporte<{ bucket: string; path: string; token: string }>(`${base(ticketId)}/archivos/firmar`, {
        method: "POST",
        json: { nombre: f.name, mime_type: f.type, size: f.size },
      });
      const up = await browserClient()
        .storage.from(firma.bucket)
        .uploadToSignedUrl(firma.path, firma.token, f, { contentType: f.type || "application/octet-stream" });
      if (up.error) throw new Error(`"${f.name}": ${up.error.message}`);
      await apiSoporte(`${base(ticketId)}/archivos`, {
        method: "POST",
        json: { path: firma.path, nombre: f.name, mime_type: f.type, comentario_id: opciones?.comentarioId ?? null },
      });
      subidos++;
    } catch (e) {
      errores.push(e instanceof Error ? e.message : `No se pudo subir "${f.name}"`);
    }
    opciones?.alAvanzar?.(i + 1, archivos.length);
  }
  return { subidos, errores };
}
