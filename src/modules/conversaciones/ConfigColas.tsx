"use client";

/**
 * Colas y enrutamiento (solo ADMIN; se entra desde Monitoreo). Copia simple de
 * /configuracion/colas del sistema actual: lista de colas y editor en ventana con datos
 * generales, estrategia (equitativa | manual), canales vinculados, SLA de primera
 * respuesta y reasignaciones, ventana de "mismo asesor" y asesores de la cola
 * (recibe nuevos, máximo de conversaciones, supervisor). Se guarda todo junto.
 */
import { TablaScroll } from "@/components/TablaResponsive";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Plus, Trash2, X } from "lucide-react";
import { borrarCola, crearCola, guardarCola, pedirColas, type CuerpoCola } from "@/modules/conversaciones/api-supervision";
import type { AgenteCola, Cola, DatosColas, Estrategia } from "@/modules/conversaciones/supervision";
import { Cargando, Encabezado, btnPrimario } from "@/modules/conversaciones/ui-supervision";
import { Girando } from "@/modules/conversaciones/ui";

const seccion = "space-y-4 rounded-2xl border border-[#4FAEB2]/45 bg-white p-5 shadow-sm";
const tituloSeccion = "text-xs font-bold uppercase tracking-wide text-slate-500";
const etiqueta = "mb-1 block text-xs font-semibold uppercase text-slate-500";
const campo =
  "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm transition-colors hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const check = "h-4 w-4 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6 rounded border-slate-300 text-[#4FAEB2] accent-[#4FAEB2] focus:ring-[#4FAEB2]/30";
const ayuda = "mt-1 text-[11px] leading-relaxed text-slate-500";

const ESTRATEGIAS: { id: Estrategia; label: string; detalle: string }[] = [
  { id: "equitativa", label: "Equitativa", detalle: "Reparte los chats nuevos entre los asesores disponibles: primero los en línea, después el de menos asignaciones del día y menos carga." },
  { id: "manual", label: "Manual", detalle: "No autoasigna: los chats quedan en Sin asignar para que alguien los tome o un supervisor los asigne." },
];

const NUEVA: CuerpoCola = {
  nombre: "",
  estrategia: "equitativa",
  prioridad: 0,
  sla_minutos: 5,
  max_reasignaciones: 2,
  mismo_asesor_horas: 24,
  activo: true,
  canales: [],
  agentes: [],
};

export function ConfigColas() {
  const [datos, setDatos] = useState<DatosColas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string | null; cola: CuerpoCola } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await pedirColas());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const usuarios = useMemo(() => new Map((datos?.usuarios ?? []).map((u) => [u.id, u])), [datos]);
  const canales = useMemo(() => new Map((datos?.canales ?? []).map((c) => [c.id, c])), [datos]);
  const activas = (datos?.colas ?? []).filter((c) => c.activo).length;

  return (
    <div className="flex flex-col gap-6 pb-10">
      <nav className="text-xs text-slate-500">
        <Link href="/conversaciones/monitoreo" className="hover:text-[#3F8E91] hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">Monitoreo</Link> / <span className="font-semibold text-slate-700">Colas y enrutamiento</span>
      </nav>
      <Encabezado
        eyebrow="Omnicanal · Routing"
        titulo="Colas y enrutamiento"
        detalle="Definí colas, canales asociados, estrategia de distribución, SLA de primera respuesta y asesores por cola. Los chats entrantes se asignan solos con estas reglas."
      >
        <button type="button" className={btnPrimario} onClick={() => setEditando({ id: null, cola: { ...NUEVA } })} disabled={!datos}>
          <Plus className="h-4 w-4" aria-hidden /> Nueva cola
        </button>
      </Encabezado>

      {aviso ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{aviso}</div> : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {/permiso/i.test(error) ? "Solo un administrador puede configurar las colas." : error}
        </div>
      ) : null}
      {datos && activas === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No hay ninguna cola activa: los chats nuevos van a quedar sin asignar hasta que actives una.
        </div>
      ) : null}

      {!datos && !error ? (
        <Cargando />
      ) : datos ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!datos.colas.length ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No hay colas. Creá la primera con el botón superior.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {datos.colas.map((c) => {
                const nAg = c.agentes.length;
                const sup = c.agentes.filter((a) => a.es_supervisor).map((a) => usuarios.get(a.usuario_id)?.nombre).filter(Boolean);
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 sm:py-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{c.nombre}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.estrategia === "manual" ? "Manual (sin autoasignación)" : "Equitativa"} · prioridad {c.prioridad} · SLA {c.sla_minutos} min · {nAg}{" "}
                        {nAg === 1 ? "asesor" : "asesores"} ·{" "}
                        {c.canales.length ? c.canales.map((id) => canales.get(id)?.nombre ?? "canal").join(", ") : "todos los canales sin cola propia"}
                      </p>
                      {sup.length ? <p className="mt-0.5 text-[11px] text-slate-400">Supervisa: {sup.join(", ")}</p> : null}
                    </div>
                    <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
                      <span className={`text-xs font-bold uppercase ${c.activo ? "text-emerald-700" : "text-slate-400"}`}>{c.activo ? "Activa" : "Inactiva"}</span>
                      <button
                        type="button"
                        onClick={() => setEditando({ id: c.id, cola: aCuerpo(c) })}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] max-sm:min-h-11 max-sm:px-5"
                      >
                        Editar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
      <p className="text-xs text-slate-400">El Monitoreo resume la carga operativa casi en tiempo real.</p>

      {editando && datos ? (
        <EditorCola
          inicial={editando.cola}
          id={editando.id}
          datos={datos}
          onCerrar={() => setEditando(null)}
          onGuardado={(msg) => {
            setEditando(null);
            setAviso(msg);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}

function aCuerpo(c: Cola): CuerpoCola {
  const { id: _id, ...resto } = c;
  void _id;
  return { ...resto, canales: [...c.canales], agentes: c.agentes.map((a) => ({ ...a })) };
}

function EditorCola({
  id,
  inicial,
  datos,
  onCerrar,
  onGuardado,
}: {
  id: string | null;
  inicial: CuerpoCola;
  datos: DatosColas;
  onCerrar: () => void;
  onGuardado: (aviso: string) => void;
}) {
  const [c, setC] = useState<CuerpoCola>(inicial);
  const [agregar, setAgregar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismoActivo = c.mismo_asesor_horas > 0;
  const nombreUsuario = useMemo(() => new Map(datos.usuarios.map((u) => [u.id, u])), [datos]);
  const disponibles = datos.usuarios.filter((u) => !c.agentes.some((a) => a.usuario_id === u.id));

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !guardando && onCerrar();
    window.addEventListener("keydown", k);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = overflow;
    };
  }, [onCerrar, guardando]);

  const set = <K extends keyof CuerpoCola>(k: K, v: CuerpoCola[K]) => setC((x) => ({ ...x, [k]: v }));
  const setAgente = (uid: string, p: Partial<AgenteCola>) =>
    setC((x) => ({ ...x, agentes: x.agentes.map((a) => (a.usuario_id === uid ? { ...a, ...p } : a)) }));
  const sumar = (uids: string[]) =>
    setC((x) => ({
      ...x,
      agentes: [...x.agentes, ...uids.filter((u) => !x.agentes.some((a) => a.usuario_id === u)).map((usuario_id) => ({ usuario_id, recibe_nuevos: true, max_conversaciones: 20, es_supervisor: false }))],
    }));
  const numero = (v: string, def: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? def : Math.trunc(Number(v)));

  const guardar = async () => {
    if (!c.nombre.trim()) return setError("Poné un nombre a la cola.");
    setGuardando(true);
    setError(null);
    try {
      if (id) await guardarCola(id, { ...c, nombre: c.nombre.trim() });
      else await crearCola({ ...c, nombre: c.nombre.trim() });
      onGuardado("Cola guardada correctamente.");
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  };
  const eliminar = async () => {
    if (!id || !window.confirm("¿Eliminar esta cola? Sus asesores se quitan de ella y los chats que estaban en la cola quedan sin cola.")) return;
    setGuardando(true);
    try {
      await borrarCola(id);
      onGuardado("Cola eliminada.");
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  };

  return (
    <CapaModal onClose={() => !guardando && onCerrar()} z="z-[100]" fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex h-[min(90dvh,960px)] ${ALTO_MAX_MODAL} w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#4FAEB2]/15 text-[#2F6E71]">
              <Inbox className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">{id ? "Editar" : "Nueva"}</p>
              <h2 className="text-lg font-semibold text-slate-900">{id ? "Editar cola" : "Nueva cola"}</h2>
              <p className="text-[13px] text-slate-500 max-sm:hidden">
                {id ? "Modificá nombre, canales, estrategia, SLA y asesores de esta cola." : "Definí nombre, canales asociados, estrategia de distribución, SLA y asesores."}
              </p>
            </div>
          </div>
          <button type="button" onClick={onCerrar} disabled={guardando} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/50 px-3 py-4 sm:px-6 sm:py-5">
          {/* Datos generales */}
          <section className={seccion}>
            <h3 className={tituloSeccion}>Datos generales</h3>
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <label className="block">
                <span className={etiqueta}>Nombre</span>
                <input value={c.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={80} placeholder="Ej. Ventas, Soporte técnico" className={campo} autoFocus={!id} />
              </label>
              <label className="block">
                <span className={etiqueta}>Prioridad numérica</span>
                <input type="number" value={c.prioridad} onChange={(e) => set("prioridad", numero(e.target.value, 0))} className={campo} />
                <p className={ayuda}>Mayor número = mayor prioridad al elegir cola.</p>
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={c.activo} onChange={(e) => set("activo", e.target.checked)} className={check} /> Cola activa
            </label>
          </section>

          {/* Estrategia */}
          <section className={seccion}>
            <div>
              <h3 className={tituloSeccion}>Estrategia de distribución</h3>
              <p className={ayuda}>Define cómo se reparten los chats nuevos entre los asesores de esta cola.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ESTRATEGIAS.map((s) => (
                <label key={s.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${c.estrategia === s.id ? "border-[#4FAEB2]/60 bg-[#4FAEB2]/8" : "border-slate-200 hover:border-[#4FAEB2]/40"}`}>
                  <input type="radio" name="estrategia" checked={c.estrategia === s.id} onChange={() => set("estrategia", s.id)} className="mt-0.5 accent-[#4FAEB2]" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{s.label}</span>
                    <span className="block text-[12px] leading-snug text-slate-500">{s.detalle}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Canales */}
          <section className={seccion}>
            <div>
              <h3 className={tituloSeccion}>Canales asociados a esta cola</h3>
              <p className={ayuda}>
                Los chats de esos canales entran a esta cola. Sin canales marcados, la cola atiende cualquier canal que no tenga una cola propia (la de mayor prioridad).
              </p>
            </div>
            {!datos.canales.length ? (
              <p className="text-sm text-slate-500">Todavía no hay canales configurados en la empresa.</p>
            ) : (
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {datos.canales.map((k) => {
                  const marcado = c.canales.includes(k.id);
                  return (
                    <label key={k.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={(e) => set("canales", e.target.checked ? [...c.canales, k.id] : c.canales.filter((x) => x !== k.id))}
                        className={check}
                      />
                      <span className="flex-1 text-sm text-slate-800">
                        {k.nombre} <span className="text-xs text-slate-400">· {k.tipo}{k.activo ? "" : " · inactivo"}</span>
                      </span>
                      {marcado ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Asociado</span> : null}
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              {c.canales.length ? `${c.canales.length} ${c.canales.length === 1 ? "canal asociado" : "canales asociados"}.` : "Ningún canal asociado: atiende los canales sin cola propia."}
            </p>
          </section>

          {/* SLA */}
          <section className={seccion}>
            <div>
              <h3 className={tituloSeccion}>Redistribución por falta de respuesta inicial (SLA)</h3>
              <p className={ayuda}>
                Si el asesor asignado no da la primera respuesta en el plazo, el chat se reasigna automáticamente a otro asesor disponible (se revisa cada minuto),
                hasta el máximo de reasignaciones. Después queda con el último asesor y se ve como vencido en Monitoreo.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={etiqueta}>Plazo (minutos)</span>
                <input type="number" min={1} max={1440} value={c.sla_minutos} onChange={(e) => set("sla_minutos", numero(e.target.value, 5))} className={campo} />
              </label>
              <label className="block">
                <span className={etiqueta}>Máximo de reasignaciones</span>
                <input type="number" min={0} max={20} value={c.max_reasignaciones} onChange={(e) => set("max_reasignaciones", numero(e.target.value, 0))} className={campo} />
                <p className={ayuda}>0 = nunca reasignar (solo se marca vencido).</p>
              </label>
            </div>
          </section>

          {/* Mismo asesor */}
          <section className={seccion}>
            <div>
              <h3 className={tituloSeccion}>Relación del cliente con el mismo asesor</h3>
              <p className={ayuda}>
                Si el cliente vuelve a escribir dentro de la ventana, el chat vuelve al mismo asesor (si está disponible y con lugar). Pasado el plazo, aplica la
                distribución normal de la cola.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={mismoActivo} onChange={(e) => set("mismo_asesor_horas", e.target.checked ? 24 : 0)} className={check} /> Activar ventana de mismo asesor
            </label>
            {mismoActivo ? (
              <label className="block max-w-[12rem]">
                <span className={etiqueta}>Duración (horas)</span>
                <input type="number" min={1} max={720} value={c.mismo_asesor_horas} onChange={(e) => set("mismo_asesor_horas", Math.max(1, numero(e.target.value, 24)))} className={campo} />
              </label>
            ) : null}
          </section>

          {/* Asesores */}
          <section className={seccion}>
            <div>
              <h3 className={tituloSeccion}>Asesores</h3>
              <p className={ayuda}>
                <strong>Recibe nuevos</strong>: entra en la asignación automática. <strong>Máximo</strong>: chats abiertos a la vez antes de dejar de recibir.{" "}
                <strong>Supervisor</strong>: ve el Monitoreo y todas las finalizadas.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="block min-w-[min(14rem,100%)] flex-1">
                <span className={etiqueta}>Agregar usuario</span>
                <Select
                  compacto
                  block
                  etiqueta="Agregar usuario"
                  value={agregar}
                  onChange={setAgregar}
                  options={[["", "Elegir…"], ...disponibles.map((u): [string, string] => [u.id, `${u.nombre} (${u.rol})`])]}
                />
              </div>
              <button
                type="button"
                disabled={!agregar}
                onClick={() => {
                  sumar([agregar]);
                  setAgregar("");
                }}
                className="rounded-xl bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 hover:bg-[#3F8E91] disabled:opacity-50 max-sm:min-h-11"
              >
                Añadir
              </button>
              {disponibles.length > 1 ? (
                <button type="button" onClick={() => sumar(disponibles.map((u) => u.id))} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold max-sm:min-h-11 text-slate-600 hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
                  Añadir todos
                </button>
              ) : null}
            </div>
            {!c.agentes.length ? (
              <p className="text-sm text-slate-500">Sin asesores en esta cola.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <TablaScroll primeraFija>
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-slate-50/80 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Usuario</th>
                      <th className="px-3 py-2 text-center">Recibe nuevos</th>
                      <th className="px-3 py-2 text-left">Máx.</th>
                      <th className="px-3 py-2 text-center">Supervisor</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {c.agentes.map((a) => {
                      const u = nombreUsuario.get(a.usuario_id);
                      return (
                        <tr key={a.usuario_id}>
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{u?.nombre ?? "Usuario inactivo"}</p>
                            {u ? <p className="text-[11px] text-slate-400">{u.rol}</p> : null}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={a.recibe_nuevos} onChange={(e) => setAgente(a.usuario_id, { recibe_nuevos: e.target.checked })} className={check} aria-label="Recibe nuevos" />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={a.max_conversaciones}
                              onChange={(e) => setAgente(a.usuario_id, { max_conversaciones: Math.min(500, Math.max(1, numero(e.target.value, 20))) })}
                              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs tabular-nums max-sm:h-11 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20"
                              aria-label="Máximo de conversaciones"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={a.es_supervisor} onChange={(e) => setAgente(a.usuario_id, { es_supervisor: e.target.checked })} className={check} aria-label="Supervisor" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setC((x) => ({ ...x, agentes: x.agentes.filter((y) => y.usuario_id !== a.usuario_id) }))}
                              className="text-xs font-semibold text-red-600 hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2"
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </TablaScroll>
              </div>
            )}
          </section>
          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {guardando ? <Girando className="h-4 w-4" /> : null} {guardando ? "Guardando…" : "Guardar cola"}
            </button>
            <button
              type="button"
              onClick={onCerrar}
              disabled={guardando}
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]"
            >
              Cancelar
            </button>
          </div>
          {id ? (
            <button
              type="button"
              onClick={() => void eliminar()}
              disabled={guardando}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 shadow-sm hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar cola
            </button>
          ) : null}
        </div>
      </div>
    </CapaModal>
  );
}
