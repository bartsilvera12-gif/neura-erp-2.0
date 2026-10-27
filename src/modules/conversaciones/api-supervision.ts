/** Llamadas del navegador de la fase 2 (Monitoreo, Finalizadas, Historial, presencia, colas). */
import { apiFetch } from "@/lib/api/client-fetch";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import type {
  AgenteCarga, ContactoBuscado, DatosColas, DatosMonitoreo, EstadoAgente, Historial, LeadDia, PaginaFinalizadas,
} from "@/modules/conversaciones/supervision";

const B = "/api/conversaciones";

export const latir = (estado?: EstadoAgente | null) =>
  apiFetch<{ estado: EstadoAgente }>(`${B}/presencia`, { method: "POST", body: JSON.stringify({ estado: estado ?? null }) });

export const pedirMonitoreo = (fecha?: string, signal?: AbortSignal) =>
  apiFetch<DatosMonitoreo>(`${B}/monitoreo${fecha ? `?fecha=${fecha}` : ""}`, { signal });

export const pedirLeads = (agente: string, fecha: string) =>
  apiFetch<{ leads: LeadDia[] }>(`${B}/monitoreo/leads?${new URLSearchParams({ agente, fecha })}`).then((r) => r.leads);

export const pedirCargaAgentes = () => apiFetch<{ agentes: AgenteCarga[] }>(`${B}/agentes`).then((r) => r.agentes);

export const asignarAutomatico = (id: string) =>
  apiFetch<{ asignada: boolean; motivo?: string; usuario_id?: string; fila: FilaBandeja | null }>(`${B}/${id}/asignar`, { method: "POST", body: "{}" });

export type FiltrosFinalizadas = {
  desde: string; hasta: string; asesor: string; asignado: string; cola: string; estado: string; semaforo: string; q: string;
};
export type AlcanceFinalizadas = "todas" | "equipo" | "propias";
export function pedirFinalizadas(f: FiltrosFinalizadas, cursor: { at: string; id: string; offset?: number } | null, signal?: AbortSignal, seguimientos = false) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) sp.set(k, v.trim());
  if (seguimientos) sp.set("modo", "seguimientos");
  // Con búsqueda (orden por relevancia) se pagina por offset; si no, keyset.
  if (cursor?.offset != null) sp.set("offset", String(cursor.offset));
  else if (cursor) {
    sp.set("cursor_at", cursor.at);
    sp.set("cursor_id", cursor.id);
  }
  return apiFetch<PaginaFinalizadas & { alcance: AlcanceFinalizadas }>(`${B}/finalizadas?${sp}`, { signal });
}
export const marcarSeguimiento = (id: string, hecho: boolean) =>
  apiFetch<{ id: string; seguimiento_hecho_at: string | null }>(`${B}/${id}/seguimiento`, { method: "POST", body: JSON.stringify({ hecho }) });

export const buscarContactos = (q: string, signal?: AbortSignal) =>
  apiFetch<{ contactos: ContactoBuscado[] }>(`${B}/historial?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.contactos);
export const pedirHistorial = (contacto: string, signal?: AbortSignal) =>
  apiFetch<Historial>(`${B}/historial?contacto=${contacto}`, { signal });

export const pedirColas = () => apiFetch<DatosColas>(`${B}/colas`);
export type CuerpoCola = Omit<DatosColas["colas"][number], "id">;
export const crearCola = (c: CuerpoCola) => apiFetch<{ id: string }>(`${B}/colas`, { method: "POST", body: JSON.stringify(c) });
export const guardarCola = (id: string, c: CuerpoCola) => apiFetch<{ id: string }>(`${B}/colas/${id}`, { method: "PATCH", body: JSON.stringify(c) });
export const borrarCola = (id: string) => apiFetch<{ id: string }>(`${B}/colas/${id}`, { method: "DELETE" });
/** Reemplaza los asesores de UN supervisor (lista vacía = vuelve a ver a todos). */
export const guardarSupervisor = (supervisor_id: string, asesores: string[]) =>
  apiFetch<{ supervisor_id: string; asesores: string[] }>(`${B}/supervisores`, { method: "PUT", body: JSON.stringify({ supervisor_id, asesores }) });
