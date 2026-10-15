/**
 * Pagos a proveedores (órdenes de pago OP-000001).
 *   GET  /api/pagos-proveedores?moneda=GS|USD&proveedor&q&anulados=1&pagina&por_pagina
 *        → { rows: [pago + medios], total }  (los más nuevos primero)
 *   POST /api/pagos-proveedores { proveedor_id, moneda, medios: [{ metodo, monto, referencia? }],
 *                                 aplicaciones?: [{ cxp_id, monto }], observacion? }
 *        → { id, numero, total, moneda }. Sin aplicaciones paga lo que vence primero.
 *        El efectivo sale de la caja abierta (solo en Gs.).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail } from "@/lib/api/responses";

const UUID = /^[0-9a-f-]{36}$/i;
const COLS =
  "id, numero, proveedor_id, proveedor_nombre, fecha, moneda, total, caja_id, observacion, usuario_nombre, anulado_at, anulado_por, anulado_motivo, " +
  "medios:pagos_proveedores_medios(metodo, monto, referencia)";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const proveedor = sp.get("proveedor");
    const q = sp.get("q")?.trim().slice(0, 100).replace(/[%,()*]/g, " ").trim();
    let query = ctx.db
      .select("pagos_proveedores", COLS, { count: "exact" })
      .eq("moneda", sp.get("moneda") === "USD" ? "USD" : "GS");
    if (proveedor && UUID.test(proveedor)) query = query.eq("proveedor_id", proveedor);
    if (sp.get("anulados") !== "1") query = query.is("anulado_at", null);
    if (q) query = query.or(`numero.ilike.%${q}%,proveedor_nombre.ilike.%${q}%`);
    const { data, error, count } = await query
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false })
      .range((pagina - 1) * porPagina, pagina * porPagina - 1);
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok({ rows: data ?? [], total: count ?? 0 });
  },
  { roles: ["ADMIN"] },
);

const cuerpo = z.object({
  proveedor_id: z.string().uuid(),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  medios: z
    .array(z.object({
      metodo: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]),
      monto: z.coerce.number().positive("Hay un monto en cero"),
      referencia: z.string().trim().max(120).nullish(),
    }))
    .min(1, "Cargá cómo le pagás")
    .max(10),
  aplicaciones: z.array(z.object({ cxp_id: z.string().uuid(), monto: z.coerce.number().positive() })).max(200).nullish(),
  observacion: z.string().trim().max(1000).nullish(),
  /** doble clic / reintento: devuelve la orden de pago ya registrada */
  idempotency_key: z.string().uuid().nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_pago_proveedor", { p: input });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return created(data);
  },
  { permiso: "pagar_proveedores", body: cuerpo },
);
