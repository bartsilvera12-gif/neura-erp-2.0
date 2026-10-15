/**
 * Ajustes (AJ-) y pérdidas (PE-) de inventario.
 *   GET  /api/inventario/ajustes?pagina&por_pagina&tipo&estado&deposito&q&desde&hasta
 *        → { rows, total, pendientes, totales }  (listar_ajustes)
 *   POST /api/inventario/ajustes → registra el documento (registrar_ajuste):
 *        · ajuste: solo ADMIN, se aplica al guardar
 *        · pérdida: ADMIN la aplica al guardar; otro rol la deja PENDIENTE de aprobación
 *          (solo en depósitos de su sucursal)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const tipo = sp.get("tipo") ?? "";
  const estado = sp.get("estado") ?? "";
  const { data, error } = await ctx.db.rpc("listar_ajustes", {
    p_tipo: tipo === "ajuste" || tipo === "perdida" ? tipo : null,
    p_estado: ["pendiente", "aplicado", "rechazado", "anulado"].includes(estado) ? estado : null,
    p_deposito: uuidONull(sp.get("deposito")),
    p_q: (sp.get("q") ?? "").trim().slice(0, 100) || null,
    p_desde: fechaONull(sp.get("desde")),
    p_hasta: fechaONull(sp.get("hasta")),
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  });
  if (error || !data) return ERR.server();
  return ok(data);
});

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const cuerpo = z.object({
  tipo: z.enum(["ajuste", "perdida"]),
  deposito_id: z.string().uuid("Elegí el depósito"),
  motivo: z.string().trim().min(1, "Elegí el motivo").max(40),
  detalle: z.string().trim().max(500).nullish(),
  idempotency_key: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        /** conteo: "cantidad" es el stock real contado · diferencia: +/− (pérdida: unidades perdidas) */
        modo: z.enum(["conteo", "diferencia"]).default("diferencia"),
        cantidad: z.coerce.number(),
        lote_id: z.string().uuid().nullish(),
        lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
        vencimiento: z.string().regex(RE_FECHA, "Vencimiento inválido").nullish().or(z.literal("")),
        costo_unitario: z.coerce.number().min(0).nullish(),
        nota: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, "El documento no tiene productos")
    .max(500),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_ajuste", { p: input });
    if (error) return falloRpc(error);
    return created(data);
  },
  { body: cuerpo },
);
