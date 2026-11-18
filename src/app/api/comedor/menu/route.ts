/**
 * Comedor — menú semanal.
 *   GET  /api/comedor/menu?fecha=YYYY-MM-DD → la semana que contiene esa fecha (comedor_menu_cargar)
 *   POST /api/comedor/menu → guardar las opciones de la semana (comedor_menu_guardar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(
  async (ctx, req) => {
    const fecha = new URL(req.url).searchParams.get("fecha");
    const r = await ctx.db.rpc("comedor_menu_cargar", { p_fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar" },
);

const guardarMenu = z.object({
  semana_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Semana inválida"),
  opciones: z.array(z.object({
    dia: z.coerce.number().int().min(1).max(5),
    opcion: z.coerce.number().int().min(1).max(2),
    nombre: z.string().trim().max(160), // vacío = quitar esa opción del menú (el backend la desactiva)
    producto_id: z.string().uuid().nullable().optional(),
    especial: z.boolean().default(false),
    precio_habitual: z.coerce.number().min(0).default(0),
    precio_especial: z.coerce.number().min(0).nullable().optional(),
    activa: z.boolean().default(true),
  })).max(20),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const r = await ctx.db.rpc("comedor_menu_guardar", { p: input });
    if (r.error) return ERR.server();
    return ok(r.data);
  },
  { permiso: "comedor_administrar", body: guardarMenu },
);
