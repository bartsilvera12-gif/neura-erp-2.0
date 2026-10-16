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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, HandCoins, Loader2, RefreshCw, Scale, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { Select } from "@/components/Select";
import { AccionesPagina, BarraFiltros, EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla, type RolMovil } from "@/components/TablaResponsive";
import { DetalleCobranzaPanel, TramoBadge } from "@/modules/cobranzas/DetalleCobranza";
import { filasBase, filtrarTabla, ordenPorDefecto, SIN_CATEGORIA, TODOS, type FilaSeguimiento } from "@/modules/cobranzas/filtros";
import { fechaCorta, gs, planDe, TRAMO_PESO, type Seguimiento, type TramoKey } from "@/modules/cobranzas/tipos";

type SortKey = "cliente" | "plan" | "monto" | "total" | "cuotas" | "tramo" | "mensaje" | "ultimo" | "prox" | "promesa";
type Orden = { key: SortKey; dir: "asc" | "desc" } | null;

// `id`: clave de la columna; `movil`: papel en la TARJETA del celular (TablaTarjetas, < 768 px).
const COLUMNAS: { id: string; h: string; right?: boolean; key: SortKey | null; kind: "str" | "num" | "date" | null; hint?: string; movil: RolMovil }[] = [
  { id: "cliente", h: "Cliente", key: "cliente", kind: "str", movil: "titulo" },
  { id: "plan", h: "Plan", key: "plan", kind: "str", movil: "subtitulo" },
  { id: "monto", h: "Monto mensual", right: true, key: "monto", kind: "num", movil: "detalle" },
  { id: "total", h: "Total adeudado", right: true, key: "total", kind: "num", hint: "Deuda emitida impaga: cuotas vencidas + por vencer (no solo lo en mora)", movil: "valor" },
  { id: "cuotas", h: "Cuotas venc.", right: true, key: "cuotas", kind: "num", movil: "dato" },
  { id: "tramo", h: "Tramo", key: "tramo", kind: "num", movil: "chip" },
  { id: "mensaje", h: "Mensaje del mes", key: "mensaje", kind: "date", hint: "Último mensaje enviado al cliente este mes desde Conversaciones", movil: "detalle" },
  { id: "ultimo", h: "Último pago", key: "ultimo", kind: "date", movil: "dato" },
  { id: "prox", h: "Próx. venc.", key: "prox", kind: "date", movil: "dato" },
  { id: "promesa", h: "Promesa de pago", key: "promesa", kind: "date", movil: "chip" },
  { id: "enviada", h: "Cobranza enviada", key: null, kind: null, hint: "Marca manual: tildá cuando ya le enviaste la cobranza este mes", movil: "acciones" },
  { id: "accion", h: "Acción", right: true, key: null, kind: null, movil: "oculto" }, // en la tarjeta, tocarla abre el detalle
];

