/**
 * Lista de alumnos de "Que el alumno marque solo" (receta 156):
 *   GET /api/gimnasio/alumnos?q=&filtro=todos|sin_link|deben → { alumnos, totales }
 * Cada alumno con lo último que hizo, si debe y si ya se le mandó su link.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";
const FILTROS = new Set(["todos", "sin_link", "deben"]);

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80) || null;
  const filtro = FILTROS.has(sp.get("filtro") ?? "") ? sp.get("filtro") : "todos";
  const { data, error } = await ctx.db.rpc("gim_alumnos_lista", { p_buscar: q, p_filtro: filtro });
  if (error) return falloGim(error, "No se pudo leer la lista de alumnos");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });
