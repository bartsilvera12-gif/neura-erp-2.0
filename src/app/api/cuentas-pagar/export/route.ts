/**
 * Cuentas a pagar a Excel. GET /api/cuentas-pagar/export?q&filtro&moneda&proveedor
 * Mismos filtros que la pantalla; trae todo (en tandas de 500).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ESTADO_CXP, type CuentaPagar, type ListaCuentasPagar } from "@/modules/compras/pagos";

const UUID = /^[0-9a-f-]{36}$/i;
const TANDA = 500;
const fechaDia = (d: string) => new Date(`${d}T12:00:00-03:00`);

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const filtro = sp.get("filtro");
    const proveedor = sp.get("proveedor");
    const moneda = sp.get("moneda") === "USD" ? "USD" : "GS";
    const args = {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_filtro: filtro === "vencidas" || filtro === "por_vencer" || filtro === "semana" ? filtro : null,
      p_moneda: moneda,
      p_proveedor: proveedor && UUID.test(proveedor) ? proveedor : null,
    };
    const filas: CuentaPagar[] = [];
    for (let offset = 0; offset < 20_000; offset += TANDA) {
      const { data, error } = await ctx.db.rpc<ListaCuentasPagar>("listar_cuentas_pagar", { ...args, p_limit: TANDA, p_offset: offset });
      if (error || !data) return ERR.server();
      filas.push(...data.rows);
      if (data.rows.length < TANDA) break;
    }
    const xlsx = buildXlsx([
      hoja(`A pagar ${moneda}`, filas, [
        { header: "Proveedor", value: (r) => r.proveedor_nombre, width: 34 },
        { header: "RUC", value: (r) => r.proveedor_ruc ?? "", width: 15 },
        { header: "Factura", value: (r) => r.numero, width: 18 },
        { header: "Compra / gasto", value: (r) => r.compra_numero, width: 14 },
        { header: "Emisión", value: (r) => fechaDia(r.fecha_emision), width: 13 },
        { header: "Vencimiento", value: (r) => fechaDia(r.vencimiento), width: 13 },
        { header: "Días de atraso", value: (r) => (r.dias_atraso > 0 ? r.dias_atraso : ""), width: 12 },
        { header: "Vence en (días)", value: (r) => (r.dias_atraso > 0 ? "" : r.dias_para_vencer), width: 12 },
        { header: "Moneda", value: (r) => r.moneda, width: 8 },
        { header: "Monto", value: (r) => Number(r.monto), width: 15 },
        { header: "Pagado", value: (r) => Number(r.pagado), width: 15 },
        { header: "Saldo", value: (r) => Number(r.saldo), width: 15 },
        { header: "Estado", value: (r) => (r.dias_atraso > 0 ? "Vencida" : ESTADO_CXP[r.estado]?.t ?? r.estado), width: 15 },
      ]),
    ]);
    return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`cuentas-a-pagar-${moneda.toLowerCase()}-${hoyPY()}`) });
  },
  { roles: ["ADMIN"] },
);
