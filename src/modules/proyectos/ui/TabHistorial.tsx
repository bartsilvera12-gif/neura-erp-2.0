"use client";

/**
 * Pestaña Historial (HistorialCompacto + HistorialLinea del actual):
 *   · "Tiempo por estado": cuántas horas LABORALES pasó en cada estado (el actual corre)
 *   · "Movimientos": la bitácora agrupada por día (Hoy / Ayer / fecha), con la duración
 *     de cada tramo en los cambios de estado, motivos, ediciones, bloqueos, asignaciones,
 *     tareas y archivos. Orden más recientes / más antiguos primero.
 * Se carga al abrir la pestaña y se refresca sola cuando el proyecto cambia (version).
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Archive, ArchiveRestore, CheckSquare, FilePlus2, FileX2, ListPlus, ListX, Loader2, Lock, LockOpen, Pencil, Sparkles, UserPlus,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { msLaborables } from "@/modules/soporte/dominio";
import { duracion, horasTexto, type Evento, type HorarioLaboral, type Tramo } from "@/modules/proyectos/tipos";
import { PANEL, TituloPanel } from "./comun";
import { useAhora } from "./reloj";

const diaPY = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: TZ_PY }) : "";
};
const horaPY = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { timeZone: TZ_PY, hour: "2-digit", minute: "2-digit", hour12: false });

function etiquetaDia(clave: string): string {
  const hoy = diaPY(new Date().toISOString());
  const ayer = diaPY(new Date(Date.now() - 86_400_000).toISOString());
  if (clave === hoy) return "Hoy";
  if (clave === ayer) return "Ayer";
  const [y, m, d] = clave.split("-").map(Number);
  if (!y) return clave;
  const s = new Intl.DateTimeFormat("es-PY", { timeZone: TZ_PY, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Vista = { icono: React.ReactNode; tono: string; titulo: string; cuerpo: React.ReactNode };

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function vistaEvento(e: Evento, tramo: Tramo | undefined, ahora: number, horario: HorarioLaboral): Vista {
  const d = e.detalle ?? {};
  switch (e.tipo) {
    case "creado":
      return { icono: <Sparkles className="h-3.5 w-3.5" />, tono: "bg-[var(--brand)]/12 text-[var(--brand-600)]", titulo: "Proyecto creado", cuerpo: s(d.numero) ? <span className="font-mono text-xs text-slate-500">{s(d.numero)}</span> : null };
    case "cambio_estado": {
      const actual = tramo && !tramo.exited_at;
      const lab = tramo ? (actual ? (msLaborables(tramo.entered_at, new Date(ahora || Date.now()).toISOString(), horario) ?? 0) : (tramo.horas_laborales ?? 0) * 3_600_000) : null;
      return {
        icono: <ArrowRight className="h-3.5 w-3.5" />,
        tono: "bg-sky-100 text-sky-700",
        titulo: "Cambio de estado",
        cuerpo: (
          <>
            <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <span className="text-slate-500">{s(d.de) || "—"}</span>
              <span aria-hidden className="text-slate-300">→</span>
              <span className="font-semibold text-slate-900">{s(d.a) || "—"}</span>
            </p>
            {s(d.motivo) ? <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800"><span className="font-semibold">Motivo:</span> {s(d.motivo)}</p> : null}
            {lab != null ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {actual ? <>Lleva <strong className="text-slate-700">{duracion(lab)}</strong> laborales en este estado</> : (
                  <>Estuvo <strong className="text-slate-700">{duracion(lab)}</strong> laborales{tramo?.horas_totales != null ? <> ({horasTexto(tramo.horas_totales)} corridas)</> : null}</>
                )}
              </p>
            ) : null}
          </>
        ),
      };
    }
    case "editado": {
      const cambios = Array.isArray(d.cambios) ? (d.cambios as { campo: string; de: string; a: string }[]) : [];
      return {
        icono: <Pencil className="h-3.5 w-3.5" />,
        tono: "bg-slate-100 text-slate-600",
        titulo: "Datos editados",
        cuerpo: (
          <ul className="space-y-0.5 text-[12px] text-slate-600">
            {cambios.map((c, i) => (
              <li key={i}><span className="font-medium text-slate-700">{c.campo}:</span> <span className="text-slate-400">{c.de}</span> → <span className="text-slate-800">{c.a}</span></li>
            ))}
          </ul>
        ),
      };
    }
    case "asignacion":
      return {
        icono: <UserPlus className="h-3.5 w-3.5" />,
        tono: "bg-amber-100 text-amber-700",
        titulo: `Asignación · ${s(d.rol)}`,
        cuerpo: <p className="flex flex-wrap items-center gap-1.5 text-[13px]"><span className="text-slate-500">{s(d.de)}</span><span className="text-slate-300">→</span><span className="font-semibold text-slate-900">{s(d.a)}</span></p>,
      };
    case "bloqueo":
    case "bloqueo_editado":
      return {
        icono: <Lock className="h-3.5 w-3.5" />,
        tono: "bg-rose-100 text-rose-700",
        titulo: e.tipo === "bloqueo" ? "Proyecto bloqueado" : "Bloqueo actualizado",
        cuerpo: (
          <div className="space-y-0.5 text-[12px] text-slate-600">
            {s(d.motivo) ? <p><span className="font-medium text-slate-700">Motivo:</span> {s(d.motivo)}</p> : null}
            {s(d.tipo) ? <p><span className="font-medium text-slate-700">Tipo:</span> {s(d.tipo)}</p> : null}
            {s(d.responsable) ? <p><span className="font-medium text-slate-700">Destraba:</span> {s(d.responsable)}</p> : null}
            {s(d.proxima_accion) ? <p><span className="font-medium text-slate-700">Próxima acción:</span> {s(d.proxima_accion)}</p> : null}
          </div>
        ),
      };
    case "desbloqueo":
      return { icono: <LockOpen className="h-3.5 w-3.5" />, tono: "bg-emerald-100 text-emerald-700", titulo: "Bloqueo levantado", cuerpo: s(d.motivo_anterior) ? <p className="text-[12px] text-slate-500">Era: {s(d.motivo_anterior)}</p> : null };
    case "archivado":
      return { icono: <Archive className="h-3.5 w-3.5" />, tono: "bg-slate-100 text-slate-600", titulo: "Proyecto archivado", cuerpo: null };
    case "desarchivado":
      return { icono: <ArchiveRestore className="h-3.5 w-3.5" />, tono: "bg-slate-100 text-slate-600", titulo: "Proyecto desarchivado", cuerpo: null };
    case "tarea_creada":
      return { icono: <ListPlus className="h-3.5 w-3.5" />, tono: "bg-violet-100 text-violet-700", titulo: "Tarea agregada", cuerpo: <p className="text-[13px] text-slate-700">{s(d.titulo)}</p> };
    case "tarea_estado":
      return { icono: <CheckSquare className="h-3.5 w-3.5" />, tono: "bg-violet-100 text-violet-700", titulo: "Tarea actualizada", cuerpo: <p className="text-[13px] text-slate-700">{s(d.titulo)} · <span className="text-slate-400">{s(d.de)}</span> → <span className="font-semibold">{s(d.a)}</span></p> };
    case "tarea_eliminada":
      return { icono: <ListX className="h-3.5 w-3.5" />, tono: "bg-slate-100 text-slate-600", titulo: "Tarea eliminada", cuerpo: <p className="text-[13px] text-slate-500 line-through">{s(d.titulo)}</p> };
    case "archivo_subido":
      return { icono: <FilePlus2 className="h-3.5 w-3.5" />, tono: "bg-sky-100 text-sky-700", titulo: d.en_comentario ? "Adjunto en un comentario" : "Archivo subido", cuerpo: <p className="text-[13px] text-slate-700">{s(d.nombre)}</p> };
    case "archivo_eliminado":
      return { icono: <FileX2 className="h-3.5 w-3.5" />, tono: "bg-slate-100 text-slate-600", titulo: "Archivo eliminado", cuerpo: <p className="text-[13px] text-slate-500 line-through">{s(d.nombre)}</p> };
    default:
      return { icono: <Pencil className="h-3.5 w-3.5" />, tono: "bg-slate-100 text-slate-600", titulo: e.tipo, cuerpo: null };
  }
}

export function TabHistorial({ proyectoId, version, horario }: { proyectoId: string; version: number; horario: HorarioLaboral }) {
  const [data, setData] = useState<{ tramos: Tramo[]; eventos: Evento[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<"desc" | "asc">("desc");
  const ahora = useAhora();

  useEffect(() => {
    let vivo = true;
    apiFetch<{ tramos: Tramo[]; eventos: Evento[] }>(`/api/proyectos/${proyectoId}/historial`)
      .then((r) => vivo && setData(r))
      .catch((e) => vivo && setError((e as Error).message));
    return () => { vivo = false; };
  }, [proyectoId, version]);

  // Tiempo por estado (horas laborales), el tramo abierto corriendo.
  const porEstado = useMemo(() => {
    const m = new Map<string, { nombre: string; color: string; ms: number; veces: number; actual: boolean; cuenta: boolean }>();
    for (const t of data?.tramos ?? []) {
      const ms = t.exited_at ? (t.horas_laborales ?? 0) * 3_600_000 : (msLaborables(t.entered_at, new Date(ahora || Date.now()).toISOString(), horario) ?? 0);
      const x = m.get(t.estado_id) ?? { nombre: t.estado_nombre, color: t.estado_color, ms: 0, veces: 0, actual: false, cuenta: t.tipo_sla_snapshot === "interno" };
      x.ms += ms;
      x.veces += 1;
      if (!t.exited_at) x.actual = true;
      m.set(t.estado_id, x);
    }
    return [...m.values()];
  }, [data?.tramos, ahora, horario]);
  const maxMs = Math.max(1, ...porEstado.map((x) => x.ms));

  // Cada cambio de estado con el tramo que abrió (mismo estado, entrada a segundos del evento).
  const tramoDe = useMemo(() => {
    const m = new Map<number, Tramo>();
    const tramos = data?.tramos ?? [];
    for (const e of data?.eventos ?? []) {
      if (e.tipo !== "cambio_estado") continue;
      const t0 = Date.parse(e.created_at);
      const a = s(e.detalle?.a);
      const t = tramos.find((x) => x.estado_nombre === a && Math.abs(Date.parse(x.entered_at) - t0) < 15_000)
        ?? tramos.find((x) => Math.abs(Date.parse(x.entered_at) - t0) < 15_000);
      if (t) m.set(e.id, t);
    }
    return m;
  }, [data]);

  const porDia = useMemo(() => {
    const signo = orden === "desc" ? -1 : 1;
    const m = new Map<string, Evento[]>();
    for (const e of data?.eventos ?? []) {
      const k = diaPY(e.created_at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const arr of m.values()) arr.sort((a, b) => signo * (Date.parse(a.created_at) - Date.parse(b.created_at)));
    return [...m.entries()].sort(([a], [b]) => (a < b ? -signo : a > b ? signo : 0));
  }, [data?.eventos, orden]);

  if (!data) {
    return (
      <div className={PANEL}>
        {error ? <p className="text-sm text-rose-600">{error}</p> : <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando historial…</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={PANEL}>
        <TituloPanel>Tiempo por estado</TituloPanel>
        <p className="mt-1 text-[11px] text-slate-400">Horas laborales (horario de la empresa) que el proyecto pasó en cada estado.</p>
        {porEstado.length ? (
          <ul className="mt-4 space-y-2.5">
            {porEstado.map((x) => (
              <li key={x.nombre} className="grid grid-cols-[150px_1fr_auto] items-center gap-3 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.color }} />
                  <span className="truncate font-medium text-slate-700">{x.nombre}</span>
                  {x.actual ? <span className="shrink-0 rounded-full bg-[var(--brand)]/10 px-1.5 text-[9px] font-bold uppercase text-[var(--brand-600)]">Actual</span> : null}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.round((x.ms / maxMs) * 100))}%`, background: x.color, opacity: x.cuenta ? 1 : 0.45 }} />
                </span>
                <span className="text-right tabular-nums text-slate-600">
                  {duracion(x.ms)}{x.veces > 1 ? <span className="text-slate-400"> · {x.veces} veces</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-slate-400">Sin tramos todavía.</p>}
      </div>

      <div className={PANEL}>
        <TituloPanel extra={
          <button type="button" onClick={() => setOrden((o) => (o === "desc" ? "asc" : "desc"))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand-600)]">
            {orden === "desc" ? "Más recientes primero" : "Más antiguos primero"}
          </button>
        }>Movimientos</TituloPanel>
        {porDia.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Sin historial todavía</p>
            <p className="mt-1 text-xs text-slate-500">Acá van a aparecer los cambios de estado y las ediciones del proyecto.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {porDia.map(([dia, eventos]) => (
              <section key={dia}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{etiquetaDia(dia)}</h3>
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] text-slate-400">{eventos.length} {eventos.length === 1 ? "movimiento" : "movimientos"}</span>
                </div>
                <ol className="space-y-2">
                  {eventos.map((e) => {
                    const v = vistaEvento(e, tramoDe.get(e.id), ahora, horario);
                    return (
                      <li key={e.id} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-start gap-3">
                          <span aria-hidden className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${v.tono}`}>{v.icono}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-500">{v.titulo}</p>
                              <p className="text-[11px] tabular-nums text-slate-400">{horaPY(e.created_at)} · {e.usuario_nombre ?? "Sistema"}</p>
                            </div>
                            {v.cuerpo ? <div className="mt-0.5">{v.cuerpo}</div> : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
