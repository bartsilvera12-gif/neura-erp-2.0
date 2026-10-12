/**
 * GET /api/soporte/opciones — clientes existentes (id + nombre) para los selectores.
 * Los clientes son los del ERP: Soporte los referencia, no los copia.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { accesoSoporte, sinAccesoSoporte } from "@/modules/soporte/server";

export const GET = withTenant(async (ctx) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const lista: { id: string; nombre: string }[] = [];
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await ctx.db
      .select("clientes", "id, nombre")
      .is("deleted_at", null)
      .order("nombre")
      .range(desde, desde + 999);
    if (error) return ERR.server();
    const lote = (data ?? []) as unknown as { id: string; nombre: string | null }[];
    for (const c of lote) lista.push({ id: c.id, nombre: c.nombre?.trim() || "Cliente" });
    if (lote.length < 1000) break;
  }
  return ok({ clientes: lista });
});
