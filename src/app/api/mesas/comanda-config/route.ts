/**
 * Configuración del ticket de comanda (receta 71, Configuración › Tickets y facturación) para la
 * pantalla de cocina (receta 70): ancho 58/80, letra, cliente/notas/precios, copias y pie. La
 * pantalla arma el HTML con htmlComanda (src/modules/facturacion/tickets.ts) y lo imprime.
 *   GET /api/mesas/comanda-config → { ticket_comanda }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  if (!ctx.puede("pedidos_mesas") && !ctx.puede("cocina")) return ERR.sinPermiso("cocina");
  const { data, error } = await ctx.db.rpc<{ ticket_comanda?: unknown }>("config_tickets");
  if (error) return falloRpc(error);
  return ok({ ticket_comanda: data?.ticket_comanda ?? null }, { headers: { "Cache-Control": "no-store" } });
});