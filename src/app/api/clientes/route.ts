/**
 * Clientes — lista y alta. "Mejor versión" combinada:
 *   GET  /api/clientes?paginado=1&pagina&por_pagina&q&tipo&condicion&deuda&inactivos=1
 *        → { rows, total, kpis } (listar_clientes): cada cliente con total comprado, última
 *          compra, deuda y vencido; kpis = clientes, con deuda, a cobrar, vencido.
 *   GET  /api/clientes?q=   → lista sin borrados. Con q, búsqueda inteligente (buscar_clientes:
 *                             nombre, razón social, CI/RUC con o sin puntos, teléfono, email,
 *                             ciudad; sin tildes, errores de tipeo, por relevancia)
 *        &limit=N (o limite=N) → cuántos traer: sin q 1..500 (por defecto 500, por nombre);
 *                             con q 1..200 (por defecto 50)
 *   POST /api/clientes      → alta con anti-duplicados (candado en DB + chequeo amable)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { documentoRepetido } from "@/modules/clientes/server";

// Sin export: un route file solo puede exportar handlers/config (si no, falla el build).
const COLS =
  "id, nombre, razon_social, tipo_cliente, documento, ruc, telefono, email, ciudad, direccion, condicion_pago, limite_credito, origen, activo, vendedor_usuario_id, creado_at";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  if (sp.get("paginado") === "1") {
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const tipo = sp.get("tipo");
    const condicion = sp.get("condicion");
    const deuda = sp.get("deuda");
    const r = await ctx.db.rpc("listar_clientes", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_tipo: tipo === "empresa" || tipo === "persona" ? tipo : null,
      p_condicion: condicion === "CONTADO" || condicion === "CREDITO" ? condicion : null,
      p_deuda: deuda === "con_deuda" || deuda === "vencidos" ? deuda : null,
      p_inactivos: sp.get("inactivos") === "1",
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
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  tipo_cliente: z.enum(["empresa", "persona"]).default("persona"),
  razon_social: z.string().trim().max(200).nullish(),
  documento: z.string().trim().max(40).nullish(),
  ruc: z.string().trim().max(40).nullish(),
  telefono: z.string().trim().max(40).nullish(),
  email: z.string().trim().email("Email inválido").max(120).nullish().or(z.literal("")),
  direccion: z.string().trim().max(200).nullish(),
  ciudad: z.string().trim().max(80).nullish(),
  condicion_pago: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  plazo_dias: z.coerce.number().int().min(0).max(3650).nullish(),
  limite_credito: z.coerce.number().min(0).default(0),
  origen: z.enum(["MANUAL", "VENTA", "CRM"]).default("MANUAL"),
  notas: z.string().trim().max(1000).nullish(),
  vendedor_usuario_id: z.string().uuid().nullish(),
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

    const { data, error } = await ctx.db.insert("clientes", {
      ...input,
      plazo_dias: input.condicion_pago === "CREDITO" ? input.plazo_dias ?? null : null,
      email: input.email || null,
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
