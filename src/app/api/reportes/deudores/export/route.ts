/**
 * Deudores a Excel. GET /api/reportes/deudores/export?vencidos=1 → deudores-….xlsx
 */
import { withTenant } from "@/lib/api/with-tenant";
import { buildXlsx, hoja, xlsxHeaders } from "@/lib/excel/xlsx";
import { hoyPY } from "@/lib/fecha/paraguay";
import { reporteDeudores } from "@/modules/reportes/server/deudores";

export const GET = withTenant(
  async (ctx, req) => {
    try {
      const r = await reporteDeudores(ctx.db, new URL(req.url).searchParams.get("vencidos") === "1");
      const xlsx = buildXlsx([
        hoja("Deudores", r.rows, [
          { header: "Cliente", value: (f) => f.razon_social || f.nombre, width: 32 },
          { header: "RUC / CI", value: (f) => f.documento ?? "", width: 16 },
          { header: "Teléfono", value: (f) => f.telefono ?? "", width: 16 },
          { header: "Ciudad", value: (f) => f.ciudad ?? "", width: 14 },
          { header: "Deuda", value: (f) => Number(f.deuda), width: 14 },
          { header: "Vencido", value: (f) => Number(f.vencido), width: 14 },
          { header: "Por vencer", value: (f) => Number(f.por_vencer), width: 14 },
          { header: "1-30 días", value: (f) => Number(f.d1_30), width: 12 },
          { header: "31-60 días", value: (f) => Number(f.d31_60), width: 12 },
          { header: "61-90 días", value: (f) => Number(f.d61_90), width: 12 },
          { header: "+90 días", value: (f) => Number(f.d90), width: 12 },
          { header: "Días de atraso (máx.)", value: (f) => Number(f.max_atraso), width: 12 },
          { header: "Último pago", value: (f) => (f.ultimo_cobro ? new Date(f.ultimo_cobro) : ""), width: 14 },
          { header: "Monto último pago", value: (f) => Number(f.ultimo_cobro_monto ?? 0), width: 14 },
          { header: "Saldo a favor", value: (f) => Number(f.saldo_favor), width: 12 },
        ]),
      ]);
      return new Response(xlsx as unknown as BodyInit, { status: 200, headers: xlsxHeaders(`deudores-${hoyPY()}`) });
    } catch {
      return new Response("No se pudo generar el Excel", { status: 500 });
    }
  },
  { roles: ["ADMIN"] },
);
