"use client";

/**
 * Listado de tickets con pestañas (con contadores), filtros y paginación.
 * El estado vive en la URL (?pestana=…&cliente_id=…): un refresh no pierde los
 * filtros, "atrás" funciona y otras pantallas enlazan listados ya filtrados.
 */
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Search, UserPen, X } from "lucide-react";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { useMediaQuery } from "@/lib/ui/responsive";
import { numeroTicket, fechaHora, puedeEstarACargo, type Persona } from "@/modules/soporte/dominio";
import {
  apiSoporte,
  catalogosEnMemoria,
  clientesEnMemoria,
  obtenerCatalogos,
  obtenerClientes,
  precargarTicket,
  type CatalogosConEquipo,
} from "@/modules/soporte/api";
import { Aviso, Avatar, Cargando, ChipSla, Desplegable, Fase, Insignia, SelectorBuscable, TARJETA, TONOS, TONO_AREA, TONO_ESTADO, Vacio, claseInput, type Tono } from "@/modules/soporte/ui";

export type PestanaDef = {
  id: string;
  etiqueta: string;
  estados: readonly string[] | null;
  /** Tickets con una revisión de QA sin terminar asignada a quien mira. */
  revision?: boolean;
};

type TicketLista = {
  id: string;
  numero: number;
  asunto: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_etiqueta: string;
  tipo_codigo: string;
  estado_codigo: string;
  estado_nombre: string;
  estado_color: string;
  fase?: number;
  clasificacion_nombre: string | null;
  responsable: Persona | null;
  creador: Persona | null;
  updated_at: string;
  sla: { estado: string };
};

type RespLista = {
  tickets: TicketLista[];
  total: number;
  pagina: number;
  por_pagina: number;
  por_estado: Record<string, number>;
  revisiones_pendientes?: number;
};

const POR_PAGINA = 20;
const recordado = new Map<string, RespLista>();

function tonoPestana(p: PestanaDef): Tono {
  if (p.revision) return "violeta";
  if (!p.estados) return "turquesa";
  return TONO_ESTADO[p.estados[p.estados.length - 1]] ?? "turquesa";
}

