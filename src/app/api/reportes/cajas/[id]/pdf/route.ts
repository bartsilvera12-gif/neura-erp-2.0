/**
 * Arqueo / detalle de un turno, imprimible en A4 (portado de Ferretería República).
 *   GET /api/reportes/cajas/<id>/pdf[?auto=1] → HTML; con auto=1 abre el diálogo de impresión.
 * El front lo pide con el Bearer y lo abre como blob (igual que el ticket).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { clienteConfig } from "@/cliente.config";
import { cajaIdDeUrl, estadoCajaLabel, getDetalleCaja, medioLabel } from "@/modules/caja/reporte-cajas";

const TZ = "America/Asuncion";
const gs = (v: number) => Math.round(v || 0).toLocaleString("es-PY");
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
// Turno que cruza la medianoche → la hora sola no alcanza: se antepone dd/mm.
const horaTurno = (iso: string, conDia: boolean) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: TZ, ...(conDia ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(",", "");

export const GET = withTenant(async (ctx, req) => {
  const id = cajaIdDeUrl(req.url);
  if (!id) return ERR.invalid("Falta el id de la caja");
  const auto = new URL(req.url).searchParams.get("auto") === "1";

  let data;
  try {
    data = await getDetalleCaja(ctx.db, id);
  } catch {
    return ERR.server();
  }
  if (!data) return ERR.notFound("turno");
  const c = data.caja;
  const conDia = dia(c.fecha_apertura) !== dia(c.fecha_cierre ?? new Date().toISOString());

  // Línea de tiempo unificada (misma lógica que la pantalla): apertura + ventas + movimientos.
  type Row = { ts: string; tipo: string; detalle: string; medio: string; monto: number; signo: number; tachado?: boolean };
  const timeline: Row[] = [
    {
      ts: c.fecha_apertura,
      tipo: "Apertura",
      detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja",
      medio: "Efectivo",
      monto: c.monto_apertura,
      signo: 1,
    },
  ];
  for (const v of data.ventas) {
    const credito = v.tipo_venta === "CREDITO";
    timeline.push({
      ts: v.fecha,
      tipo: "Venta",
      detalle: `${v.numero_control ?? "Venta"}${v.tipo_venta ? ` · ${v.tipo_venta}` : ""}`,
      medio: credito ? "Crédito" : v.medios.length ? v.medios.map(medioLabel).join(" + ") : medioLabel(v.metodo_pago),
      monto: v.total,
      signo: 1,
      tachado: v.estado === "anulada",
    });
  }
  for (const m of data.movimientos) {
    const entrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
    const tipo = m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : m.tipo === "retiro" ? "Retiro" : "Ajuste";
    const autor = m.usuario_nombre || m.usuario_email;
    timeline.push({
      ts: m.created_at,
      tipo,
      detalle: autor ? `${m.concepto} · ${autor}` : m.concepto,
      medio: medioLabel(m.medio_pago),
      monto: Math.abs(m.monto),
      signo: entrada ? 1 : -1,
    });
  }
  timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const dif = c.diferencia;
  const difTxt = dif == null ? "turno abierto" : `${dif > 0 ? "+" : ""}Gs. ${gs(dif)}`;
  const filas = timeline
    .map(
      (r) => `<tr class="${r.tachado ? "anul" : ""}">
      <td class="mono">${esc(horaTurno(r.ts, conDia))}</td>
      <td>${esc(r.tipo)}</td>
      <td>${esc(r.detalle)}${r.tachado ? ' <span class="anulbadge">(anulada)</span>' : ""}</td>
      <td>${esc(r.medio)}</td>
      <td class="num ${r.signo < 0 ? "neg" : "pos"}">${r.signo < 0 ? "−" : "+"}${gs(r.monto)}</td>
    </tr>`,
    )
    .join("");

  const T = clienteConfig.color;
  const card = (lbl: string, val: string, hint = "", hi = false) =>
    `<div class="card${hi ? " hi" : ""}"><div class="lbl">${esc(lbl)}</div><div class="val">${esc(val)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Arqueo de caja ${esc(c.numero_caja)} — ${esc(fechaHora(c.fecha_apertura))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:22px; }
  .doc { background:#fff; max-width:900px; margin:0 auto; padding:26px 30px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .membrete { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid ${T}; padding-bottom:8px; }
  .membrete .emp { font-size:18px; font-weight:800; color:${T}; }
  .membrete .dom { font-size:11px; color:#666; }
  .titulo { text-align:center; font-weight:800; font-size:16px; letter-spacing:1.5px; border:2px solid #111; padding:7px; margin:14px 0 6px; }
  .sub { text-align:center; font-size:12px; color:#555; margin-bottom:6px; }
  .meta { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 22px; font-size:11px; color:#666; margin-bottom:16px; }
  .meta b { color:#111; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:18px; }
  .card { border:1px solid #e2e7ef; border-radius:8px; padding:8px 14px; text-align:center; min-width:120px; }
  .card.hi { border-color:${T}; background:${T}14; }
  .card .lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:${T}; }
  .card .val { font-size:15px; font-weight:800; color:#111; font-variant-numeric:tabular-nums; }
  .card .hint { font-size:9px; color:#888; margin-top:1px; }
  h3 { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:${T}; margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th, td { border:1px solid #dcdcdc; padding:5px 8px; text-align:left; vertical-align:top; }
  th { background:#f4f7f7; font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:${T}; }
  td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.mono { font-family:ui-monospace,monospace; white-space:nowrap; }
  td.num.neg { color:#b91c1c; } td.num.pos { color:#047857; }
  tr.anul td { color:#b91c1c; text-decoration:line-through; }
  .anulbadge { font-size:9px; color:#b91c1c; }
  .vacio { text-align:center; color:#888; padding:20px; }
  .obs { margin-top:12px; font-size:11px; border:1px solid #e2e7ef; border-radius:6px; padding:8px 10px; background:#fafafa; white-space:pre-line; }
  .foot { margin-top:16px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; }
  .firmas { display:flex; gap:40px; margin-top:46px; }
  .firmas div { flex:1; border-top:1px solid #111; text-align:center; font-size:10.5px; padding-top:4px; color:#444; }
  .actions { max-width:900px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; padding:0; } .actions { display:none; } @page { size:A4; margin:12mm; } }
</style></head>
<body><div class="doc">
  <div class="membrete"><div class="emp">${esc(clienteConfig.nombre)}</div><div class="dom">${esc(clienteConfig.dominio)}</div></div>
  <div class="titulo">ARQUEO DE CAJA</div>
  <div class="sub">Caja ${esc(c.numero_caja)} · ${esc(estadoCajaLabel(c.estado))}</div>
  <div class="meta">
    <span>Apertura: <b>${esc(fechaHora(c.fecha_apertura))}</b></span>
    <span>Cierre: <b>${c.fecha_cierre ? esc(fechaHora(c.fecha_cierre)) : "— en curso"}</b></span>
    ${c.abierta_por_nombre ? `<span>Abrió: <b>${esc(c.abierta_por_nombre)}</b></span>` : ""}
    ${c.cerrada_por_nombre ? `<span>Cerró: <b>${esc(c.cerrada_por_nombre)}</b></span>` : ""}
  </div>
  <div class="cards">
    ${card("Vendido", `Gs. ${gs(c.total_vendido)}`, `${c.cantidad_ventas} venta(s)`, true)}
    ${card("Efectivo", `Gs. ${gs(c.total_efectivo)}`)}
    ${card("Tarjeta", `Gs. ${gs(c.total_tarjeta)}`)}
    ${card("POS", `Gs. ${gs(c.total_pos)}`)}
    ${card("Transferencia", `Gs. ${gs(c.total_transferencia)}`)}
    ${c.total_otros ? card("Otros medios", `Gs. ${gs(c.total_otros)}`) : ""}
    ${card("Crédito", `Gs. ${gs(c.total_credito)}`, "no ingresa a caja")}
    ${card("Efectivo esperado", `Gs. ${gs(c.efectivo_esperado)}`, "apertura + efectivo ± movs")}
    ${card("Contado / Diferencia", c.monto_cierre_contado == null ? "—" : `Gs. ${gs(c.monto_cierre_contado)}`, difTxt)}
  </div>
  <h3>Movimientos del turno</h3>
  <table>
    <thead><tr><th>Hora</th><th>Movimiento</th><th>Detalle</th><th>Método</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="5" class="vacio">Sin movimientos en este turno.</td></tr>`}</tbody>
  </table>
  ${c.observacion_cierre ? `<div class="obs"><b>Observación de cierre:</b> ${esc(c.observacion_cierre)}</div>` : ""}
  <div class="firmas"><div>Cajero</div><div>Supervisor</div></div>
  <div class="foot">Arqueo generado desde ${esc(clienteConfig.nombre)} · ${esc(fechaHora(new Date().toISOString()))}. Documento no fiscal.</div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
${auto ? "<script>setTimeout(function(){window.print();},300);</script>" : ""}
</body></html>`;

  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
});
