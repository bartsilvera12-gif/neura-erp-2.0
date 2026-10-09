/**
 * Clientes — validación compartida de los campos de la ficha (alta y edición) y tipos de la
 * ficha completa. Las rutas no pueden exportar nada que no sea un handler, por eso vive acá.
 */
import { z } from "zod";

const texto = (max: number) => z.string().trim().max(max).nullish();
const email = z.string().trim().email("Email inválido").max(120).nullish().or(z.literal(""));

/** Campos editables de la ficha (todos opcionales: PATCH parcial). */
export const camposCliente = {
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(200).optional(),
  tipo_cliente: z.enum(["empresa", "persona"]).optional(),
  razon_social: texto(200),
  documento: texto(40),
  ruc: texto(40),
  nombre_contacto: texto(200),
  telefono: texto(40),
  telefono_secundario: texto(40),
  email,
  email_secundario: email,
  direccion: texto(200),
  ciudad: texto(80),
  pais: texto(80),
  sitio_web: texto(200),
  instagram: texto(120),
  linkedin: texto(200),
  categoria_id: z.string().uuid().nullish(),
  valor_anual: z.coerce.number().min(0).nullish(),
  moneda_preferida: z.enum(["GS", "USD"]).optional(),
  condicion_pago: z.enum(["CONTADO", "CREDITO"]).optional(),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  limite_credito: z.coerce.number().min(0).optional(),
  vendedor_usuario_id: z.string().uuid().nullish(),
  vendedor_texto: texto(120),
  origen: z.enum(["MANUAL", "VENTA", "CRM"]).optional(),
  notas: texto(1000),
  sifen_naturaleza: z.enum(["contribuyente", "no_contribuyente"]).nullish(),
  sifen_ti_ope: z.enum(["B2B", "B2C", "B2G", "B2F"]).nullish(),
  sifen_extranjero: z.boolean().optional(),
  sifen_pais_iso3: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "El país va en código de 3 letras (ej. ARG)").nullish().or(z.literal("")),
  sifen_tipo_documento: z.enum(["cedula", "pasaporte", "carnet_extranjero", "otro"]).nullish(),
  sifen_num_id: texto(40),
  sifen_direccion: texto(200),
  sifen_numero_casa: texto(20),
};

/** Extranjero → país distinto de PRY (SIFEN lo rechaza si no). */
export function errorSifen(v: { sifen_extranjero?: boolean; sifen_pais_iso3?: string | null }): string | null {
  if (!v.sifen_extranjero) return null;
  const p = (v.sifen_pais_iso3 ?? "").trim().toUpperCase();
  if (!p || p === "PRY") return "Si el receptor es extranjero, el país tiene que ser distinto de PRY (ej. ARG, BRA).";
  return null;
}

/** Texto vacío → null, para no guardar "" en la base. */
export function limpiarVacios(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    r[k] = typeof v === "string" && v.trim() === "" ? null : v;
  }
  return r;
}

export type Categoria = { id: string; nombre: string; color: string | null; orden?: number; activo?: boolean };

/** El cliente completo como lo devuelve GET /api/clientes/[id]. */
export type ClienteCompleto = {
  id: string;
  codigo: string | null;
  nombre: string;
  razon_social: string | null;
  tipo_cliente: "empresa" | "persona";
  documento: string | null;
  ruc: string | null;
  nombre_contacto: string | null;
  telefono: string | null;
  telefono_secundario: string | null;
  email: string | null;
  email_secundario: string | null;
  direccion: string | null;
  ciudad: string | null;
  pais: string | null;
  sitio_web: string | null;
  instagram: string | null;
  linkedin: string | null;
  categoria_id: string | null;
  categoria_nombre: string | null;
  categoria_color: string | null;
  valor_anual: number | null;
  moneda_preferida: "GS" | "USD" | null;
  condicion_pago: "CONTADO" | "CREDITO";
  plazo_dias: number | null;
  limite_credito: number | null;
  vendedor_usuario_id: string | null;
  vendedor_texto: string | null;
  vendedor_nombre: string | null;
  origen: "MANUAL" | "VENTA" | "CRM";
  notas: string | null;
  activo: boolean;
  creado_at: string;
  created_by: string | null;
  creado_por_nombre: string | null;
  baja_at: string | null;
  baja_motivo: string | null;
  baja_por_nombre: string | null;
  sifen_naturaleza: "contribuyente" | "no_contribuyente" | null;
  sifen_ti_ope: "B2B" | "B2C" | "B2G" | "B2F" | null;
  sifen_extranjero: boolean | null;
  sifen_pais_iso3: string | null;
  sifen_tipo_documento: string | null;
  sifen_num_id: string | null;
  sifen_direccion: string | null;
  sifen_numero_casa: string | null;
};
