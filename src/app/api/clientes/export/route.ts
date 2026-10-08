/**
 * Exportar clientes a Excel, con los mismos filtros de la lista.
 *   GET /api/clientes/export?q&tipo&condicion&deuda&inactivos=1 → clientes-….xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { TZ_PY } from "@/lib/fecha/paraguay";

type Fila = {
  nombre: string; razon_social: string | null; tipo_cliente: string; documento: string | null; telefono: string | null;
  email: string | null; direccion: string | null; ciudad: string | null; condicion_pago: string; plazo_dias: number | null;
  limite_credito: number; activo: boolean; total_comprado: number; compras: number; ultima_compra: string | null;
  deuda: number; vencido: number;
};

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo");
  const condicion = sp.get("condicion");
  const deuda = sp.get("deuda");
  const r = await ctx.db.rpc<{ rows: Fila[] }>("listar_clientes", {
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_tipo: tipo === "empresa" || tipo === "persona" ? tipo : null,
    p_condicion: condicion === "CONTADO" || condicion === "CREDITO" ? condicion : null,
    p_deuda: deuda === "con_deuda" || deuda === "vencidos" ? deuda : null,
    p_inactivos: sp.get("inactivos") === "1",
    p_limit: 500,
    p_offset: 0,
  });
  if (r.error || !r.data) return new Response("No se pudo generar el Excel", { status: 500 });
  const xlsx = buildXlsx([
    hoja("Clientes", r.data.rows, [
      { header: "Nombre", value: (c) => c.nombre, width: 30 },
      { header: "Razón social", value: (c) => c.razon_social ?? "", width: 30 },
      { header: "Tipo", value: (c) => (c.tipo_cliente === "empresa" ? "Empresa" : "Persona"), width: 10 },
      { header: "RUC / CI", value: (c) => c.documento ?? "", width: 16 },
      { header: "Teléfono", value: (c) => c.telefono ?? "", width: 16 },
      { header: "Email", value: (c) => c.email ?? "", width: 26 },
      { header: "Dirección", value: (c) => c.direccion ?? "", width: 30 },
      { header: "Ciudad", value: (c) => c.ciudad ?? "", width: 16 },
      { header: "Condición", value: (c) => (c.condicion_pago === "CREDITO" ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado"), width: 16 },
      { header: "Límite de crédito", value: (c) => Number(c.limite_credito) || 0, width: 16 },
      { header: "Total comprado", value: (c) => Number(c.total_comprado) || 0, width: 16 },
      { header: "Compras", value: (c) => Number(c.compras) || 0, width: 10 },
      { header: "Última compra", value: (c) => (c.ultima_compra ? new Date(c.ultima_compra) : ""), width: 16 },
      { header: "Deuda", value: (c) => Number(c.deuda) || 0, width: 14 },
      { header: "Vencido", value: (c) => Number(c.vencido) || 0, width: 14 },
      { header: "Estado", value: (c) => (c.activo ? "Activo" : "Inactivo"), width: 10 },
    ]),
  ]);
  const ahora = new Date().toLocaleString("sv-SE", { timeZone: TZ_PY }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
  return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`clientes-${ahora}`) });
});
