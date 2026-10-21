/**
 * Ticket imprimible de una venta (térmico 80mm). Portado del flujo de O&M:
 * devuelve HTML listo para imprimir. Con ?auto=1 dispara window.print() al cargar.
 * SIFEN inactivo → por ahora toda venta (ticket o "factura") sale por acá.
 */
import { TZ_PY } from "@/lib/fecha/paraguay";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { datosEmpresa } from "@/modules/empresa/server";
import { membreteEmpresa } from "@/modules/empresa/tipos";

function ventaId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("ventas");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

const metodoLabel = (m: string) => {
  const t = m.trim().toLowerCase();
  return ({
    efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", pos: "Tarjeta", cheque: "Cheque",
    tarjeta_debito: "Tarjeta débito", tarjeta_credito: "Tarjeta crédito", pos_debito: "Tarjeta débito", pos_credito: "Tarjeta crédito",
    qr: "QR / billetera", billetera: "QR / billetera", mixto: "Mixto", otro: "Otro",
  }[t] ?? (t ? t[0].toUpperCase() + t.slice(1) : "—"));
};

export const GET = withTenant(async (ctx, req) => {
  const id = ventaId(req);
  if (!id) return ERR.invalid("Falta el id de la venta");
  const sp = new URL(req.url).searchParams;
  const auto = sp.get("auto") === "1";
  // Ancho del papel térmico: ?w=58|80, o el de Configuración › Facturación (receta 61:
  // ticket 58 / 80 mm; los PDF A4 / media hoja todavía no existen → 80 mm). La fuente escala con el ancho.
  const wParam = sp.get("w");
  let widthMm: 58 | 80 = wParam === "58" ? 58 : 80;
  if (wParam !== "58" && wParam !== "80") {
    try {
      const cfg = await ctx.db.rpc<{ impresion_tipo_default?: string }>("config_facturacion");
      if (cfg.data?.impresion_tipo_default === "ticket_58mm") widthMm = 58;
    } catch { /* sin receta 61: 80 mm como siempre */ }
  }
  const fontPx = widthMm === 58 ? 11 : 12;

  // Membrete (Configuración › Datos de la empresa): en paralelo con la venta.
  const empresaP = datosEmpresa(ctx.db);

  // Venta + ítems + cliente en UNA consulta (embebidos): el ticket sale después de cada venta.
  const vq = await ctx.db
    .select(
      "ventas",
      "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago, cliente_id, usuario_nombre, " +
        "ventas_items(producto_nombre, sku, cantidad, precio_venta, tipo_iva, monto_iva, total_linea), " +
        "pagos:ventas_pagos_detalle(metodo_pago, monto, referencia, recibido, vuelto, created_at), " +
        "punto:puntos_venta(nombre), sucursal:sucursales(nombre), " +
        "cliente:clientes!cliente_id(nombre)",
    )
    .eq("id", id)
    .limit(1);
  if (vq.error) return ERR.server();
  if (!vq.data?.length) return ERR.notFound();
  const v = vq.data[0] as unknown as Record<string, unknown>;
  const items = (v.ventas_items ?? []) as Record<string, unknown>[];
  const clienteNombre = (v.cliente as { nombre?: string | null } | null)?.nombre || "Consumidor final";

  const fecha = v.fecha ? new Date(v.fecha as string).toLocaleString("es-PY", { timeZone: TZ_PY, dateStyle: "short", timeStyle: "short" }) : "";
  const metodo = v.tipo_venta === "CREDITO" ? `Crédito${v.plazo_dias ? ` (${v.plazo_dias} días)` : ""}` : metodoLabel(String(v.metodo_pago ?? "efectivo"));
  const anulada = v.estado === "anulada";
  const pagos = ((v.pagos ?? []) as { metodo_pago: string; monto: number; referencia: string | null; recibido: number | null; vuelto: number | null; created_at: string }[])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const cajaTxt = [(v.punto as { nombre?: string } | null)?.nombre, (v.sucursal as { nombre?: string } | null)?.nombre].filter(Boolean).join(" · ");
  // Forma de pago: crédito, una sola, o el detalle del pago mixto; efectivo con lo recibido y el vuelto.
  const filasPago =
    v.tipo_venta === "CREDITO" || pagos.length === 0
      ? `<tr><td class="lbl">Pago</td><td class="val">${esc(metodo)}</td></tr>`
      : pagos
          .map((pg) => {
            const ref = pg.referencia ? ` <span style="font-size:calc(var(--fs) - 2px)">(${esc(pg.referencia)})</span>` : "";
            let fila = `<tr><td class="lbl">${esc(metodoLabel(pg.metodo_pago))}${ref}</td><td class="val">${gs(Number(pg.monto) || 0)}</td></tr>`;
            if (pg.metodo_pago === "efectivo" && Number(pg.recibido) > 0) {
              fila += `<tr class="sub"><td class="lbl">Recibido</td><td class="val">${gs(Number(pg.recibido))}</td></tr>`;
              fila += `<tr><td class="lbl"><strong>Vuelto</strong></td><td class="val"><strong>${gs(Number(pg.vuelto) || 0)}</strong></td></tr>`;
            }
            return fila;
          })
          .join("");

  // Formato de ticket copiado de Reserva Caacupé (térmico 80mm, monoespaciado),
  // SIN el logo. Cada ítem: cantidad × nombre … total; abajo el desglose unitario.
  const filas = items
    .map((it) => {
      const cant = Number(it.cantidad) || 0;
      const precio = Number(it.precio_venta) || 0;
      return `<tr><td class="qty"><strong>${cant}×</strong></td><td>${esc(it.producto_nombre)}</td><td class="amt">${gs(Number(it.total_linea) || 0)}</td></tr>
        <tr class="sub"><td></td><td colspan="2">${cant} × ${gs(precio)}</td></tr>`;
    })
    .join("");

  const m = membreteEmpresa(await empresaP, { nombre: clienteConfig.nombre });
  const emisor = [m.razonSocial, m.ruc ? `RUC ${m.ruc}` : null, m.ubicacion, m.telefono ? `Tel. ${m.telefono}` : null]
    .filter(Boolean).map((l) => esc(l)).join("<br>");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ticket ${esc(v.numero_control)} — ${esc(m.nombre)}</title>
<style id="sz">
  :root { --w: ${widthMm}mm; --fs: ${fontPx}px; }
  @page { margin: 0; size: ${widthMm}mm auto; }
</style>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: var(--fs); color: #000; background: #f1f1f1; margin: 0; padding: 20px; }
  .paper { background: #fff; width: var(--w); margin: 0 auto 12mm; padding: 6mm 4mm; box-shadow: 0 1px 4px rgba(0,0,0,0.1); page-break-after: always; break-after: page; }
  .paper.last { page-break-after: auto; break-after: auto; margin-bottom: 0; }
  h1 { font-size: calc(var(--fs) + 4px); text-align: center; margin: 0 0 2mm; letter-spacing: 1px; }
  .emisor { font-size: calc(var(--fs) - 2px); text-align: center; line-height: 1.35; margin: 0 0 2mm; }
  .meta { font-size: calc(var(--fs) - 1px); text-align: center; margin: 1mm 0 2mm; }
  .cliente { font-size: var(--fs); margin: 1mm 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 0.5mm 0; }
  td.qty { width: 9mm; }
  td.amt { width: 22mm; text-align: right; white-space: nowrap; }
  tr.sub td { color: #555; font-size: calc(var(--fs) - 2px); padding-bottom: 1mm; }
  .totales td { padding: 0.7mm 0; }
  .totales .lbl { text-align: left; }
  .totales .val { text-align: right; white-space: nowrap; }
  .total-row { font-weight: bold; font-size: calc(var(--fs) + 2px); border-top: 1px solid #000; }
  .footer { font-size: calc(var(--fs) - 2px); text-align: center; margin-top: 3mm; font-style: italic; }
  .anulado-banner { border: 3px solid #b91c1c; color: #b91c1c; text-align: center; font-weight: 900; letter-spacing: 3px; font-size: calc(var(--fs) + 8px); padding: 3mm 2mm; margin: 0 0 3mm; background: #fef2f2; }
  body.anulada .paper { position: relative; }
  body.anulada .paper::before { content: "ANULADO"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 60px; font-weight: 900; color: rgba(185,28,28,0.12); letter-spacing: 8px; transform: rotate(-20deg); pointer-events: none; }
  .actions { max-width: var(--w); margin: 8mm auto 0; text-align: center; }
  .actions button { padding: 8px 16px; font-size: 13px; cursor: pointer; border: 1px solid #333; background: #fff; border-radius: 6px; }
  .actions button:hover { background: #f5f5f5; }
  .actions a { margin-left: 12px; font-size: 13px; color: #444; cursor: pointer; text-decoration: underline; }
  @media print {
    body { background: #fff; padding: 0; }
    .paper { box-shadow: none; padding: 2mm; margin: 0; }
    .actions { display: none; }
  }
</style>
</head>
<body class="${anulada ? "anulada" : ""}">
  <section class="paper last">
    ${anulada ? `<div class="anulado-banner">ANULADO</div>` : ""}
    <h1>${esc(m.nombre)}</h1>
    ${emisor ? `<div class="emisor">${emisor}</div>` : ""}
    <hr>
    <div class="meta">${esc(v.numero_control)}<br>${esc(fecha)}${cajaTxt ? `<br>${esc(cajaTxt)}` : ""}${v.usuario_nombre ? ` · ${esc(v.usuario_nombre)}` : ""}</div>
    <hr>
    <div class="cliente">Cliente: ${esc(clienteNombre)}</div>
    <hr>
    <table>${filas}</table>
    <hr>
    <table class="totales">
      <tr><td class="lbl">Subtotal</td><td class="val">${gs(Number(v.subtotal) || 0)}</td></tr>
      <tr><td class="lbl">IVA</td><td class="val">${gs(Number(v.monto_iva) || 0)}</td></tr>
      <tr class="total-row"><td class="lbl">TOTAL</td><td class="val">${gs(Number(v.total) || 0)}</td></tr>
      ${filasPago}
    </table>
    <hr>
    <div class="footer">¡Gracias por tu compra!<br>Comprobante interno — no válido como factura legal.</div>
  </section>
  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a id="toggle" onclick="setAncho()">Cambiar a 58mm</a>
  </div>
  <script>
    var ancho = ${widthMm};
    function setAncho(){
      ancho = ancho === 80 ? 58 : 80;
      var fs = ancho === 58 ? 11 : 12;
      document.getElementById('sz').textContent = ':root{--w:'+ancho+'mm;--fs:'+fs+'px;}@page{margin:0;size:'+ancho+'mm auto;}';
      document.getElementById('toggle').textContent = 'Cambiar a ' + (ancho === 80 ? 58 : 80) + 'mm';
    }
    ${auto ? "try{var u=new URL(location.href);if(u.searchParams.get('auto')==='1'){setTimeout(function(){window.print();},250);}}catch(e){}" : ""}
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
