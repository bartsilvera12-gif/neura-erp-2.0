/**
 * Ficha de un proveedor en Excel: productos, compras, cuentas por pagar, pagos y meses.
 *   GET /api/reportes/proveedores/<id>/export?desde&hasta&sucursal → .xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { fechaCorta, mesCorto } from "@/components/graficos/formato";
import { idDeRuta, idInvalido, UUID_RE } from "@/modules/inventario/server/ids";
import { argsRango, filtrosRango, leerReporte, nombreArchivo } from "@/modules/reportes/server/rpc";
import type { ProveedorDetalle } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req.url, "proveedores");
    if (!UUID_RE.test(id ?? "")) return idInvalido("proveedor");
    const r = await leerReporte<ProveedorDetalle>(ctx.db, "reporte_proveedor", { p_proveedor: id, ...argsRango(filtrosRango(new URL(req.url).searchParams)) });
    if (!r.ok) return r.res;
    const d = r.data;
    const xlsx = buildXlsx([
      hoja("Productos", d.productos, [
        { header: "Producto", value: (f) => f.nombre, width: 32 },
        { header: "SKU", value: (f) => f.sku ?? "", width: 12 },
        { header: "Proveedor principal", value: (f) => (f.principal ? "Sí" : "No"), width: 10 },
        { header: "Cantidad comprada (rango)", value: (f) => Number(f.cantidad), width: 12 },
        { header: "Monto comprado (rango)", value: (f) => Number(f.monto), width: 15 },
        { header: "Compras (rango)", value: (f) => Number(f.compras), width: 9 },
        { header: "Última compra", value: (f) => (f.ultima_compra ? fechaCorta(f.ultima_compra) : ""), width: 12 },
        { header: "Último costo", value: (f) => (f.ultimo_costo == null ? "" : Math.round(Number(f.ultimo_costo))), width: 12 },
        { header: "Costo promedio", value: (f) => Math.round(Number(f.costo_promedio)), width: 12 },
        { header: "Precio de venta", value: (f) => Number(f.precio_venta), width: 12 },
        { header: "Stock actual", value: (f) => Number(f.stock_actual), width: 10 },
      ]),
      hoja("Compras", d.compras, [
        { header: "Número", value: (f) => f.numero_control, width: 14 },
        { header: "Fecha", value: (f) => fechaCorta(f.fecha), width: 11 },
        { header: "Factura", value: (f) => f.numero_factura ?? "", width: 18 },
        { header: "Condición", value: (f) => (f.tipo_pago === "credito" ? "Crédito" : "Contado"), width: 10 },
        { header: "Moneda", value: (f) => f.moneda, width: 7 },
        { header: "Total", value: (f) => Number(f.total), width: 14 },
        { header: "Total en Gs.", value: (f) => Number(f.total_gs), width: 14 },
        { header: "Estado", value: (f) => f.estado, width: 11 },
        { header: "Sucursal", value: (f) => f.sucursal_nombre ?? "", width: 16 },
        { header: "Ítems", value: (f) => Number(f.items), width: 7 },
        { header: "Saldo pendiente", value: (f) => (f.saldo == null ? "" : Number(f.saldo)), width: 14 },
      ]),
      hoja("Cuentas por pagar", d.cuentas, [
        { header: "Documento", value: (f) => f.documento, width: 14 },
        { header: "Origen", value: (f) => (f.origen === "compra" ? "Compra" : "Gasto"), width: 9 },
        { header: "Emisión", value: (f) => fechaCorta(f.fecha_emision), width: 11 },
        { header: "Vencimiento", value: (f) => fechaCorta(f.vencimiento), width: 11 },
        { header: "Días de atraso", value: (f) => Number(f.dias_atraso), width: 9 },
        { header: "Moneda", value: (f) => f.moneda, width: 7 },
        { header: "Monto", value: (f) => Number(f.monto), width: 14 },
        { header: "Pagado", value: (f) => Number(f.pagado), width: 14 },
        { header: "Saldo", value: (f) => Number(f.saldo), width: 14 },
      ]),
      hoja("Pagos", d.pagos, [
        { header: "Número", value: (f) => f.numero, width: 14 },
        { header: "Fecha", value: (f) => new Date(f.fecha), width: 16 },
        { header: "Moneda", value: (f) => f.moneda, width: 7 },
        { header: "Total", value: (f) => Number(f.total), width: 14 },
        { header: "Medios", value: (f) => f.medios.map((m) => m.metodo).join(", "), width: 20 },
        { header: "Anulado", value: (f) => (f.anulado ? "Sí" : ""), width: 8 },
      ]),
      hoja("Por mes", d.por_mes, [
        { header: "Mes", value: (f) => mesCorto(f.mes), width: 10 },
        { header: "Compras de mercadería", value: (f) => Number(f.compras), width: 16 },
        { header: "Gastos operativos", value: (f) => Number(f.operativos), width: 16 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(nombreArchivo(`proveedor-${d.proveedor.nombre.slice(0, 30)}`, d.desde, d.hasta)) });
  },
  { roles: ["ADMIN"] },
);
