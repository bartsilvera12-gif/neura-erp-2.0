/**
 * Categorías de cliente (configurables por empresa: Minorista, Mayorista…).
 *   GET  /api/clientes/categorias          → activas, por orden ([{ id, nombre, color, orden, activo }])
 *        ?todas=1                          → también las inactivas
 *   POST /api/clientes/categorias { nombre, color? } → la creada (solo ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx, req) => {
  const todas = new URL(req.url).searchParams.get("todas") === "1";
  let q = ctx.db.select("cliente_categorias", "id, nombre, color, orden, activo");
  if (!todas) q = q.eq("activo", true);
  const { data, error } = await q.order("orden", { ascending: true }).order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});

const nueva = z.object({
  nombre: z.string().trim().min(1, "Escribí el nombre").max(60),
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Color inválido").nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const ult = await ctx.db.select("cliente_categorias", "orden").order("orden", { ascending: false }).limit(1);
    const orden = Number((ult.data?.[0] as unknown as { orden?: number } | undefined)?.orden ?? 0) + 1;
    const { data, error } = await ctx.db.insert("cliente_categorias", { nombre: input.nombre, color: input.color ?? "#0d9488", orden });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail(`Ya existe la categoría «${input.nombre}».`, 409);
      return ERR.server();
    }
    return created(data?.[0] ?? null);
  },
  { roles: ["ADMIN"], body: nueva },
);
