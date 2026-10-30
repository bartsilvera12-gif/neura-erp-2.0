/**
 * Ticket imprimible de una venta (térmico 58/80 mm). Portado del flujo de O&M:
 * devuelve HTML listo para imprimir. Con ?auto=1 dispara window.print() al cargar.
 * SIFEN inactivo → por ahora toda venta (ticket o "factura") sale por acá. Receta 101: la factura
 * del autoimpresor sale con número fiscal, timbrado e IVA por tasa.
 * Receta 71: respeta Configuración › Tickets y facturación › Ticket de venta (ancho, logo,
 * encabezado, pie, qué datos se muestran, letra y copias). El HTML lo arma htmlTicketVenta()
 * de src/modules/facturacion/tickets.ts (el mismo de la vista previa). ?w=58|80 fuerza el ancho.
 */
import { TZ_PY } from "@/lib/fecha/paraguay";
import { textoCredito } from "@/modules/caja/cuotas";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { logoDoc } from "@/lib/pdf/documento";
import { datosEmpresa } from "@/modules/empresa/server";
import { membreteEmpresa, nombreParaFactura, rucParaFactura } from "@/modules/empresa/tipos";
import {
  etiquetaMetodoPago, htmlTicketVenta, ticketVentaEfectivo,
  type ConfigTicketVenta, type DatosTicketVenta, type FiscalTicket,
} from "@/modules/facturacion/tickets";
import type { Autoimpresor } from "@/modules/facturacion/tipos";
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
  const facP = Promise.resolve(ctx.db.rpc<{ impresion_tipo_default?: string; ticket_venta?: Partial<ConfigTicketVenta>; autoimpresor?: Partial<Autoimpresor> }>("config_facturacion"))
    .then((r) => r.data)
    .catch(() => null);
  const cfgP = facP.then((r) => ticketVentaEfectivo(r?.ticket_venta, r?.impresion_tipo_default));

  // Membrete (Configuración › Datos de la empresa): en paralelo con la venta.
  const empresaP = datosEmpresa(ctx.db);

  // Venta + ítems + cliente en UNA consulta (embebidos): el ticket sale después de cada venta.
  // Receta 73: modificadores de cada plato (si el schema todavía no los tiene, sin ellos).
  const consulta = (mods: boolean) => ctx.db
    .select(
      "ventas",
      "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, cuotas, cuotas_cada, metodo_pago, cliente_id, usuario_nombre, " +
        "tipo_documento, receptor_nombre, receptor_ruc, receptor_ocasional, fiscal_numero, fiscal_timbrado, fiscal_vigencia_desde, fiscal_vigencia_hasta, " +
        `ventas_items(producto_nombre, sku, cantidad, precio_venta, precio_venta_original, tipo_iva, monto_iva, total_linea${mods ? ", modificadores, modificadores_texto, precio_mods" : ""}), ` +
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

  const fecha = v.fecha ? new Date(v.fecha as string).toLocaleString("es-PY", { timeZone: TZ_PY, dateStyle: "short", timeStyle: "short", hourCycle: "h23" }) : "";
  const metodo = v.tipo_venta === "CREDITO" ? textoCredito(v.plazo_dias as number | null, v.cuotas as number | null, v.cuotas_cada as string | null) : etiquetaMetodoPago(String(v.metodo_pago ?? "efectivo"));
  const pagos = ((v.pagos ?? []) as { metodo_pago: string; monto: number; referencia: string | null; recibido: number | null; vuelto: number | null; created_at: string }[])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const cajaTxt = [(v.punto as { nombre?: string } | null)?.nombre, (v.sucursal as { nombre?: string } | null)?.nombre].filter(Boolean).join(" · ");

  const [cfgBase, empresa, fac] = await Promise.all([cfgP, empresaP, facP]);
  const wParam = sp.get("w");
  const cfg: ConfigTicketVenta = wParam === "58" || wParam === "80" ? { ...cfgBase, ancho_mm: wParam === "58" ? 58 : 80 } : cfgBase;
  const m = membreteEmpresa(empresa, { nombre: clienteConfig.nombre });
  const logo = cfg.logo ? (await logoDoc(empresa).catch(() => null))?.data ?? null : null;

  // Receta 101: factura del autoimpresor. Emisor de la configuración del timbrado; IVA por tasa.
  const timbrado = fac?.autoimpresor;
  const fechaDoc = (iso: unknown) => (typeof iso === "string" && iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
  const sumar = (tasa: string, campo: "total_linea" | "monto_iva") =>
    items.filter((it) => String(it.tipo_iva ?? "").toUpperCase() === tasa).reduce((s, it) => s + (Number(it[campo]) || 0), 0);
  const fiscal: FiscalTicket | null = v.fiscal_numero
    ? {
        numero: String(v.fiscal_numero),
        timbrado: String(v.fiscal_timbrado ?? ""),
        vigenciaDesde: fechaDoc(v.fiscal_vigencia_desde),
        vigenciaHasta: fechaDoc(v.fiscal_vigencia_hasta),
        // La "factura al contado" se guarda como CREDITO con plazo 0 y una cuota (igual que el RG 90).
        condicion: v.tipo_venta === "CREDITO" && !(v.plazo_dias === 0 && Number(v.cuotas ?? 1) <= 1) ? "Crédito" : "Contado",
        exenta: sumar("EXENTA", "total_linea"),
        gravada5: sumar("5%", "total_linea"),
        gravada10: sumar("10%", "total_linea"),
        iva5: sumar("5%", "monto_iva"),
        iva10: sumar("10%", "monto_iva"),
        leyenda: timbrado?.leyenda_papel_termico ?? null,
      }
    : null;

  const datos: DatosTicketVenta = {
    fiscal,
    empresa: {
      nombre: (fiscal && timbrado?.nombre_fantasia) || m.nombre,
      razonSocial: (fiscal && timbrado?.razon_social_emisor) || m.razonSocial,
      ruc: (fiscal && timbrado?.ruc_emisor) || m.ruc,
      ubicacion: (fiscal && timbrado?.direccion_matriz) || m.ubicacion,
      telefono: (fiscal && timbrado?.telefono) || m.telefono,
      logo,
    },
    numero: String(v.numero_control ?? ""),
    fecha,
    caja: cajaTxt || null,
    cajero: (v.usuario_nombre as string | null) ?? null,
    cliente: { nombre: clienteNombre, documento: clienteDoc || null },
    items: items.map((it) => ({
      nombre: String(it.producto_nombre ?? ""),
      cantidad: Number(it.cantidad) || 0,
      precio: Number(it.precio_venta) || 0,
      // Descuento (del producto o precio manual menor): el de lista (+ los extras del plato) tachado.
      precioLista: Number(it.precio_venta_original) > 0 ? Number(it.precio_venta_original) + (Number(it.precio_mods) || 0) : null,
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
