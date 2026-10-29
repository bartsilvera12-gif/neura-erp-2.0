/**
 * Producción por tanda (receta 97).
 *   GET  /api/inventario/produccion?pagina&por_pagina&estado&deposito&producto&q&desde&hasta
 *        → { rows, total, ver_costos, puede_fabricar, totales }  (listar_producciones)
 *   POST /api/inventario/produccion → fabricar: { producto_id, deposito_id, cantidad, obtenida,
 *        lote?, vencimiento?, notas?, idempotency_key } (fabricar). Descuenta las materias
 *        primas de la receta (si falta alguna no fabrica) y suma lo obtenido al stock.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const estado = sp.get("estado") ?? "";
  const { data, error } = await ctx.db.rpc("listar_producciones", {
    p_q: (sp.get("q") ?? "").trim().slice(0, 100) || null,
    p_estado: estado === "confirmada" || estado === "anulada" ? estado : null,
    p_deposito: uuidONull(sp.get("deposito")),
    p_producto: uuidONull(sp.get("producto")),
    p_desde: fechaONull(sp.get("desde")),
    p_hasta: fechaONull(sp.get("hasta")),
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  });
  if (error) return falloRpc(error);
  if (!data) return ERR.server();
  return ok(data);
});

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const cuerpo = z.object({
  producto_id: z.string().uuid("Elegí qué producto fabricar"),
  deposito_id: z.string().uuid("Elegí el depósito"),
  cantidad: z.coerce.number().positive("Cargá cuánto vas a fabricar").max(10000000),
  obtenida: z.coerce.number().positive("Cargá cuánto salió").max(100000000).nullish(),
  lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
  vencimiento: z.string().regex(RE_FECHA, "Vencimiento inválido").nullish().or(z.literal("")),
  notas: z.string().trim().max(500).nullish(),
  idempotency_key: z.string().uuid().nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("fabricar", { p: input });
    if (error) return falloRpc(error);
    return created(data);
  },
  { permiso: "fabricar", body: cuerpo },
);
