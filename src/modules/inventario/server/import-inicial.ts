/**
 * Importación INICIAL del catálogo (portada de Ferretería República): recibe hasta 3
 * reportes del sistema anterior (Productos, Stock General, Stock Valorizado), los
 * consolida sin duplicados y crea/actualiza los productos con su stock inicial.
 *
 * La consolidación (parsers + cruce + conflictos) es la de Ferretería tal cual
 * (`src/lib/imports/*`). Acá va lo que toca la base del 2.0: marcar existentes y
 * aplicar por RPC (`aplicar_importacion_productos`, modo 'inicial': nunca pisa con vacío).
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import {
  consolidar, nullificarBarrasDuplicados, resumir,
  type FilaNormalizada, type Fuente, type ProductoConsolidado, type ResumenConsolidacion,
} from "@/lib/imports/consolidacion-productos";
import { parseReporte, type DiagnosticoParser } from "@/lib/imports/parsers-reportes-xls";
import { aplicarEnTandas, generadorSku, leerMatriz, MAX_BYTES_INICIAL, traerCatalogo, type FilaRpc } from "./excel-io";

/** Campo del form-data por reporte. Los tres son opcionales por separado. */
export const CAMPOS_REPORTE: { campo: string; fuente: Fuente }[] = [
  { campo: "file_productos", fuente: "productos" },
  { campo: "file_stock_general", fuente: "stock_general" },
  { campo: "file_stock_valorizado", fuente: "stock_valorizado" },
];

export type ArchivoEntrada = { fuente: Fuente; filename: string; aoa: unknown[][] };
export type DiagnosticoArchivo = DiagnosticoParser & { filename: string };
export type PreviewConsolidado = {
  items: ProductoConsolidado[];
  resumen: ResumenConsolidacion;
  archivos: DiagnosticoArchivo[];
};

/** Lee los archivos del form-data. Error de validación → string con el mensaje. */
export async function leerReportes(form: FormData): Promise<ArchivoEntrada[] | string> {
  const archivos: ArchivoEntrada[] = [];
  for (const { campo, fuente } of CAMPOS_REPORTE) {
    const f = form.get(campo);
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_BYTES_INICIAL) return `${f.name}: archivo demasiado grande (máx. 30 MB).`;
    try {
      archivos.push({ fuente, filename: f.name, aoa: leerMatriz(await f.arrayBuffer()) });
    } catch (e) {
      return `${f.name}: ${e instanceof Error ? e.message : "no se pudo leer"}`;
    }
  }
  if (!archivos.length) return "Subí al menos uno de los tres reportes.";
  return archivos;
}

const sinAcentos = (s: string | null) =>
  String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const up = (s: string | null) => String(s ?? "").trim().toUpperCase();

/** Consolida y marca los que ya existen: código interno (SKU) → barras → fábrica → descripción. */
export async function previewInicial(db: TenantDb, archivos: ArchivoEntrada[]): Promise<PreviewConsolidado> {
  const todas: FilaNormalizada[] = [];
  const diagnosticos: DiagnosticoArchivo[] = [];
  for (const a of archivos) {
    const { filas, diag } = parseReporte(a.fuente, a.aoa);
    todas.push(...filas);
    diagnosticos.push({ ...diag, filename: a.filename });
  }
  const items = consolidar(todas);
  // El código de barras tiene que ser único: se anulan los repetidos del origen.
  nullificarBarrasDuplicados(items);

  const catalogo = await traerCatalogo(db);
  const porSku = new Map<string, string>();
  const porBarras = new Map<string, string>();
  const porFabrica = new Map<string, string>();
  const porNombre = new Map<string, string>();
  for (const p of catalogo) {
    if (p.sku) porSku.set(up(p.sku), p.id);
    if (p.codigo_barras) porBarras.set(up(p.codigo_barras), p.id);
    if (p.codigo_fabrica) porFabrica.set(up(p.codigo_fabrica), p.id);
    if (p.nombre) porNombre.set(sinAcentos(p.nombre), p.id);
  }
  for (const it of items) {
    it.match_existente_id =
      (it.codigo_interno && porSku.get(it.codigo_interno)) ||
      (it.codigo_barras && porBarras.get(it.codigo_barras)) ||
      (it.codigo_fabrica && porFabrica.get(it.codigo_fabrica)) ||
      (it.descripcion && porNombre.get(sinAcentos(it.descripcion))) ||
      null;
  }
  return { items, resumen: resumir(items), archivos: diagnosticos };
}

// "UNIDAD" del reporte → "Unidad" (como se muestra en el 2.0).
const unidad2 = (u: string) => (u ? u.charAt(0) + u.slice(1).toLowerCase() : "Unidad");

export type ResultadoInicial = {
  creados: number;
  actualizados: number;
  omitidos: number;
  errores: number;
  categorias_creadas: number;
  movimientos_generados: number;
  unidades_iniciales: number;
  mensajes_error: string[];
};

export async function commitInicial(
  db: TenantDb,
  archivos: ArchivoEntrada[],
  opts: { actualizarExistentes: boolean; crearCategorias: boolean },
): Promise<ResultadoInicial> {
  const { items } = await previewInicial(db, archivos);
  const catalogo = await traerCatalogo(db);
  const nuevoSku = generadorSku(catalogo);

  let omitidos = 0;
  const filas: FilaRpc[] = [];
  for (const it of items) {
    if (it.errores.length || (it.match_existente_id && !opts.actualizarExistentes)) {
      omitidos++;
      continue;
    }
    filas.push({
      fila: it.codigo_interno || it.clave,
      id: it.match_existente_id ?? null,
      nombre: it.descripcion,
      // El 2.0 exige SKU: el código interno, o uno generado si el reporte no lo trae.
      sku: it.codigo_interno || (it.match_existente_id ? "" : nuevoSku()),
      codigo_barras: it.codigo_barras || null,
      codigo_fabrica: it.codigo_fabrica || null,
      categoria: it.categoria || null,
      unidad: unidad2(it.unidad),
      costo: it.costo,
      costo_mayorista: it.costo_mayorista,
      precio: it.precio_venta,
      stock: it.stock ?? 0,
      tipo_iva: it.iva,
    });
  }

  const referencia = `IMPORT_INICIAL:${archivos.map((a) => a.filename).join(" + ")}`.slice(0, 120);
  const r = await aplicarEnTandas(db, filas, {
    modo: "inicial",
    crearCategorias: opts.crearCategorias,
    origen: "inventario_inicial",
    referencia,
  });
  return {
    creados: r.creados,
    actualizados: r.actualizados,
    omitidos,
    errores: r.errores,
    categorias_creadas: r.categorias_creadas,
    movimientos_generados: r.movimientos_generados,
    unidades_iniciales: r.unidades_entrada,
    mensajes_error: r.mensajes_error,
  };
}
