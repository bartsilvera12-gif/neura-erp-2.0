"use client";

/**
 * Agenda de capacitaciones: las citas que se agendan desde la Tipificación del cliente.
 * Próximas / pasadas / todas, filtro por quién la da y por estado, y el cambio de estado
 * (pendiente → confirmada → completada / no asistió / cancelada con motivo).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ClipboardPen, MapPin, RefreshCw, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { TEAL } from "@/modules/clientes/ui";
import { ESTADOS_CITA, estadoCita, fechaHoraPy, isoAFechaLocal } from "@/modules/tipificacion/dominio";

type Cita = {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  responsable_id: string | null;
  responsable_nombre: string | null;
  titulo: string;
  estado: string;
  inicio_at: string;
  fin_at: string;
  ubicacion: string | null;
  observaciones: string | null;
  cancelada_motivo: string | null;
  metadata: { tipificacion_id?: string } | null;
};
type Resp = { citas: Cita[]; equipo: { id: string; nombre: string }[] };

const VISTAS = [
  { id: "proximas", label: "Próximas" },
  { id: "pasadas", label: "Pasadas" },
  { id: "todas", label: "Todas" },
] as const;

const ACCIONES: Record<string, { estado: string; label: string }[]> = {
  pendiente: [{ estado: "confirmada", label: "Confirmar" }, { estado: "completada", label: "Completada" }, { estado: "no_asistio", label: "No asistió" }, { estado: "cancelada", label: "Cancelar" }],
  confirmada: [{ estado: "completada", label: "Completada" }, { estado: "no_asistio", label: "No asistió" }, { estado: "pendiente", label: "Volver a pendiente" }, { estado: "cancelada", label: "Cancelar" }],
  completada: [{ estado: "confirmada", label: "Deshacer" }],
  no_asistio: [{ estado: "confirmada", label: "Deshacer" }],
  cancelada: [{ estado: "pendiente", label: "Reactivar" }],
};

const dia = (iso: string) => {
  const l = isoAFechaLocal(iso);
  if (!l) return "";
  const d = new Date(`${l.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("es-PY", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
};

export default function AgendaPage() {
  const me = useUsuario();
  const [vista, setVista] = useState<(typeof VISTAS)[number]["id"]>("proximas");
  const [responsable, setResponsable] = useState("");
  const [estado, setEstado] = useState("");
  const [datos, setDatos] = useState<Resp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ vista });
      if (responsable) qs.set("responsable", responsable);
      if (estado) qs.set("estado", estado);
      setDatos(await apiFetch<Resp>(`/api/agenda?${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [vista, responsable, estado]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function cambiar(c: Cita, nuevo: string) {
    let motivo: string | null = null;
    if (nuevo === "cancelada") {
      motivo = window.prompt("Motivo de la cancelación:")?.trim() || null;
      if (!motivo) return;
    }
    setOcupado(c.id);
    setError(null);
    try {
      await apiFetch(`/api/agenda/${c.id}`, { method: "PATCH", body: JSON.stringify({ estado: nuevo, motivo }) });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const citas = datos?.citas ?? [];
  const puedeCambiar = (c: Cita) => me?.rol === "ADMIN" || c.responsable_id === me?.usuarioId;
  let diaPrevio = "";

  return (
    <div className="max-w-5xl space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><CalendarClock className="h-[18px] w-[18px]" /></span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Agenda de capacitaciones</h1>
            <p className="text-[13px] text-slate-500">Las capacitaciones agendadas desde la tipificación del cliente.</p>
          </div>
        </div>
        <button type="button" onClick={() => void cargar()} disabled={cargando}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {VISTAS.map((v) => (
            <button key={v.id} type="button" onClick={() => setVista(v.id)}
              className={`rounded-lg px-3 py-1 text-[12.5px] font-semibold transition ${vista === v.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <select value={responsable} onChange={(e) => setResponsable(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700">
          <option value="">Todos los capacitadores</option>
          <option value="yo">Mis capacitaciones</option>
          {(datos?.equipo ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700">
          <option value="">Todos los estados</option>
          {ESTADOS_CITA.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
        </select>
      </div>

      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-700">{error}</p> : null}

      {cargando && !datos ? (
        <p className="py-10 text-center text-sm text-slate-400">Cargando agenda…</p>
      ) : citas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-400">
          No hay capacitaciones {vista === "proximas" ? "próximas" : vista === "pasadas" ? "pasadas" : ""} con estos filtros.
        </div>
      ) : (
        <ol className="space-y-2">
          {citas.map((c) => {
            const d = dia(c.inicio_at);
            const cabecera = d !== diaPrevio ? d : null;
            diaPrevio = d;
            const ce = estadoCita(c.estado);
            const acciones = puedeCambiar(c) ? ACCIONES[c.estado] ?? [] : [];
            return (
              <li key={c.id}>
                {cabecera ? <p className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 first:mt-0">{cabecera}</p> : null}
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold tabular-nums text-slate-800">{fechaHoraPy(c.inicio_at).slice(11)} – {fechaHoraPy(c.fin_at).slice(11)}</span>
                      <span className={`rounded-full px-2 py-px text-[11px] font-bold ${ce.color}`}>{ce.nombre}</span>
                    </div>
                    <p className="mt-0.5 text-[14px] font-semibold text-slate-900">{c.titulo}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-500">
                      <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{c.responsable_nombre ?? "Sin capacitador"}</span>
                      {c.ubicacion ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{c.ubicacion}</span> : null}
                      {c.cliente_id ? (
                        <Link href={`/clientes/${c.cliente_id}/tipificacion${c.metadata?.tipificacion_id ? `#tip-${c.metadata.tipificacion_id}` : ""}`}
                          className="inline-flex items-center gap-1 font-medium hover:underline" style={{ color: TEAL }}>
                          <ClipboardPen className="h-3.5 w-3.5" />{c.cliente_nombre ?? "Cliente"} · Ver tipificación
                        </Link>
                      ) : null}
                    </div>
                    {c.observaciones ? <p className="mt-1.5 whitespace-pre-line text-[12.5px] text-slate-600">{c.observaciones}</p> : null}
                    {c.estado === "cancelada" && c.cancelada_motivo ? <p className="mt-1 text-[12px] text-slate-500"><span className="font-semibold">Motivo:</span> {c.cancelada_motivo}</p> : null}
                  </div>
                  {acciones.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {acciones.map((a) => (
                        <button key={a.estado} type="button" disabled={ocupado === c.id} onClick={() => void cambiar(c, a.estado)}
                          className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition disabled:opacity-50 ${
                            a.estado === "cancelada" ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50" : "border-slate-200 bg-white text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)]"
                          }`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
