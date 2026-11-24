/**
 * Configuración de Envíos › Choferes (receta 170). Permiso envios_administrar.
 *   GET    /api/envios/choferes            → { choferes[] }
 *   POST   /api/envios/choferes            (guardar: upsert) → { id }
 *   DELETE /api/envios/choferes?id=<uuid>  → {}
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR, fail } from "@/lib/api/responses";
import { falloRpc, uuidONull } from "@/modules/inventario/server/rpc";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("envios_choferes_listar");
  if (error) return falloRpc(error);
  if (!data) return ERR.server();
  return ok(data);
}, { permiso: "envios_administrar" });

export const POST = withTenant(async (ctx, req) => {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return fail("Datos inválidos");
  const { data, error } = await ctx.db.rpc("envio_chofer_guardar", { p: b });
  if (error) return falloRpc(error);
  return ok(data);
}, { permiso: "envios_administrar" });

export const DELETE = withTenant(async (ctx, req) => {
  const id = uuidONull(new URL(req.url).searchParams.get("id"));
  if (!id) return fail("Falta el chofer");
  const { error } = await ctx.db.rpc("envio_chofer_eliminar", { p_id: id });
  if (error) return falloRpc(error);
  return ok({});
}, { permiso: "envios_administrar" });
