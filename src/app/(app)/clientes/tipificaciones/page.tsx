"use client";

/**
 * Configuración de tipificaciones (portada de /configuracion/tipificaciones del actual).
 * Árbol de 2 niveles: Estados (Solicitud, Reclamo, Consulta…) → Sub-estados, y la ACCIÓN de
 * cada sub-estado: ninguna / ticket de Error / ticket de Cambio / agendar capacitación.
 * Lo edita un ADMIN; el resto lo ve en modo lectura.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { TEAL } from "@/modules/clientes/ui";
import type { EstadoCat } from "@/modules/tipificacion/dominio";

type Nivel = "familia" | "estado";
type Nodo = { id: string; nombre: string; activo: boolean };

/** Acciones que puede disparar un sub-estado al tipificar. */
const ACCIONES: { value: string; label: string }[] = [
  { value: "", label: "Sin acción" },
  { value: "ticket_error", label: "Crea ticket de Error (Soporte)" },
  { value: "ticket_cambio", label: "Crea ticket de Cambio (Soporte)" },
  { value: "capacitacion", label: "Agenda capacitación" },
];
const accionLabel = (v?: string | null) => ACCIONES.find((c) => c.value === (v ?? ""))?.label ?? "Sin acción";

const F_INPUT = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15";
const F_LABEL = "mb-1 block text-xs font-semibold text-slate-600";
const BTN_PRIMARY = "rounded-lg px-3.5 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-50";
const BTN_GHOST = "rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50";
const BTN_DANGER = "rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50";
const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

