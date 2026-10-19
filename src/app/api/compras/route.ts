/**
 * Compras (Fase 2, portado de Ferretería República; unificadas con los gastos en la receta 59).
 *   GET  /api/compras?pagina&por_pagina&q&desde&hasta&proveedor&tipo_pago&estado
 *        → { rows, total, total_monto } paginado en el servidor, más reciente primero.
 *        q = búsqueda inteligente (número, proveedor, factura, timbrado, productos).
 *        (La pantalla usa la lista unificada /api/compras-gastos; esta queda por compatibilidad.)
 *   POST /api/compras → registra la compra (ADMIN). `items` = líneas de MERCADERÍA (stock, costo
 *        promedio, precio de venta y kardex) y `gastos` = líneas de GASTO (subcategoría, monto,
 *        IVA; no tocan stock); una compra puede tener las dos (mixta). Todo en una sola
 *        transacción (registrar_compra). Sin comprobante fiscal y al contado el proveedor es
 *        opcional (sueldo, propina…). Con orden_compra_id (+ oc_item_id por línea) es la
 *        recepción de esa orden (no más de lo pendiente salvo permitir_excedente). Contado con
 *        medio_pago "efectivo": egreso de la caja abierta. idempotency_key evita duplicados por
 *        doble clic. deposito_id: a qué depósito entra (por defecto el principal de la sucursal).
 *        Permisos: 'registrar_compras' si hay mercadería y 'registrar_gastos' si hay gastos.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { aplicarBusqueda, paginarConPrimeros, prepararBusqueda, primerosDe, restringirIds, type Primeros } from "@/lib/api/busqueda-servidor";
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
  // Búsqueda precisa: "comp 8" / "COMP-000008" / "8" o el N° de factura → solo esa compra;
  // un total ("650.200") → esas primero; el resto por texto (número, proveedor, RUC, factura,
  // productos).
  const busqueda = await prepararBusqueda(ctx.db, "compras", sp.get("q"));

  // + cuántos productos y, si es a crédito, cómo está su deuda (saldo / estado).
  const armar = (r: Primeros) => {
    let query = ctx.db.select("compras", `${COLS_COMPRA}, compras_items(count), cxp:cuentas_por_pagar(saldo, estado, moneda)`, { count: "exact" });
    if (RE_FECHA.test(desde)) query = query.gte("fecha", `${desde}T00:00:00-03:00`);
    if (RE_FECHA.test(hasta)) query = query.lte("fecha", `${hasta}T23:59:59.999-03:00`);
    if (/^[0-9a-f-]{36}$/i.test(proveedor)) query = query.eq("proveedor_id", proveedor);
    if (tipoPago === "contado" || tipoPago === "credito") query = query.eq("tipo_pago", tipoPago);
    if (estado === "registrada" || estado === "anulada") query = query.eq("estado", estado);
    query = restringirIds(aplicarBusqueda(query, busqueda), r);
    return query.order("fecha", { ascending: false }).order("id", { ascending: false });
  };

  const desdeFila = (pagina - 1) * porPagina;
  const res = await paginarConPrimeros(armar, primerosDe(busqueda), desdeFila, porPagina);
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();
  type Fila = Record<string, unknown> & { compras_items?: { count: number }[]; cxp?: { saldo: number; estado: string; moneda: string }[] | null };
  const rows = ((res.data ?? []) as unknown as Fila[]).map(({ compras_items, cxp, ...c }) => ({
    ...c,
    cantidad_items: compras_items?.[0]?.count ?? 0,
    deuda: cxp?.[0] ?? null,
  }));
  return ok({ rows, total: res.count ?? 0 });
}, { roles: ["ADMIN"] });

const UUID = z.string().uuid();

const cuerpo = z
  .object({
    /** opcional solo sin comprobante fiscal y al contado (sueldo, propina, peaje…) */
    proveedor_id: UUID.nullish(),
    /** false = sin comprobante fiscal: sin número obligatorio, sin IVA, no deducible */
    con_comprobante: z.boolean().default(true),
    /** Factura, Recibo, Boleta… (la lista de Gastos) */
    tipo_comprobante: z.string().trim().max(60).nullish(),
    numero_factura: z.string().trim().max(40).nullish(),
    nro_timbrado: z.string().trim().max(20).nullish(),
    fecha_factura: z.string().regex(RE_FECHA).nullish().or(z.literal("")),
    tipo_pago: z.enum(["contado", "credito"]).default("contado"),
    /** contado: cómo se pagó (el efectivo sale de la caja abierta, solo en Gs.) */
    medio_pago: z.enum(["efectivo", "transferencia", "cheque", "tarjeta", "otro"]).nullish(),
    referencia_pago: z.string().trim().max(120).nullish(),
    /** contado por transferencia / cheque / tarjeta: cuenta propia de origen (opcional) */
    cuenta_bancaria_id: UUID.nullish(),
    plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
    /** crédito: vencimiento explícito (si no, fecha + plazo) */
    vencimiento: z.string().regex(RE_FECHA).nullish().or(z.literal("")),
    moneda: z.enum(["GS", "USD"]).default("GS"),
    tipo_cambio: z.coerce.number().positive().max(100000).nullish(),
    observacion: z.string().trim().max(2000).nullish(),
    /** centro de costo (vacío: la del depósito o la del usuario) */
    sucursal_id: UUID.nullish(),
    /** si viene: se está recibiendo esa orden de compra */
    orden_compra_id: UUID.nullish(),
    /** recibir más de lo pendiente en la orden (confirmado por el usuario) */
    permitir_excedente: z.boolean().nullish(),
    /** doble clic / reintento: devuelve la compra ya registrada */
    idempotency_key: UUID.nullish(),
    /** depósito al que entra la mercadería (vacío: el principal de la sucursal) */
    deposito_id: UUID.nullish(),
    /** líneas de MERCADERÍA: suman stock y actualizan el costo */
    items: z
      .array(
        z.object({
          producto_id: UUID,
          cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor a 0"),
          costo_unitario: z.coerce.number().positive("Falta el costo"),
          precio_venta_nuevo: z.coerce.number().min(0).nullish(),
          oc_item_id: UUID.nullish(),
          /** productos con lotes: número (vacío → L-YYMMDD) y vencimiento (obligatorio, lo valida la base) */
          lote: z.string().trim().max(40, "El número de lote es muy largo").nullish(),
          vencimiento: z.string().regex(RE_FECHA, "Vencimiento inválido").nullish().or(z.literal("")),
        }),
      )
      .max(300)
      .default([]),
    /** líneas de GASTO: subcategoría de gasto, no tocan stock */
    gastos: z
      .array(
        z.object({
          categoria_id: UUID,
          descripcion: z.string().trim().max(300).default(""),
          monto: z.coerce.number().positive("Hay un gasto sin monto").max(1e13),
          iva_tipo: z.enum(["10%", "5%", "exenta"]).default("10%"),
          deducible: z.boolean().nullish(),
          sucursal_id: UUID.nullish(),
          empleado_id: UUID.nullish(),
        }),
      )
      .max(300)
      .default([]),
  })
  .refine((b) => (b.items?.length ?? 0) + (b.gastos?.length ?? 0) > 0, { message: "Cargá al menos un producto o un gasto", path: ["items"] });

export const POST = withTenant(
  async (ctx, _req, input) => {
    // Cada tipo de línea con su permiso (la base lo vuelve a validar).
    if (input.items?.length && !ctx.puede("registrar_compras")) return ERR.sinPermiso("registrar_compras");
    if (input.gastos?.length && !ctx.puede("registrar_gastos")) return ERR.sinPermiso("registrar_gastos");
    const { data, error } = await ctx.db.rpc<{ id: string; numero_control: string; total: number; tipo: string }>("registrar_compra", { p: input });
    // Los mensajes de la función (factura repetida, falta el costo…) son para el usuario.
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
