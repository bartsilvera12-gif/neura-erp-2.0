"use client";

/**
 * Lo que ve el alumno con SU link (recetas 155 y 156): sin CI ni PIN. Arriba cuántas clases le quedan,
 * los días en una tira (Hoy, Vie 6, Sáb 7…) y abajo solo las clases del día elegido, una fila por clase
 * con un solo botón: Marcar (el día de la clase, desde 1 hora antes, esté donde esté), Reservar o
 * Cancelar; un tilde si ya asistió. "Vengo sin clase" marca la entrada libre de hoy.
 * Con una cuota vencida puede reservar pero no marcar.
 * El link queda guardado en el celular para que el QR viejo de la entrada lo lleve acá.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, DoorOpen, Loader2 } from "lucide-react";
import { CLAVE_LINK } from "./clave";

type Clase = {
  cita_id: string; titulo: string; inicio_at: string; fin_at: string; fecha: string; profesor: string | null; ubicacion: string | null;
  grupal: boolean; estado: string | null; lugares: number | null; puede_reservar: boolean; puede_cancelar: boolean; puede_marcar: boolean;
};
type Alumno = { nombre: string; bloqueado: boolean; membresia: { plan: string; clases_mes: number | null; usadas: number } | null; entrada_libre_hoy: boolean; clases: Clase[] };
type Hecho = { accion: "reservar" | "cancelar" | "marcar"; clase: string; inicio_at?: string; cubierta?: boolean; valor?: number | null };
type Accion = "reservar" | "cancelar" | "marcar" | "libre";

const TZ = "America/Asuncion";
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const fechaPY = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** "Hoy", "Mañana" o "jueves 12". */
function nombreDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "hoy";
  const man = new Date(`${hoy}T12:00:00`);
  man.setDate(man.getDate() + 1);
  if (fecha === man.toISOString().slice(0, 10)) return "mañana";
  return new Date(`${fecha}T12:00:00`).toLocaleDateString("es-PY", { weekday: "long", day: "numeric" });
}

/** El chip de la tira: "Hoy", "Vie 6". */
function chip(fecha: string, hoy: string): string {
  if (fecha === hoy) return "Hoy";
  const d = new Date(`${fecha}T12:00:00`);
  const t = d.toLocaleDateString("es-PY", { weekday: "short" }).replace(".", "");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} ${d.getDate()}`;
}

async function llamar<T>(token: string, cuerpo: object): Promise<T> {
  const r = await fetch(`/api/publico/asistencia/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? "No se pudo conectar. Probá de nuevo.");
  return j.data as T;
}

function mensaje(h: Hecho, hoy: string): { titulo: string; detalle: string } {
  if (h.accion === "reservar") {
    return { titulo: `Reservaste ${h.clase}`, detalle: h.inicio_at ? `Para ${nombreDia(fechaPY(new Date(h.inicio_at)), hoy)} a las ${hora(h.inicio_at)}.` : "" };
  }
  if (h.accion === "cancelar") return { titulo: `Cancelaste ${h.clase}`, detalle: "Tu lugar quedó libre." };
  return { titulo: `Marcaste ${h.clase}`, detalle: h.cubierta ? "Se descontó de tu membresía." : h.valor ? `Clase suelta: ${gs(h.valor)}, pagala en recepción.` : "" };
}

