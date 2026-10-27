/** Llamadas del navegador a /api/conversaciones (todas con la sesión como Bearer). */
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import type { Contadores, Cursor, FilaBandeja, Mensaje, OpcionesBandeja, PaginaBandeja, Vista } from "@/modules/conversaciones/dominio";

const B = "/api/conversaciones";

/** asesor: id de usuario, o SIN_ASIGNAR para las que no tienen asesor. */
export type FiltrosBandeja = { vista: Vista; q: string; canal: string; asesor: string; cola?: string };
export const SIN_ASIGNAR = "__sin__";

export function pedirBandeja(f: FiltrosBandeja, cursor: Cursor | null, signal?: AbortSignal): Promise<PaginaBandeja> {
  const sp = new URLSearchParams({ vista: f.vista });
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.canal) sp.set("canal", f.canal);
  if (f.asesor === SIN_ASIGNAR) sp.set("sin_asignar", "1");
  else if (f.asesor) sp.set("asignado", f.asesor);
  if (f.cola) sp.set("cola", f.cola);
  if (cursor) {
    sp.set("cursor_at", cursor.at);
    sp.set("cursor_id", cursor.id);
  }
  return apiFetch<PaginaBandeja>(`${B}?${sp}`, { signal });
}

export const pedirContadores = () => apiFetch<{ contadores: Contadores }>(`${B}?solo=contadores`).then((r) => r.contadores);
export const pedirResumen = (id: string) => apiFetch<FilaBandeja>(`${B}/${id}/resumen`);

export const pedirOpciones = (fresco = false) => apiFetchCache<OpcionesBandeja>(`${B}/opciones`, { ttlMs: 5 * 60_000, fresco });
export const olvidarOpciones = () => invalidar(`${B}/opciones`);

export type PaginaHilo = { mensajes: Mensaje[]; hay_mas: boolean };
export function pedirHilo(id: string, o: { antes?: { at: string; id: string }; desde?: string } = {}, signal?: AbortSignal): Promise<PaginaHilo> {
  const sp = new URLSearchParams();
  if (o.antes) {
    sp.set("antes_at", o.antes.at);
    sp.set("antes_id", o.antes.id);
  }
  if (o.desde) sp.set("desde_at", o.desde);
  const q = sp.toString();
  return apiFetch<PaginaHilo>(`${B}/${id}/mensajes${q ? `?${q}` : ""}`, { signal });
}

export type CuerpoMensaje =
  | { tipo: "texto"; contenido: string; responde_a?: string | null }
  | { tipo: "nota"; contenido: string }
  | { tipo: "plantilla"; plantilla_id: string; variables: Record<string, string> };

export const enviarMensaje = (id: string, cuerpo: CuerpoMensaje) =>
  apiFetch<Mensaje>(`${B}/${id}/mensajes`, { method: "POST", body: JSON.stringify(cuerpo) });

export function enviarAdjunto(id: string, archivo: File | Blob, o: { nombre?: string; caption?: string; responde_a?: string | null; notaVoz?: boolean } = {}) {
  const fd = new FormData();
  fd.set("archivo", archivo, o.nombre ?? (archivo instanceof File ? archivo.name : "archivo"));
  if (o.caption) fd.set("caption", o.caption);
  if (o.responde_a) fd.set("responde_a", o.responde_a);
  if (o.notaVoz) fd.set("nota_voz", "1");
  return apiForm<Mensaje>(`${B}/${id}/adjuntos`, fd);
}

export const pedirUrlsMedia = (id: string, ids: string[]) =>
  apiFetch<{ urls: Record<string, string> }>(`${B}/${id}/media`, { method: "POST", body: JSON.stringify({ ids }) }).then((r) => r.urls);

export const marcarLeida = (id: string) => apiFetch(`${B}/${id}/leida`, { method: "POST" });