// Orden en el celular (no hay encabezados que tocar): se elige en la hoja de filtros.
const OPCIONES_ORDEN: [string, string][] = [
  ["", "Peor tramo y mayor deuda"],
  ["total:desc", "Mayor deuda"],
  ["cuotas:desc", "Más cuotas vencidas"],
  ["cliente:asc", "Cliente (A–Z)"],
  ["prox:asc", "Próximo vencimiento"],
  ["promesa:asc", "Promesa de pago"],
  ["ultimo:desc", "Último pago"],
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

  // Escritorio: scroll horizontal de la tabla con el mouse (auto-scroll al acercarse a un borde
  // + arrastre). Solo con mouse: en táctil se desliza con el dedo, sin intervalos.
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ down: false, x: 0, left: 0, movido: false });
  const borde = useRef<number | null>(null);
  const pararBorde = useCallback(() => { if (borde.current != null) { window.clearInterval(borde.current); borde.current = null; } }, []);
  useEffect(() => () => pararBorde(), [pararBorde]);
  const scroller = () => scrollRef.current?.querySelector<HTMLDivElement>(".overflow-x-auto") ?? null;
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller();
    if (!el || e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest("button, input, a, label")) return;
    drag.current = { down: true, x: e.clientX, left: el.scrollLeft, movido: false };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller();
    if (!el || e.pointerType !== "mouse") return;
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

  const vistaTarjetas = useVistaTarjetas();
  const hoy = data?.hoy ?? "";

  // Columnas de TablaTarjetas: tabla con encabezados que ordenan (≥ 768 px) y tarjetas en celular.
  const columnas = useMemo((): ColumnaTabla<FilaSeguimiento>[] => {
    const promesaCls = (r: FilaSeguimiento) =>
      hoy && r.c.promesa_fecha === hoy ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-slate-50 text-slate-600";
    const celda: Record<string, (r: FilaSeguimiento) => React.ReactNode> = {
      cliente: (r) => (
        <>
          <span className="block max-w-[220px] truncate text-sm font-medium text-slate-800" title={r.c.cliente_label}>{r.c.cliente_label}</span>
          {r.c.categoria ? (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-normal text-slate-500">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.c.categoria_color || "#94a3b8" }} />
              {r.c.categoria}
            </span>
          ) : null}
        </>
      ),
      plan: (r) => r.plan,
      monto: (r) => gs(r.monto_mensual),
      total: (r) => gs(r.total_adeudado),
      cuotas: (r) => r.cuotas_vencidas,
      tramo: (r) => <TramoBadge tramo={r.tramo} />,
      mensaje: (r) => <MensajeMesBadge fecha={r.c.mensaje_mes_fecha} />,
      ultimo: (r) => fechaCorta(r.c.ultimo_pago),
      prox: (r) => fechaCorta(r.proximo_vencimiento),
      promesa: (r) => (r.c.promesa_fecha ? (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${promesaCls(r)}`}>
          {fechaCorta(r.c.promesa_fecha)}
        </span>
      ) : <span className="text-slate-400">—</span>),
      enviada: (r) => {
        const marcada = enviadoLocal[r.c.cliente_id] ?? r.c.cobranza_enviada;
        return (
          // Toda la celda es del tilde: tocar al lado no abre el detalle.
          <span onClick={(e) => e.stopPropagation()} className="-m-3 flex cursor-default p-3">
            <input type="checkbox" checked={marcada} onChange={(e) => void marcarEnviada(r.c.cliente_id, e.target.checked)}
              aria-label={`Cobranza enviada a ${r.c.cliente_label}`} title={marcada ? "Cobranza enviada este mes" : "Marcar como cobranza enviada este mes"}
              className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#4FAEB2]" />
          </span>
        );
      },
      accion: (r) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); setDetalleId(r.c.cliente_id); }}
          className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
          Ver detalle <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ),
    };
    // En la tarjeta: textos sin recortar y etiquetas que se entienden solas.
    const movil: Record<string, (r: FilaSeguimiento) => React.ReactNode> = {
      cliente: (r) => (
        <>
          {r.c.cliente_label}
          {r.c.categoria ? (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-slate-500">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: r.c.categoria_color || "#94a3b8" }} />
              {r.c.categoria}
            </span>
          ) : null}
        </>
      ),
      total: (r) => <span className="text-rose-700">{gs(r.total_adeudado)}</span>,
      promesa: (r) => (r.c.promesa_fecha ? (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${promesaCls(r)}`}>
          Promesa {fechaCorta(r.c.promesa_fecha)}
        </span>
      ) : null),
      enviada: (r) => {
        const marcada = enviadoLocal[r.c.cliente_id] ?? r.c.cobranza_enviada;
        return (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium text-slate-600">
            <input type="checkbox" checked={marcada} onChange={(e) => void marcarEnviada(r.c.cliente_id, e.target.checked)}
              className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-[#4FAEB2]" />
            Cobranza enviada
          </label>
        );
      },
    };
    const td: Record<string, string> = {
      cliente: "",
      plan: "whitespace-nowrap text-xs text-slate-600",
      monto: "whitespace-nowrap text-right text-xs tabular-nums text-slate-700",
      total: "whitespace-nowrap text-right text-sm font-semibold tabular-nums text-rose-700",
      cuotas: "text-right text-sm tabular-nums text-slate-800",
      tramo: "whitespace-nowrap",
      mensaje: "whitespace-nowrap",
      ultimo: "whitespace-nowrap text-xs tabular-nums text-slate-600",
      prox: "whitespace-nowrap text-xs tabular-nums text-slate-600",
      promesa: "whitespace-nowrap text-xs tabular-nums",
      enviada: "whitespace-nowrap",
      accion: "text-right",
    };
    return COLUMNAS.map((col) => {
      const activa = col.key != null && orden?.key === col.key;
      return {
        key: col.id,
        etiquetaMovil: col.h,
        movil: col.movil,
        claseTh: `${col.right ? "text-right" : "text-left"} ${activa ? "text-[#3F8E91]" : "text-slate-500"}`,
        claseTd: td[col.id],
        titulo: col.key != null ? (
          <button type="button" onClick={() => tocarOrden(col.key!, col.kind)} title={col.hint ?? "Ordenar por esta columna"}
            className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-[0.08em] transition-colors hover:text-[#3F8E91]">
            {col.h}
            <span className={`text-[9px] leading-none ${activa ? "opacity-100" : "opacity-25"}`}>{activa ? (orden!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
          </button>
        ) : (
          <span title={col.hint}>{col.h}</span>
        ),
        celda: celda[col.id],
        celdaMovil: movil[col.id],
      };
    });
    // marcarEnviada / tocarOrden solo usan setters estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orden, enviadoLocal, hoy]);

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
  const conPlanes = planes.length > 1;
  const conCategorias = categorias.lista.length > 0;
  const filtrosActivos = (plan !== TODOS ? 1 : 0) + (categoria !== TODOS ? 1 : 0) + (vistaTarjetas && orden ? 1 : 0);
  const valorOrdenSel = orden ? `${orden.key}:${orden.dir}` : "";

  return (
    <div className="space-y-4 pb-10 sm:space-y-5">
      <EncabezadoPagina
        kicker="Finanzas · Cobranzas"
        titulo="Seguimiento Cobranzas"
        subtitulo={`Clientes con deuda y tramos de mora${data?.hoy ? ` · al ${fechaCorta(data.hoy)}` : ""}.`}
        acciones={
          <AccionesPagina acciones={[
            { etiqueta: "Cuentas a cobrar", icono: <HandCoins />, href: "/clientes/cobrar" },
            { etiqueta: "Conciliación", icono: <Scale />, href: "/cobranzas/conciliacion", primaria: true },
            { etiqueta: "Exportar Excel", icono: <Download />, onClick: () => void exportar(), cargando: exportando, deshabilitada: !data },
            { etiqueta: "Actualizar", icono: <RefreshCw />, onClick: () => void cargar() },
          ]} />
        }
      />

      {cargando && !data ? (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" /> Cargando seguimiento de cobranzas…
        </div>
      ) : error && !data ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
          <button type="button" onClick={() => void cargar()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 max-sm:min-h-11">
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Franja compacta de cifras (plan + categoría + búsqueda; el tramo filtra solo la tabla).
              En celular: grilla de 2 columnas con la etiqueta arriba del número. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-1.5 sm:px-4 sm:py-2.5">
            <span className="flex min-w-0 flex-col text-slate-500 sm:block" title="Deuda emitida impaga (vencido + por vencer)">
              <span className="text-[11px] sm:text-sm">Total adeudado</span> <b className="tabular-nums text-rose-700 sm:ml-1">{gs(cifras.total)}</b>
            </span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <span className="flex min-w-0 flex-col text-slate-500 sm:block">
              <span className="text-[11px] sm:text-sm">Clientes con deuda</span> <b className="tabular-nums text-[#3F8E91] sm:ml-1">{cifras.clientes}</b>
            </span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <span className="flex min-w-0 flex-col text-slate-500 sm:block">
              <span className="text-[11px] sm:text-sm">Cuotas vencidas</span> <b className="tabular-nums text-slate-900 sm:ml-1">{cifras.cuotas}</b>
            </span>
            <span className="hidden text-slate-200 sm:inline">·</span>
            <button type="button" onClick={() => setSoloPromesaHoy((v) => !v)} aria-pressed={soloPromesaHoy}
              className={`-mx-2 -my-1 flex min-w-0 flex-col items-start rounded-lg px-2 py-1 text-left transition-colors sm:mx-0 sm:my-0 sm:inline-flex sm:flex-row sm:items-center sm:gap-1 sm:py-0.5 ${soloPromesaHoy ? "bg-[#4FAEB2]/10 text-[#3F8E91] ring-1 ring-[#4FAEB2]/40" : "text-slate-500 hover:bg-slate-50"}`}
              title={soloPromesaHoy ? "Mostrando solo promesas de hoy (clic para quitar)" : "Ver solo los clientes que prometieron pagar hoy"}>
              <span className="text-[11px] sm:text-sm">Promesas hoy</span>
              <span className="inline-flex items-center gap-1">
                <b className="tabular-nums text-[#3F8E91] sm:ml-1">{cifras.promesasHoy}</b>
                <span className="text-[10px] font-semibold text-[#4FAEB2]">{soloPromesaHoy ? "· filtrando" : "· filtrar"}</span>
              </span>
            </button>
            {cargando ? <Loader2 className="ml-auto hidden h-3.5 w-3.5 animate-spin text-slate-400 sm:block" /> : null}
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            {/* Chips de tramo: si no entran, scroll horizontal (nunca se cortan). */}
            <ScrollHorizontal claseFila="gap-1.5" role="group" ariaLabel="Tramo de mora" dependencias={[tramo]}>
              {chips.map((t) => (
                <button key={t.key} type="button" onClick={() => setTramo(t.key)} aria-pressed={tramo === t.key} data-activo={tramo === t.key ? "true" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors max-sm:min-h-11 ${tramo === t.key ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#3F8E91]" : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60"}`}>
                  {t.label} <span className="tabular-nums text-slate-400">({t.count})</span>
                </button>
              ))}
            </ScrollHorizontal>
            <BarraFiltros
              plano
              className="xl:min-w-[26rem] xl:flex-none"
              activos={filtrosActivos}
              onLimpiar={() => { setPlan(TODOS); setCategoria(TODOS); setOrden(null); }}
              busqueda={
                <div className="relative">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, plan o categoría…" aria-label="Buscar cliente, plan o categoría" enterKeyHint="search"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 max-md:h-11 [&::-webkit-search-cancel-button]:hidden" />
                  {q ? (
                    <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda" className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              }
            >
              {conPlanes || conCategorias || vistaTarjetas ? (
                <>
                  {conPlanes ? <Select value={plan} onChange={setPlan} options={opcionesPlan} minWidth={170} etiqueta="Plan" /> : null}
                  {conCategorias ? <Select value={categoria} onChange={setCategoria} options={opcionesCategoria} minWidth={170} etiqueta="Categoría" /> : null}
                  {vistaTarjetas ? (
                    <Select value={valorOrdenSel} etiqueta="Ordenar por" options={OPCIONES_ORDEN}
                      onChange={(v) => { if (!v) { setOrden(null); return; } const [key, dir] = v.split(":"); setOrden({ key: key as SortKey, dir: dir as "asc" | "desc" }); }} />
                  ) : null}
                </>
              ) : undefined}
            </BarraFiltros>
          </div>

          {filas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center text-sm text-slate-600">
              No hay clientes con deuda para este filtro.
            </div>
          ) : (
            <div ref={scrollRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:cursor-grab md:select-none md:active:cursor-grabbing"
              title={vistaTarjetas ? undefined : "Llevá el mouse al borde para desplazar, o arrastrá"}>
              <TablaTarjetas
                filas={filas}
                columnas={columnas}
                claveFila={(r) => r.c.cliente_id}
                onFila={(r) => setDetalleId(r.c.cliente_id)}
                cargando={cargando}
                minAncho={1100}
                claseTabla="w-full text-left text-sm"
                claseThead="border-b border-slate-200 bg-slate-50"
                thBase="whitespace-nowrap px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                tdBase="px-3 py-3 align-middle"
              />
            </div>
          )}
        </>
      )}

      {detalleId ? (
        <DetalleCobranzaPanel clienteId={detalleId} onClose={() => setDetalleId(null)} onCambio={() => void cargar(true)} avisar={avisar} />
      ) : null}

      {toast ? (
        <div role="status" className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[140] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-medium text-emerald-800 shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}
