/**
 * Compras (Fase 2, portado de Ferretería República).
 *   GET  /api/compras?pagina&por_pagina&q&desde&hasta&proveedor&tipo_pago&estado
 *        → { rows, total, total_monto } paginado en el servidor, más reciente primero.
 *        q = búsqueda inteligente (número, proveedor, factura, timbrado, productos).
 *   POST /api/compras → registra la compra (ADMIN): cabecera + ítems + stock, costo
 *        promedio, precio de venta y kardex en una sola transacción (registrar_compra).
 *        Con orden_compra_id (+ oc_item_id por línea) es la recepción de esa orden (no más
 *        de lo pendiente salvo permitir_excedente). Contado con medio_pago "efectivo": egreso
 *        de la caja abierta. idempotency_key evita duplicados por doble clic.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { condicionGrupo, variantesBusqueda } from "@/lib/api/busqueda-servidor";
import { COLS_COMPRA } from "@/modules/compras/tipos";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const desde = sp.get("desde") ?? "";
  const hasta = sp.get("hasta") ?? "";
  const proveedor = sp.get("proveedor") ?? "";
  const tipoPago = sp.get("tipo_pago") ?? "";
  const estado = sp.get("estado") ?? "";
  const grupos = await variantesBusqueda(ctx.db, sp.get("q"));

  // + cuántos productos y, si es a crédito, cómo está su deuda (saldo / estado).
  let query = ctx.db.select("compras", `${COLS_COMPRA}, compras_items(count), cxp:cuentas_por_pagar(saldo, estado, moneda)`, { count: "exact" });
  if (RE_FECHA.test(desde)) query = query.gte("fecha", `${desde}T00:00:00-03:00`);
  if (RE_FECHA.test(hasta)) query = query.lte("fecha", `${hasta}T23:59:59.999-03:00`);
  if (/^[0-9a-f-]{36}$/i.test(proveedor)) query = query.eq("proveedor_id", proveedor);
  if (tipoPago === "contado" || tipoPago === "credito") query = query.eq("tipo_pago", tipoPago);
  if (estado === "registrada" || estado === "anulada") query = query.eq("estado", estado);
  for (const g of grupos) query = query.or(condicionGrupo(g));

  const desdeFila = (pagina - 1) * porPagina;
  const res = await query.order("fecha", { ascending: false }).order("id", { ascending: false }).range(desdeFila, desdeFila + porPagina - 1);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  type Fila = Record<string, unknown> & { compras_items?: { count: number }[]; cxp?: { saldo: number; estado: string; moneda: string }[] | null };
  const rows = ((res.data ?? []) as unknown as Fila[]).map(({ compras_items, cxp, ...c }) => ({
    ...c,
    cantidad_items: compras_items?.[0]?.count ?? 0,
    deuda: cxp?.[0] ?? null,
  }));
  return ok({ rows, total: res.count ?? 0 });
}, { roles: ["ADMIN"] });

const cuerpo = z.object({
  proveedor_id: z.string().uuid("Elegí el proveedor"),
  numero_factura: z.string().trim().min(1, "Falta el número de factura").max(40),
  nro_timbrado: z.string().trim().max(20).nullish(),
  fecha_factura: z.string().regex(RE_FECHA).nullish().or(z.literal("")),
  tipo_pago: z.enum(["contado", "credito"]).default("contado"),
  /** contado: cómo se pagó (el efectivo sale de la caja abierta, solo en Gs.) */
  medio_pago: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]).nullish(),
  referencia_pago: z.string().trim().max(120).nullish(),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  tipo_cambio: z.coerce.number().positive().nullish(),
  observacion: z.string().trim().max(2000).nullish(),
  /** si viene: se está recibiendo esa orden de compra */
  orden_compra_id: z.string().uuid().nullish(),
  /** recibir más de lo pendiente en la orden (confirmado por el usuario) */
  permitir_excedente: z.boolean().nullish(),
  /** doble clic / reintento: devuelve la compra ya registrada */
  idempotency_key: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0"),
        costo_unitario: z.coerce.number().positive("Falta el costo"),
        precio_venta_nuevo: z.coerce.number().min(0).nullish(),
        oc_item_id: z.string().uuid().nullish(),
        /** productos con lotes: número (vacío → L-YYMMDD) y vencimiento (obligatorio, lo valida la base) */
        lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
        vencimiento: z.string().regex(RE_FECHA, "Vencimiento inválido").nullish().or(z.literal("")),
      }),
    )
    .min(1, "La compra no tiene productos")
    .max(300),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ id: string; numero_control: string; total: number }>("registrar_compra", { p: input });
    // Los mensajes de la función (factura repetida, falta el costo…) son para el usuario.
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
