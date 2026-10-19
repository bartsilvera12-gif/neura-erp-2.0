/**
 * Lista unificada "Compras y gastos" (Gastos empresariales, receta 59): compras de mercadería,
 * de gasto y mixtas + los gastos operativos cargados antes (y los borradores de recurrentes).
 *   GET /api/compras-gastos?q&tipo=mercaderia|gasto|mixta|con_gasto|con_mercaderia
 *       &estado=vigente|borrador|anulado&desde&hasta&sucursal&proveedor&categoria
 *       &tipo_costo=fijo|variable&deducible=1|0&origen=recurrente|personal|sin_comprobante|orden_compra
 *       &tipo_pago=contado|credito&pagina&por_pagina
 *   → { rows (origen 'compra' | 'gasto'), total, total_monto, total_mercaderia, total_gastos,
 *       total_iva, total_borradores, borradores }
 * Búsqueda precisa en la base: número de documento exacto (COMP-…, GS-…) o N° de factura →
 * solo ese; monto exacto y RUC primero; el resto por texto (proveedor, factura, productos,
 * categorías y descripciones de gasto, empleados).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS = ["mercaderia", "gasto", "mixta", "con_gasto", "con_mercaderia"];
const ESTADOS = ["vigente", "borrador", "anulado"];
const ORIGENES = ["recurrente", "personal", "sin_comprobante", "orden_compra"];

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const de = (k: string, lista: string[]) => {
      const v = sp.get(k);
      return v && lista.includes(v) ? v : null;
    };
    const fecha = (k: string) => {
      const v = sp.get(k);
      return v && FECHA.test(v) ? v : null;
    };
    const id = (k: string) => {
      const v = sp.get(k);
      return v && UUID.test(v) ? v : null;
    };
    const ded = sp.get("deducible");
    const { data, error } = await ctx.db.rpc("listar_compras_gastos", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_tipo: de("tipo", TIPOS),
      p_estado: de("estado", ESTADOS),
      p_desde: fecha("desde"),
      p_hasta: fecha("hasta"),
      p_sucursal: id("sucursal"),
      p_proveedor: id("proveedor"),
      p_categoria: id("categoria"),
      p_tipo_costo: de("tipo_costo", ["fijo", "variable"]),
      p_deducible: ded === "1" ? true : ded === "0" ? false : null,
      p_origen: de("origen", ORIGENES),
      p_tipo_pago: de("tipo_pago", ["contado", "credito"]),
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
