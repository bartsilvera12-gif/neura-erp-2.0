/**
 * Exportar movimientos de inventario a Excel, con los mismos filtros de la pantalla.
 *   GET /api/inventario/movimientos/export?q&tipo&origen&desde&hasta&producto&deposito&sucursal → movimientos-….xlsx
 * Tope de 50.000 filas por archivo (para períodos más largos, filtrar por fecha).
 * Las filas se piden de a 5000 (4 en paralelo), no de a 1000 en serie.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { consultaMovimientos, filtrosDeUrl, listarMovimientosRpc, type FiltrosMov } from "@/modules/inventario/server/movimientos";
import type { TenantDb } from "@/lib/api/tenant-db";
import { variantesBusqueda } from "@/lib/api/busqueda-servidor";
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
  proveedor: string | null;
  numero_factura: string | null;
  usuario_nombre: string | null;
  fecha: string;
  deposito_nombre?: string | null;
  sucursal_nombre?: string | null;
  documento_numero?: string | null;
  contraparte_nombre?: string | null;
};

// listar_movimientos (receta 47) devuelve hasta 5000 por llamada (no le aplica el tope
// de 1000 filas de PostgREST) y salta páginas por el índice: el total primero y el resto
// de a 4 en paralelo. Antes: hasta 50 viajes EN SERIE de 1000 filas con OFFSET creciente.
const POR_LLAMADA = 5000;
const EN_PARALELO = 4;

async function traerFilas(db: TenantDb, f: FiltrosMov): Promise<Mov[]> {
  const primera = await listarMovimientosRpc(db, f, { limit: POR_LLAMADA, offset: 0 });
  if (primera) {
    const filas = primera.rows as Mov[];
    const hasta = Math.min(primera.total, TOPE);
    const offsets: number[] = [];
    for (let d = POR_LLAMADA; d < hasta; d += POR_LLAMADA) offsets.push(d);
    for (let i = 0; i < offsets.length; i += EN_PARALELO) {
      const tanda = await Promise.all(
        offsets.slice(i, i + EN_PARALELO).map((d) =>
          listarMovimientosRpc(db, f, { limit: Math.min(POR_LLAMADA, hasta - d), offset: d, total: false })),
      );
      for (const r of tanda) filas.push(...((r?.rows ?? []) as Mov[]));
    }
    return filas.slice(0, TOPE);
  }
  // Respaldo (receta 47 sin aplicar): la consulta anterior, de a 1000.
  const filas: Mov[] = [];
  const grupos = await variantesBusqueda(db, f.q);
  for (let desde = 0; desde < TOPE; desde += 1000) {
    const { data, error } = await consultaMovimientos(db, f, undefined, grupos).range(desde, desde + 999);
    if (error) throw new Error("db");
    filas.push(...((data ?? []) as unknown as Mov[]));
    if ((data ?? []).length < 1000) break;
  }
  return filas;
}

export const GET = withTenant(async (ctx, req) => {
  const f = filtrosDeUrl(new URL(req.url).searchParams);
  try {
    const filas = await traerFilas(ctx.db, f);
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
        { header: "Documento", value: (m) => m.documento_numero ?? "", width: 16 },
        { header: "Sucursal", value: (m) => m.sucursal_nombre ?? "", width: 18 },
        { header: "Depósito", value: (m) => m.deposito_nombre ?? "", width: 20 },
        { header: "Desde / hacia", value: (m) => m.contraparte_nombre ?? "", width: 20 },
        { header: "Referencia", value: (m) => m.referencia ?? "", width: 36 },
        { header: "Proveedor", value: (m) => m.proveedor ?? "", width: 26 },
        { header: "Factura", value: (m) => m.numero_factura ?? "", width: 18 },
        { header: "Usuario", value: (m) => m.usuario_nombre ?? "", width: 20 },
      ]),
    ]);
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`movimientos-${ahora}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
});
