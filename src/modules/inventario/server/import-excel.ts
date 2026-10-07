/**
 * Importación NORMAL de productos desde Excel (portada de Ferretería República).
 *   - Cruce con lo existente: primero código de barras, después SKU (activos o no).
 *   - Con cruce → UPDATE (pisa todos los campos, como Ferretería); sin cruce → INSERT.
 *   - Categorías por nombre; las que falten se crean solo si el usuario lo pide.
 *   - Toda diferencia de stock queda en el kardex (movimientos_inventario).
 * Diferencias con el original: números robustos (12,5 / 12.5 / 1.234), SKU generado si
 * falta (el 2.0 lo exige), columna IVA opcional, categorías inactivas también cuentan.
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import {
  booleano, generadorSku, iva, leerPlanilla, MAX_FILAS_EXCEL, numero, tomar, texto, traerCatalogo, traerCategorias,
  type FilaPlanilla, type FilaRpc,
} from "./excel-io";

export const COLUMNAS_PLANTILLA = [
  "NOMBRE", "SKU", "CODIGO_BARRAS", "CATEGORIA", "UNIDAD_MEDIDA", "COSTO_PROMEDIO",
  "PRECIO_VENTA", "STOCK_ACTUAL", "STOCK_MINIMO", "IVA", "ACTIVO",
] as const;

export type AccionFila = "INSERT" | "UPDATE" | "SKIP" | "ERROR";

export type FilaPreview = {
  row_number: number;
  action: AccionFila;
  warnings: string[];
  errors: string[];
  data: Record<string, string>;
};

export type PreviewExcel = {
  summary: {
    total: number;
    insertar: number;
    actualizar: number;
    omitir: number;
    errores: number;
    warnings: number;
    faltantes: { categorias: string[] };
    movimientos_a_generar: number;
    unidades_entrada: number;
    unidades_salida: number;
  };
  rows: FilaPreview[];
  headers: string[];
  /** Solo servidor: lo que se manda a la base al confirmar. */
  _filas: FilaRpc[];
};

type Parseada = {
  row_number: number;
  nombre: string;
  sku: string;
  codigo_barras: string;
  categoria: string;
  unidad: string;
  costo: number;
  precio: number;
  stock: number;
  stock_minimo: number;
  tipo_iva: string | null;
  activo: boolean;
  errors: string[];
  warnings: string[];
};

function parsearFila(f: FilaPlanilla, i: number): Parseada {
  const p: Parseada = {
    row_number: i + 2,
    // Nombre y SKU tal cual vienen (el 2.0 respeta mayúsculas/minúsculas; Ferretería
    // pasaba todo a MAYÚSCULAS). El cruce con lo existente igual es sin distinguirlas.
    nombre: String(tomar(f, "NOMBRE")).trim(),
    sku: String(tomar(f, "SKU")).trim(),
    codigo_barras: texto(tomar(f, "CODIGO_BARRAS", "CODIGOBARRAS")),
    categoria: texto(tomar(f, "CATEGORIA", "CATEGORIA_PRINCIPAL")),
    unidad: String(tomar(f, "UNIDAD_MEDIDA", "UNIDADMEDIDA", "UNIDAD") || "Unidad").trim(),
    costo: numero(tomar(f, "COSTO_PROMEDIO", "COSTO")),
    precio: numero(tomar(f, "PRECIO_VENTA", "PRECIO")),
    stock: numero(tomar(f, "STOCK_ACTUAL", "STOCK")),
    stock_minimo: numero(tomar(f, "STOCK_MINIMO")),
    tipo_iva: null,
    activo: booleano(tomar(f, "ACTIVO")),
    errors: [],
    warnings: [],
  };
  if (!p.nombre) p.errors.push("NOMBRE obligatorio.");
  const ivaCrudo = tomar(f, "IVA", "TIPO_IVA");
  if (ivaCrudo !== "") {
    p.tipo_iva = iva(ivaCrudo);
    if (!p.tipo_iva) p.warnings.push(`IVA "${ivaCrudo}" no reconocido: se usa 10%.`);
  }
  if (p.costo < 0 || p.precio < 0) p.errors.push("Costo y precio no pueden ser negativos.");
  return p;
}

