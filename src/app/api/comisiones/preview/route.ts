/**
 * GET /api/comisiones/preview?mes=YYYY-MM → vista previa del mes (receta 115). No guarda nada.
 * El Administrador ve a todos; el resto, solo lo suyo (lo filtra comisiones_datos).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { errorDb } from "@/modules/clientes/suscripciones/server";
import { armarPreview } from "@/modules/comisiones/calculo";
import type { DatosComisiones } from "@/modules/comisiones/tipos";

export const GET = withTenant(async (ctx, req) => {
  const pedido = new URL(req.url).searchParams.get("mes") ?? "";
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : hoyPY().slice(0, 7);
  const [a, m] = mes.split("-").map(Number);
  const hasta = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
  const { data, error } = await ctx.db.rpc<DatosComisiones>("comisiones_datos", { p_desde: `${mes}-01`, p_hasta: hasta });
  if (error || !data) return errorDb(error, "No se pudieron calcular las comisiones");
  return ok(armarPreview(data, mes));
});
