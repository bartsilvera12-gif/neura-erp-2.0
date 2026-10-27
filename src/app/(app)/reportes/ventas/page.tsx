"use client";

/**
 * /reportes/ventas — "Ventas del período": cuánto se vendió, cuánto se ganó, cómo se
 * cobró, qué se vende, quién vendió y cuánto IVA hay que declarar. Todo se calcula en la
 * base (reporte_ventas_resumen / reporte_ventas_detalle); acá solo se muestra.
 * Sin gráficos (pedido del usuario): números claros + tablas. Excel y PDF con los filtros.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaTarjetas, useVistaTarjetas } from "@/components/TablaResponsive";
import { EncabezadoReporte, FilaKpis, Kpi as KpiReporte, RangoFechasLocal, SANGRIA_TARJETAS, Tabla as TablaReporte, Tarjeta, TH_REPORTE } from "@/modules/reportes/ui";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { CorregirCostos } from "@/modules/reportes/CorregirCostos";
import { opcionesFiltroCategoria, type Categoria } from "@/modules/inventario/categorias";
import type { ResumenVentas, VentaDetalle as FilaVenta } from "@/modules/reportes/server/ventas";

const TEAL = clienteConfig.color;
const TZ = "America/Asuncion";
const POR_PAGINA = 25;

const MEDIO: Record<string, string> = {
  // Receta 78: posnet (pos*) va en "Tarjeta" y QR tiene su renglón.
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", qr: "QR", cheque: "Cheque", otro: "Otros", credito: "Crédito",
};
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const margenColor = (a: number, b: number) => {
  const m = b ? (a / b) * 100 : 0;
  return m >= 40 ? "text-emerald-600" : m >= 20 ? "text-amber-600" : "text-red-600";
};
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const diaCorto = (s: string) => {
  const d = new Date(`${s}T12:00:00Z`);
  return d.toLocaleDateString("es-PY", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
};
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");

function rangoAtajo(k: string) {
  const h = hoy();
  const [y, m] = h.split("-").map(Number);
  if (k === "hoy") return { desde: h, hasta: h };
  if (k === "7d") {
    const d = new Date(`${h}T12:00:00`);
    d.setDate(d.getDate() - 6);
    return { desde: d.toISOString().slice(0, 10), hasta: h };
  }
  if (k === "mes_ant") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const mm = String(pm).padStart(2, "0");
    return { desde: `${py}-${mm}-01`, hasta: `${py}-${mm}-${new Date(py, pm, 0).getDate()}` };
  }
  return { desde: `${h.slice(0, 7)}-01`, hasta: h };
}
const ATAJOS: [string, string][] = [["hoy", "Hoy"], ["7d", "7 días"], ["mes", "Este mes"], ["mes_ant", "Mes anterior"]];

export default function ReporteVentasPage() {
  return <Suspense fallback={null}><Contenido /></Suspense>;
}

// Acepta ?desde&hasta en la URL (enlaces del Inicio, Estado de cuenta y Ventas por mes).
const FECHA_URL = /^\d{4}-\d{2}-\d{2}$/;

function Contenido() {
  const sp = useSearchParams();
  const rangoUrl = FECHA_URL.test(sp.get("desde") ?? "") && FECHA_URL.test(sp.get("hasta") ?? "");
  const [desde, setDesde] = useState(() => (rangoUrl ? sp.get("desde")! : rangoAtajo("mes").desde));
  const [hasta, setHasta] = useState(() => (rangoUrl ? sp.get("hasta")! : hoy()));
  const [atajo, setAtajo] = useState<string | null>(rangoUrl ? null : "mes");
  const [cajero, setCajero] = useState("");
  const [tipo, setTipo] = useState("");
  const [medio, setMedio] = useState("");
  const [categoria, setCategoria] = useState("");

  const [resumen, setResumen] = useState<ResumenVentas | null>(null);
  const [cajeros, setCajeros] = useState<{ id: string; nombre: string }[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ventas, setVentas] = useState<FilaVenta[]>([]);
  const [totalVentas, setTotalVentas] = useState(0);
  const [pag, setPag] = useState<{ filtros: string; n: number }>({ filtros: "", n: 1 });
  const [cargandoDet, setCargandoDet] = useState(true);
  const [verTodosProd, setVerTodosProd] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const [bajando, setBajando] = useState<"" | "xlsx" | "pdf">("");
  const [recarga, setRecarga] = useState(0);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const angosta = useVistaTarjetas();

  useEffect(() => {
    apiFetchCache<{ categorias: Categoria[] }>("/api/inventario/categorias").then((r) => setCategorias(r.categorias)).catch(() => {});
  }, []);

  const filtros = useMemo(() => {
    const sp = new URLSearchParams({ desde, hasta });
    if (cajero) sp.set("cajero", cajero);
    if (tipo) sp.set("tipo", tipo);
    if (medio) sp.set("medio", medio);
    if (categoria) sp.set("categoria", categoria);
    return sp.toString();
  }, [desde, hasta, cajero, tipo, medio, categoria]);

  // La página es de ESTOS filtros: si cambian, vuelve a 1 en el mismo render (antes un
  // efecto la reseteaba después y el detalle se pedía dos veces, con la página vieja y la 1).
  const pagina = pag.filtros === filtros ? pag.n : 1;
  const setPagina = (f: (p: number) => number) => setPag({ filtros, n: f(pagina) });

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    apiFetch<{ resumen: ResumenVentas; cajeros: { id: string; nombre: string }[] }>(`/api/reportes/ventas?${filtros}`)
      .then((r) => { if (!cancel) { setResumen(r.resumen); setCajeros(r.cajeros); } })
      .catch((e: Error) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [filtros, recarga]);

  useEffect(() => {
    let cancel = false;
    setCargandoDet(true);
    apiFetch<{ total: number; rows: FilaVenta[] }>(`/api/reportes/ventas/detalle?${filtros}&pagina=${pagina}&por_pagina=${POR_PAGINA}`)
      .then((r) => { if (!cancel) { setVentas(r.rows); setTotalVentas(r.total); } })
      .catch(() => { if (!cancel) { setVentas([]); setTotalVentas(0); } })
      .finally(() => { if (!cancel) setCargandoDet(false); });
    return () => { cancel = true; };
  }, [filtros, pagina, recarga]);

  async function bajar(formato: "xlsx" | "pdf") {
    setBajando(formato);
    try {
      await descargarArchivo(`/api/reportes/ventas/${formato === "xlsx" ? "export" : "pdf"}?${filtros}`, `ventas.${formato}`);
    } catch {
      /* best-effort */
    } finally {
      setBajando("");
    }
  }

  const k = resumen?.kpis;
  const ticket = k && k.cantidad_ventas ? k.ventas_netas / k.cantidad_ventas : 0;
  const totalMedios = resumen?.por_medio.reduce((a, m) => a + Number(m.monto), 0) ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(totalVentas / POR_PAGINA));
  const productos = verTodosProd ? resumen?.productos ?? [] : (resumen?.productos ?? []).slice(0, 10);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoReporte kicker="Reportes · Ventas" titulo="Ventas del período"
        subtitulo="Cuánto se vendió y se ganó, cómo se cobró, qué se vende y quién vendió.">
        <button onClick={() => bajar("xlsx")} disabled={!!bajando || !k?.cantidad_ventas} className="inline-flex h-[38px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition hover:bg-[var(--brand-50)] disabled:opacity-50" style={{ borderColor: `${TEAL}55`, color: TEAL }}>
          {bajando === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} <span className="sm:hidden">Excel</span><span className="max-sm:hidden">Exportar Excel</span>
        </button>
        <button onClick={() => bajar("pdf")} disabled={!!bajando || !k?.cantidad_ventas} className="inline-flex h-[38px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: TEAL }}>
          {bajando === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} <span className="sm:hidden">PDF</span><span className="max-sm:hidden">Descargar PDF</span>
        </button>
      </EncabezadoReporte>

      {/* Filtros en UNA fila (≥ 768 px): período + chips (cajero, tipo, medio, categoría) y
          "Limpiar filtros" a la derecha. En celular: período a lo ancho y los chips en la hoja "Filtros". */}
      <section className="space-y-1.5">
        <BarraFiltros
          inicio={
            <RangoFechasLocal atajos={ATAJOS} atajo={atajo}
              onAtajo={(key) => { const r = rangoAtajo(key); setDesde(r.desde); setHasta(r.hasta); setAtajo(key); }}
              desde={desde} hasta={hasta}
              onDesde={(v) => { if (v) { setDesde(v); setAtajo(null); } }}
              onHasta={(v) => { if (v) { setHasta(v); setAtajo(null); } }} />
          }
          busqueda={angosta ? <span className="block truncate px-1 text-xs text-slate-400">Cajero, contado / crédito, medio y categoría</span> : undefined}
          activos={[cajero, tipo, medio, categoria].filter(Boolean).length}
          onLimpiar={() => { setCajero(""); setTipo(""); setMedio(""); setCategoria(""); }}>
          <Select chip prefijo="Cajero" textoVacio="Todos" value={cajero} onChange={setCajero} minWidth={200} etiqueta="Cajero" options={[["", "Todos los cajeros"], ...cajeros.map((c): [string, string] => [c.id, c.nombre])]} />
          <Select chip value={tipo} onChange={setTipo} minWidth={180} etiqueta="Contado o crédito" options={[["", "Contado y crédito"], ["CONTADO", "Solo contado"], ["CREDITO", "Solo crédito"]]} />
          <Select chip prefijo="Medio" textoVacio="Todos" value={medio} onChange={setMedio} minWidth={190} etiqueta="Medio de pago" options={[["", "Todos los medios"], ...Object.entries(MEDIO).map(([v, l]): [string, string] => [v, l])]} />
          <Select chip prefijo="Categoría" textoVacio="Todas" value={categoria} onChange={setCategoria} minWidth={220} etiqueta="Categoría" className="max-w-[260px] max-md:max-w-none lg:max-w-none" options={[["", "Todas las categorías"], ["__sin__", "— Sin categoría —"], ...opcionesFiltroCategoria(categorias)]} />
        </BarraFiltros>
        {medio || categoria ? (
          <p className="px-1 text-[11px] text-slate-400">
            {medio ? "Con filtro de medio se incluyen las ventas que usaron ese medio (con su monto total). " : ""}
            {categoria ? "Con filtro de categoría, los montos son solo de los productos de esa categoría." : ""}
          </p>
        ) : null}
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">No se pudo cargar el reporte: {error}</div> : null}

      {!k ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[92px] animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : (
        <div className={`space-y-6 transition-opacity ${cargando ? "opacity-60" : ""}`}>
          {/* Números clave */}
          <FilaKpis n={5}>
            <Kpi accent label="Ventas netas" value={gs(k.ventas_netas)} hint={`${num(k.cantidad_ventas)} venta(s) · ${num(k.unidades)} unidades`} />
            <Kpi label="Ticket promedio" value={gs(ticket)} hint="por venta" />
            <Kpi label="Ganancia bruta" value={gs(k.ganancia)} hint={`${pct(k.ganancia, k.ventas_netas)} sobre ventas`} valueClass={k.ganancia < 0 ? "text-red-600" : undefined} />
            <Kpi label="IVA incluido" value={gs(k.iva_total)} hint={(resumen.iva ?? []).map((t) => `${t.tipo === "EXENTA" ? "Exentas" : t.tipo} ${gs(t.total)}`).join(" · ") || "—"} />
            <Kpi label="Anuladas" value={num(resumen.anuladas.cantidad)} hint={gs(resumen.anuladas.monto)} valueClass={resumen.anuladas.cantidad ? "text-red-600" : undefined} />
          </FilaKpis>

          {k.productos_sin_costo ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span><strong>{k.productos_sin_costo} producto(s) vendidos sin costo</strong> · la ganancia está sobreestimada</span>
              </span>
              <button onClick={() => setCorrigiendo(true)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 max-sm:min-h-11 max-sm:w-full max-sm:text-sm">
                Corregir costos
              </button>
            </div>
          ) : null}
          {aviso ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              <span>{aviso}</span>
              <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100 max-sm:-my-2 max-sm:-mr-2 max-sm:flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center"><X className="h-4 w-4" /></button>
            </div>
          ) : null}

          {k.cantidad_ventas === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400 shadow-sm">No hay ventas con estos filtros.</div>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Medios de pago */}
                <Tarjeta titulo="Por medio de pago">
                  <Tabla
                    cols={["Medio", "Ventas", "Monto", "% del total"]}
                    der={[1, 2, 3]}
                    filas={resumen.por_medio.map((m) => [MEDIO[m.medio] ?? m.medio, num(m.ventas), gs(m.monto), pct(m.monto, totalMedios)])}
                    pie={["Total", "", gs(totalMedios), "100%"]}
                  />
                </Tarjeta>
                {/* Cajeros */}
                <Tarjeta titulo="Por cajero">
                  <Tabla
                    cols={["Cajero", "Ventas", "Monto", "Ticket prom.", "Anuladas"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_cajero.map((c) => [c.nombre, num(c.cantidad), gs(c.ventas), gs(c.cantidad ? c.ventas / c.cantidad : 0), c.anuladas ? <span key="a" className="font-semibold text-red-600">{c.anuladas}</span> : "0"])}
                  />
                </Tarjeta>
              </div>

              {/* Productos */}
              <Tarjeta titulo="Productos más vendidos" extra={resumen.productos.length > 10 ? (
                <button onClick={() => setVerTodosProd((v) => !v)} className="text-xs font-semibold hover:underline max-sm:min-h-11 max-sm:text-[13px]" style={{ color: TEAL }}>
                  {verTodosProd ? "Ver top 10" : `Ver los ${resumen.productos.length}`}
                </button>
              ) : null}>
                <Tabla
                  // El puesto va junto al nombre: así la columna fija (la 1.ª) es el producto.
                  cols={["Producto", "SKU", "Unidades", "Monto", "Ganancia", "Margen de ganancia"]}
                  der={[2, 3, 4, 5]}
                  filas={productos.map((p, i) => [
                    <span key="n" className="font-medium text-slate-800"><span className="mr-1.5 inline-block min-w-[1.5ch] text-right font-normal tabular-nums text-slate-400">{i + 1}</span>{p.nombre}{p.sin_costo ? <span className="ml-1 font-bold text-amber-600" title="Vendido al menos una vez sin costo cargado">*</span> : null}</span>,
                    <span key="s" className="font-mono text-xs text-slate-500">{p.sku ?? "—"}</span>,
                    num(p.unidades),
                    gs(p.monto),
                    gs(p.ganancia),
                    <span key="m" className={`font-semibold ${margenColor(p.ganancia, p.monto)}`}>{pct(p.ganancia, p.monto)}</span>,
                  ])}
                />
              </Tarjeta>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Por día */}
                <Tarjeta titulo="Por día">
                  <Tabla
                    cols={["Día", "Ventas", "Monto", "Ticket prom.", "Ganancia"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_dia.map((d) => [<span key="d" className="capitalize">{diaCorto(d.dia)}</span>, num(d.cantidad), gs(d.ventas), gs(d.cantidad ? d.ventas / d.cantidad : 0), gs(d.ganancia)])}
                  />
                </Tarjeta>
                {/* Categorías */}
                <Tarjeta titulo="Por categoría">
                  <Tabla
                    cols={["Categoría", "Unidades", "Monto", "% del total", "Margen de ganancia"]}
                    der={[1, 2, 3, 4]}
                    filas={resumen.por_categoria.map((c) => [c.nombre, num(c.unidades), gs(c.monto), pct(c.monto, k.ventas_netas), <span key="m" className={`font-semibold ${margenColor(c.ganancia, c.monto)}`}>{pct(c.ganancia, c.monto)}</span>])}
                  />
                </Tarjeta>
              </div>
            </>
          )}
        </div>
      )}

      {/* Detalle de ventas */}
      <Tarjeta titulo="Detalle de ventas" extra={<span className="text-sm text-slate-400">{num(totalVentas)} venta(s)</span>}>
        {/* Lista de ventas que se abren: tarjetas en celular, tabla desde 768 px. */}
        <div className={`transition-opacity ${cargandoDet ? "opacity-60" : ""} ${SANGRIA_TARJETAS}`}>
          <TablaTarjetas filas={ventas} claveFila={(v) => v.id} onFila={(v) => setViendo(v.id)} minAncho={960}
            claseThead="bg-slate-50" thBase={TH_REPORTE} tdBase="px-3 py-3"
            claseFila={(v) => (v.estado === "anulada" ? "opacity-60" : "")}
            vacio={<p className="py-10 text-center text-sm text-slate-400">{cargandoDet ? "Cargando…" : "No hay ventas con estos filtros."}</p>}
            columnas={[
              { key: "num", titulo: "Número", movil: "subtitulo", claseTd: "whitespace-nowrap font-mono text-xs text-slate-600",
                celda: (v) => <>{v.numero}{v.estado === "anulada" ? <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-red-600">Anulada</span> : null}</>,
                celdaMovil: (v) => <span className="tabular-nums"><span className="font-mono text-xs">{v.numero}</span> · {fechaHora(v.fecha)}</span> },
              { key: "fecha", titulo: "Fecha", movil: "oculto", claseTd: "whitespace-nowrap text-xs tabular-nums text-slate-500", celda: (v) => fechaHora(v.fecha) },
              { key: "cli", titulo: "Cliente", movil: "titulo", claseTd: "max-w-[180px] truncate text-slate-700", celda: (v) => v.cliente ?? <span className="text-slate-300">Sin cliente</span>,
                celdaMovil: (v) => v.cliente ?? <span className="font-medium text-slate-400">Sin cliente</span> },
              { key: "caj", titulo: "Cajero", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (v) => v.cajero ?? "—" },
              { key: "tipo", titulo: "Tipo", movil: "chip",
                celda: (v) => (
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={v.tipo === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#475569" }}>
                    {v.tipo === "CREDITO" ? "Crédito" : "Contado"}
                  </span>
                ) },
              { key: "anu", titulo: "", movil: "chip", claseTh: "hidden", claseTd: "hidden",
                celda: (v) => (v.estado === "anulada" ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">Anulada</span> : null) },
              { key: "med", titulo: "Medio de pago", movil: "dato", etiquetaMovil: "Medio", claseTd: "whitespace-nowrap text-xs text-slate-600", celda: (v) => v.medios.map((m) => MEDIO[m] ?? m).join(" + ") },
              { key: "it", titulo: "Ítems", claseTh: "text-right", claseTd: "text-right tabular-nums text-slate-600", celda: (v) => v.items },
              { key: "tot", titulo: "Total", movil: "valor", claseTh: "text-right",
                claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900",
                celda: (v) => <span className={v.estado === "anulada" ? "text-slate-400 line-through" : ""}>{gs(v.total)}</span> },
              { key: "gan", titulo: "Ganancia", movil: "dato", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-600", celda: (v) => (v.estado === "anulada" ? "—" : gs(v.ganancia)) },
            ]} />
        </div>
        {totalVentas > POR_PAGINA ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 max-sm:justify-center">
            <span className="text-sm text-slate-500">
              Mostrando <strong className="font-semibold text-slate-700">{(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, totalVentas)}</strong> de <strong className="font-semibold text-slate-700">{num(totalVentas)}</strong>
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} aria-label="Página anterior" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 max-sm:h-11 max-sm:w-11"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[110px] text-center text-sm tabular-nums text-slate-600">Página <strong className="text-slate-800">{pagina}</strong> de {totalPaginas}</span>
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} aria-label="Página siguiente" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 max-sm:h-11 max-sm:w-11"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        ) : null}
      </Tarjeta>

      {corrigiendo && resumen ? (
        <CorregirCostos
          productos={resumen.productos.filter((p) => p.sin_costo)}
          onClose={() => setCorrigiendo(false)}
          onListo={(msg) => { setCorrigiendo(false); setAviso(msg); setRecarga((n) => n + 1); }}
        />
      ) : null}

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); setRecarga((n) => n + 1); }} /> : null}
    </div>
  );
}

function Kpi({ label, value, hint, accent, valueClass }: { label: string; value: string; hint?: string; accent?: boolean; valueClass?: string }) {
  return <KpiReporte label={label} valor={value} hint={hint} acento={accent} tono={valueClass ? "malo" : undefined} />;
}

/** Tabla de los resúmenes (las filas como arreglos): la de los reportes, con scroll interno y 1.ª columna fija. */
function Tabla({ cols, filas, der, pie }: { cols: string[]; filas: React.ReactNode[][]; der: number[]; pie?: React.ReactNode[] }) {
  return <TablaReporte cols={cols} der={der} pie={pie} filas={filas.map((celdas, i) => ({ key: String(i), celdas }))} />;
}
