"use client";

/**
 * Registro de TODAS las tipificaciones (receta 81): búsqueda inteligente (cliente, RUC,
 * motivo, observación, usuario o #ticket), barra de filtros (período, estado, usuario,
 * acción) en la URL, paginado con lo ya visto al instante (stale-while-revalidate) y la
 * página siguiente precargada. Tocar una fila abre el DETALLE en un modal (no navega); desde
 * ahí: ver ticket o ficha del cliente (modales), tipificar de nuevo a ese cliente, o abrirlo
 * en Gestión. "Nueva tipificación" pide el cliente y abre el formulario encima.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardPen, ExternalLink, GraduationCap, Headset, Loader2, Search, UserRound, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { apiFetchSWR, guardadoAlInstante, precargar } from "@/lib/api/cache-cliente";
import { hoyPY } from "@/lib/fecha/paraguay";
import { ATAJO_LABEL, SelectorPeriodo, rangoAtajo, type Atajo } from "@/modules/reportes/ui";
import { Avatar, codigoCliente } from "@/modules/clientes/ui";
import { FichaClienteModal } from "@/modules/clientes/ficha/FichaClienteModal";
import {
  fechaHoraPy, fechaRelativa, numeroTicket, type ContextoTipificacion, type RegistroTipificaciones as Registro, type TipificacionRegistro,
} from "@/modules/tipificacion/dominio";
import { cargarContexto, contextoAlInstante, precargarTipificacion, urlHistorial } from "@/modules/tipificacion/datos";
import { ItemTipificacion } from "@/modules/tipificacion/ItemTipificacion";
import { ModalTicketResumen } from "@/modules/tipificacion/ModalTicketResumen";
import { ModalTipificacion, useAvisoTipificacion } from "@/modules/tipificacion/ModalTipificacion";

const POR_PAGINA = 25;
const ATAJOS: Atajo[] = ["hoy", "semana", "mes", "mes_anterior", "3m", "anio", "todo"];
const OPC_ATAJOS = ATAJOS.map((k): [string, string] => [k, ATAJO_LABEL[k]]);
const ACCIONES: [string, string][] = [["", "Todas"], ["ticket", "Con ticket"], ["capacitacion", "Con capacitación"], ["ninguna", "Sin acción"]];

export function RegistroTipificaciones({ nuevaAbierta, onNuevaCerrada }: { nuevaAbierta: boolean; onNuevaCerrada: () => void }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ── Filtros (en la URL: se comparten y sobreviven a "atrás") ─────────────
  const q = sp.get("q") ?? "";
  const tieneRango = sp.has("desde") || sp.has("hasta");
  const atajo = (sp.get("atajo") as Atajo | null) ?? (tieneRango ? null : "todo");
  const rango = tieneRango ? { desde: sp.get("desde") ?? "", hasta: sp.get("hasta") ?? "" } : rangoAtajo(atajo ?? "todo");
  const familia = sp.get("familia") ?? "";
  const usuario = sp.get("usuario") ?? "";
  const accion = sp.get("accion") ?? "";
  const pagina = Math.max(Number(sp.get("pagina")) || 1, 1);

  const cambiar = useCallback((cambios: Record<string, string | null>, mantenerPagina = false) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    if (!mantenerPagina) p.delete("pagina");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  }, [sp, router, pathname]);

  // Buscador: se escribe local y se aplica a la URL a los 300 ms (o con Enter).
  const [texto, setTexto] = useState(q);
  useEffect(() => { setTexto(q); }, [q]);
  useEffect(() => {
    if (texto.trim() === q.trim()) return;
    const t = window.setTimeout(() => cambiar({ q: texto.trim() || null }), 300);
    return () => window.clearTimeout(t);
  }, [texto, q, cambiar]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (rango.desde) p.set("desde", rango.desde);
    if (rango.hasta) p.set("hasta", rango.hasta);
    if (familia) p.set("familia", familia);
    if (usuario) p.set("usuario", usuario);
    if (accion) p.set("accion", accion);
    p.set("por", String(POR_PAGINA));
    const base = p.toString();
    return { actual: `/api/tipificaciones/registro?${base}&pagina=${pagina}`, siguiente: `/api/tipificaciones/registro?${base}&pagina=${pagina + 1}` };
  }, [q, rango.desde, rango.hasta, familia, usuario, accion, pagina]);

  // ── Datos ───────────────────────────────────────────────────────────────
  const [ctx, setCtx] = useState<ContextoTipificacion | null>(() => contextoAlInstante());
  useEffect(() => { cargarContexto().then(setCtx).catch(() => {}); }, []);

  const [data, setData] = useState<Registro | null>(() => guardadoAlInstante<Registro>(url.actual) ?? null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    apiFetchSWR<Registro>(url.actual, (d) => { setData(d); setError(null); }, { signal: ctrl.signal, fresco: recarga > 0 })
      .then(() => {
        // La página siguiente queda lista (el "Siguiente" es instantáneo).
        if (!ctrl.signal.aborted) void precargar(url.siguiente);
      })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!ctrl.signal.aborted) setCargando(false); });
    return () => ctrl.abort();
  }, [url, recarga]);

  const filas = data?.filas ?? [];
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desdeN = total ? (pagina - 1) * POR_PAGINA + 1 : 0;
  const hastaN = Math.min(total, pagina * POR_PAGINA);

  // Volver arriba de la lista al cambiar de página (no al refrescar).
  const lista = useRef<HTMLDivElement>(null);
  const paginaPrev = useRef(pagina);
  useEffect(() => {
    if (paginaPrev.current !== pagina) lista.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    paginaPrev.current = pagina;
  }, [pagina]);

  // ── Modales ─────────────────────────────────────────────────────────────
  const [detalle, setDetalle] = useState<TipificacionRegistro | null>(null);
  const [tipificar, setTipificar] = useState<{ id: string; nombre: string } | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const aviso = useAvisoTipificacion();
  const mostrarAviso = aviso.mostrar;
  const guardada = useCallback((r: Parameters<typeof mostrarAviso>[0]) => { mostrarAviso(r); setRecarga((k) => k + 1); }, [mostrarAviso]);

  const activos = (familia ? 1 : 0) + (usuario ? 1 : 0) + (accion ? 1 : 0) + (atajo !== "todo" ? 1 : 0);
  const limpiar = () => cambiar({ familia: null, usuario: null, accion: null, atajo: null, desde: null, hasta: null, q: null });

  const opcFamilias: [string, string][] = [["", "Todos"], ...(ctx?.familias ?? []).map((f): [string, string] => [f.id, f.nombre])];
  const opcUsuarios: [string, string][] = [["", "Todos"], ...(ctx?.equipo ?? []).map((p): [string, string] => [p.id, p.nombre])];

  return (
    <div className="space-y-3">
      <BarraFiltros
        activos={activos}
        onLimpiar={limpiar}
        inicio={
          <SelectorPeriodo atajos={OPC_ATAJOS} atajo={atajo} onAtajo={(k) => cambiar({ atajo: k === "todo" ? null : k, desde: null, hasta: null })}
            desde={rango.desde} hasta={rango.hasta} onRango={(d, h) => cambiar({ atajo: null, desde: d || null, hasta: h || null })} maxHasta={hoyPY()} />
        }
        busqueda={
          <label className="flex h-[38px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-[var(--brand)] focus-within:shadow-[0_0_0_4px_var(--brand-100)] max-md:h-11">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") cambiar({ q: texto.trim() || null }); if (e.key === "Escape" && texto) { e.preventDefault(); setTexto(""); } }}
              aria-label="Buscar tipificaciones" placeholder="Cliente, RUC, motivo, observación, usuario o #ticket…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400 max-md:text-base" />
            {cargando ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400 motion-reduce:animate-none" aria-label="Buscando" /> : null}
            {texto ? <button type="button" aria-label="Borrar búsqueda" onClick={() => setTexto("")} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button> : null}
          </label>
        }
      >
        <Select chip prefijo="Estado" textoVacio="Todos" etiqueta="Estado" minWidth={200} value={familia} onChange={(v) => cambiar({ familia: v || null })} options={opcFamilias} />
        <Select chip prefijo="Usuario" textoVacio="Todos" etiqueta="Usuario" minWidth={220} value={usuario} onChange={(v) => cambiar({ usuario: v || null })} options={opcUsuarios} />
        <Select chip prefijo="Acción" textoVacio="Todas" etiqueta="Acción" minWidth={200} value={accion} onChange={(v) => cambiar({ accion: v || null })} options={ACCIONES} />
      </BarraFiltros>

      <div ref={lista} className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500">
          <span>
            {data ? (total ? <><span className="font-semibold tabular-nums text-slate-700">{total.toLocaleString("es-PY")}</span> tipificaci{total === 1 ? "ón" : "ones"}</> : "Sin resultados") : "Cargando…"}
            {q ? <> para <span className="font-semibold text-slate-700">“{q}”</span></> : null}
          </span>
          {total > POR_PAGINA ? <span className="tabular-nums">{desdeN}–{hastaN}</span> : null}
        </div>

        {/* Cabecera de columnas (escritorio) */}
        <div className="hidden grid-cols-[150px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_minmax(0,2fr)_150px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 lg:grid">
          <span>Fecha</span><span>Cliente</span><span>Motivo</span><span>Observación</span><span>Acción</span>
        </div>

        {error && !data ? <p className="m-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {!data && !error ? <FilasEsqueleto /> : null}
        {data && filas.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-slate-400">
            <p>{q || activos ? "Nada coincide con la búsqueda o los filtros." : "Todavía no hay tipificaciones."}</p>
            {q || activos ? <button type="button" onClick={limpiar} className="mt-2 text-[13px] font-semibold text-[var(--brand)] hover:underline">Limpiar búsqueda y filtros</button> : null}
          </div>
        ) : null}

        <ul className={`divide-y divide-slate-100 transition-opacity ${cargando && data ? "opacity-60" : ""}`}>
          {filas.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setDetalle(t)} onMouseEnter={() => void precargar(urlHistorial(t.cliente.id))}
                className="grid w-full gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none lg:grid-cols-[150px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_minmax(0,2fr)_150px] lg:items-start">
                <span className="flex items-center gap-2 text-[12px] text-slate-500 lg:flex-col lg:items-start lg:gap-0.5">
                  <time dateTime={t.fecha} className="tabular-nums" title={fechaHoraPy(t.fecha)}>{fechaHoraPy(t.fecha)}</time>
                  <span className="inline-flex items-center gap-1 text-slate-600"><UserRound className="h-3 w-3 text-slate-400 lg:hidden" aria-hidden />{t.usuario}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-slate-900">{t.cliente.nombre}</span>
                  <span className="block truncate text-[11.5px] text-slate-400">{codigoCliente(t.cliente)}{t.cliente.ruc ? ` · RUC ${t.cliente.ruc}` : ""}</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-teal-700">{t.tipo_gestion}</span>
                  <span className="block text-[12.5px] font-medium leading-snug text-slate-700 [overflow-wrap:anywhere]">{t.resultado}</span>
                </span>
                <span className="line-clamp-2 text-[13px] leading-relaxed text-slate-600 [overflow-wrap:anywhere]">{t.observacion}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {t.ticket ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-bold text-rose-700">
                      <Headset className="h-3 w-3" aria-hidden /> {numeroTicket(t.ticket.numero)}
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.ticket.estado_color ?? "#94a3b8" }} aria-hidden />
                      <span className="font-medium">{t.ticket.estado_nombre}</span>
                    </span>
                  ) : null}
                  {t.cita ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11.5px] font-bold text-indigo-700">
                      <GraduationCap className="h-3 w-3" aria-hidden /> {fechaRelativa(t.cita.inicio_at) || "Capacitación"}
                    </span>
                  ) : null}
                  {!t.ticket && !t.cita ? <span className="text-[12px] text-slate-300 max-lg:hidden">—</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
            <button type="button" disabled={pagina <= 1} onClick={() => cambiar({ pagina: pagina - 1 > 1 ? String(pagina - 1) : null }, true)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 max-sm:min-h-11">
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <span className="text-[12.5px] tabular-nums text-slate-500">Página {pagina} de {paginas}</span>
            <button type="button" disabled={pagina >= paginas} onClick={() => cambiar({ pagina: String(pagina + 1) }, true)} onMouseEnter={() => void precargar(url.siguiente)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 max-sm:min-h-11">
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {detalle ? (
        <DetalleTipificacion t={detalle} puedeSoporte={!!ctx?.puede_soporte} onClose={() => setDetalle(null)}
          onTipificar={() => { const c = detalle.cliente; setDetalle(null); precargarTipificacion(c.id); setTipificar({ id: c.id, nombre: c.nombre }); }}
          onFicha={() => setFicha(detalle.cliente.id)} onTicket={setTicket} />
      ) : null}
      {tipificar ? <ModalTipificacion clienteId={tipificar.id} clienteNombre={tipificar.nombre} onClose={() => setTipificar(null)} onGuardada={guardada} /> : null}
      {nuevaAbierta ? <ModalTipificacion onClose={onNuevaCerrada} onGuardada={guardada} /> : null}
      {ficha ? <FichaClienteModal id={ficha} onCerrar={() => setFicha(null)} /> : null}
      {ticket ? <ModalTicketResumen ticketId={ticket} onClose={() => setTicket(null)} /> : null}
      {aviso.nodo}
    </div>
  );
}

/** Detalle de una tipificación: todo a la vista y las acciones (sin navegar, salvo Gestión). */
function DetalleTipificacion({ t, puedeSoporte, onClose, onTipificar, onFicha, onTicket }: {
  t: TipificacionRegistro; puedeSoporte: boolean; onClose: () => void; onTipificar: () => void; onFicha: () => void; onTicket: (id: string) => void;
}) {
  return (
    <CapaModal onClose={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Tipificación de ${t.cliente.nombre}`}
        className={`flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <Avatar nombre={t.cliente.nombre} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Tipificación</p>
            <h2 className="truncate text-[15px] font-bold text-slate-900">{t.cliente.nombre}</h2>
            <p className="text-[12px] text-slate-500">{codigoCliente(t.cliente)}{t.cliente.ruc ? ` · RUC ${t.cliente.ruc}` : ""}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ul><ItemTipificacion t={t} puedeSoporte={puedeSoporte} onVerTicket={onTicket} /></ul>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5 max-sm:[&>*]:flex-1">
          <button type="button" onClick={onFicha} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <UserRound className="h-4 w-4" /> Ver cliente
          </button>
          <Link href={`/clientes/gestion?cliente=${encodeURIComponent(t.cliente.id)}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Gestión <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button type="button" onClick={onTipificar} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-white hover:brightness-95 sm:ml-auto">
            <ClipboardPen className="h-4 w-4" /> Nueva tipificación
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

function FilasEsqueleto() {
  const bar = "animate-pulse rounded-md bg-slate-200/80";
  return (
    <ul className="divide-y divide-slate-100" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="grid gap-3 px-4 py-3.5 lg:grid-cols-[150px_minmax(160px,1.1fr)_minmax(200px,1.4fr)_minmax(0,2fr)_150px]">
          <div className={`h-3.5 w-28 ${bar}`} /><div className={`h-3.5 w-36 ${bar}`} /><div className={`h-3.5 w-44 ${bar}`} /><div className={`h-3.5 w-full ${bar}`} /><div className={`h-3.5 w-16 ${bar}`} />
        </li>
      ))}
    </ul>
  );
}
