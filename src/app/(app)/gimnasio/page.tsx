"use client";

/**
 * /gimnasio — Recepción del gimnasio (receta 150).
 *   · Arriba se busca al alumno: su card de Asistencia (al día o debe, membresía, próximas clases,
 *     entrada libre y cobrar).
 *   · Las clases del día, cada una con su profesor, cupo y alumnos: Llegó → Culminó (o No vino).
 *     "Anotar" suma un alumno (respeta el cupo). Los días se mueven con las flechas.
 *   · Turno individual: una cita con un alumno y un profesor (también aparece en la Agenda).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Dumbbell, Loader2, Plus, Settings2, UserPlus, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import { ClienteSelect, type ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import { AccionesAsistencia, ChipEstado, PanelAlumno } from "@/modules/gimnasio/ui";
import { hora, type ClaseDia, type Dia } from "@/modules/gimnasio/tipos";

const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const fechaLarga = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" });

function Anotar({ clase, onHecho }: { clase: ClaseDia; onHecho: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const lleno = clase.cupo !== null && clase.ocupados >= clase.cupo;
  async function elegir(c: ClienteOpcion | null) {
    if (!c) return;
    setOcupado(true); setError(null);
    try {
      await apiFetch("/api/gimnasio/anotar", { method: "POST", body: JSON.stringify({ cita_id: clase.cita_id, cliente_id: c.id }) });
      setAbierto(false); onHecho();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  if (clase.individual) return null;
  return (
    <div className="space-y-1.5">
      {abierto ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><ClienteSelect valor={null} onChange={(c) => void elegir(c)} /></div>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
          <button type="button" onClick={() => { setAbierto(false); setError(null); }} className="text-xs font-medium text-slate-500 hover:text-slate-800">Cerrar</button>
        </div>
      ) : (
        <button type="button" disabled={lleno} onClick={() => setAbierto(true)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[var(--brand)] transition hover:bg-[var(--brand-50,#eef7f7)] disabled:text-slate-400 disabled:hover:bg-transparent">
          <UserPlus className="h-4 w-4" /> {lleno ? "Clase llena" : "Anotar alumno"}
        </button>
      )}
      {error ? <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function TarjetaClase({ c, onHecho, onVerAlumno }: { c: ClaseDia; onHecho: () => void; onVerAlumno: (id: string, nombre: string) => void }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <span className="block text-xs font-semibold tabular-nums text-[var(--brand)]">{hora(c.inicio_at)} – {hora(c.fin_at)}</span>
          <span className="block truncate text-[15px] font-semibold text-slate-900">{c.titulo}</span>
          <span className="block text-xs text-slate-500">{[c.individual ? "Turno individual" : null, c.profesor ?? "Sin profesor", c.ubicacion].filter(Boolean).join(" · ")}</span>
        </div>
        {!c.individual ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${c.cupo !== null && c.ocupados >= c.cupo ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
            <Users className="h-3.5 w-3.5" /> {c.ocupados}{c.cupo !== null ? ` / ${c.cupo}` : ""}
          </span>
        ) : null}
      </div>
      <ul className="m-0 list-none divide-y divide-slate-100 p-0 px-4">
        {c.alumnos.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => onVerAlumno(a.cliente_id, a.cliente)} className="flex min-w-0 items-center gap-2 text-left">
              <span className="truncate text-sm font-medium text-slate-800 hover:text-[var(--brand)]">{a.cliente}</span>
              <ChipEstado estado={a.estado} />
              {a.bloqueado ? <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">Debe</span> : null}
            </button>
            <AccionesAsistencia a={a} onHecho={onHecho} />
          </li>
        ))}
        {!c.alumnos.length ? <li className="py-3 text-sm text-slate-400">Nadie anotado todavía.</li> : null}
      </ul>
      <div className="border-t border-slate-100 px-2 py-1"><Anotar clase={c} onHecho={onHecho} /></div>
    </li>
  );
}

function ModalTurno({ fecha, onCerrar, onHecho }: { fecha: string; onCerrar: () => void; onHecho: () => void }) {
  const [alumno, setAlumno] = useState<ClienteOpcion | null>(null);
  const [profes, setProfes] = useState<[string, string][]>([]);
  const [profe, setProfe] = useState("");
  const [dia, setDia] = useState(fecha);
  const [h, setH] = useState("08:00");
  const [dur, setDur] = useState("60");
  const [titulo, setTitulo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    apiFetch<{ responsables: { id: string; nombre: string | null }[]; yo: string }>("/api/agenda/options")
      .then((r) => { setProfes(r.responsables.map((u) => [u.id, u.nombre ?? "Sin nombre"])); setProfe((p) => p || r.yo); })
      .catch(() => setProfes([]));
  }, []);
  async function guardar() {
    if (!alumno || !profe) { setError("Elegí el alumno y el profesor"); return; }
    setOcupado(true); setError(null);
    try {
      // La hora es de Paraguay (UTC-3).
      await apiFetch("/api/gimnasio/turno", { method: "POST", body: JSON.stringify({ cliente_id: alumno.id, profesor_id: profe, inicio_at: `${dia}T${h}:00-03:00`, duracion_min: Number(dur) || 60, titulo: titulo.trim() || undefined }) });
      onHecho(); onCerrar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <ModalDocumento titulo="Turno individual" subtitulo="Un alumno con su profesor (por ejemplo, personal trainer). También queda en la Agenda." ancho="max-w-lg" onClose={onCerrar}
      footer={<>
        <button type="button" onClick={onCerrar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" disabled={ocupado} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11 max-sm:flex-1`}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Crear turno</button>
      </>}>
      <div className="space-y-3">
        <label className="block"><span className={ET}>Alumno *</span><ClienteSelect valor={alumno} onChange={setAlumno} /></label>
        <div><span className={ET}>Profesor *</span><Select value={profe} onChange={setProfe} options={[["", "Elegí el profesor"], ...profes]} etiqueta="Profesor" block /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="col-span-2 block sm:col-span-1"><span className={ET}>Día *</span><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className={ET}>Hora *</span><input type="time" value={h} onChange={(e) => setH(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className={ET}>Minutos *</span><input type="number" min={5} max={600} step={5} value={dur} onChange={(e) => setDur(e.target.value)} className={INPUT} /></label>
        </div>
        <label className="block"><span className={ET}>Qué se hace</span><input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Ej. Personal trainer, clase de prueba" className={INPUT} /></label>
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </div>
    </ModalDocumento>
  );
}

export default function RecepcionGimnasio() {
  const [fecha, setFecha] = useState(hoyPY());
  const [dia, setDia] = useState<Dia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alumno, setAlumno] = useState<ClienteOpcion | null>(null);
  const [recargaAlumno, setRecargaAlumno] = useState(0);
  const [turno, setTurno] = useState(false);
  const puedeAdministrar = usePermiso("gimnasio_administrar");

  const cargar = useCallback(() => {
    apiFetch<Dia>(`/api/gimnasio/dia?fecha=${fecha}`).then((d) => { setDia(d); setError(null); }).catch((e: Error) => setError(e.message));
  }, [fecha]);
  useEffect(() => { setDia(null); cargar(); }, [cargar]);
  const hecho = useCallback(() => { cargar(); setRecargaAlumno((n) => n + 1); }, [cargar]);
  const verAlumno = (id: string, nombre: string) => { setAlumno({ id, nombre }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const esHoy = fecha === hoyPY();

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Gimnasio" titulo="Recepción" subtitulo="Buscá al alumno para ver si está al día, o marcá la asistencia en cada clase."
        acciones={
          <div className="grid grid-cols-2 gap-2 max-sm:w-full sm:flex">
            <button type="button" onClick={() => setTurno(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}><CalendarClock className="h-4 w-4" /> Turno individual</button>
            <Link href="/gimnasio/clases" className={`${BOTON_SECUNDARIO} no-underline max-sm:min-h-11`}>{puedeAdministrar ? <Settings2 className="h-4 w-4" /> : <Dumbbell className="h-4 w-4" />} Clases</Link>
          </div>
        } />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3 lg:sticky lg:top-4">
          <div>
            <span className={ET}>Alumno</span>
            <ClienteSelect valor={alumno} onChange={setAlumno} />
          </div>
          {alumno ? <PanelAlumno key={alumno.id} clienteId={alumno.id} compacto recarga={recargaAlumno} onCambio={cargar} /> : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Users className="h-5 w-5" /></span>
              <p className="text-sm text-slate-500">Buscá por nombre, CI o teléfono para ver su membresía, si debe y marcar su entrada.</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button type="button" aria-label="Día anterior" onClick={() => setFecha((f) => sumarDias(f, -1))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-[var(--brand)] sm:h-10 sm:w-10"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-0 text-center">
              <span className="block truncate text-sm font-semibold capitalize text-slate-900">{esHoy ? "Hoy, " : ""}{fechaLarga(fecha)}</span>
              {!esHoy ? <button type="button" onClick={() => setFecha(hoyPY())} className="text-xs font-medium text-[var(--brand)]">Volver a hoy</button> : null}
            </div>
            <button type="button" aria-label="Día siguiente" onClick={() => setFecha((f) => sumarDias(f, 1))} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-[var(--brand)] sm:h-10 sm:w-10"><ChevronRight className="h-4 w-4" /></button>
          </div>

          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {!dia && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
          {dia ? (
            <>
              {dia.clases.length ? (
                <ul className="m-0 grid list-none gap-3 p-0 xl:grid-cols-2">
                  {dia.clases.map((c) => <TarjetaClase key={c.cita_id} c={c} onHecho={hecho} onVerAlumno={verAlumno} />)}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Dumbbell className="h-6 w-6" /></span>
                  <p className="text-sm font-semibold text-slate-800">No hay clases este día</p>
                  <p className="max-w-sm text-sm text-slate-500">Las clases se arman en Clases con sus días, hora, profesor y cupo, y aparecen solas cada semana.</p>
                  {puedeAdministrar ? <Link href="/gimnasio/clases" className={`${BOTON_PRIMARIO} bg-[var(--brand)] no-underline`}><Plus className="h-4 w-4" /> Crear una clase</Link> : null}
                </div>
              )}
              {dia.libres.length ? (
                <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">Entradas libres ({dia.libres.length})</h2>
                  <ul className="m-0 list-none divide-y divide-slate-100 p-0">
                    {dia.libres.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                        <button type="button" onClick={() => verAlumno(a.cliente_id, a.cliente)} className="min-w-0 truncate text-left text-sm font-medium text-slate-800 hover:text-[var(--brand)]">{a.cliente}</button>
                        <span className="shrink-0 text-xs text-slate-500">{hora(a.llegada_at)}{a.cubierta ? " · Membresía" : a.venta_id ? " · Clase suelta" : ""}{a.forzada ? " · Con deuda" : ""}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {turno ? <ModalTurno fecha={fecha} onCerrar={() => setTurno(false)} onHecho={hecho} /> : null}
    </div>
  );
}
