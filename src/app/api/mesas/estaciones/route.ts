/**
 * Estaciones de cocina (receta 70).
 *   GET  /api/mesas/estaciones → { estaciones } (cualquier usuario de la empresa: las usan
 *        Categorías e Inventario › producto para elegir la estación)
 *   POST /api/mesas/estaciones { id?, nombre, color?, icono?, orden?, activa? } → { id }
 *        (ADMIN + "Configuración del sistema"; la base lo vuelve a exigir)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db
    .select("estaciones_cocina", "id, nombre, color, icono, orden, activa")
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok({ estaciones: data ?? [] });
});

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(1, "Escribí el nombre de la estación").max(40, "El nombre es muy largo (hasta 40 letras)"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido").nullish(),
  icono: z.string().trim().max(16, "Ícono inválido").nullish(),
  orden: z.coerce.number().int().min(0).max(100000).default(0),
  activa: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("estacion_cocina_guardar", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ["ADMIN"], permiso: "configuracion", body: cuerpo },
);