export default function ConfiguracionTipificacionesPage() {
  const [estados, setEstados] = useState<EstadoCat[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nuevoEstado, setNuevoEstado] = useState("");
  const [nuevoSub, setNuevoSub] = useState<Record<string, string>>({});
  const [nuevoSubAccion, setNuevoSubAccion] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch<{ familias: EstadoCat[]; meta: { can_edit: boolean } }>("/api/tipificaciones");
      setEstados(r.familias);
      setCanEdit(r.meta.can_edit);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function ejecutar(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      invalidar("/api/tipificaciones");
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const crear = (nivel: Nivel, nombre: string, parentId?: string, comportamiento?: string) => {
    const nom = nombre.trim();
    if (!nom) return;
    void ejecutar(() =>
      apiFetch("/api/tipificaciones", {
        method: "POST",
        body: JSON.stringify({ nivel, nombre: nom, parent_id: parentId ?? null, ...(nivel === "estado" ? { comportamiento: comportamiento ?? "" } : {}) }),
      }),
    );
  };
  const patch = (nivel: Nivel, id: string, body: Record<string, unknown>) =>
    void ejecutar(async () => {
      await apiFetch(`/api/tipificaciones/${id}`, { method: "PATCH", body: JSON.stringify({ nivel, ...body }) });
      setEditId(null);
    });
  const eliminar = (nivel: Nivel, id: string, aviso: string) => {
    if (!window.confirm(aviso)) return;
    void ejecutar(() => apiFetch(`/api/tipificaciones/${id}?nivel=${nivel}`, { method: "DELETE" }));
  };

  /** Fila editable (nombre + acciones) de un Estado o Sub-estado. */
  function fila(nivel: Nivel, nodo: Nodo, aviso: string, extra?: React.ReactNode) {
    if (editId === nodo.id) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${F_INPUT} min-w-[200px] flex-1`}
            value={editNombre}
            onChange={(e) => setEditNombre(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") patch(nivel, nodo.id, { nombre: editNombre }); if (e.key === "Escape") setEditId(null); }}
            autoFocus
          />
          <button type="button" className={BTN_PRIMARY} style={{ backgroundColor: TEAL }} onClick={() => patch(nivel, nodo.id, { nombre: editNombre })} disabled={busy || !editNombre.trim()}>Guardar</button>
          <button type="button" className={BTN_GHOST} onClick={() => setEditId(null)}>Cancelar</button>
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm ${nodo.activo ? "text-slate-800" : "text-slate-400 line-through"}`}>{nodo.nombre}</span>
        {!nodo.activo ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Inactivo</span> : null}
        {extra}
        {canEdit ? (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => { setEditId(nodo.id); setEditNombre(nodo.nombre); }}>Editar</button>
            <button type="button" className={BTN_GHOST} onClick={() => patch(nivel, nodo.id, { activo: !nodo.activo })} disabled={busy}>{nodo.activo ? "Desactivar" : "Activar"}</button>
            <button type="button" className={BTN_DANGER} onClick={() => eliminar(nivel, nodo.id, aviso)} disabled={busy}>Eliminar</button>
          </div>
        ) : null}
      </div>
    );
  }

  const agregarSub = (estId: string) => {
    crear("estado", nuevoSub[estId] ?? "", estId, nuevoSubAccion[estId] ?? "");
    setNuevoSub((m) => ({ ...m, [estId]: "" }));
    setNuevoSubAccion((m) => ({ ...m, [estId]: "" }));
  };

  return (
    <div className="max-w-5xl space-y-5 pb-10">
      <div>
        <Link href="/clientes/gestion" className="text-xs text-slate-400 hover:text-slate-600">← Gestión de clientes</Link>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700"><Settings2 className="h-[18px] w-[18px]" /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Gestión de clientes</p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Tipificaciones</h1>
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-[13px] text-slate-500">
          Estados de tipificación (Solicitud, Reclamo, Consulta…) y sus sub-estados. La acción (crear ticket de Soporte o agendar capacitación) vive en el sub-estado. Es el catálogo que se usa al tipificar la gestión de un cliente.
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      {canEdit ? (
        <div className={CARD}>
          <h2 className="text-sm font-semibold text-slate-800">Agregar estado</h2>
          <p className="mt-0.5 text-xs text-slate-500">El estado es el nivel de arriba (Solicitud, Reclamo, Consulta…). Después le cargás sus sub-estados. Lo desactivado no se ofrece al tipificar.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className={F_LABEL} htmlFor="nuevo-estado">Nombre del estado</label>
              <input
                id="nuevo-estado"
                className={F_INPUT}
                value={nuevoEstado}
                onChange={(e) => setNuevoEstado(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { crear("familia", nuevoEstado); setNuevoEstado(""); } }}
                placeholder="Ej: Solicitud, Reclamo, Consulta…"
              />
            </div>
            <button type="button" className={BTN_PRIMARY} style={{ backgroundColor: TEAL }} onClick={() => { crear("familia", nuevoEstado); setNuevoEstado(""); }} disabled={busy || !nuevoEstado.trim()}>
              Agregar estado
            </button>
          </div>
        </div>
      ) : null}

      <div className={CARD}>
        <h2 className="text-sm font-semibold text-slate-800">Estados ({estados.length})</h2>
        {cargando && estados.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : estados.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No hay estados de tipificación todavía.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {estados.map((est) => (
              <div key={est.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="rounded-t-xl border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  {fila("familia", est, `¿Eliminar el estado "${est.nombre}" y todos sus sub-estados?`)}
                </div>
                <div className="space-y-1.5 px-3 py-3 sm:pl-6">
                  {est.subestados.length === 0 ? (
                    <p className="text-xs text-slate-400">Sin sub-estados todavía.</p>
                  ) : (
                    est.subestados.map((s) => (
                      <div key={s.id} className="rounded-lg border border-slate-100 px-2.5 py-2">
                        {fila(
                          "estado",
                          s,
                          `¿Eliminar el sub-estado "${s.nombre}"?`,
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-slate-400">Acción:</span>
                            {canEdit ? (
                              <select
                                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-[var(--brand)] focus:outline-none"
                                value={s.comportamiento ?? ""}
                                onChange={(ev) => patch("estado", s.id, { comportamiento: ev.target.value })}
                                disabled={busy}
                              >
                                {ACCIONES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                              </select>
                            ) : (
                              <span className="text-[11px] text-slate-500">{accionLabel(s.comportamiento)}</span>
                            )}
                          </span>,
                        )}
                      </div>
                    ))
                  )}
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <input
                        className={`${F_INPUT} h-9 min-w-[200px] flex-1`}
                        value={nuevoSub[est.id] ?? ""}
                        onChange={(ev) => setNuevoSub((m) => ({ ...m, [est.id]: ev.target.value }))}
                        onKeyDown={(ev) => { if (ev.key === "Enter") agregarSub(est.id); }}
                        placeholder="Nuevo sub-estado… (ej: Cliente solicita nueva contraseña)"
                      />
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[var(--brand)] focus:outline-none"
                        value={nuevoSubAccion[est.id] ?? ""}
                        onChange={(ev) => setNuevoSubAccion((m) => ({ ...m, [est.id]: ev.target.value }))}
                        title="Acción que dispara este sub-estado"
                      >
                        {ACCIONES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <button type="button" className={BTN_GHOST} onClick={() => agregarSub(est.id)} disabled={busy || !(nuevoSub[est.id] ?? "").trim()}>
                        + Sub-estado
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
