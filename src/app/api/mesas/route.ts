/**
 * Configuración › Mesas y QR (receta 68). Nivel ADMIN + "Configuración del sistema" (la base lo
 * vuelve a exigir en mesas_listar / mesa_guardar).
 *   GET  /api/mesas  → { mesas, sucursales, empresa }
 *   POST /api/mesas  { id?, sucursal_id, nombre, zona?, activa?, orden? } → { id, token }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("mesas_listar");
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return ok(data);
  },
  { permiso: "configuracion" },
);

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  sucursal_id: z.string().uuid("Elegí la sucursal de la mesa"),
  nombre: z.string().trim().min(1, "Escribí el nombre de la mesa").max(60, "El nombre es muy largo (hasta 60 letras)"),
  zona: z.string().trim().max(60, "La zona es muy larga (hasta 60 letras)").nullish(),
  activa: z.boolean().default(true),
  orden: z.coerce.number().int().min(0).max(100000).default(0),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("mesa_guardar", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: cuerpo },
);