export async function previewExcel(db: TenantDb, buf: ArrayBuffer): Promise<PreviewExcel> {
  const crudas = leerPlanilla(buf);
  if (crudas.length > MAX_FILAS_EXCEL) throw new Error(`Demasiadas filas (máx. ${MAX_FILAS_EXCEL.toLocaleString("es-PY")}).`);

  const [catalogo, categorias] = await Promise.all([traerCatalogo(db), traerCategorias(db)]);
  const porBarras = new Map<string, (typeof catalogo)[number]>();
  const porSku = new Map<string, (typeof catalogo)[number]>();
  for (const p of catalogo) {
    if (p.codigo_barras) porBarras.set(p.codigo_barras.toUpperCase(), p);
    if (p.sku) porSku.set(p.sku.toUpperCase(), p);
  }
  const nuevoSku = generadorSku(catalogo);

  const vistosSku = new Set<string>();
  const vistosBarras = new Set<string>();
  const faltantes = new Set<string>();
  const rows: FilaPreview[] = [];
  const filas: FilaRpc[] = [];
  let movs = 0;
  let ent = 0;
  let sal = 0;

  crudas.forEach((cruda, i) => {
    const p = parsearFila(cruda, i);
    if (p.sku) {
      if (vistosSku.has(p.sku.toUpperCase())) p.errors.push(`SKU "${p.sku}" duplicado en el archivo.`);
      vistosSku.add(p.sku.toUpperCase());
    }
    if (p.codigo_barras) {
      if (vistosBarras.has(p.codigo_barras)) p.errors.push(`Código de barras "${p.codigo_barras}" duplicado en el archivo.`);
      vistosBarras.add(p.codigo_barras);
    }
    if (p.categoria && !categorias.has(p.categoria)) {
      p.warnings.push(`Categoría "${p.categoria}" no existe.`);
      faltantes.add(p.categoria);
    }

    const existente = (p.codigo_barras && porBarras.get(p.codigo_barras)) || (p.sku && porSku.get(p.sku.toUpperCase())) || null;
    const action: AccionFila = p.errors.length ? "ERROR" : existente ? "UPDATE" : "INSERT";
    let sku = p.sku;
    if (action === "INSERT" && !sku) {
      sku = nuevoSku();
      p.warnings.push(`Sin SKU: se generó ${sku}.`);
    }

    const prev = existente?.stock_actual ?? 0;
    const delta = p.stock - prev;
    let movimiento = "SIN MOVIMIENTO";
    if (action !== "ERROR" && delta !== 0) {
      movs++;
      if (delta > 0) ent += delta;
      else sal += -delta;
      movimiento = existente ? `${delta > 0 ? "ENTRADA +" : "SALIDA -"}${Math.abs(delta)} (prev=${prev})` : `ENTRADA +${delta}`;
    }

    rows.push({
      row_number: p.row_number,
      action,
      warnings: p.warnings,
      errors: p.errors,
      data: {
        NOMBRE: p.nombre,
        SKU: sku || existente?.sku || "",
        CODIGO_BARRAS: p.codigo_barras || "—",
        CATEGORIA: p.categoria,
        COSTO: String(p.costo),
        PRECIO: String(p.precio),
        STOCK: String(p.stock),
        STOCK_ANTERIOR: existente ? String(prev) : "",
        MOVIMIENTO: movimiento,
      },
    });
    if (action !== "ERROR") {
      filas.push({
        fila: `Fila ${p.row_number}`,
        id: existente?.id ?? null,
        nombre: p.nombre,
        sku: sku || existente?.sku || "",
        codigo_barras: p.codigo_barras || null,
        categoria: p.categoria || null,
        unidad: p.unidad,
        costo: p.costo,
        precio: p.precio,
        stock: p.stock,
        stock_minimo: p.stock_minimo,
        tipo_iva: p.tipo_iva,
        activo: p.activo,
      });
    }
  });

  return {
    summary: {
      total: rows.length,
      insertar: rows.filter((r) => r.action === "INSERT").length,
      actualizar: rows.filter((r) => r.action === "UPDATE").length,
      omitir: 0,
      errores: rows.filter((r) => r.action === "ERROR").length,
      warnings: rows.filter((r) => r.warnings.length).length,
      faltantes: { categorias: [...faltantes].sort() },
      movimientos_a_generar: movs,
      unidades_entrada: ent,
      unidades_salida: sal,
    },
    rows,
    headers: [...COLUMNAS_PLANTILLA],
    _filas: filas,
  };
}
