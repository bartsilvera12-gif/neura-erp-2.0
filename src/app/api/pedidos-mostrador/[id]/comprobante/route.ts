/**
 * Comprobante imprimible de un pedido de mostrador (receta 77): HTML de ticket térmico con el
 * número grande y el código de barras para la caja. Ancho y letra: los del ticket de venta
 * (Configuración › Tickets y facturación); ?w=58|80 fuerza el ancho; ?auto=1 imprime al cargar.
 *   GET /api/pedidos-mostrador/<id>/comprobante
 */
import { TZ_PY } from "@/lib/fecha/paraguay";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { datosEmpresa } from "@/modules/empresa/server";
import { membreteEmpresa } from "@/modules/empresa/tipos";
import { ticketVentaEfectivo, type ConfigTicketVenta } from "@/modules/facturacion/tickets";
import { htmlComprobantePedido } from "@/modules/pedidos-mostrador/comprobante";
import type { PedidoMostrador } from "@/modules/pedidos-mostrador/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "pedidos-mostrador");
  if (!id || !UUID_RE.test(id)) return idInvalido("pedido");
  const sp = new URL(req.url).searchParams;

  const cfgP = Promise.resolve(ctx.db.rpc<{ impresion_tipo_default?: string; ticket_venta?: Partial<ConfigTicketVenta> }>("config_facturacion"))
    .then((r) => ticketVentaEfectivo(r.data?.ticket_venta, r.data?.impresion_tipo_default))
    .catch(() => ticketVentaEfectivo());
  const empresaP = datosEmpresa(ctx.db);

  const { data, error } = await ctx.db.rpc<PedidoMostrador>("pedido_mostrador_ver", { p_id: id });
  if (error) return falloRpc(error);
  if (!data) return ERR.notFound();

  const [cfg, empresa] = await Promise.all([cfgP, empresaP]);
  const w = sp.get("w");
  const ancho = w === "58" ? 58 : w === "80" ? 80 : cfg.ancho_mm;
  const m = membreteEmpresa(empresa, { nombre: clienteConfig.nombre });
  const html = htmlComprobantePedido(data, {
    empresa: m.nombre,
    ancho,
    letra: cfg.letra,
    fecha: new Date(data.creado_at).toLocaleString("es-PY", { timeZone: TZ_PY, dateStyle: "short", timeStyle: "short" }),
    anulado: data.estado === "anulado",
    auto: sp.get("auto") === "1",
    acciones: sp.get("acciones") !== "0",
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
