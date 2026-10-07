/**
 * Exportar inventario a Excel (portado de Ferretería República).
 *   GET /api/inventario/productos/export → productos-YYYYMMDD-HHMM.xlsx
 * Incluye activos e inactivos (como Ferretería). Las columnas son las mismas que la
 * plantilla de importación: un archivo exportado se puede volver a importar.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";

type Fila = {
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  categoria_principal_id: string | null;
  unidad_medida: string;
  costo_promedio: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  tipo_iva: string;
  activo: boolean;
};

const COLS =
  "nombre, sku, codigo_barras, categoria_principal_id, unidad_medida, costo_promedio, precio_venta, stock_actual, stock_minimo, tipo_iva, activo";

export const GET = withTenant(async (ctx) => {
  try {
    const traerTodos = async () => {
      const out: Fila[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await ctx.db
          .select("productos", COLS)
          .order("nombre", { ascending: true })
          .order("id", { ascending: true })
          .range(desde, desde + 999);
        if (error) throw new Error("db");
        out.push(...((data ?? []) as unknown as Fila[]));
        if ((data ?? []).length < 1000) break;
      }
      return out;
    };
    const [cats, filas] = await Promise.all([ctx.db.select("categorias_productos", "id, nombre"), traerTodos()]);
    const nombreCat = new Map(((cats.data ?? []) as unknown as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));

    const xlsx = buildXlsx([
      hoja("Productos", filas, [
        { header: "NOMBRE", value: (p) => p.nombre, width: 38 },
        { header: "SKU", value: (p) => p.sku, width: 18 },
        { header: "CODIGO_BARRAS", value: (p) => p.codigo_barras ?? "", width: 24 },
        { header: "CATEGORIA", value: (p) => (p.categoria_principal_id ? (nombreCat.get(p.categoria_principal_id) ?? "") : ""), width: 22 },
        { header: "UNIDAD_MEDIDA", value: (p) => p.unidad_medida, width: 14 },
        { header: "COSTO_PROMEDIO", value: (p) => Number(p.costo_promedio) || 0, width: 15 },
        { header: "PRECIO_VENTA", value: (p) => Number(p.precio_venta) || 0, width: 14 },
        { header: "STOCK_ACTUAL", value: (p) => Number(p.stock_actual) || 0, width: 13 },
        { header: "STOCK_MINIMO", value: (p) => Number(p.stock_minimo) || 0, width: 13 },
        { header: "IVA", value: (p) => p.tipo_iva, width: 9 },
        { header: "ACTIVO", value: (p) => (p.activo ? "SI" : "NO"), width: 8 },
      ]),
    ]);
    // productos-YYYYMMDD-HHMM en hora de Paraguay.
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`productos-${ahora}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
});
