/**
 * Comprobante impreso del pedido de mostrador (receta 77): ticket chico con el número grande,
 * fecha y hora, vendedor, cliente (si hay), productos con cantidad y precio, total y el código de
 * barras (Code 128 de "P0042") para escanear en la caja. Usa la base de tickets
 * (documentoTicket, ancho y letra del ticket de venta de Configuración › Tickets y facturación:
 * respeta 58 / 80 mm). Puro: lo arma GET /api/pedidos-mostrador/<id>/comprobante.
 */
import { documentoTicket, escHtml, letraTicketPx, type AnchoTicket, type LetraTicket, type OpcionesDocumento } from "@/modules/facturacion/tickets";
import { svgCode128 } from "@/modules/pedidos-mostrador/code128";
import { codigoBarrasPedido, type PedidoMostrador } from "@/modules/pedidos-mostrador/tipos";

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const cant = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });

const ESTILOS = `
  .ped-kicker { text-align: center; font-size: calc(var(--fs) - 1px); letter-spacing: 2px; text-transform: uppercase; margin: 0 0 1mm; }
  .ped-num { text-align: center; font-size: calc(var(--fs) * 3.2); font-weight: 900; letter-spacing: 1px; line-height: 1.05; margin: 0 0 1mm; }
  .ped-barras { margin: 2mm auto 0; width: 92%; }
  .ped-codigo { text-align: center; font-size: calc(var(--fs) - 2px); letter-spacing: 3px; margin: 0.5mm 0 1mm; }
  .ped-aviso { text-align: center; font-weight: bold; margin: 2mm 0 0; }
`;

export function htmlComprobantePedido(
  p: PedidoMostrador,
  a: { empresa: string; ancho: AnchoTicket; letra: LetraTicket; fecha: string; anulado?: boolean } & OpcionesDocumento,
): string {
  const filas = p.items
    .map((it) => `<tr><td class="qty"><strong>${cant(it.cantidad)}×</strong></td><td>${escHtml(it.nombre)}</td><td class="amt">${gs(it.total)}</td></tr>
        <tr class="sub"><td></td><td colspan="2">${cant(it.cantidad)} × ${gs(it.precio_unitario)}</td></tr>${(it.modificadores_texto ?? "").trim() ? `
        <tr class="sub"><td></td><td colspan="2">${escHtml((it.modificadores_texto ?? "").trim())}</td></tr>` : ""}`)
    .join("");
  const papel = `
    <style>${ESTILOS}</style>
    ${a.anulado ? `<div class="anulado-banner">ANULADO</div>` : ""}
    <div class="emisor">${escHtml(a.empresa)}</div>
    <hr>
    <div class="ped-kicker">Pedido</div>
    <div class="ped-num">${escHtml(p.etiqueta)}</div>
    <div class="meta">${escHtml(a.fecha)}${p.vendedor ? `<br>Vendedor: ${escHtml(p.vendedor)}` : ""}${p.sucursal?.nombre ? `<br>${escHtml(p.sucursal.nombre)}` : ""}</div>
    ${p.cliente ? `<div class="cliente">Cliente: ${escHtml(p.cliente.nombre)}</div>` : ""}
    <hr>
    <table>${filas}</table>
    <hr>
    <table class="totales"><tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${gs(p.total)}</td></tr></table>
    ${(p.nota ?? "").trim() ? `<div class="cliente" style="margin-top:2mm">Nota: ${escHtml((p.nota ?? "").trim())}</div>` : ""}
    <div class="ped-barras">${svgCode128(codigoBarrasPedido(p.numero), { alto: 48, titulo: p.etiqueta })}</div>
    <div class="ped-codigo">${escHtml(codigoBarrasPedido(p.numero))}</div>
    <div class="ped-aviso">Pasá por caja con este número</div>
    <div class="footer">Vale solo por hoy. No es un comprobante de venta.</div>
  `;
  return documentoTicket({
    titulo: `Pedido ${p.etiqueta} — ${a.empresa}`,
    ancho: a.ancho,
    fontPara: (w) => letraTicketPx(w, a.letra),
    papel,
    copias: 1,
    claseBody: a.anulado ? "anulada" : "",
    acciones: a.acciones,
    auto: a.auto,
    vistaPrevia: a.vistaPrevia,
  });
}