export function MiAsistencia({ token, empresa, color }: { token: string; empresa: string; color: string }) {
  const estilo = { ["--brand" as string]: color, ["--brand-100" as string]: `color-mix(in srgb, ${color} 14%, white)` } as React.CSSProperties;
  const [alumno, setAlumno] = useState<Alumno | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dia, setDia] = useState<string | null>(null);

  const cargar = useCallback(() => {
    llamar<{ alumno: Alumno }>(token, { accion: "ver" }).then((d) => { setAlumno(d.alumno); setError(null); }).catch((x: Error) => setError(x.message));
  }, [token]);
  useEffect(() => {
    cargar();
    try { localStorage.setItem(CLAVE_LINK, token); } catch { /* sin almacenamiento */ }
    const alVolver = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar, token]);

  async function hacer(accion: Accion, citaId?: string) {
    setOcupado(`${accion}|${citaId ?? ""}`); setError(null); setHecho(null);
    try {
      const d = await llamar<{ hecho: Hecho; alumno: Alumno }>(token, accion === "libre" ? { accion } : { accion, cita_id: citaId });
      setAlumno(d.alumno); setHecho(d.hecho);
    } catch (x) { setError((x as Error).message); } finally { setOcupado(null); }
  }

  const hoy = fechaPY(new Date());
  const dias = new Map<string, Clase[]>([[hoy, []]]);
  for (const c of alumno?.clases ?? []) dias.set(c.fecha, [...(dias.get(c.fecha) ?? []), c]);
  const orden = [...dias.keys()].sort();
  const elegido = dia && dias.has(dia) ? dia : hoy;
  const clases = dias.get(elegido) ?? [];
  const esHoy = elegido === hoy;
  const msj = hecho ? mensaje(hecho, hoy) : null;
  const m = alumno?.membresia;
  const quedan = m?.clases_mes ? Math.max(0, m.clases_mes - m.usadas) : null;
  const resumen = !m ? "Cada clase se paga en recepción" : quedan === null ? "Clases ilimitadas" : `Te ${quedan === 1 ? "queda 1 clase" : `quedan ${quedan} clases`} este mes`;

  function Boton({ accion, citaId, children }: { accion: Accion; citaId: string; children: React.ReactNode }) {
    const estiloBoton = accion === "marcar" ? "bg-[var(--brand)] px-4 text-white"
      : accion === "reservar" ? "border border-slate-300 bg-white px-4 text-slate-800"
      : "px-2 text-slate-500 hover:bg-slate-100";
    return (
      <button type="button" disabled={!!ocupado} onClick={() => void hacer(accion, citaId)}
        className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl text-sm font-semibold disabled:opacity-50 ${estiloBoton}`}>
        {ocupado === `${accion}|${citaId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{children}
      </button>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))]" style={estilo}>
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white"><CalendarCheck className="h-6 w-6" /></span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{empresa}</p>
            <h1 className="truncate text-xl font-bold text-slate-900">{alumno ? `Hola, ${alumno.nombre.split(" ")[0]}` : "Mi asistencia"}</h1>
            {alumno ? <p className="truncate text-sm text-slate-500">{resumen}</p> : null}
          </div>
        </header>

        {msj ? (
          <div role="status" className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-slate-900">{msj.titulo}</span>
              {msj.detalle ? <span className="block text-slate-600">{msj.detalle}</span> : null}
            </span>
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800">{error}</p> : null}
        {alumno?.bloqueado ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">Tenés una cuota vencida: podés reservar, pero para marcar tu asistencia pasá por recepción.</p>
        ) : null}

        {!alumno && !error ? <div className="h-64 animate-pulse rounded-2xl bg-white" /> : null}
        {alumno ? (
          <>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: "none" }}>
              {orden.map((f) => (
                <button key={f} type="button" onClick={() => setDia(f)} aria-pressed={f === elegido}
                  className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium transition ${f === elegido ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                  {chip(f, hoy)}
                </button>
              ))}
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white px-4">
              {clases.length ? (
                <ul className="m-0 list-none divide-y divide-slate-100 p-0">
                  {clases.map((c) => {
                    const ya = c.estado === "culminada";
                    const reservada = c.estado === "pendiente" || c.estado === "confirmada" || c.estado === "en_espera";
                    const lleno = !c.estado && c.lugares !== null && c.lugares <= 0;
                    const terminada = new Date(c.fin_at).getTime() < Date.now();
                    const abre = new Date(new Date(c.inicio_at).getTime() - 3_600_000);
                    const estado = ya ? "Asististe"
                      : reservada ? (esHoy && !c.puede_marcar && !alumno.bloqueado && Date.now() < abre.getTime() ? `Reservada · marcás desde las ${hora(abre.toISOString())}` : "Reservada")
                      : lleno ? "Llena" : terminada ? "Terminó"
                      : c.lugares !== null ? `${c.lugares} ${c.lugares === 1 ? "lugar" : "lugares"}` : "";
                    const detalle = [estado, c.profesor, c.ubicacion].filter(Boolean).join(" · ");
                    return (
                      <li key={c.cita_id} className="flex items-center gap-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-semibold text-slate-900"><span className="tabular-nums">{hora(c.inicio_at)}</span> {c.titulo}</span>
                          <span className={`block truncate text-sm ${ya ? "text-emerald-700" : reservada ? "text-[var(--brand)]" : "text-slate-500"}`}>{detalle}</span>
                        </span>
                        {ya ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-label="Asististe" />
                          : c.puede_marcar ? <Boton accion="marcar" citaId={c.cita_id}>Marcar</Boton>
                          : c.puede_reservar ? <Boton accion="reservar" citaId={c.cita_id}>Reservar</Boton>
                          : c.puede_cancelar ? <Boton accion="cancelar" citaId={c.cita_id}>Cancelar</Boton> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="py-8 text-center text-sm text-slate-500">{esHoy ? "Hoy no hay clases." : "Ese día no hay clases."}</p>}
              {esHoy ? (
                <div className="border-t border-slate-100 py-2">
                  {alumno.entrada_libre_hoy ? (
                    <p className="flex min-h-10 items-center gap-2 text-sm text-emerald-700"><DoorOpen className="h-4 w-4" /> Marcaste entrada libre hoy</p>
                  ) : (
                    <button type="button" disabled={!!ocupado || alumno.bloqueado} onClick={() => void hacer("libre")}
                      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--brand)] disabled:opacity-50">
                      {ocupado === "libre|" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />} Vengo sin clase (entrada libre)
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
