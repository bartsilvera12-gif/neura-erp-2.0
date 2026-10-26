/**
 * Ticket imprimible de una venta (térmico 58/80 mm). Portado del flujo de O&M:
 * devuelve HTML listo para imprimir. Con ?auto=1 dispara window.print() al cargar.
 * SIFEN inactivo → por ahora toda venta (ticket o "factura") sale por acá.
 * Receta 71: respeta Configuración › Tickets y facturación › Ticket de venta (ancho, logo,
 * encabezado, pie, qué datos se muestran, letra y copias). El HTML lo arma htmlTicketVenta()
 * de src/modules/facturacion/tickets.ts (el mismo de la vista previa). ?w=58|80 fuerza el ancho.
 */
import { TZ_PY } from "@/lib/fecha/paraguay";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { logoDoc } from "@/lib/pdf/documento";
import { datosEmpresa } from "@/modules/empresa/server";
import { membreteEmpresa, nombreParaFactura, rucParaFactura } from "@/modules/empresa/tipos";
import {
  etiquetaMetodoPago, htmlTicketVenta, ticketVentaEfectivo,
  type ConfigTicketVenta, type DatosTicketVenta,
} from "@/modules/facturacion/tickets";
import { textoConPrecios, type ModsSnapshot } from "@/modules/mesas/modificadores";

function ventaId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("ventas");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = ventaId(req);
  if (!id) return ERR.invalid("Falta el id de la venta");
  const sp = new URL(req.url).searchParams;
  const auto = sp.get("auto") === "1";

  // Config del ticket (receta 71; sin 71 → el ancho del tipo de impresión de 61; sin 61 → 80 mm).
  // (el builder de supabase es "thenable" sin .catch: se envuelve en un Promise de verdad)
  const cfgP = Promise.resolve(ctx.db.rpc<{ impresion_tipo_default?: string; ticket_venta?: Partial<ConfigTicketVenta> }>("config_facturacion"))
    .then((r) => ticketVentaEfectivo(r.data?.ticket_venta, r.data?.impresion_tipo_default))
    .catch(() => ticketVentaEfectivo());

  // Membrete (Configuración › Datos de la empresa): en paralelo con la venta.
  const empresaP = datosEmpresa(ctx.db);

  // Venta + ítems + cliente en UNA consulta (embebidos): el ticket sale después de cada venta.
  // Receta 73: modificadores de cada plato (si el schema todavía no los tiene, sin ellos).
  const consulta = (mods: boolean) => ctx.db
    .select(
      "ventas",
      "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago, cliente_id, usuario_nombre, " +
        "tipo_documento, receptor_nombre, receptor_ruc, receptor_ocasional, " +
        `ventas_items(producto_nombre, sku, cantidad, precio_venta, tipo_iva, monto_iva, total_linea${mods ? ", modificadores, modificadores_texto" : ""}), ` +
        "pagos:ventas_pagos_detalle(metodo_pago, monto, referencia, recibido, vuelto, created_at), " +
        "punto:puntos_venta(nombre), sucursal:sucursales(nombre), " +
        "cliente:clientes!cliente_id(nombre, razon_social, ruc, documento)",
    )
    .eq("id", id)
    .limit(1);
  let vq = await consulta(true);
  if (vq.error && /modificadores/.test(vq.error.message ?? "")) vq = await consulta(false);
  if (vq.error) return ERR.server();
  if (!vq.data?.length) return ERR.notFound();
  const v = vq.data[0] as unknown as Record<string, unknown>;
  const items = (v.ventas_items ?? []) as Record<string, unknown>[];
  // Receptor (receta 66): lo guardado en la venta (razón social → nombre; RUC → documento con
  // formato de RUC). Ventas viejas sin snapshot: la misma regla sobre el cliente actual.
  const cli = v.cliente as { nombre?: string | null; razon_social?: string | null; ruc?: string | null; documento?: string | null } | null;
  // Receta 67: cliente ocasional → lo guardado en la venta ("X" / "X" o lo configurado).
  const ocasional = v.receptor_ocasional === true;
  const clienteNombre = (v.receptor_nombre as string | null) || (cli ? nombreParaFactura(cli) : "") || (ocasional ? "X" : "Consumidor final");
  const clienteRuc = (v.receptor_ruc as string | null) || (ocasional ? "X" : rucParaFactura(cli));
  const clienteDoc = clienteRuc ? `RUC: ${clienteRuc}` : cli?.documento ? `CI: ${cli.documento}` : "";

  const fecha = v.fecha ? new Date(v.fecha as string).toLocaleString("es-PY", { timeZone: TZ_PY, dateStyle: "short", timeStyle: "short" }) : "";
  const metodo = v.tipo_venta === "CREDITO" ? `Crédito${v.plazo_dias ? ` (${v.plazo_dias} días)` : ""}` : etiquetaMetodoPago(String(v.metodo_pago ?? "efectivo"));
  const pagos = ((v.pagos ?? []) as { metodo_pago: string; monto: number; referencia: string | null; recibido: number | null; vuelto: number | null; created_at: string }[])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const cajaTxt = [(v.punto as { nombre?: string } | null)?.nombre, (v.sucursal as { nombre?: string } | null)?.nombre].filter(Boolean).join(" · ");

  const [cfgBase, empresa] = await Promise.all([cfgP, empresaP]);
  const wParam = sp.get("w");
  const cfg: ConfigTicketVenta = wParam === "58" || wParam === "80" ? { ...cfgBase, ancho_mm: wParam === "58" ? 58 : 80 } : cfgBase;
  const m = membreteEmpresa(empresa, { nombre: clienteConfig.nombre });
  const logo = cfg.logo ? (await logoDoc(empresa).catch(() => null))?.data ?? null : null;

  const datos: DatosTicketVenta = {
    empresa: { nombre: m.nombre, razonSocial: m.razonSocial, ruc: m.ruc, ubicacion: m.ubicacion, telefono: m.telefono, logo },
    numero: String(v.numero_control ?? ""),
    fecha,
    caja: cajaTxt || null,
    cajero: (v.usuario_nombre as string | null) ?? null,
    cliente: { nombre: clienteNombre, documento: clienteDoc || null },
    items: items.map((it) => ({
      nombre: String(it.producto_nombre ?? ""),
      cantidad: Number(it.cantidad) || 0,
      precio: Number(it.precio_venta) || 0,
      total: Number(it.total_linea) || 0,
      // Receta 73: modificadores del plato debajo, en chico (extras con su precio).
      detalle: textoConPrecios(it.modificadores as ModsSnapshot | null) || (it.modificadores_texto as string | null) || null,
    })),
    subtotal: Number(v.subtotal) || 0,
    iva: Number(v.monto_iva) || 0,
    total: Number(v.total) || 0,
    // Forma de pago: crédito, una sola, o el detalle del pago mixto; efectivo con lo recibido y el vuelto.
    pago: v.tipo_venta === "CREDITO" || pagos.length === 0
      ? { metodo }
      : {
          detalle: pagos.map((pg) => ({
            etiqueta: etiquetaMetodoPago(pg.metodo_pago),
            referencia: pg.referencia,
            monto: Number(pg.monto) || 0,
            recibido: pg.recibido,
            vuelto: pg.vuelto,
            efectivo: pg.metodo_pago === "efectivo",
          })),
        },
    anulada: v.estado === "anulada",
  };

  const html = htmlTicketVenta(cfg, datos, { auto });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
