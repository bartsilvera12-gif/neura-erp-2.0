/**
 * Pedidos que tomó el bot vendedor por WhatsApp (receta 172) — Caja › Pedidos de WhatsApp.
 *   GET → los que esperan ("Por preparar") y los de WhatsApp de los últimos 7 días, con el link
 *         firmado al comprobante de transferencia (si lo mandaron). Nivel distinto de Vendedor.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { firmarAdjuntosChat } from "@/lib/conversaciones/servidor";

export const dynamic = "force-dynamic";

type Fila = { whatsapp?: { comprobante_path?: string | null; comprobante_url?: string | null } | null };

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("pedidos_whatsapp_listar", {});
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    const lista = data as { ahora: string; pedidos: Fila[] };
    const paths = lista.pedidos.map((p) => p.whatsapp?.comprobante_path).filter((x): x is string => !!x);
    const urls = paths.length ? await firmarAdjuntosChat(ctx.empresaId, paths) : new Map<string, string>();
    for (const p of lista.pedidos) if (p.whatsapp?.comprobante_path) p.whatsapp.comprobante_url = urls.get(p.whatsapp.comprobante_path) ?? null;
    return ok(lista, { headers: { "Cache-Control": "no-store" } });
  },
  { permiso: "pedidos_mostrador" },
);
