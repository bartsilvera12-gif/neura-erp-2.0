/**
 * Una compra de un sorteo (receta 123).
 *   GET  /api/sorteos/ordenes/<oid> → la compra + link firmado (10 min) al comprobante si tiene
 *   POST /api/sorteos/ordenes/<oid> { accion: confirmar | rechazar | anular, motivo? }
 *        confirmar / rechazar: sorteos_revisar · anular: sorteos_administrar (la base lo vuelve a exigir)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req, "ordenes");
  if (!id) return fail("Compra inválida", 400);
  const { data, error } = await ctx.db.rpc<Record<string, unknown>>("sorteo_orden", { p_id: id });
  if (error || !data) return falloSorteo(error ?? { message: "" }, "No se pudo leer la compra");
  const path = typeof data.comprobante_path === "string" ? data.comprobante_path : null;
  let comprobante_url: string | null = null;
  // Solo archivos de la carpeta de este schema y esta empresa.
  if (path && path.startsWith(`${tenantSchema()}/${ctx.empresaId}/`)) {
    const { data: firmado } = await systemClient().storage.from("erp-sorteos").createSignedUrl(path, 600);
    comprobante_url = firmado?.signedUrl ?? null;
  }
  return ok({ ...data, comprobante_url });
}, { permiso: "sorteos_vender" });

const cuerpo = z.object({ accion: z.enum(["confirmar", "rechazar", "anular"]), motivo: z.string().max(300).nullish() });

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "ordenes");
  if (!id) return fail("Compra inválida", 400);
  const { data, error } = body.accion === "confirmar"
    ? await ctx.db.rpc("sorteo_orden_confirmar", { p_id: id })
    : await ctx.db.rpc(body.accion === "rechazar" ? "sorteo_orden_rechazar" : "sorteo_orden_anular", { p_id: id, p_motivo: body.motivo ?? "" });
  if (error) return falloSorteo(error, "No se pudo actualizar la compra");
  return ok(data);
}, { permiso: "sorteos_vender", body: cuerpo });
