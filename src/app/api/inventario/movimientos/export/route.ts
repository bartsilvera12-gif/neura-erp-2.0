/**
 * Exportar movimientos de inventario a Excel, con los mismos filtros de la pantalla.
 *   GET /api/inventario/movimientos/export?q&tipo&origen&desde&hasta&producto → movimientos-….xlsx
 * Tope de 50.000 filas por archivo (para períodos más largos, filtrar por fecha).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { consultaMovimientos, filtrosDeUrl } from "@/modules/inventario/server/movimientos";
import { ORIGEN_LABEL } from "@/modules/inventario/kardex";

const TOPE = 50_000;

type Mov = {
  producto_nombre: string | null;
  producto_sku: string | null;
  tipo: string;
  cantidad: number;
  costo_unitario: number;
  origen: string;
  referencia: string | null;
  usuario_nombre: string | null;
  fecha: string;
};

export const GET = withTenant(async (ctx, req) => {
  const f = filtrosDeUrl(new URL(req.url).searchParams);
  try {
    const filas: Mov[] = [];
    for (let desde = 0; desde < TOPE; desde += 1000) {
      const { data, error } = await consultaMovimientos(ctx.db, f).range(desde, desde + 999);
      if (error) throw new Error("db");
      filas.push(...((data ?? []) as unknown as Mov[]));
      if ((data ?? []).length < 1000) break;
    }
    const xlsx = buildXlsx([
      hoja("Movimientos", filas, [
        { header: "Fecha", value: (m) => new Date(m.fecha), width: 18 },
        { header: "Producto", value: (m) => m.producto_nombre ?? "", width: 36 },
        { header: "SKU", value: (m) => m.producto_sku ?? "", width: 16 },
        { header: "Tipo", value: (m) => m.tipo, width: 10 },
        { header: "Cantidad", value: (m) => (m.tipo === "SALIDA" ? -1 : 1) * Number(m.cantidad), width: 11 },
        { header: "Costo unit.", value: (m) => Number(m.costo_unitario) || 0, width: 13 },
        { header: "Valor", value: (m) => (m.tipo === "SALIDA" ? -1 : 1) * Number(m.cantidad) * (Number(m.costo_unitario) || 0), width: 14 },
        { header: "Origen", value: (m) => ORIGEN_LABEL[m.origen] ?? m.origen, width: 18 },
        { header: "Referencia", value: (m) => m.referencia ?? "", width: 36 },
        { header: "Usuario", value: (m) => m.usuario_nombre ?? "", width: 20 },
      ]),
    ]);
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`movimientos-${ahora}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
});