export type AccionConversacion =
  | { accion: "tomar" | "soltar" | "reabrir" | "pendiente" | "abierta" }
  | { accion: "transferir"; asignado_id: string }
  | { accion: "derivar"; cola_id: string }
  | { accion: "etiquetas"; etiquetas: string[] };
export const accionConversacion = (id: string, a: AccionConversacion) =>
  apiFetch<FilaBandeja>(`${B}/${id}`, { method: "PATCH", body: JSON.stringify(a) });

export type CatalogoCierre = {
  familias: { id: string; nombre: string; subestados: { id: string; nombre: string; comportamiento: string | null }[] }[];
  clasificaciones: { codigo: string; tipo_codigo: string; nombre: string; sla_horas: number | null }[];
  puede_soporte: boolean;
};
export const pedirCatalogoCierre = () => apiFetchCache<CatalogoCierre>(`${B}/cierre`, { ttlMs: 5 * 60_000 });

export const finalizar = (
  id: string,
  cuerpo: {
    familia_id: string;
    estado_id: string;
    observacion: string;
    ticket?: { clasificacion_codigo: string | null } | null;
    /** Opcional: fecha ("YYYY-MM-DD") y nota del seguimiento. */
    proxima_accion?: { fecha: string; nota: string | null } | null;
  },
) =>
  apiFetch<{ fila: FilaBandeja | null; tipificacion_id: string | null; ticket: { id: string; numero: number } | null }>(`${B}/${id}/finalizar`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
  });

export const crearTicket = (id: string, cuerpo: { familia_id: string; estado_id: string; observacion: string; clasificacion_codigo: string | null }) =>
  apiFetch<{ tipificacion_id: string; ticket: { id: string; numero: number } | null }>(`${B}/${id}/ticket`, { method: "POST", body: JSON.stringify(cuerpo) });

export type Ficha = {
  contacto: { id: string; nombre: string | null; telefono: string | null; creado_at: string };
  cierre: { fecha: string; estado: string | null; subestado: string | null; observacion: string | null; por: string | null; reabierta: boolean } | null;
  cliente: {
    id: string; codigo: string | null; nombre: string; ruc: string | null; telefono: string | null; email: string | null; ciudad: string | null;
    activo: boolean; deuda: number; vinculado_ahora: boolean;
    suscripciones: { id: string; plan_nombre: string; precio: number; moneda: string }[];
    tickets: { id: string; numero: number; asunto: string; estado_nombre: string; estado_color: string | null; created_at: string }[];
    ultima_tipificacion: { id: string; fecha: string; usuario: string; tipo_gestion: string; resultado: string; observacion: string } | null;
  } | null;
  prospecto: { id: string; numero_control: string; contacto: string; empresa: string | null; etapa: string; etapa_nombre: string | null; valor_estimado: number } | null;
  /** Las otras conversaciones del contacto (otros canales), de la más reciente a la más vieja. */
  previas: {
    id: string; canal: string; canal_tipo: string; estado: "abierta" | "pendiente" | "cerrada"; created_at: string;
    ultimo_mensaje_at: string | null; cerrada_at: string | null; asignado: string | null; cierre_estado: string | null;
  }[];
  /** Proyectos activos del cliente vinculado. */
  proyectos: { id: string; numero: string; titulo: string; estado: string | null; color: string | null }[];
};
export const pedirFicha = (id: string) => apiFetch<Ficha>(`${B}/${id}/ficha`);
export const vincularCliente = (id: string, clienteId: string | null) =>
  apiFetch<FilaBandeja>(`${B}/${id}/vincular`, { method: "POST", body: JSON.stringify({ cliente_id: clienteId }) });
export const crearProspecto = (id: string) =>
  apiFetch<{ prospecto: { id: string; numero_control: string }; fila: FilaBandeja | null }>(`${B}/${id}/prospecto`, { method: "POST", body: "{}" });

export const simularEntrante = (c: { telefono: string; nombre?: string; texto: string }) =>
  apiFetch<{ conversacion_id: string }>(`${B}/simular`, { method: "POST", body: JSON.stringify(c) });
