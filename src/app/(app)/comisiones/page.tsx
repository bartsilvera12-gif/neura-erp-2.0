"use client";

/**
 * /comisiones — Comisiones (traída de sistemas-propio, receta 115): seguimiento del mes según la
 * política activa. El Administrador ve a todos los vendedores; el resto, "Mi comisión".
 * Por vendedor: progreso de escala, totales, movimientos (con excluir/incluir), lo que le falta
 * cobrar y la recurrencia nueva. Nada se guarda como liquidación.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Percent, RefreshCw, Search, Settings, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { fechaCorta, gs } from "@/components/graficos/formato";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { hoyPY } from "@/lib/fecha/paraguay";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import { etiquetaMes } from "@/modules/comisiones/calculo";
import type { ACobrarDatos, ACobrarVendedor, Linea, PreviewComisiones, RecurrenciaDatos, VendedorFila } from "@/modules/comisiones/tipos";

const TH = "whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500";
const TD = "px-3 py-2.5";
const BOTON = "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:min-h-11 max-sm:justify-center max-sm:text-sm";

const fmtPct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-PY", { maximumFractionDigits: 2 })}%`);

function ultimosMeses(n: number): [string, string][] {
  const [a, m] = hoyPY().slice(0, 7).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const total = a * 12 + (m - 1) - i;
    const mes = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
    return [mes, etiquetaMes(mes)];
  });
}

function escalaActual(r: VendedorFila): string {
  if (r.escala_actual_porcentaje === null) return r.siguiente_escala_desde === null ? "Sin escalas configuradas" : "Sin escala alcanzada todavía";
  return `Escala actual: ${fmtPct(r.escala_actual_porcentaje)}${r.escala_actual_premio_fijo ? ` + ${gs(r.escala_actual_premio_fijo)} fijo` : ""}`;
}
function siguienteEscala(r: VendedorFila): string {
  if (r.max_escala_alcanzada) return "Máxima escala alcanzada";
  if (r.siguiente_escala_desde === null) return "Sin siguiente escala";
  return `Siguiente escala: ${fmtPct(r.siguiente_escala_porcentaje)} desde ${gs(r.siguiente_escala_desde)}`;
}
function faltaEscala(r: VendedorFila): string {
  if (r.max_escala_alcanzada) return "Ya está en el tramo más alto.";
  if (r.falta_para_siguiente_escala === null) return "Sin escala siguiente configurada.";
  return `Faltan ${gs(r.falta_para_siguiente_escala)} para llegar a la siguiente escala.`;
}

function Titulo({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span aria-hidden className="block h-5 w-1 rounded-full bg-[var(--brand)]" />
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{children}</h2>
      {extra}
    </div>
  );
}

function Kpi({ label, valor, sub, tono = "neutro", onClick }: { label: string; valor: string | number; sub?: string; tono?: "neutro" | "destacado" | "alerta"; onClick?: () => void }) {
  const clases = `relative overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${tono === "destacado" ? "border-[var(--brand)]/55 bg-gradient-to-br from-white via-white to-[var(--brand-50)]" : "border-slate-200"}`;
  const color = tono === "destacado" ? "text-[var(--brand)]" : tono === "alerta" ? "text-amber-700" : "text-slate-900";
  const contenido = (
    <>
      {tono === "destacado" ? <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--brand)] to-[var(--brand)]/30" /> : null}
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums tracking-tight ${color}`}>{valor}</p>
      {sub ? <p className="mt-1 text-[11px] text-slate-500">{sub}</p> : null}
      {onClick ? <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand)]">Ver detalle →</p> : null}
    </>
  );
  return onClick ? <button type="button" onClick={onClick} className={`${clases} block w-full transition-shadow hover:shadow-md`}>{contenido}</button> : <div className={clases}>{contenido}</div>;
}

function ProgresoEscala({ r }: { r: VendedorFila }) {
  if (r.escala_actual_porcentaje === null && r.siguiente_escala_desde === null) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">Sin escalas configuradas para esta política.</div>;
  }
  const avance = r.max_escala_alcanzada ? 100 : r.progreso_hacia_siguiente_pct ?? 0;
  return (
    <div className="space-y-2 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand-50)]/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{escalaActual(r)}</p>
          <p className="text-xs text-slate-500">{siguienteEscala(r)}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${r.max_escala_alcanzada ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[var(--brand)]/30 bg-white text-[var(--brand)]"}`}>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${r.max_escala_alcanzada ? "bg-emerald-500" : "bg-[var(--brand)]"}`} />
          {r.max_escala_alcanzada ? "Máxima escala" : `${avance}%`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white ring-1 ring-slate-200">
        <div className="h-2 rounded-full bg-[var(--brand)] transition-all" style={{ width: `${avance}%` }} />
      </div>
      <p className="text-xs text-slate-600">{faltaEscala(r)}</p>
    </div>
  );
}

function Totales({ r }: { r: VendedorFila }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Kpi label="Base comisionable" valor={gs(r.revenue_base)} />
      <Kpi label="Comisión estimada" valor={gs(r.comision_estimada)} tono="destacado" sub={r.premio_fijo_aplicado > 0 ? `Variable ${gs(r.comision_variable)} + Premio fijo ${gs(r.premio_fijo_aplicado)}` : undefined} />
      <Kpi label="Pendiente de cobro" valor={gs(r.a_cobrar_total)} tono="alerta" />
      <Kpi label="Recurrencia nueva del mes" valor={gs(r.recurrencia_mes)} sub="Clientes nuevos · no suma a la base" />
    </div>
  );
}

const motivoExclusion = (l: Linea) =>
  l.origen === "override_excluir" ? l.override_motivo || "Excluido manualmente" : l.origen === "factura" ? "Venta marcada como no comisionable" : "No es venta nueva (cliente recurrente o suscripción)";

type CtxExcluir = { busy: string | null; abrir: (l: Linea) => void; quitar: (pagoId: string) => void };

function AccionLinea({ l, ctx }: { l: Linea; ctx?: CtxExcluir }) {
  if (!ctx || !l.pago_id) return <span className="text-slate-300">—</span>;
  const manual = l.origen === "override_incluir" || l.origen === "override_excluir";
  const busy = ctx.busy === l.pago_id;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {manual ? (
        <button type="button" disabled={busy} onClick={() => ctx.quitar(l.pago_id!)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-50 max-md:min-h-11 max-md:px-3 max-md:text-xs">Quitar</button>
      ) : null}
      <button type="button" disabled={busy} onClick={() => ctx.abrir(l)}
        className={`rounded-lg border px-2 py-1 text-[10px] font-semibold disabled:opacity-50 max-md:min-h-11 max-md:px-3 max-md:text-xs ${l.comisiona ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
        {l.comisiona ? "Excluir" : "Incluir"}
      </button>
    </div>
  );
}

function Movimientos({ r, ctx, ocultarExcluidos }: { r: VendedorFila; ctx?: CtxExcluir; ocultarExcluidos?: boolean }) {
  const [q, setQ] = useState("");
  const [excluidos, setExcluidos] = useState(false);
  const cantExcluidos = r.lineas.filter((l) => !l.comisiona).length;
  const ver = !ocultarExcluidos && excluidos;
  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return r.lineas.filter((l) => l.comisiona === !ver).filter((l) => !t || [l.cliente_label, l.numero_factura ?? "", fechaCorta(l.fecha)].some((x) => x.toLowerCase().includes(t)));
  }, [r.lineas, q, ver]);

  const cliente: ColumnaTabla<Linea> = {
    key: "cliente", titulo: "Cliente", movil: "titulo",
    celda: (l) => (<><p className="font-medium text-slate-800">{l.cliente_label}</p>{l.numero_factura ? <p className="text-[10px] font-normal text-slate-400">{l.numero_factura}</p> : null}</>),
  };
  const accion: ColumnaTabla<Linea> = { key: "accion", titulo: "Acción", movil: "pie", claseTh: "text-right", claseTd: "text-right", celda: (l) => <AccionLinea l={l} ctx={ctx} /> };
  const pago: ColumnaTabla<Linea> = { key: "pago", titulo: "Fecha de pago", movil: "dato", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-600", celda: (l) => fechaCorta(l.fecha) };
  const pagado: ColumnaTabla<Linea> = { key: "pagado", titulo: "Monto pagado", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900", celda: (l) => gs(l.monto_base) };
  const columnas: ColumnaTabla<Linea>[] = ver
    ? [cliente, pago, pagado, { key: "motivo", titulo: "Motivo", movil: "dato", claseTd: "text-xs text-slate-600", celda: (l) => (<>{motivoExclusion(l)}{l.override_por ? <span className="block text-[10px] text-slate-400">{l.override_por}</span> : null}</>) }, ...(ctx ? [accion] : [])]
    : [
        cliente,
        { key: "alta", titulo: "Fecha alta cliente", movil: "oculto", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-600", celda: (l) => fechaCorta(l.cliente_alta) },
        { key: "total", titulo: "Monto total", movil: "oculto", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-700", celda: (l) => gs(l.factura_monto_total) },
        pagado,
        { key: "susc", titulo: "Monto suscripción", movil: "oculto", claseTh: "text-right", claseTd: "whitespace-nowrap text-right text-xs tabular-nums text-slate-600", celda: (l) => (l.monto_suscripcion ? gs(l.monto_suscripcion) : <span className="text-slate-300">—</span>) },
        pago,
        { key: "comision", titulo: "Comisión (variable)", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-[var(--brand)]", celda: (l) => gs(l.comision_estimada_linea) },
        ...(ctx ? [accion] : []),
      ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar movimientos" placeholder="Buscar cliente, comprobante o fecha…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] max-md:h-11" />
        </div>
        {!ocultarExcluidos ? (
          <button type="button" onClick={() => setExcluidos((v) => !v)} className={`${BOTON} ${excluidos ? "border-[var(--brand)] text-[var(--brand)]" : ""}`}>
            {excluidos ? "Ver comisionables" : `Mostrar excluidos${cantExcluidos ? ` (${cantExcluidos})` : ""}`}
          </button>
        ) : null}
      </div>
      <div className={`overflow-hidden rounded-xl border ${ver ? "border-amber-200" : "border-slate-200"}`}>
        <TablaTarjetas filas={filas} columnas={columnas} claveFila={(l) => `${l.pago_id ?? ""}-${l.factura_id}`} minAncho={ver ? 680 : 900} thBase={TH} tdBase={TD}
          vacio={<p className="px-4 py-10 text-center text-sm text-slate-500">{q ? "No se encontraron movimientos para esta búsqueda." : ver ? "No hay movimientos excluidos." : "No hay movimientos comisionables en este mes."}</p>} />
      </div>
    </div>
  );
}

function ACobrarBloque({ a, onCobrar }: { a: ACobrarVendedor | null; onCobrar?: (f: ACobrarDatos) => void }) {
  const columnas: ColumnaTabla<ACobrarDatos>[] = [
    { key: "cliente", titulo: "Cliente", movil: "titulo", celda: (f) => (<><p className="font-medium text-slate-800">{f.cliente_label}</p>{f.numero_factura ? <p className="text-[10px] font-normal text-slate-400">{f.numero_factura}</p> : null}</>) },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-500", celda: (f) => fechaCorta(f.fecha) },
    { key: "susc", titulo: "Monto suscripción", movil: "oculto", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (f) => (f.monto_suscripcion ? gs(f.monto_suscripcion) : <span className="text-slate-300">—</span>) },
    { key: "total", titulo: "Total", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-500", celda: (f) => gs(f.monto_total) },
    { key: "saldo", titulo: "Saldo a cobrar", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-amber-700", celda: (f) => gs(f.saldo_pendiente) },
    ...(onCobrar ? [{
      key: "cobrar", titulo: "", movil: "pie" as const, claseTd: "text-right",
      celda: (f: ACobrarDatos) => <button type="button" onClick={() => onCobrar(f)} className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:brightness-95 max-md:min-h-11 max-md:w-full">Cobrar</button>,
    }] : []),
  ];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-3">
      <p className="text-xs font-semibold text-slate-800">A cobrar (comisionable): cuáles cobrar</p>
      <p className="mb-2 text-[11px] text-slate-500">Las ventas comisionables con saldo: se vuelven comisión al cobrarlas.</p>
      {a?.facturas.length ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <TablaTarjetas filas={a.facturas} columnas={columnas} claveFila={(f) => f.factura_id} minAncho={700} thBase={TH} tdBase={TD} />
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>{a.facturas.length} venta{a.facturas.length === 1 ? "" : "s"} con saldo</span>
            <span className="text-sm font-bold tabular-nums text-amber-800">{gs(a.total_a_cobrar)}</span>
          </div>
        </div>
      ) : <p className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">Sin ventas comisionables con saldo pendiente.</p>}
    </div>
  );
}

function RecurrenciaBloque({ items, total }: { items: RecurrenciaDatos[]; total: number }) {
  const columnas: ColumnaTabla<RecurrenciaDatos>[] = [
    { key: "cliente", titulo: "Cliente", movil: "titulo", celda: (i) => <span className="font-medium text-slate-800">{i.cliente}</span> },
    { key: "alta", titulo: "Alta", movil: "dato", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-500", celda: (i) => fechaCorta(i.fecha) },
    { key: "plan", titulo: "Plan", movil: "dato", claseTd: "text-slate-500", celda: (i) => i.plan ?? <span className="text-slate-300">—</span> },
    { key: "cuota", titulo: "Cuota mensual", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-emerald-700", celda: (i) => gs(i.monto) },
  ];
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3">
      <p className="text-xs font-semibold text-slate-800">Recurrencia nueva del mes: quiénes suman</p>
      <p className="mb-2 text-[11px] text-slate-500">Clientes dados de alta este mes, con su cuota de suscripción. No suma a la base ni paga comisión.</p>
      {items.length ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <TablaTarjetas filas={items} columnas={columnas} claveFila={(i) => i.cliente_id} thBase={TH} tdBase={TD} />
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>{items.length} cliente{items.length === 1 ? "" : "s"} nuevo{items.length === 1 ? "" : "s"}</span>
            <span className="text-sm font-bold tabular-nums text-emerald-800">{gs(total)}</span>
          </div>
        </div>
      ) : <p className="rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">Sin clientes nuevos con suscripción este mes.</p>}
    </div>
  );
}

function ModalExcluir({ objetivo, busy, onCancelar, onConfirmar }: { objetivo: Linea; busy: boolean; onCancelar: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState("");
  return (
    <Modal titulo={objetivo.comisiona ? "Excluir de comisión" : "Incluir en comisión"} onClose={onCancelar}>
      <p className="text-xs text-slate-500">{objetivo.cliente_label} · {objetivo.numero_factura ?? "—"} · {gs(objetivo.monto_base)}</p>
      <label className="mt-4 block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Motivo (obligatorio)</span>
        <textarea autoFocus rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: cliente recurrente, no es venta nueva"
          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]" />
      </label>
      <div className="mt-4 flex justify-end gap-2 max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1">
        <button type="button" onClick={onCancelar} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
        <button type="button" onClick={() => onConfirmar(motivo.trim())} disabled={busy || !motivo.trim()} className="rounded-xl bg-[var(--brand)] px-3.5 py-2 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50">{busy ? "Guardando…" : "Confirmar"}</button>
      </div>
    </Modal>
  );
}

function ModalExcluidas({ filas, periodo, ctx, onClose }: { filas: VendedorFila[]; periodo: string; ctx: CtxExcluir; onClose: () => void }) {
  const excluidas = filas.flatMap((v) => v.lineas.filter((l) => !l.comisiona).map((l) => ({ ...l, vendedor: v.vendedor_nombre })));
  type Fila = (typeof excluidas)[number];
  const columnas: ColumnaTabla<Fila>[] = [
    { key: "cliente", titulo: "Cliente", movil: "titulo", celda: (l) => (<><p className="font-medium text-slate-800">{l.cliente_label}</p>{l.numero_factura ? <p className="text-[10px] font-normal text-slate-400">{l.numero_factura}</p> : null}</>) },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-600", celda: (l) => fechaCorta(l.fecha) },
    { key: "monto", titulo: "Monto", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums", celda: (l) => gs(l.monto_base) },
    { key: "vend", titulo: "Vendedor", movil: "dato", claseTd: "text-xs text-slate-600", celda: (l) => l.vendedor },
    { key: "motivo", titulo: "Motivo", movil: "dato", claseTd: "text-xs text-slate-700", celda: (l) => motivoExclusion(l) },
    { key: "accion", titulo: "", movil: "pie", claseTd: "text-right", celda: (l) => <AccionLinea l={l} ctx={ctx} /> },
  ];
  return (
    <Modal titulo={`${excluidas.length} línea${excluidas.length === 1 ? "" : "s"} no comisiona${excluidas.length === 1 ? "" : "n"}`} onClose={onClose} size="xl">
      <p className="mb-3 text-xs text-slate-500">{periodo} · Total excluido: {gs(excluidas.reduce((s, l) => s + l.monto_base, 0))}. Las de clientes sin vendedor se cuentan aparte.</p>
      <div className="overflow-hidden rounded-xl border border-amber-200">
        <TablaTarjetas filas={excluidas} columnas={columnas} claveFila={(l) => `${l.pago_id ?? ""}-${l.factura_id}`} minAncho={720} thBase={TH} tdBase={TD}
          vacio={<p className="px-4 py-10 text-center text-sm text-slate-500">No hay líneas excluidas en este mes.</p>} />
      </div>
    </Modal>
  );
}

const inicial = (s: string) => (s.replace(/^[^\p{L}\p{N}]+/u, "")[0] ?? "?").toUpperCase();

function TarjetaVendedor({ r, ctx, onCobrar }: { r: VendedorFila; ctx: CtxExcluir; onCobrar?: (f: ACobrarDatos) => void }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow open:shadow-md hover:shadow-md">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 max-sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--brand)]/30 bg-[var(--brand-50)] text-sm font-semibold text-[var(--brand)]">{inicial(r.vendedor_nombre)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{r.vendedor_nombre}</p>
            <p className="mt-0.5 text-xs text-slate-500">{r.cantidad_movimientos} movimiento{r.cantidad_movimientos === 1 ? "" : "s"} · <span className="text-slate-700">{escalaActual(r)}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-right max-sm:w-full max-sm:justify-between max-sm:gap-3">
          {([["Base", r.revenue_base, "text-slate-900"], ["Comisión", r.comision_estimada, "text-[var(--brand)]"], ["Pendiente", r.a_cobrar_total, "text-amber-700"]] as const).map(([t, v, c]) => (
            <div key={t}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t}</p>
              <p className={`text-sm font-semibold tabular-nums ${c}`}>{gs(v)}</p>
            </div>
          ))}
          <div className="min-w-[200px] text-right max-lg:hidden">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Progreso de escala</p>
            <p className="mt-0.5 text-xs font-medium text-slate-700">{faltaEscala(r)}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-[var(--brand)]" style={{ width: `${r.max_escala_alcanzada ? 100 : r.progreso_hacia_siguiente_pct ?? 0}%` }} />
            </div>
          </div>
          <ChevronDown className="h-5 w-5 shrink-0 text-[var(--brand)] transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4 max-sm:px-3">
        <ProgresoEscala r={r} />
        <Totales r={r} />
        <Movimientos r={r} ctx={ctx} />
        <ACobrarBloque a={r.a_cobrar} onCobrar={onCobrar} />
        <RecurrenciaBloque items={r.recurrencia_items} total={r.recurrencia_mes} />
      </div>
    </details>
  );
}

export default function ComisionesPage() {
  const [mes, setMes] = useState("");
  const [datos, setDatos] = useState<PreviewComisiones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [objetivo, setObjetivo] = useState<Linea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verExcluidas, setVerExcluidas] = useState(false);
  const [cobrando, setCobrando] = useState<ACobrarDatos | null>(null);
  const puedeCobrar = usePermiso("registrar_cobros");
  const meses = useMemo(() => ultimosMeses(24), []);

  const cargar = useCallback(async (m: string, silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      const d = await apiFetch<PreviewComisiones>(`/api/comisiones/preview${m ? `?mes=${m}` : ""}`);
      setDatos(d);
      setMes(d.mes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(""); }, [cargar]);

  const confirmar = async (motivo: string) => {
    if (!objetivo?.pago_id) return;
    setBusy(objetivo.pago_id);
    try {
      await apiFetch("/api/comisiones/override", { method: "POST", body: JSON.stringify({ periodo_ym: mes, pago_id: objetivo.pago_id, factura_id: objetivo.factura_id, decision: objetivo.comisiona ? "excluir" : "incluir", motivo }) });
      setObjetivo(null);
      await cargar(mes, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const quitar = async (pagoId: string) => {
    setBusy(pagoId);
    try {
      await apiFetch(`/api/comisiones/override?periodo_ym=${mes}&pago_id=${pagoId}`, { method: "DELETE" });
      await cargar(mes, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const esAdmin = !!datos?.es_admin;
  const selectorMes = (
    <div className="flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Mes a consultar</span>
      <div className="w-52 max-sm:w-full"><Select block value={mes} onChange={(m) => { setMes(m); void cargar(m); }} etiqueta="Mes a consultar" options={meses} /></div>
    </div>
  );

  if (cargando && !datos) {
    return <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando seguimiento de comisiones…</div>;
  }
  if (!datos) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="h-4 w-4 shrink-0" /> {error}</div>
        <button type="button" onClick={() => void cargar("")} className={BOTON}><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>
      </div>
    );
  }
  if (datos.estado !== "ok") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <EncabezadoPagina volver={{ href: "/comercial", label: "Comercial" }} kicker="Comercial" titulo="Comisiones"
          subtitulo={datos.estado === "sin_politica" ? "No hay política de comisiones configurada para esta empresa." : "La política existe pero está inactiva."} />
        {esAdmin ? (
          <Link href="/configuracion/comisiones" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-50)] px-4 py-3 text-sm font-semibold text-[var(--brand)]">
            Ir a Configuración › Comisiones
          </Link>
        ) : <p className="text-sm text-slate-500">Pedile a un administrador que la configure.</p>}
      </div>
    );
  }

  const ctx: CtxExcluir = { busy, abrir: setObjetivo, quitar: (p) => void quitar(p) };
  const onCobrar = puedeCobrar ? (f: ACobrarDatos) => setCobrando(f) : undefined;
  const k = datos.kpis!;
  const propia = datos.por_vendedor[0] ?? null;

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina volver={{ href: "/comercial", label: "Comercial" }} kicker={esAdmin ? "Comercial" : "Mi comisión"} titulo={esAdmin ? "Comisiones" : "Comisión del mes"}
        subtitulo="Seguimiento mensual de comisiones según la política activa."
        acciones={esAdmin ? (
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            <button type="button" onClick={() => void cargar(mes)} className={BOTON}><RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Recalcular</button>
            <Link href="/configuracion/comisiones" className={BOTON}><Settings className="h-3.5 w-3.5" /> Configuración</Link>
          </div>
        ) : undefined} />

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <section className="rounded-2xl border border-[var(--brand)]/45 bg-white px-6 py-4 shadow-sm max-sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="block h-5 w-1 rounded-full bg-[var(--brand)]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Período</p>
            <p className="text-base font-semibold capitalize tracking-tight text-slate-900">{datos.periodo}</p>
          </div>
          {selectorMes}
        </div>
      </section>

      {esAdmin ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-sm:p-4">
            <Titulo>Resumen</Titulo>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 max-sm:[&>*:first-child]:col-span-2">
              <Kpi label="Base comisionable" valor={gs(k.revenue_base_total)} />
              <Kpi label="Comisión estimada" valor={gs(k.comision_estimada_total)} tono="destacado" sub={k.premio_fijo_total > 0 ? `Variable ${gs(k.comision_variable_total)} + Premio fijo ${gs(k.premio_fijo_total)}` : undefined} />
              <Kpi label="Total pendiente de cobro" valor={gs(k.a_cobrar_total)} tono="alerta" />
              <Kpi label="Líneas excluidas" valor={k.lineas_excluidas} sub="No comisionan este período" tono={k.lineas_excluidas ? "alerta" : "neutro"} onClick={k.lineas_excluidas ? () => setVerExcluidas(true) : undefined} />
              <Kpi label="Recurrencia nueva del mes" valor={gs(k.recurrencia_total)} sub="Clientes nuevos · no suma a la base" />
            </div>
            {k.fuentes_sin_vendedor > 0 ? (
              <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex max-w-3xl items-start gap-2.5 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  Hay {k.fuentes_sin_vendedor} {k.fuentes_sin_vendedor === 1 ? "movimiento" : "movimientos"} de clientes sin vendedor asignado. Asigná un vendedor responsable en la ficha del cliente para incluirlos en el cálculo.
                </p>
                <Link href="/clientes" className="shrink-0 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 max-sm:flex max-sm:min-h-11 max-sm:w-full max-sm:items-center max-sm:justify-center">Ir a Clientes</Link>
              </div>
            ) : null}
          </section>

          <section>
            <Titulo extra={datos.por_vendedor.length ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">{datos.por_vendedor.length}</span> : null}>Por vendedor</Titulo>
            {datos.por_vendedor.length ? (
              <div className="space-y-3">{datos.por_vendedor.map((r) => <TarjetaVendedor key={r.vendedor_usuario_id} r={r} ctx={ctx} onCobrar={onCobrar} />)}</div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center shadow-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400"><Users className="h-5 w-5" /></div>
                <p className="text-sm font-semibold text-slate-700">No hay movimientos con vendedor asignado en este período.</p>
                <p className="mt-1 text-xs text-slate-500">Cuando haya movimientos para la base seleccionada, vas a verlos acá.</p>
              </div>
            )}
          </section>
        </>
      ) : propia ? (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-sm:p-4">
            <Titulo>Mi comisión del mes</Titulo>
            <ProgresoEscala r={propia} />
            <Totales r={propia} />
          </section>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm max-sm:p-4">
            <div>
              <p className="font-semibold text-slate-900">Mis clientes y movimientos</p>
              <p className="mt-0.5 text-xs text-slate-500">{propia.lineas.filter((l) => l.comisiona).length} movimiento{propia.lineas.filter((l) => l.comisiona).length === 1 ? "" : "s"} · Pendiente de cobro {gs(propia.a_cobrar_total)}</p>
            </div>
            <Movimientos r={propia} ocultarExcluidos />
          </section>
          <ACobrarBloque a={propia.a_cobrar} onCobrar={onCobrar} />
          <RecurrenciaBloque items={propia.recurrencia_items} total={propia.recurrencia_mes} />
        </>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--brand)]/25 bg-[var(--brand-50)] text-[var(--brand)]"><Percent className="h-5 w-5" /></div>
          <p className="text-sm font-semibold text-slate-800">Todavía no tenés movimientos comisionables en este período.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">Cuando tus clientes registren movimientos dentro del período, vas a verlos acá.</p>
        </div>
      )}

      {objetivo ? <ModalExcluir key={objetivo.pago_id} objetivo={objetivo} busy={!!busy} onCancelar={() => setObjetivo(null)} onConfirmar={(m) => void confirmar(m)} /> : null}
      {verExcluidas ? <ModalExcluidas filas={datos.por_vendedor} periodo={datos.periodo} ctx={ctx} onClose={() => setVerExcluidas(false)} /> : null}
      {cobrando ? (
        <RegistrarCobro clienteId={cobrando.cliente_id} clienteNombre={cobrando.cliente_label} cxcInicial={cobrando.cxc_id} onClose={() => setCobrando(null)}
          onHecho={() => { setCobrando(null); void cargar(mes, true); }} />
      ) : null}
    </div>
  );
}
