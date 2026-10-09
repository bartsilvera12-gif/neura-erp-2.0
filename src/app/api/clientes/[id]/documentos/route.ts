/**
 * Documentos del cliente para "Gestión del Cliente": todas sus ventas (contado, crédito y
 * cuotas de suscripción) con saldo, vencimiento, días de mora, estado y último pago, más
 * las cifras de arriba (cantidad, monto total, saldo pendiente, vencidas, pendientes, pagadas).
 *   GET /api/clientes/[id]/documentos?emision_desde&emision_hasta&venc_desde&venc_hasta
 *       &saldo_cero=0|1 (por defecto 1) &contado=0|1 (por defecto 1) &moneda=GS|USD
 *       → documentos_cliente { rows, kpis }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req, "clientes");
  if (!id) return ERR.invalid("Falta el id del cliente");
  const sp = new URL(req.url).searchParams;
  const fecha = (k: string) => {
    const v = sp.get(k)?.trim() ?? "";
    return FECHA_RE.test(v) ? v : null;
  };
  const moneda = sp.get("moneda");
  const { data, error } = await ctx.db.rpc("documentos_cliente", {
    p_cliente: id,
    p_emision_desde: fecha("emision_desde"),
    p_emision_hasta: fecha("emision_hasta"),
    p_venc_desde: fecha("venc_desde"),
    p_venc_hasta: fecha("venc_hasta"),
    p_incluir_saldo_cero: sp.get("saldo_cero") !== "0",
    p_incluir_contado: sp.get("contado") !== "0",
    p_moneda: moneda === "GS" || moneda === "USD" ? moneda : null,
  });
  if (error) return errorDb(error, "No se pudieron cargar los documentos");
  return ok(data ?? { rows: [], kpis: null });
});
