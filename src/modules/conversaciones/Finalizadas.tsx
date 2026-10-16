"use client";

/**
 * Conversaciones finalizadas (como el sistema actual): filtros (fechas, asesor que cerró,
 * estado de cierre, búsqueda), tabla con la tipificación, etiquetas y tiempo de primera
 * respuesta; lectura del chat y "Reabrir". UNA consulta keyset (chat_finalizadas) con
 * "Cargar más". ADMIN/supervisores ven todas; el resto, las que cerró.
 */
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, RotateCcw, SlidersHorizontal } from "lucide-react";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { accionConversacion, pedirCatalogoCierre, pedirOpciones, type CatalogoCierre } from "@/modules/conversaciones/api";
import { pedirFinalizadas, type FiltrosFinalizadas } from "@/modules/conversaciones/api-supervision";
import { nombreContacto, telefonoLegible } from "@/modules/conversaciones/dominio";
import { duracionCorta, segundosEntre, type Finalizada } from "@/modules/conversaciones/supervision";
import { Encabezado, btnPrimario } from "@/modules/conversaciones/ui-supervision";
import { Girando } from "@/modules/conversaciones/ui";

const VisorChat = dynamic(() => import("@/modules/conversaciones/VisorChat").then((m) => m.VisorChat), { ssr: false });

const VACIOS: FiltrosFinalizadas = { desde: "", hasta: "", asesor: "", estado: "", q: "" };
const campo =
  "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20 max-sm:h-11";
const etiqueta = "flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#2F6E71]";
const tarjeta = "overflow-hidden rounded-2xl border border-[#4FAEB2]/20 bg-white shadow-[0_2px_12px_rgba(47,110,113,0.08)]";

const F_FECHA = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fechaHora = (iso: string | null | undefined) => (iso ? F_FECHA.format(new Date(iso)).replace(",", "") : "—");