export default function TablaTickets({
  pestanas,
  soloMios = false,
  ocultarResponsable = false,
  abrirPestanaConDatos = false,
}: {
  pestanas: readonly PestanaDef[];
  soloMios?: boolean;
  ocultarResponsable?: boolean;
  /** Sin pestaña elegida y con la primera vacía, abre la primera con tickets. */
  abrirPestanaConDatos?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const pestana = pestanas.find((p) => p.id === params.get("pestana")) ?? pestanas[0];
  const filtros = {
    q: params.get("q") ?? "",
    cliente_id: params.get("cliente_id") ?? "",
    estado: params.get("estado") ?? "",
    tipo: params.get("tipo") ?? "",
    responsable_id: params.get("responsable_id") ?? "",
    cargados: params.get("cargados") ?? "",
  };
  const soloCargados = filtros.cargados === "1";
  const pagina = Math.max(1, Number(params.get("pagina") ?? "1") || 1);

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (pestana.estados) q.set("estados", pestana.estados.join(","));
    if (pestana.revision) q.set("revision", "1");
    for (const k of ["q", "cliente_id", "estado", "tipo", "responsable_id", "cargados"]) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    if (soloMios) q.set("mios", "1");
    q.set("pagina", String(pagina));
    q.set("por_pagina", String(POR_PAGINA));
    return q.toString();
  }, [params, soloMios, pestana, pagina]);

  const [cat, setCat] = useState<CatalogosConEquipo | null>(() => catalogosEnMemoria() ?? null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>(() => clientesEnMemoria() ?? []);
  const [datos, setDatos] = useState<RespLista | null>(() => recordado.get(consulta) ?? null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState(filtros.q);

  // "Tomar": Técnico y QA se asignan un ticket desde la fila, sin abrirlo.
  const yo = cat?.personas.find((p) => p.id === cat.usuario_id);
  const puedoTomar = Boolean(yo && cat && puedeEstarACargo(yo, cat.hay_equipo));
  const [tomando, setTomando] = useState<string | null>(null);
  const tomar = async (ticketId: string) => {
    if (!yo) return;
    setTomando(ticketId);
    setError(null);
    try {
      await apiSoporte(`/api/soporte/tickets/${ticketId}`, { method: "PATCH", json: { responsable_id: yo.id } });
      setDatos((d) => (d ? { ...d, tickets: d.tickets.map((x) => (x.id === ticketId ? { ...x, responsable: yo } : x)) } : d));
      recordado.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo asignar el ticket");
    } finally {
      setTomando(null);
    }
  };

  useEffect(() => {
    void obtenerCatalogos().then(setCat).catch((e: Error) => setError(e.message));
    void obtenerClientes().then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    let vivo = true;
    const guardado = recordado.get(consulta);
    if (guardado) setDatos(guardado);
    setCargando(true);
    apiSoporte<RespLista>(`/api/soporte/tickets?${consulta}`)
      .then((r) => {
        recordado.set(consulta, r);
        if (vivo) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [consulta]);

  const cambiar = useCallback(
    (cambios: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      if (!("pagina" in cambios)) q.delete("pagina");
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (texto === filtros.q) return;
    const t = window.setTimeout(() => cambiar({ q: texto.trim() || null }), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const contador = (p: PestanaDef) => {
    const pe = datos?.por_estado ?? {};
    if (p.revision) return datos?.revisiones_pendientes ?? 0;
    if (!p.estados) return Object.values(pe).reduce((s, n) => s + n, 0);
    return p.estados.reduce((s, e) => s + (pe[e] ?? 0), 0);
  };

  const pestanaElegida = params.has("pestana");
  useEffect(() => {
    if (!abrirPestanaConDatos || pestanaElegida || !datos) return;
    if (contador(pestana) > 0) return;
    const conDatos = pestanas.find((p) => contador(p) > 0);
    if (conDatos && conDatos.id !== pestana.id) cambiar({ pestana: conDatos.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirPestanaConDatos, pestanaElegida, datos]);

  const op = useMemo(() => {
    const todos = (etq: string) => [{ value: "", label: etq }];
    return {
      estado: [...todos("Todos los estados"), ...(cat?.estados ?? []).filter((e) => e.activo).map((e) => ({ value: e.codigo, label: e.nombre }))],
      tipo: [...todos("Todos los tipos"), ...(cat?.tipos ?? []).filter((t) => t.activo).map((t) => ({ value: t.codigo, label: t.nombre }))],
      responsable: [
        { value: "", label: "Cualquier responsable" },
        ...(cat?.personas ?? []).map((u) => ({ value: u.id, label: u.nombre, detalle: u.area, tono: TONO_AREA[u.area] })),
      ],
    };
  }, [cat]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  const total = datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(total, pagina * POR_PAGINA);
  const href = (id: string) => `/soporte/tickets/${id}`;
  const angosta = useMediaQuery("(max-width: 767.98px)");

  return (
    <div className="space-y-4">
      {/* Pestañas con contador */}
      <ScrollHorizontal claseFila="gap-1.5" dependencias={[pestana.id]} className="rounded-2xl border border-slate-200/80 bg-white/80 p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        {pestanas.map((p) => {
          const sel = p.id === pestana.id;
          const t = TONOS[tonoPestana(p)];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => cambiar({ pestana: p.id === pestanas[0].id ? null : p.id })}
              aria-current={sel ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition max-md:min-h-11 ${
                sel ? `${t.suave} ${t.texto} ring-1 ring-inset ${t.borde}` : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${t.solido}`} aria-hidden />
              {p.etiqueta}
              {datos ? (
                <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${sel ? "bg-white/70" : "bg-slate-100 text-slate-500"}`}>{contador(p)}</span>
              ) : null}
            </button>
          );
        })}
      </ScrollHorizontal>

      <div className={`overflow-visible ${TARJETA}`}>
        {/* Filtros (celular / tablet chica: búsqueda + "Filtros" con el resto en una hoja) */}
        {angosta ? (
          <div className="rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/[0.05] via-white to-sky-50/40 px-3 py-2.5">
            <BarraFiltros
              plano
              busqueda={<label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" aria-hidden />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por asunto o #número…" aria-label="Buscar tickets" className={`${claseInput} h-11 pl-9`} type="search" enterKeyHint="search" />
          </label>}
              activos={[filtros.cliente_id, filtros.estado, filtros.tipo, filtros.responsable_id, filtros.cargados].filter(Boolean).length}
              onLimpiar={() => cambiar({ cliente_id: null, estado: null, tipo: null, responsable_id: null, cargados: null })}
            >
              <SelectorBuscable
              avatares
              ariaLabel="Cliente"
              opciones={[{ value: "", label: "Todos los clientes" }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]}
              value={filtros.cliente_id}
              onChange={(v) => cambiar({ cliente_id: v || null })}
              placeholder="Todos los clientes"
              buscarPlaceholder="Buscar cliente…"
              vacio="Ningún cliente coincide"
          />
              <Desplegable value={filtros.estado} onChange={(v) => cambiar({ estado: v || null })} options={op.estado} etiqueta="Estado" />
              <Desplegable value={filtros.tipo} onChange={(v) => cambiar({ tipo: v || null })} options={op.tipo} etiqueta="Tipo" />
              {ocultarResponsable ? null : (
                <SelectorBuscable
                avatares
                ariaLabel="Asignado a"
                value={filtros.responsable_id}
                onChange={(v) => cambiar({ responsable_id: v || null })}
                opciones={op.responsable}
                placeholder="Cualquier responsable"
                buscarPlaceholder="Buscar persona o área…"
                vacio="Nadie coincide"
            />
              )}
              <button
              type="button"
              onClick={() => cambiar({ cargados: soloCargados ? null : "1" })}
              aria-pressed={soloCargados}
              title="Sólo los tickets que cargué yo"
              className={`inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-[12px] font-semibold transition-colors ${
                soloCargados ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]" : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
              }`}
          >
              <UserPen className="h-3.5 w-3.5" aria-hidden /> Cargados por mí
          </button>
            </BarraFiltros>
          </div>
        ) : (
        <div className="grid gap-2 rounded-t-2xl border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/[0.05] via-white to-sky-50/40 px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1.4fr)_repeat(4,minmax(0,1fr))_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" aria-hidden />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por asunto o #número…" aria-label="Buscar tickets" className={`${claseInput} h-[42px] pl-9`} />
          </label>
          <SelectorBuscable
            avatares
            ariaLabel="Cliente"
            opciones={[{ value: "", label: "Todos los clientes" }, ...clientes.map((c) => ({ value: c.id, label: c.nombre }))]}
            value={filtros.cliente_id}
            onChange={(v) => cambiar({ cliente_id: v || null })}
            placeholder="Todos los clientes"
            buscarPlaceholder="Buscar cliente…"
            vacio="Ningún cliente coincide"
          />
          <Desplegable value={filtros.estado} onChange={(v) => cambiar({ estado: v || null })} options={op.estado} etiqueta="Estado" />
          <Desplegable value={filtros.tipo} onChange={(v) => cambiar({ tipo: v || null })} options={op.tipo} etiqueta="Tipo" />
          {ocultarResponsable ? (
            <span className="hidden lg:block" />
          ) : (
            <SelectorBuscable
              avatares
              ariaLabel="Asignado a"
              value={filtros.responsable_id}
              onChange={(v) => cambiar({ responsable_id: v || null })}
              opciones={op.responsable}
              placeholder="Cualquier responsable"
              buscarPlaceholder="Buscar persona o área…"
              vacio="Nadie coincide"
            />
          )}
          <button
            type="button"
            onClick={() => cambiar({ cargados: soloCargados ? null : "1" })}
            aria-pressed={soloCargados}
            title="Sólo los tickets que cargué yo"
            className={`inline-flex h-[42px] items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-[12px] font-semibold transition-colors ${
              soloCargados ? "border-[#4FAEB2] bg-[#4FAEB2]/10 text-[#2F6E71]" : "border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#2F6E71]"
            }`}
          >
            <UserPen className="h-3.5 w-3.5" aria-hidden /> Cargados por mí
          </button>
          {hayFiltros ? (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                cambiar({ q: null, cliente_id: null, estado: null, tipo: null, responsable_id: null, cargados: null });
              }}
              className="inline-flex h-[42px] items-center justify-center gap-1 rounded-xl px-2.5 text-[12px] font-semibold text-rose-500 hover:bg-rose-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Limpiar
            </button>
          ) : (
            <span className="hidden lg:block" />
          )}
        </div>

        )}
        <div className={`h-0.5 overflow-hidden transition-opacity ${cargando && datos ? "opacity-100" : "opacity-0"}`}>
          <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-[#4FAEB2] to-transparent" />
        </div>

        {error ? (
          <div className="p-4">
            <Aviso>{error}</Aviso>
          </div>
        ) : null}
        {!datos ? (
          error ? null : <Cargando filas={6} />
        ) : datos.tickets.length === 0 ? (
          <Vacio
            icono={Inbox}
            titulo={hayFiltros ? "Ningún ticket coincide con los filtros" : soloMios ? "No tenés tickets en esta vista" : "Todavía no hay tickets"}
            detalle={hayFiltros ? "Probá quitando algún filtro." : undefined}
          />
        ) : (
          <>
            {/* Tabla (≥ 768 px) / tarjetas (celular) */}
            <TablaTarjetas
              filas={datos.tickets}
              claveFila={(t) => t.id}
              onFila={(t) => router.push(href(t.id))}
              onIntencion={(t) => {
                precargarTicket(t.id);
                router.prefetch(href(t.id));
              }}
              minAncho={1000}
              claseTabla="w-full text-left text-[13px]"
              claseThead="border-b border-slate-100"
              thBase="px-3 py-3 text-[11px] font-bold uppercase tracking-wide text-slate-400"
              tdBase="px-3 py-3.5"
              claseFila={() => "relative border-b border-slate-100 last:border-0 hover:!bg-[#4FAEB2]/[0.04]"}
              columnas={[
                {
                  key: "num",
                  titulo: "#",
                  movil: "subtitulo",
                  claseTh: "w-24 !px-5",
                  claseTd: "relative !px-5",
                  celda: (t) => (
                    <>
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full opacity-0 transition-opacity group-hover:opacity-100" style={{ backgroundColor: t.estado_color }} aria-hidden />
                      <span className="font-bold tabular-nums text-slate-400 group-hover:text-[#2F6E71]">{numeroTicket(t.numero)}</span>
                    </>
                  ),
                  celdaMovil: (t) => (
                    <span className="font-semibold tabular-nums">
                      {numeroTicket(t.numero)} · {t.cliente_nombre ?? "Sin cliente"}
                    </span>
                  ),
                },
                {
                  key: "asunto",
                  titulo: "Asunto",
                  movil: "titulo",
                  claseTd: "max-w-[340px]",
                  celda: (t) => (
                    <>
                      <Link href={href(t.id)} onClick={(e) => e.stopPropagation()} className="line-clamp-2 font-semibold text-slate-800 no-underline group-hover:text-[#2F6E71]">
                        {t.asunto}
                      </Link>
                      <span className="mt-1 flex">
                        <ChipSla estado={t.sla.estado} compacto />
                      </span>
                    </>
                  ),
                  celdaMovil: (t) => t.asunto,
                },
                {
                  key: "cliente",
                  titulo: "Cliente",
                  movil: "oculto",
                  claseTd: "max-w-[190px] truncate font-medium text-slate-600",
                  celda: (t) => t.cliente_nombre ?? "—",
                },
                { key: "tipo", titulo: "Tipo", movil: "detalle", claseTd: "text-slate-600", celda: (t) => cat?.tipos.find((x) => x.codigo === t.tipo_codigo)?.nombre ?? t.tipo_etiqueta },
                {
                  key: "estado",
                  titulo: "Estado",
                  movil: "chip",
                  celda: (t) => (
                    <>
                      <Insignia color={t.estado_color} punto>
                        {t.estado_nombre}
                      </Insignia>
                      <Fase n={t.fase} bloque />
                    </>
                  ),
                  celdaMovil: (t) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Insignia color={t.estado_color} punto>
                        {t.estado_nombre}
                      </Insignia>
                      <Fase n={t.fase} />
                      <ChipSla estado={t.sla.estado} compacto />
                    </span>
                  ),
                },
                {
                  key: "clasif",
                  titulo: "Clasificación",
                  movil: "dato",
                  celda: (t) => <span className="text-slate-600">{t.clasificacion_nombre ?? <span className="text-slate-300">—</span>}</span>,
                },
                ...(ocultarResponsable
                  ? []
                  : [
                      {
                        key: "resp",
                        titulo: "Asignado a",
                        movil: "dato" as const,
                        celda: (t: TicketLista) => (
                          <div className="flex items-center gap-2">
                            {t.responsable ? (
                              <span className="inline-flex min-w-0 items-center gap-2 font-medium text-slate-700">
                                <Avatar nombre={t.responsable.nombre} tam={24} />
                                <span className="min-w-0 truncate">{t.responsable.nombre}</span>
                              </span>
                            ) : (
                              <span className="text-[12px] italic text-slate-400">Sin asignar</span>
                            )}
                            {puedoTomar && t.responsable?.id !== cat?.usuario_id && t.estado_codigo !== "cerrado" && t.estado_codigo !== "cancelado" ? (
                              <button
                                type="button"
                                disabled={tomando === t.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void tomar(t.id);
                                }}
                                title="Asignarme este ticket"
                                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#4FAEB2]/40 bg-white px-2 py-1 text-[11px] font-bold text-[#2F6E71] opacity-0 transition hover:bg-[#4FAEB2]/10 focus:opacity-100 group-hover:opacity-100 disabled:opacity-60 max-md:min-h-10 max-md:px-3 max-md:text-xs max-md:opacity-100 [@media(hover:none)]:opacity-100"
                              >
                                {tomando === t.id ? "…" : "Tomar"}
                              </button>
                            ) : null}
                          </div>
                        ),
                      },
                    ]),
                {
                  key: "creador",
                  titulo: "Cargado por",
                  movil: "dato",
                  celda: (t) =>
                    t.creador ? (
                      <span className="inline-flex min-w-0 items-center gap-2 font-medium text-slate-700">
                        <Avatar nombre={t.creador.nombre} tam={24} />
                        <span className="min-w-0 truncate">{t.creador.nombre}</span>
                      </span>
                    ) : (
                      <span className="text-[12px] italic text-slate-400">—</span>
                    ),
                },
                {
                  key: "act",
                  titulo: "Actualizado",
                  movil: "detalle",
                  claseTh: "!px-5 text-right",
                  claseTd: "whitespace-nowrap !px-5 text-right text-[12.5px] tabular-nums text-slate-500",
                  celda: (t) => fechaHora(t.updated_at),
                },
              ]}
            />

            {/* Paginación */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-3 py-3 text-[12px] text-slate-500 sm:px-5 max-sm:justify-center">
              <span className="tabular-nums">
                Mostrando <b className="text-slate-700">{desde}</b> a <b className="text-slate-700">{hasta}</b> de <b className="text-slate-700">{total}</b> tickets
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pagina <= 1}
                  onClick={() => cambiar({ pagina: String(pagina - 1) })}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40 max-md:h-11 max-md:w-11"
                  aria-label="Página anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {Array.from({ length: paginas }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === paginas || Math.abs(n - pagina) <= 1)
                  .map((n, i, arr) => (
                    <span key={n} className="flex items-center gap-1">
                      {i > 0 && n - arr[i - 1] > 1 ? <span className="px-1">…</span> : null}
                      <button
                        type="button"
                        onClick={() => cambiar({ pagina: String(n) })}
                        aria-current={n === pagina ? "page" : undefined}
                        className={`h-8 min-w-8 rounded-lg px-2 font-semibold tabular-nums max-md:h-11 max-md:min-w-11 ${
                          n === pagina ? "bg-[#4FAEB2] text-white shadow-[0_4px_12px_-4px_rgba(79,174,178,0.8)]" : "border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50"
                        }`}
                      >
                        {n}
                      </button>
                    </span>
                  ))}
                <button
                  type="button"
                  disabled={pagina >= paginas}
                  onClick={() => cambiar({ pagina: String(pagina + 1) })}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#4FAEB2]/50 disabled:opacity-40 max-md:h-11 max-md:w-11"
                  aria-label="Página siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
