/**
 * Acciones sobre un vendedor (receta 123).
 *   POST /api/sorteos/vendedores/<vid> { accion: "link" }     → link nuevo del punto de venta (se muestra una vez; invalida el anterior)
 *   POST /api/sorteos/vendedores/<vid> { accion: "revocar" }  → el link deja de funcionar
 *   POST /api/sorteos/vendedores/<vid> { accion: "rendir", nota? } → recibe el efectivo, menos la comisión (sorteos_revisar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

const cuerpo = z.object({ accion: z.enum(["link", "revocar", "rendir"]), nota: z.string().max(300).nullish() });

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "vendedores");
  if (!id) return fail("Vendedor inválido", 400);
  if (body.accion === "rendir") {
    const { data, error } = await ctx.db.rpc("sorteo_rendir", { p_vendedor: id, p_nota: body.nota ?? null });
    if (error) return falloSorteo(error, "No se pudo registrar la rendición");
    return ok(data);
  }
  const { data, error } = await ctx.db.rpc<string | null>("sorteo_vendedor_link", { p_id: id, p_revocar: body.accion === "revocar" });
  if (error) return falloSorteo(error, "No se pudo generar el link");
  const base = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
  return ok({ link: data ? `${base}/rv/${data}` : null });
}, { permiso: "sorteos_vender", body: cuerpo });
