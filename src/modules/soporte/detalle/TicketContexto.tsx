"use client";

import { createContext, useContext } from "react";
import type { InfoSla, Persona } from "@/modules/soporte/dominio";
import type { CatalogosConEquipo } from "@/modules/soporte/api";

export type TicketDetalle = {
  id: string;
  numero: number;
  asunto: string;
  descripcion: string | null;
  resultado_esperado: string | null;
  impacto_operativo: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_codigo: string;
  tipo_etiqueta: string;
  clasificacion_codigo: string | null;
  clasificacion_nombre: string | null;
  prioridad_codigo: string;
  prioridad_nombre: string;
  prioridad_color: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string;
  estado_tipo: "abierto" | "cerrado";
  estado_area: string | null;
  responsable_id: string | null;
  responsable: Persona | null;
  creador: Persona | null;
  proxima_accion: string | null;
  sla_horas: number | string | null;
  fecha_objetivo: string | null;
  fase?: number;
  origen: string | null;
  tipificacion_id: string | null;
  resuelto_at: string | null;
  cerrado_at: string | null;
  created_at: string;
  updated_at: string;
  sla: InfoSla;
};

export type TicketCtx = {
  ticket: TicketDetalle;
  contadores: { comentarios: number; archivos: number; relaciones: number };
  catalogos: CatalogosConEquipo;
  recargar: () => Promise<void>;
};

export const TicketContext = createContext<TicketCtx | null>(null);

export function useTicket(): TicketCtx {
  const ctx = useContext(TicketContext);
  if (!ctx) throw new Error("useTicket fuera del detalle de ticket");
  return ctx;
}
