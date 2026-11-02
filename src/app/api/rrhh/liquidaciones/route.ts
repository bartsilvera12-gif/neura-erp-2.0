/**
 * Liquidaciones del mes (receta 118). No mueven plata: es el extracto para el asesor.
 *   GET  ?mes=YYYY-MM
 *   POST { accion: ajustar | cerrar | reabrir }. Al cerrar se recalcula acá y queda la foto.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { errorDb } from "@/modules/clientes/suscripciones/server";
import { accionLiquidacion, mesValido } from "@/modules/rrhh/esquemas";
import { extractoDelMes } from "@/modules/rrhh/server";

export const GET = withTenant(async (ctx, req) => {
  const pedido = mesValido.safeParse(new URL(req.url).searchParams.get("mes"));
  try {
    return ok(await extractoDelMes(ctx, pedido.success ? pedido.data : hoyPY().slice(0, 7)));
  } catch (e) {
    return errorDb({ message: (e as Error).message }, "No se pudieron leer las liquidaciones");
  }
}, { permiso: "administrar_rrhh" });

export const POST = withTenant(async (ctx, _req, input) => {
  if (input.accion === "ajustar") {
    const { error } = await ctx.db.rpc("rrhh_liquidacion_ajustar", { p_usuario: input.usuario_id, p_periodo: input.mes, p_dias: input.dias_trabajados, p_ajustes: input.ajustes });
    if (error) return errorDb(error, "No se pudo guardar");
    return ok({ guardado: true });
  }
  if (input.accion === "reabrir") {
    const { error } = await ctx.db.rpc("rrhh_liquidacion_reabrir", { p_usuario: input.usuario_id, p_periodo: input.mes, p_motivo: input.motivo });
    if (error) return errorDb(error, "No se pudo reabrir");
    return ok({ reabierta: true });
  }
  let extracto;
  try {
    extracto = await extractoDelMes(ctx, input.mes);
  } catch (e) {
    return errorDb({ message: (e as Error).message }, "No se pudo calcular la liquidación");
  }
  const elegidas = extracto.filas.filter((f) => input.usuarios.includes(f.usuario_id) && f.estado === "abierta");
  const sinDias = elegidas.find((f) => f.faltan_dias);
  if (sinDias) return fail(`Falta cargar los días trabajados de ${sinDias.nombre}`, 422);
  for (const f of elegidas) {
    const { error } = await ctx.db.rpc("rrhh_liquidacion_cerrar", { p_usuario: f.usuario_id, p_periodo: input.mes, p_resultado: f.resultado });
    if (error) return errorDb(error, "No se pudo cerrar");
  }
  return ok({ cerradas: elegidas.length });
}, { permiso: "administrar_rrhh", body: accionLiquidacion });
