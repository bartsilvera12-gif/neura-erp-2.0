/**
 * Categorías de gasto (catálogo por empresa: Alquiler, Honorarios, Internet…).
 *   GET  /api/gastos/categorias → { categorias: [{ id, nombre, activo, orden }] } (activas)
 *   POST /api/gastos/categorias { nombre } → la crea (o devuelve la que ya existe con ese nombre)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db
      .select("gasto_categorias", "id, nombre, activo, orden")
      .eq("activo", true)
      .order("orden")
      .order("nombre");
    if (error) return ERR.server();
    return ok({ categorias: data ?? [] });
  },
  { roles: ["ADMIN"] },
);

const cuerpo = z.object({ nombre: z.string().trim().min(2, "Escribí el nombre de la categoría").max(80) });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const nombre = input.nombre.replace(/\s+/g, " ");
    const existe = await ctx.db.select("gasto_categorias", "id, nombre, activo, orden").ilike("nombre", nombre.replace(/[%_\\]/g, "\\$&")).limit(1);
    if (existe.error) return ERR.server();
    const ya = existe.data?.[0] as unknown as { id: string; activo: boolean } | undefined;
    if (ya) {
      if (!ya.activo) await ctx.db.update("gasto_categorias", { activo: true }).eq("id", ya.id);
      return ok({ ...ya, activo: true });
    }
    const ins = await ctx.db.insert("gasto_categorias", { nombre, orden: 50 });
    if (ins.error || !ins.data?.[0]) return ERR.server();
    return created(ins.data[0]);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
