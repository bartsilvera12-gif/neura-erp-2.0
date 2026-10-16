"use client";

/**
 * Pestaña Tareas: checklist simple del proyecto (en el actual estaba oculta; acá se ve).
 * Cada tarea con estado, asignado y fecha límite. Se carga recién al abrir la pestaña;
 * los cambios son optimistas (si la base falla, se revierte).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ListTodo, Loader2, Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { ESTADOS_TAREA, ESTADO_TAREA_LABEL, ESTADO_TAREA_TONO, fechaCorta, type EstadoTarea, type Tarea } from "@/modules/proyectos/tipos";
import { INPUT, PANEL, TituloPanel, useUsuarios } from "./comun";
import { SelectorFecha } from "@/components/SelectorFecha";

export function TabTareas({ proyectoId, puedeEditar, onConteo }: {
  proyectoId: string;
  puedeEditar: boolean;
  onConteo: (total: number, hechas: number) => void;
}) {
  const me = useUsuario();
  const usuarios = useUsuarios();
  const [tareas, setTareas] = useState<Tarea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [asignado, setAsignado] = useState("");
  const [limite, setLimite] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiFetch<Tarea[]>(`/api/proyectos/${proyectoId}/tareas`)
      .then((t) => vivo && setTareas(t))
      .catch((e) => vivo && setError((e as Error).message));
    return () => { vivo = false; };
  }, [proyectoId]);

  const publicar = useCallback((lista: Tarea[]) => {
    setTareas(lista);
    onConteo(lista.length, lista.filter((t) => t.estado === "completada").length);
  }, [onConteo]);

  const opciones = useMemo<[string, string][]>(() => [["", "Sin asignar"], ...usuarios.map((u) => [u.id, u.nombre] as [string, string])], [usuarios]);
  const nombreDe = (id: string | null) => (id ? (usuarios.find((u) => u.id === id)?.nombre ?? null) : null);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || creando || !tareas) return;
    setCreando(true);
    setError(null);
    try {
      const t = await apiFetch<Tarea>(`/api/proyectos/${proyectoId}/tareas`, {
        method: "POST",
        body: JSON.stringify({ titulo: titulo.trim(), asignado_id: asignado || null, fecha_limite: limite || null }),
      });
      publicar([...tareas, t]);
      setTitulo("");
      setLimite("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function cambiar(t: Tarea, patch: Partial<Pick<Tarea, "estado" | "asignado_id" | "fecha_limite" | "titulo">>) {
    if (!tareas) return;
    const antes = tareas;
    const optimista = { ...t, ...patch, ...(patch.asignado_id !== undefined ? { asignado_nombre: nombreDe(patch.asignado_id) } : {}) };
    publicar(tareas.map((x) => (x.id === t.id ? optimista : x)));
    setError(null);
    try {
      const r = await apiFetch<Tarea>(`/api/proyectos/${proyectoId}/tareas/${t.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setTareas((prev) => (prev ? prev.map((x) => (x.id === t.id ? r : x)) : prev));
    } catch (err) {
      publicar(antes);
      setError((err as Error).message);
    }
  }

  async function borrar(t: Tarea) {
    if (!tareas) return;
    const antes = tareas;
    publicar(tareas.filter((x) => x.id !== t.id));
    try {
      await apiFetch(`/api/proyectos/${proyectoId}/tareas/${t.id}`, { method: "DELETE" });
    } catch (err) {
      publicar(antes);
      setError((err as Error).message);
    }
  }

  const hechas = tareas?.filter((t) => t.estado === "completada").length ?? 0;
  const total = tareas?.length ?? 0;
  const hoy = hoyPY();

  return (
    <div className={`space-y-4 ${PANEL}`}>
      <TituloPanel extra={total ? <span className="text-xs tabular-nums text-slate-500">{hechas} de {total} completadas</span> : null}>Tareas</TituloPanel>
      {total ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${Math.round((hechas / total) * 100)}%` }} />
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">{error}</div> : null}

      {puedeEditar ? (
        <form onSubmit={crear} className="grid gap-2 rounded-xl border border-[var(--brand)]/25 bg-gradient-to-br from-[var(--brand)]/[0.05] to-white p-3 sm:grid-cols-[1fr_200px_160px_auto]">
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={300} placeholder="Nueva tarea…" className={INPUT} />
          <Select block value={asignado} onChange={setAsignado} options={opciones} />
          <SelectorFecha block etiqueta="Fecha límite" placeholder="Fecha límite" value={limite} onChange={setLimite} />
          <button type="submit" disabled={!titulo.trim() || creando}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Agregar
          </button>
        </form>
      ) : null}

      {tareas === null ? (
        error ? null : <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando tareas…</div>
      ) : tareas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          <ListTodo className="h-6 w-6 text-slate-300" />
          Todavía no hay tareas.{puedeEditar ? " Agregá la primera arriba." : ""}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {tareas.map((t) => {
            const mia = !!me?.usuarioId && t.asignado_id === me.usuarioId;
            const puedeEstado = puedeEditar || mia;
            const hecha = t.estado === "completada";
            const vencida = !!t.fecha_limite && !hecha && t.fecha_limite < hoy;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  disabled={!puedeEstado}
                  onClick={() => void cambiar(t, { estado: hecha ? "pendiente" : "completada" })}
                  aria-label={hecha ? "Marcar como pendiente" : "Marcar como completada"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed ${hecha ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white hover:border-[var(--brand)]"}`}
                >
                  {hecha ? <Check className="h-3.5 w-3.5" /> : null}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`break-words text-sm ${hecha ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.titulo}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>{t.asignado_nombre ?? "Sin asignar"}</span>
                    {t.fecha_limite ? (
                      <span className={`inline-flex items-center gap-1 ${vencida ? "font-semibold text-rose-600" : ""}`}>
                        <CalendarDays className="h-3 w-3" /> {fechaCorta(t.fecha_limite)}{vencida ? " · vencida" : ""}
                      </span>
                    ) : null}
                  </p>
                </div>
                {puedeEstado ? (
                  <Select value={t.estado} onChange={(v) => void cambiar(t, { estado: v as EstadoTarea })} minWidth={140}
                    options={ESTADOS_TAREA.map((e) => [e, ESTADO_TAREA_LABEL[e]] as [string, string])} className="[&>button]:py-1.5 [&>button]:text-xs" />
                ) : (
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ESTADO_TAREA_TONO[t.estado]}`}>{ESTADO_TAREA_LABEL[t.estado]}</span>
                )}
                {puedeEditar ? (
                  <>
                    <Select value={t.asignado_id ?? ""} onChange={(v) => void cambiar(t, { asignado_id: v || null })} options={opciones} minWidth={160} className="[&>button]:py-1.5 [&>button]:text-xs" />
                    <SelectorFecha compacto etiqueta="Fecha límite" value={t.fecha_limite ?? ""} onChange={(v) => void cambiar(t, { fecha_limite: v || null })}
                      claseBoton="rounded-xl px-2.5 py-1.5 text-xs text-slate-700" />
                    <button type="button" onClick={() => void borrar(t)} aria-label="Eliminar tarea" title="Eliminar"
                      className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
