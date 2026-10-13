"use client";

/**
 * /cobranzas — Seguimiento de cobranzas (portado del sistema actual, genérico).
 * Clientes con deuda y sus tramos de mora (por cuotas vencidas: 1, 2, 3 o más). Arriba una
 * franja compacta de cifras (sin tarjetas); los chips de tramo llevan su contador. Filtros
 * por plan (de la suscripción) y categoría del cliente. "Ver detalle" abre el panel lateral
 * con las cuotas, promesas y el registro de pago por transferencia (va a aprobación en
 * Conciliación bancaria). Las cuentas a cobrar de siempre (y el cobro en caja) siguen en
 * /clientes/cobrar.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, HandCoins, Loader2, RefreshCw, Scale, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { Select } from "@/components/Select";
import { DetalleCobranzaPanel, TramoBadge } from "@/modules/cobranzas/DetalleCobranza";
import { filasBase, filtrarTabla, ordenPorDefecto, SIN_CATEGORIA, TODOS, type FilaSeguimiento } from "@/modules/cobranzas/filtros";
import { fechaCorta, gs, planDe, TRAMO_PESO, type Seguimiento, type TramoKey } from "@/modules/cobranzas/tipos";

type SortKey = "cliente" | "plan" | "monto" | "total" | "cuotas" | "tramo" | "mensaje" | "ultimo" | "prox" | "promesa";
type Orden = { key: SortKey; dir: "asc" | "desc" } | null;

const COLUMNAS: { h: string; right?: boolean; key: SortKey | null; kind: "str" | "num" | "date" | null; hint?: string }[] = [
  { h: "Cliente", key: "cliente", kind: "str" },
  { h: "Plan", key: "plan", kind: "str" },
  { h: "Monto mensual", right: true, key: "monto", kind: "num" },
  { h: "Total adeudado", right: true, key: "total", kind: "num", hint: "Deuda emitida impaga: cuotas vencidas + por vencer (no solo lo en mora)" },
  { h: "Cuotas venc.", right: true, key: "cuotas", kind: "num" },
  { h: "Tramo", key: "tramo", kind: "num" },
  { h: "Mensaje del mes", key: "mensaje", kind: "date", hint: "Último mensaje enviado al cliente este mes desde Conversaciones" },
  { h: "Último pago", key: "ultimo", kind: "date" },
  { h: "Próx. venc.", key: "prox", kind: "date" },
  { h: "Promesa de pago", key: "promesa", kind: "date" },
  { h: "Cobranza enviada", key: null, kind: null, hint: "Marca manual: tildá cuando ya le enviaste la cobranza este mes" },
  { h: "Acción", right: true, key: null, kind: null },
];

function valorOrden(r: FilaSeguimiento, key: SortKey): string | number | null {
  switch (key) {
    case "cliente": return r.c.cliente_label.toLowerCase();
    case "plan": return r.plan.toLowerCase();
    case "monto": return r.monto_mensual;
    case "total": return r.total_adeudado;
    case "cuotas": return r.cuotas_vencidas;
    case "tramo": return TRAMO_PESO[r.tramo];
    case "mensaje": return r.c.mensaje_mes_fecha;
    case "ultimo": return r.c.ultimo_pago;
    case "prox": return r.proximo_vencimiento;
    case "promesa": return r.c.promesa_fecha;
  }
}

function ordenar(rows: FilaSeguimiento[], orden: Orden): FilaSeguimiento[] {
  if (!orden) return ordenPorDefecto(rows); // peor tramo y luego mayor deuda
  const f = orden.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valorOrden(a, orden.key);
    const vb = valorOrden(b, orden.key);
    const an = va == null || va === "";
    const bn = vb == null || vb === "";
    if (an && bn) return 0;
    if (an) return 1; // nulos siempre al final
    if (bn) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * f;
    return String(va).localeCompare(String(vb), "es") * f;
  });
}

function MensajeMesBadge({ fecha }: { fecha: string | null }) {
  return fecha ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {fechaCorta(fecha)}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">No</span>
  );
}

export default function SeguimientoCobranzasPage() {
  const [data, setData] = useState<Seguimiento | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tramo, setTramo] = useState<TramoKey | "todos">("todos");
  const [plan, setPlan] = useState(TODOS);
  const [categoria, setCategoria] = useState(TODOS);
  const [soloPromesaHoy, setSoloPromesaHoy] = useState(false);
  const [orden, setOrden] = useState<Orden>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [enviadoLocal, setEnviadoLocal] = useState<Record<string, boolean>>({});
  const toastTimer = useRef<number | null>(null);

  const avisar = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError(null);
    try {
      setData(await apiFetch<Seguimiento>("/api/cobranzas"));
      setEnviadoLocal({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const planes = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.clientes ?? []) for (const s of c.servicios) set.add(planDe(s));
    return [...set].sort((a, b) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b, "es")));
  }, [data]);
  const categorias = useMemo(() => {
    const set = new Set<string>();
    let sin = false;
    for (const c of data?.clientes ?? []) { if (c.categoria) set.add(c.categoria); else sin = true; }
    return { lista: [...set].sort((a, b) => a.localeCompare(b, "es")), sin };
  }, [data]);

  // Plan + categoría + búsqueda: base de las cifras y de los contadores de los chips.
  const base = useMemo(() => filasBase(data?.clientes ?? [], { q, plan, categoria }), [data, q, plan, categoria]);
  const filas = useMemo(() => ordenar(filtrarTabla(base, tramo, soloPromesaHoy, data?.hoy ?? ""), orden), [base, tramo, soloPromesaHoy, data, orden]);

  const cifras = useMemo(() => {
    const porTramo: Record<TramoKey, number> = { por_vencer: 0, tramo_1: 0, tramo_2: 0, tramo_3: 0 };
    let total = 0;
    let cuotas = 0;
    let promesasHoy = 0;
    for (const r of base) {
      total += r.total_adeudado;
      cuotas += r.cuotas_vencidas;
      porTramo[r.tramo] += 1;
      if (data?.hoy && r.c.promesa_fecha === data.hoy) promesasHoy += 1;
    }
    return { total, clientes: base.filter((r) => r.total_adeudado > 0).length, cuotas, promesasHoy, porTramo };
  }, [base, data]);

  const tocarOrden = (key: SortKey, kind: "str" | "num" | "date" | null) =>
    setOrden((prev) => (prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: kind === "str" ? "asc" : "desc" }));

  async function marcarEnviada(clienteId: string, enviada: boolean) {
    setEnviadoLocal((m) => ({ ...m, [clienteId]: enviada })); // optimista
    try {
      await apiFetch("/api/cobranzas/envio", { method: "POST", body: JSON.stringify({ cliente_id: clienteId, enviada }) });
    } catch (e) {
      setEnviadoLocal((m) => ({ ...m, [clienteId]: !enviada }));
      avisar((e as Error).message || "No se pudo actualizar la cobranza enviada");
    }
  }

  async function exportar() {
    setExportando(true);
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set("q", q.trim());
      if (plan !== TODOS) sp.set("plan", plan);
      if (categoria !== TODOS) sp.set("categoria", categoria);
      if (tramo !== "todos") sp.set("tramo", tramo);
      if (soloPromesaHoy) sp.set("promesa_hoy", "1");
      await descargarArchivo(`/api/cobranzas/export?${sp}`, "seguimiento-cobranzas.xlsx");
    } catch (e) {
      avisar((e as Error).message);
    } finally {
      setExportando(false);
    }
  }

  // Scroll horizontal de la tabla: auto-scroll al acercar el mouse a un borde + arrastre.
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, x: 0, left: 0, movido: false });
  const borde = useRef<number | null>(null);
  const pararBorde = useCallback(() => { if (borde.current != null) { window.clearInterval(borde.current); borde.current = null; } }, []);
  useEffect(() => () => pararBorde(), [pararBorde]);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest("button, input, a")) return;
    drag.current = { down: true, x: e.clientX, left: el.scrollLeft, movido: false };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (drag.current.down) {
      el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
      pararBorde();
      return;
    }
    const r = el.getBoundingClientRect();
    const EDGE = 80;
    const x = e.clientX - r.left;
    const dir = x < EDGE ? -1 : x > r.width - EDGE ? 1 : 0;
    const dist = dir < 0 ? x : r.width - x;
    pararBorde();
    if (dir !== 0 && el.scrollWidth > el.clientWidth) {
      const vel = Math.max(3, Math.round(((EDGE - Math.max(0, dist)) / EDGE) * 22));
      borde.current = window.setInterval(() => { el.scrollLeft += dir * vel; }, 16);
    }
  };
  const onUp = () => { drag.current.down = false; pararBorde(); };

  const chips: { key: TramoKey | "todos"; label: string; count: number }[] = [
    { key: "todos", label: "Todos", count: base.length },
    { key: "tramo_3", label: "Tramo 3", count: cifras.porTramo.tramo_3 },
    { key: "tramo_2", label: "Tramo 2", count: cifras.porTramo.tramo_2 },
    { key: "tramo_1", label: "Tramo 1", count: cifras.porTramo.tramo_1 },
    { key: "por_vencer", label: "Por vencer", count: cifras.porTramo.por_vencer },
  ];

  const opcionesPlan: [string, string][] = [[TODOS, "Todos los planes"], ...planes.map((p): [string, string] => [p, p])];
  const opcionesCategoria: [string, string][] = [
    [TODOS, "Todas las categorías"],
    ...categorias.lista.map((c): [string, string] => [c, c]),
    ...(categorias.sin ? [[SIN_CATEGORIA, "Sin categoría"] as [string, string]] : []),
  ];

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Cobranzas</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Seguimiento Cobranzas</h1>
          <p className="mt-1 text-sm text-slate-500">Clientes con deuda y tramos de mora{data?.hoy ? ` · al ${fechaCorta(data.hoy)}` : ""}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/clientes/cobrar" title="Todas las cuentas a cobrar y el cobro en caja"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
            <HandCoins className="h-3.5 w-3.5" /> Cuentas a cobrar
          </Link>
          <Link href="/cobranzas/conciliacion"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
            <Scale className="h-3.5 w-3.5" /> Conciliación
          </Link>
          <button type="button" onClick={() => void exportar()} disabled={exportando || !data}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] disabled:opacity-50">
            {exportando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Exportar Excel
          </button>
          <button type="button" onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </button>
        </div>
      </div>

      {cargando && !data ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" /> Cargando seguimiento de cobranzas…
        </div>
      ) : error && !data ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
          <button type="button" onClick={() => void cargar()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60">
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Franja compacta de cifras (plan + categoría + búsqueda; el tramo filtra solo la tabla). */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <span className="text-slate-500" title="Deuda emitida impaga (vencido + por vencer)">
              Total adeudado <b className="ml-1 tabular-nums text-rose-700">{gs(cifras.total)}</b>
            </span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <span className="text-slate-500">Clientes con deuda <b className="ml-1 tabular-nums text-[#3F8E91]">{cifras.clientes}</b></span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <span className="text-slate-500">Cuotas vencidas <b className="ml-1 tabular-nums text-slate-900">{cifras.cuotas}</b></span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <button type="button" onClick={() => setSoloPromesaHoy((v) => !v)} aria-pressed={soloPromesaHoy}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 transition-colors ${soloPromesaHoy ? "bg-[#4FAEB2]/10 text-[#3F8E91] ring-1 ring-[#4FAEB2]/40" : "text-slate-500 hover:bg-slate-50"}`}
              title={soloPromesaHoy ? "Mostrando solo promesas de hoy (clic para quitar)" : "Ver solo los clientes que prometieron pagar hoy"}>
              Promesas hoy <b className="ml-1 tabular-nums text-[#3F8E91]">{cifras.promesasHoy}</b>
              <span className="text-[10px] font-semibold text-[#4FAEB2]">{soloPromesaHoy ? "· filtrando" : "· filtrar"}</span>
            </button>
            {cargando ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((t) => (
                <button key={t.key} type="button" onClick={() => setTramo(t.key)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${tramo === t.key ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"}`}>
                  {t.label} <span className="tabular-nums text-slate-400">({t.count})</span>
                </button>
              ))}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {planes.length > 1 ? <Select value={plan} onChange={setPlan} options={opcionesPlan} minWidth={170} /> : null}
              {categorias.lista.length > 0 ? <Select value={categoria} onChange={setCategoria} options={opcionesCategoria} minWidth={170} /> : null}
              <div className="relative w-full sm:w-64">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, plan o categoría…"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20" />
                {q ? (
                  <button type="button" onClick={() => setQ("")} aria-label="Limpiar" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {filas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center text-sm text-slate-600">
              No hay clientes con deuda para este filtro.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div ref={scrollRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
                className="cursor-grab select-none overflow-x-auto active:cursor-grabbing" title="Llevá el mouse al borde para desplazar, o arrastrá">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {COLUMNAS.map((col) => {
                        const activa = col.key != null && orden?.key === col.key;
                        return (
                          <th key={col.h} className={`whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${col.right ? "text-right" : "text-left"} ${activa ? "text-[#3F8E91]" : "text-slate-500"}`}>
                            {col.key != null ? (
                              <button type="button" onClick={() => tocarOrden(col.key!, col.kind)} title={col.hint ?? "Ordenar por esta columna"}
                                className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-[#3F8E91]">
                                {col.h}
                                <span className={`text-[9px] leading-none ${activa ? "opacity-100" : "opacity-25"}`}>{activa ? (orden!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                              </button>
                            ) : (
                              <span title={col.hint}>{col.h}</span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filas.map((r) => {
                      const marcada = enviadoLocal[r.c.cliente_id] ?? r.c.cobranza_enviada;
                      const promesaHoy = !!data?.hoy && r.c.promesa_fecha === data.hoy;
                      return (
                        <tr key={r.c.cliente_id} className="align-middle transition-colors hover:bg-[#4FAEB2]/[0.04]">
                          <td className="px-3 py-3 text-sm font-medium text-slate-800">
                            <span className="block max-w-[220px] truncate" title={r.c.cliente_label}>{r.c.cliente_label}</span>
                            {r.c.categoria ? (
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-normal text-slate-500">
                                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.c.categoria_color || "#94a3b8" }} />
                                {r.c.categoria}
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{r.plan}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-slate-700">{gs(r.monto_mensual)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-semibold tabular-nums text-rose-700">{gs(r.total_adeudado)}</td>
                          <td className="px-3 py-3 text-right text-sm tabular-nums text-slate-800">{r.cuotas_vencidas}</td>
                          <td className="whitespace-nowrap px-3 py-3"><TramoBadge tramo={r.tramo} /></td>
                          <td className="whitespace-nowrap px-3 py-3"><MensajeMesBadge fecha={r.c.mensaje_mes_fecha} /></td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-slate-600">{fechaCorta(r.c.ultimo_pago)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-slate-600">{fechaCorta(r.proximo_vencimiento)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                            {r.c.promesa_fecha ? (
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${promesaHoy ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                                {fechaCorta(r.c.promesa_fecha)}
                              </span>
                            ) : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <input type="checkbox" checked={marcada} onChange={(e) => void marcarEnviada(r.c.cliente_id, e.target.checked)}
                              aria-label={`Cobranza enviada a ${r.c.cliente_label}`} title={marcada ? "Cobranza enviada este mes" : "Marcar como cobranza enviada este mes"}
                              className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#4FAEB2]" />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button type="button" onClick={() => setDetalleId(r.c.cliente_id)}
                              className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                              Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {detalleId ? (
        <DetalleCobranzaPanel clienteId={detalleId} onClose={() => setDetalleId(null)} onCambio={() => void cargar(true)} avisar={avisar} />
      ) : null}

      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-[140] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}
