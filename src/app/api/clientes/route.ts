/**
 * Clientes — lista y alta. "Mejor versión" combinada:
 *   GET  /api/clientes?paginado=1&pagina&por_pagina&q&tipo&condicion&deuda&estado&origen&categoria
 *        → { rows, total, kpis } (listar_clientes v3): cada cliente con código, categoría,
 *          vendedor, creado por, total comprado, última compra, deuda y vencido;
 *          estado = activos (por defecto) | inactivos | baja | todos;
 *          kpis = clientes, activos, empresas, con deuda, a cobrar, vencido.
 *   GET  /api/clientes?q=   → lista sin borrados. Con q, búsqueda inteligente (buscar_clientes:
 *                             nombre, razón social, CI/RUC con o sin puntos, teléfono, email,
 *                             ciudad; sin tildes, errores de tipeo, por relevancia)
 *        &limit=N (o limite=N) → cuántos traer: sin q 1..500 (por defecto 500, por nombre);
 *                             con q 1..200 (por defecto 50)
 *   GET  /api/clientes?cartera=1 → { activos }: cuántos clientes activos hay (chip "N en cartera"
 *                             de Gestión del Cliente; un conteo, sin traer filas)
 *   POST /api/clientes      → alta con anti-duplicados (candado en DB + chequeo amable)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { documentoRepetido } from "@/modules/clientes/server";
import { camposCliente, errorSifen, limpiarVacios } from "@/modules/clientes/esquema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sin export: un route file solo puede exportar handlers/config (si no, falla el build).
const COLS =
  "id, codigo, nombre, razon_social, tipo_cliente, documento, ruc, telefono, email, ciudad, direccion, condicion_pago, limite_credito, origen, activo, vendedor_usuario_id, creado_at";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get("cartera") === "1") {
    const r = await ctx.db
      .select("clientes", "id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("baja_at", null)
      .eq("activo", true);
    if (r.error) return ERR.server();
    return ok({ activos: r.count ?? 0 });
  }
  if (sp.get("paginado") === "1") {
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const tipo = sp.get("tipo");
    const condicion = sp.get("condicion");
    const deuda = sp.get("deuda");
    const estado = sp.get("estado");
    const origen = sp.get("origen");
    const categoria = sp.get("categoria");
    const r = await ctx.db.rpc("listar_clientes", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_tipo: tipo === "empresa" || tipo === "persona" ? tipo : null,
      p_condicion: condicion === "CONTADO" || condicion === "CREDITO" ? condicion : null,
      p_deuda: deuda === "con_deuda" || deuda === "vencidos" ? deuda : null,
      // Compatibilidad: ?inactivos=1 (lista vieja) = todos.
      p_estado: estado === "inactivos" || estado === "baja" || estado === "todos" ? estado : sp.get("inactivos") === "1" ? "todos" : "activos",
      p_origen: origen === "MANUAL" || origen === "VENTA" || origen === "CRM" ? origen : null,
      p_categoria: categoria && UUID_RE.test(categoria) ? categoria : null,
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    });
    if (r.error) return ERR.server();
    return ok(r.data);
  }
  const q = sp.get("q")?.trim().slice(0, 200);
  if (q) {
    const limite = Math.min(200, Math.max(1, Number(sp.get("limite") ?? sp.get("limit")) || 50));
    const r = await ctx.db.rpc<{ rows: unknown[]; total: number }>("buscar_clientes", { p_q: q, p_limit: limite });
    if (r.error || !r.data) return ERR.server();
    return ok(r.data.rows ?? []);
  }
  // Por defecto 500 (lo que esperan los que ya la usan); ?limit=20 para listas cortas (POS).
  const tope = Math.min(500, Math.max(1, Number(sp.get("limit") ?? sp.get("limite")) || 500));
  const { data, error } = await ctx.db.select("clientes", COLS).is("deleted_at", null).order("nombre", { ascending: true }).limit(tope);
  if (error) return ERR.server();
  return ok(data ?? []);
});

const crearCliente = z.object({
  ...camposCliente,
  nombre: z.string().trim().min(1, "El nombre es obligatorio").max(200),
  tipo_cliente: z.enum(["empresa", "persona"]).default("persona"),
  condicion_pago: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  limite_credito: z.coerce.number().min(0).default(0),
  origen: z.enum(["MANUAL", "VENTA", "CRM"]).default("MANUAL"),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    // Anti-duplicados amable: si viene documento y ya existe uno vivo, avisar claro
    // (además del candado único en la DB, que es la red dura).
    // Se compara sin puntos ni guion: "80012345-6" y "800123456" son el mismo.
    const doc = input.documento?.trim();
    if (doc) {
      const dup = await documentoRepetido(ctx.db, doc);
      if (dup) return fail(`Ya existe un cliente con el documento ${doc} (${dup}).`, 409);
    }

    const sifen = errorSifen(input);
    if (sifen) return ERR.invalid(sifen);

    const { data, error } = await ctx.db.insert("clientes", {
      ...limpiarVacios(input),
      plazo_dias: input.condicion_pago === "CREDITO" ? input.plazo_dias ?? null : null,
      created_by: ctx.usuarioId,
    });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con ese documento.", 409);
      return ERR.server();
    }
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crearCliente },
);
