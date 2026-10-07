/**
 * Reporte "Ventas del período" — resumen (KPIs, IVA, por día, medio, cajero, productos,
 * categorías) + lista de cajeros para el filtro. ADMIN.
 *   GET /api/reportes/ventas?desde&hasta&cajero&tipo&medio&categoria
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { filtrosVentas, resumenVentas } from "@/modules/reportes/server/ventas";

export const GET = withTenant(
  async (ctx, req) => {
    const f = filtrosVentas(new URL(req.url).searchParams);
    try {
      const [resumen, usuarios] = await Promise.all([
        resumenVentas(ctx.db, f),
        ctx.db.select("usuarios", "auth_user_id, nombre").order("nombre", { ascending: true }),
      ]);
      const cajeros = ((usuarios.data ?? []) as unknown as { auth_user_id: string | null; nombre: string }[])
        .filter((u) => u.auth_user_id)
        .map((u) => ({ id: u.auth_user_id!, nombre: u.nombre }));
      return ok({ desde: f.desde, hasta: f.hasta, resumen, cajeros });
    } catch (e) {
      console.error("[reportes/ventas]", e instanceof Error ? e.message : e);
      return ERR.server();
    }
  },
  { roles: ["ADMIN"] },
);
