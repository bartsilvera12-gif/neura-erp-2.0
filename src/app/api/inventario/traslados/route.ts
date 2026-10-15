/**
 * Traslados entre depósitos (con nota de remisión).
 *   GET  /api/inventario/traslados?pagina&por_pagina&estado&deposito&q&desde&hasta
 *        → { rows, total, en_transito }  (listar_traslados; estado=recibido incluye "con diferencias")
 *   POST /api/inventario/traslados → crea Y envía (ADMIN): el stock sale del origen y queda en
 *        tránsito hasta que se recibe (crear_traslado). Devuelve { id, numero, remision_numero }.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";

const ESTADOS = ["en_transito", "recibido", "recibido_con_diferencias", "anulado"];

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const estado = sp.get("estado") ?? "";
  const { data, error } = await ctx.db.rpc("listar_traslados", {
    p_estado: ESTADOS.includes(estado) ? estado : null,
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
const texto = (max: number) => z.string().trim().max(max).nullish();

const cuerpo = z.object({
  deposito_origen_id: z.string().uuid("Elegí el depósito de origen"),
  deposito_destino_id: z.string().uuid("Elegí el depósito de destino"),
  fecha_inicio: z.string().regex(RE_FECHA, "Fecha de inicio inválida"),
  fecha_fin_estimada: z.string().regex(RE_FECHA).nullish().or(z.literal("")),
  motivo_codigo: z.coerce.number().int().default(7),
  motivo_descripcion: texto(200),
  punto_partida: texto(200),
  ciudad_partida: texto(80),
  punto_llegada: texto(200),
  ciudad_llegada: texto(80),
  vehiculo_marca: texto(60),
  vehiculo_chapa: texto(20),
  chofer_nombre: texto(120),
  chofer_documento: texto(20),
  transportista_nombre: texto(120),
  transportista_ruc: texto(20),
  observacion: texto(1000),
  idempotency_key: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0"),
        /** lotes elegidos a mano (si no viene: los que vencen primero) */
        lotes: z.array(z.object({ lote_id: z.string().uuid().nullable(), cantidad: z.coerce.number().positive() })).max(50).nullish(),
      }),
    )
    .min(1, "El traslado no tiene productos")
    .max(300),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("crear_traslado", { p: input });
    if (error) return falloRpc(error);
    return created(data);
  },
  { permiso: "crear_traslados", body: cuerpo },
);