export function Finalizadas() {
  const [borrador, setBorrador] = useState<FiltrosFinalizadas>(VACIOS);
  const [filtros, setFiltros] = useState<FiltrosFinalizadas>(VACIOS);
  const [rows, setRows] = useState<Finalizada[]>([]);
  const [siguiente, setSiguiente] = useState<{ at: string; id: string } | null>(null);
  const [alcance, setAlcance] = useState<"todas" | "propias" | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [equipo, setEquipo] = useState<{ id: string; nombre: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoCierre | null>(null);
  const [visor, setVisor] = useState<Finalizada | null>(null);
  const [reabriendo, setReabriendo] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    pedirOpciones().then((o) => setEquipo(o.equipo)).catch(() => {});
    pedirCatalogoCierre().then(setCatalogo).catch(() => {});
  }, []);

  const cargar = useCallback(async (f: FiltrosFinalizadas) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCargando(true);
    setError(null);
    try {
      const p = await pedirFinalizadas(f, null, ac.signal);
      if (ac.signal.aborted) return;
      setRows(p.rows);
      setSiguiente(p.siguiente);
      setAlcance(p.alcance);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setCargando(false);
    }
  }, []);
  useEffect(() => {
    void cargar(filtros);
  }, [cargar, filtros]);

  const cargarMas = async () => {
    if (!siguiente || cargandoMas) return;
    setCargandoMas(true);
    try {
      const p = await pedirFinalizadas(filtros, siguiente);
      setRows((prev) => {
        const ya = new Set(prev.map((r) => r.id));
        return [...prev, ...p.rows.filter((r) => !ya.has(r.id))];
      });
      setSiguiente(p.siguiente);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  };

  const aplicar = () => setFiltros({ ...borrador });
  const limpiar = () => {
    setBorrador(VACIOS);
    setFiltros(VACIOS);
  };
  const set = (k: keyof FiltrosFinalizadas, v: string) => setBorrador((b) => ({ ...b, [k]: v }));

  const reabrir = async (r: Finalizada) => {
    const nombre = r.contacto_nombre?.trim() ? nombreContacto(r) : telefonoLegible(r.contacto_telefono);
    if (!window.confirm(`¿Reabrir la conversación con ${nombre}? Vuelve a la bandeja como abierta.`)) return;
    setReabriendo(r.id);
    try {
      await accionConversacion(r.id, { accion: "reabrir" });
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      setVisor(null);
      setAviso(`Conversación con ${nombre} reabierta.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReabriendo(null);
    }
  };

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // CSV con los filtros aplicados (hasta 5000 filas, recorriendo el cursor).
  const exportar = async () => {
    setExportando(true);
    try {
      const todas: Finalizada[] = [];
      let cur: { at: string; id: string } | null = null;
      do {
        const p = await pedirFinalizadas(filtros, cur);
        todas.push(...p.rows);
        cur = p.siguiente;
      } while (cur && todas.length < 5000);
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const cab = ["Fecha de finalización", "Contacto", "Teléfono", "Canal", "Cerrada por", "Estado", "Sub-estado", "Observación", "Etiquetas", "1ª respuesta"];
      const lineas = todas.map((r) =>
        [
          fechaHora(r.cerrada_at), r.contacto_nombre ?? "", telefonoLegible(r.contacto_telefono), r.canal, r.cerrada_por_nombre ?? "", r.cierre_familia ?? "",
          r.cierre_estado ?? "", r.cierre_observacion ?? "", (r.etiquetas ?? []).join(", "), duracionCorta(segundosEntre(r.created_at, r.primera_respuesta_at)),
        ].map(esc).join(";"),
      );
      const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversaciones-finalizadas-${new Date().toLocaleDateString("en-CA", { timeZone: TZ_PY })}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (cur) setAviso(`Se exportaron ${todas.length} filas (límite 5000). Acotá las fechas para el resto.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportando(false);
    }
  };

  const todas = alcance === "todas";

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Encabezado
        eyebrow="Omnicanal"
        titulo="Conversaciones finalizadas"
        detalle={
          alcance === "propias"
            ? "Tus conversaciones finalizadas. Filtrá por fecha, estado o buscá un contacto."
            : "Todas las conversaciones cerradas con su tipificación. Filtrá, leé el chat sin salir de la pantalla o reabrilo."
        }
      >
        <button type="button" onClick={() => void exportar()} disabled={exportando || cargando || !rows.length} className={btnPrimario}>
          {exportando ? <Girando className="h-4 w-4" /> : <Download className="h-4 w-4" aria-hidden />} Descargar Excel (CSV)
        </button>
      </Encabezado>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

      {/* Filtros */}
      <section className={tarjeta}>
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/5 to-transparent px-4 py-3 md:px-5">
          <SlidersHorizontal className="h-4 w-4 text-[#2F6E71]" aria-hidden />
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#2F6E71]">Filtros</h2>
        </div>
        <form
          className="px-4 pb-4 md:px-5"
          onSubmit={(e) => {
            e.preventDefault();
            aplicar();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={etiqueta}>
              Desde
              <SelectorFecha compacto block className="font-normal normal-case tracking-normal" etiqueta="Desde" value={borrador.desde} max={borrador.hasta || undefined} onChange={(v) => set("desde", v)} />
            </div>
            <div className={etiqueta}>
              Hasta
              <SelectorFecha compacto block className="font-normal normal-case tracking-normal" etiqueta="Hasta" value={borrador.hasta} min={borrador.desde || undefined} onChange={(v) => set("hasta", v)} />
            </div>
            {todas ? (
              <div className={etiqueta}>
                Cerrada por
                <Select
                  compacto
                  block
                  className="font-normal normal-case tracking-normal"
                  etiqueta="Cerrada por"
                  value={borrador.asesor}
                  onChange={(v) => set("asesor", v)}
                  options={[["", "Todos"], ...equipo.map((u): [string, string] => [u.id, u.nombre])]}
                />
              </div>
            ) : null}
            <div className={etiqueta}>
              Estado de cierre
              <Select
                compacto
                block
                className="font-normal normal-case tracking-normal"
                etiqueta="Estado de cierre"
                value={borrador.estado}
                onChange={(v) => set("estado", v)}
                options={[
                  ["", "Todos"],
                  ...(catalogo?.familias ?? []).flatMap((f) => f.subestados.map((s): [string, string] => [s.id, `${f.nombre} · ${s.nombre}`])),
                ]}
              />
            </div>
            <label className={`${etiqueta} sm:col-span-2`}>
              Nombre, número u observación
              <input type="search" value={borrador.q} onChange={(e) => set("q", e.target.value)} placeholder="Buscar contacto…" className={campo} />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button type="submit" className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] max-sm:min-h-11 max-sm:flex-1">
              Aplicar filtros
            </button>
            <button type="button" onClick={limpiar} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 max-sm:min-h-11 max-sm:flex-1">
              Limpiar
            </button>
          </div>
        </form>
      </section>

      {/* Tabla */}
      <section className={tarjeta}>
        {cargando ? (
          <p className="px-3 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : (
          <TablaTarjetas
            filas={rows}
            claveFila={(r) => r.id}
            onFila={(r) => setVisor(r)}
            minAncho={1180}
            claseTabla="w-full text-left text-sm"
            claseThead="border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/12 via-[#4FAEB2]/6 to-transparent"
            thBase="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-[#2F6E71]"
            tdBase="px-3 py-2.5"
            claseFila={() => "hover:!bg-slate-50/80"}
            vacio={<p className="px-3 py-10 text-center text-sm text-slate-500">No hay conversaciones finalizadas con estos filtros.</p>}
            columnas={[
              { key: "fecha", titulo: "Finalización", movil: "subtitulo", claseTh: "whitespace-nowrap", claseTd: "whitespace-nowrap tabular-nums text-slate-700", celda: (r) => fechaHora(r.cerrada_at) },
              {
                key: "contacto",
                titulo: "Contacto",
                movil: "titulo",
                claseTd: "font-medium text-slate-900",
                celda: (r) => r.contacto_nombre?.trim() || "—",
                celdaMovil: (r) => r.contacto_nombre?.trim() || telefonoLegible(r.contacto_telefono),
              },
              { key: "tel", titulo: "Teléfono", movil: "dato", claseTd: "whitespace-nowrap font-mono text-[12px] text-slate-600", celda: (r) => telefonoLegible(r.contacto_telefono) },
              { key: "canal", titulo: "Canal", movil: "dato", claseTd: "text-slate-700", celda: (r) => r.canal },
              { key: "por", titulo: "Cerrada por", movil: "dato", claseTh: "whitespace-nowrap", claseTd: "text-slate-700", celda: (r) => r.cerrada_por_nombre ?? "—" },
              {
                key: "cierre",
                titulo: "Cierre",
                movil: "chip",
                celda: (r) =>
                  r.cierre_familia ? (
                    <div className="flex flex-col items-start gap-1 max-md:flex-row max-md:flex-wrap">
                      <span className="rounded-full bg-[#4FAEB2]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6E71]">{r.cierre_familia}</span>
                      {r.cierre_estado ? <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">{r.cierre_estado}</span> : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
              {
                key: "obs",
                titulo: "Observación",
                claseTh: "min-w-[160px]",
                claseTd: "max-w-[220px] truncate text-slate-600",
                celda: (r) => <span title={r.cierre_observacion ?? ""}>{r.cierre_observacion || "—"}</span>,
              },
              {
                key: "etiquetas",
                titulo: "Etiquetas",
                celda: (r) => (
                  <div className="flex max-w-[180px] flex-wrap gap-1 max-md:max-w-none max-md:justify-end">
                    {(r.etiquetas ?? []).length
                      ? (r.etiquetas ?? []).map((e) => (
                          <span key={e} className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{e}</span>
                        ))
                      : <span className="text-slate-400">—</span>}
                  </div>
                ),
              },
              {
                key: "primera",
                titulo: "1ª respuesta",
                claseTh: "whitespace-nowrap",
                claseTd: "whitespace-nowrap tabular-nums text-slate-700",
                celda: (r) => (r.primera_respuesta_at ? duracionCorta(segundosEntre(r.created_at, r.primera_respuesta_at)) : <span className="text-[11px] text-amber-700">Sin respuesta</span>),
              },
              {
                key: "acciones",
                titulo: "Acciones",
                movil: "acciones",
                claseTh: "text-right",
                celda: (r) => (
                  <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setVisor(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#4FAEB2]/50 bg-[#4FAEB2]/8 px-2.5 py-1.5 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2]/15"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden /> Ver chat
                    </button>
                    <button
                      type="button"
                      disabled={reabriendo === r.id}
                      onClick={() => void reabrir(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {reabriendo === r.id ? <Girando /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />} Reabrir
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
        {!cargando && rows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span className="tabular-nums">{rows.length} {rows.length === 1 ? "conversación" : "conversaciones"}{siguiente ? " (hay más)" : ""}</span>
            {siguiente ? (
              <button
                type="button"
                onClick={() => void cargarMas()}
                disabled={cargandoMas}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-[#3F8E91] hover:bg-slate-50 disabled:opacity-50 max-sm:min-h-11"
              >
                {cargandoMas ? <Girando /> : null} Cargar más
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {visor ? (
        <VisorChat
          convId={visor.id}
          nombre={visor.contacto_nombre}
          telefono={visor.contacto_telefono}
          detalle={`${telefonoLegible(visor.contacto_telefono)} · cerrada el ${fechaHora(visor.cerrada_at)}`}
          onCerrar={() => setVisor(null)}
          arriba={
            <div className="rounded-2xl border border-[#4FAEB2]/25 bg-white p-4 shadow-[0_1px_3px_rgba(47,110,113,0.08)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#4FAEB2]/15 px-3 py-1 text-[13px] font-semibold text-[#2F6E71]">{visor.cierre_familia ?? "Sin estado"}</span>
                {visor.cierre_estado ? <span className="rounded-full bg-slate-100 px-3 py-1 text-[12.5px] text-slate-600">{visor.cierre_estado}</span> : null}
                <span className="ml-auto text-[11px] text-slate-500">
                  {visor.cerrada_por_nombre ? `Cerró ${visor.cerrada_por_nombre}` : ""}
                  {visor.canal ? ` · ${visor.canal}` : ""}
                </span>
              </div>
              {visor.cierre_observacion ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{visor.cierre_observacion}</p>
              ) : (
                <p className="mt-2 text-sm italic text-slate-400">Sin comentario de cierre.</p>
              )}
            </div>
          }
          acciones={
            <button
              type="button"
              disabled={reabriendo === visor.id}
              onClick={() => void reabrir(visor)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-50 max-sm:min-h-11"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reabrir
            </button>
          }
        />
      ) : null}

      {aviso ? (
        <div role="status" className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[140] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-xl" style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          {aviso}
        </div>
      ) : null}
    </div>
  );
}
