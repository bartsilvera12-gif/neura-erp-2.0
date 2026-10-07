/**
 * Lectura de planillas (SheetJS) y datos del catálogo para las importaciones de inventario.
 * Solo servidor.
 */
import * as XLSX from "xlsx";
import type { TenantDb } from "@/lib/api/tenant-db";
import { parseNumero } from "@/lib/imports/consolidacion-productos";

export const MAX_BYTES_EXCEL = 5 * 1024 * 1024; // importación normal: 5 MB
export const MAX_FILAS_EXCEL = 5000; // importación normal: 5.000 filas
export const MAX_BYTES_INICIAL = 30 * 1024 * 1024; // reportes del sistema anterior: 30 MB

/** "Código Barras" → "CODIGO_BARRAS" (sin acentos, MAYÚSCULAS, espacios → _). */
export function normalizarEncabezado(h: string): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

export type Celda = string | number | boolean | Date | null;
export type FilaPlanilla = Record<string, Celda>;

/** Primera hoja como filas con encabezados normalizados. Respeta celdas numéricas. */
export function leerPlanilla(buf: ArrayBuffer): FilaPlanilla[] {
  // raw: en un CSV, SheetJS convertiría "12,5" en 125 (toma la coma como miles). Así llega
  // como texto y lo interpreta parseNumero; en .xlsx las celdas numéricas siguen siendo números.
  const wb = XLSX.read(buf, { type: "array", raw: true });
  const hoja = wb.SheetNames[0];
  if (!hoja) return [];
  const crudas = XLSX.utils.sheet_to_json<Record<string, Celda>>(wb.Sheets[hoja], { defval: "", raw: true });
  return crudas.map((r) => {
    const out: FilaPlanilla = {};
    for (const [k, v] of Object.entries(r)) out[normalizarEncabezado(k)] = v;
    return out;
  });
}

/** Primera hoja como matriz cruda (reportes "sucios": sin asumir encabezado). */
export function leerMatriz(buf: ArrayBuffer): unknown[][] {
  // raw: igual que leerPlanilla — en CSV "25.000" llegaría como 25; así lo interpreta parseNumero.
  const wb = XLSX.read(buf, { type: "array", raw: true });
  const hoja = wb.SheetNames[0];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, defval: "", blankrows: false });
}

/** Primer alias con valor no vacío. */
export function tomar(fila: FilaPlanilla, ...alias: string[]): Celda {
  for (const a of alias) {
    const v = fila[a];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}
export const texto = (v: Celda) => (v == null ? "" : String(v).trim().toUpperCase());
/** Número: si la celda ya es numérica se usa tal cual; si es texto, "1.234,5" / "Gs. 15.000". */
export function numero(v: Celda): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return parseNumero(String(v ?? "")) ?? 0;
}
/** Vacío = sí (como Ferretería). Sí: si/sí/true/1/yes/y/activo. */
export function booleano(v: Celda): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return true;
  return ["si", "sí", "true", "1", "yes", "y", "activo"].includes(s);
}
export function iva(v: Celda): "10%" | "5%" | "EXENTA" | null {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s/g, "");
  if (!s) return null;
  if (s.includes("EXENT") || s === "0" || s === "0%") return "EXENTA";
  if (s === "5" || s === "5%" || s === "0.05") return "5%";
  if (s === "10" || s === "10%" || s === "0.1") return "10%";
  return null;
}

// ── Catálogo existente ────────────────────────────────────────────────────────
export type ProductoExistente = {
  id: string;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  codigo_fabrica: string | null;
  stock_actual: number;
};

/** Todos los productos de la empresa (activos o no), en tandas de 1000 (tope de PostgREST). */
export async function traerCatalogo(db: TenantDb): Promise<ProductoExistente[]> {
  const out: ProductoExistente[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db
      .select("productos", "id, nombre, sku, codigo_barras, codigo_fabrica, stock_actual")
      .order("id", { ascending: true })
      .range(desde, desde + 999);
    if (error) throw new Error("db");
    const tanda = (data ?? []) as unknown as ProductoExistente[];
    out.push(...tanda.map((p) => ({ ...p, stock_actual: Number(p.stock_actual) || 0 })));
    if (tanda.length < 1000) break;
  }
  return out;
}

/** Nombres de categorías (activas o no) en MAYÚSCULAS. */
export async function traerCategorias(db: TenantDb): Promise<Map<string, { id: string; activo: boolean }>> {
  const { data, error } = await db.select("categorias_productos", "id, nombre, activo");
  if (error) throw new Error("db");
  const m = new Map<string, { id: string; activo: boolean }>();
  for (const c of (data ?? []) as unknown as { id: string; nombre: string; activo: boolean }[]) {
    m.set(c.nombre.trim().toUpperCase(), { id: c.id, activo: c.activo });
  }
  return m;
}

/** Generador de SKU "P-000123" que no choca con los existentes. */
export function generadorSku(catalogo: { sku: string }[]) {
  let max = 0;
  for (const p of catalogo) {
    const m = /^P-(\d+)$/i.exec(p.sku ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return () => `P-${String(++max).padStart(6, "0")}`;
}

/** Fila lista para la RPC aplicar_importacion_productos. */
export type FilaRpc = {
  fila?: string;
  id?: string | null;
  nombre: string;
  sku: string;
  codigo_barras?: string | null;
  codigo_fabrica?: string | null;
  categoria?: string | null;
  unidad?: string | null;
  costo?: number | null;
  costo_mayorista?: number | null;
  precio?: number | null;
  stock?: number | null;
  stock_minimo?: number | null;
  tipo_iva?: string | null;
  activo?: boolean;
};

export type ResultadoRpc = {
  creados: number;
  actualizados: number;
  errores: number;
  mensajes_error: string[];
  categorias_creadas: number;
  movimientos_generados: number;
  unidades_entrada: number;
  unidades_salida: number;
};

/** Aplica la importación en tandas de 1000 (cada tanda = una transacción en la base). */
export async function aplicarEnTandas(
  db: TenantDb,
  filas: FilaRpc[],
  opts: { modo: "excel" | "inicial"; crearCategorias: boolean; origen: string; referencia: string },
): Promise<ResultadoRpc> {
  const total: ResultadoRpc = {
    creados: 0, actualizados: 0, errores: 0, mensajes_error: [],
    categorias_creadas: 0, movimientos_generados: 0, unidades_entrada: 0, unidades_salida: 0,
  };
  for (let i = 0; i < filas.length; i += 1000) {
    const { data, error } = await db.rpc<ResultadoRpc>("aplicar_importacion_productos", {
      p_filas: filas.slice(i, i + 1000),
      p_modo: opts.modo,
      p_crear_categorias: opts.crearCategorias,
      p_origen: opts.origen,
      p_referencia: opts.referencia,
    });
    if (error || !data) throw new Error(error?.message ?? "No se pudo aplicar la importación");
    total.creados += data.creados;
    total.actualizados += data.actualizados;
    total.errores += data.errores;
    total.categorias_creadas += data.categorias_creadas;
    total.movimientos_generados += data.movimientos_generados;
    total.unidades_entrada += Number(data.unidades_entrada) || 0;
    total.unidades_salida += Number(data.unidades_salida) || 0;
    total.mensajes_error.push(...(data.mensajes_error ?? []));
  }
  total.mensajes_error = total.mensajes_error.slice(0, 50);
  return total;
}
