/**
 * Exportar proveedores a Excel. GET /api/proveedores/export → proveedores-….xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { listarProveedores } from "@/modules/proveedores/server";
import { condicionTexto } from "@/modules/proveedores/tipos";

export const GET = withTenant(async (ctx) => {
  try {
    const filas = await listarProveedores(ctx.db);
    const xlsx = buildXlsx([
      hoja("Proveedores", filas, [
        { header: "Razón social", value: (p) => p.nombre, width: 36 },
        { header: "Nombre comercial", value: (p) => p.nombre_comercial ?? "", width: 28 },
        { header: "RUC", value: (p) => p.ruc ?? "", width: 16 },
        { header: "Teléfono", value: (p) => p.telefono ?? "", width: 16 },
        { header: "Email", value: (p) => p.email ?? "", width: 28 },
        { header: "Dirección", value: (p) => p.direccion ?? "", width: 32 },
        { header: "Ciudad", value: (p) => p.ciudad ?? "", width: 16 },
        { header: "Contacto", value: (p) => p.contacto ?? "", width: 22 },
        { header: "Tel. contacto", value: (p) => p.contacto_telefono ?? "", width: 16 },
        { header: "Condición", value: (p) => condicionTexto(p), width: 16 },
        { header: "Moneda", value: (p) => p.moneda, width: 9 },
        { header: "Rubros", value: (p) => p.categorias.map((c) => c.nombre).join(", "), width: 28 },
        { header: "Compras", value: (p) => p.compras, width: 10 },
        { header: "Estado", value: (p) => (p.activo ? "Activo" : "Inactivo"), width: 10 },
        { header: "Observaciones", value: (p) => p.observaciones ?? "", width: 36 },
      ]),
    ]);
    const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`proveedores-${ahora}`) });
  } catch {
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
});
