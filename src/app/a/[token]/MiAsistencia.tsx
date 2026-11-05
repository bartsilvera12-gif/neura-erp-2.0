"use client";

/**
 * Lo que ve el alumno con SU link (receta 155): sin CI ni PIN. Sus clases de hoy y de los próximos días:
 * reserva, cancela, o marca su asistencia desde donde esté (en una clase de hoy, desde 1 hora antes)
 * y "Entrada libre" una vez por día. Con una cuota vencida puede reservar pero no marcar.
 * El link queda guardado en el celular para que el QR viejo de la entrada lo lleve acá.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, DoorOpen, Loader2, MapPin, User } from "lucide-react";
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
function nombreDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "Hoy";
  const man = new Date(`${hoy}T12:00:00`);
  man.setDate(man.getDate() + 1);
  if (fecha === man.toISOString().slice(0, 10)) return "Mañana";
  const t = new Date(`${fecha}T12:00:00`).toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function llamar<T>(token: string, cuerpo: object): Promise<T> {
  const r = await fetch(`/api/publico/asistencia/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? "No se pudo conectar. Probá de nuevo.");
  return j.data as T;
}

function mensaje(h: Hecho, hoy: string): { titulo: string; detalle: string } {
  if (h.accion === "reservar") {
    const cuando = h.inicio_at ? `${nombreDia(fechaPY(new Date(h.inicio_at)), hoy)} a las ${hora(h.inicio_at)}. ` : "";
    return { titulo: `Reservaste ${h.clase}`, detalle: `${cuando}Ese día marcás tu asistencia desde acá.` };
  }
  if (h.accion === "cancelar") return { titulo: `Cancelaste ${h.clase}`, detalle: "Tu lugar quedó libre para otro." };
  return { titulo: `¡Listo! Marcaste ${h.clase}`, detalle: h.cubierta ? "Se descontó de tu membresía." : h.valor ? `Clase suelta: ${gs(h.valor)}, pagala en recepción.` : "" };
}

export function MiAsistencia({ token, empresa, color }: { token: string; empresa: string; color: string }) {
  const estilo = { ["--brand" as string]: color, ["--brand-100" as string]: `color-mix(in srgb, ${color} 14%, white)` } as React.CSSProperties;
  const [alumno, setAlumno] = useState<Alumno | null>(null);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (x) { setError((x as Error).message); } finally {
      setOcupado(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const hoy = fechaPY(new Date());
  const dias = new Map<string, Clase[]>([[hoy, []]]);
  for (const c of alumno?.clases ?? []) dias.set(c.fecha, [...(dias.get(c.fecha) ?? []), c]);
  const orden = [...dias.keys()].sort();
  const msj = hecho ? mensaje(hecho, hoy) : null;
  const m = alumno?.membresia;

  function Boton({ accion, citaId, children, principal }: { accion: Accion; citaId: string; children: React.ReactNode; principal?: boolean }) {
    return (
      <button type="button" disabled={!!ocupado} onClick={() => void hacer(accion, citaId)}
        className={`inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-base font-semibold disabled:opacity-50 ${
          principal ? "bg-[var(--brand)] text-white" : "border border-[var(--brand)] bg-white text-[var(--brand)]"}`}>
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
            <p className="truncate text-sm font-medium text-slate-500">{empresa}</p>
            <h1 className="truncate text-xl font-bold text-slate-900">{alumno ? `Hola, ${alumno.nombre.split(" ")[0]}` : "Mi asistencia"}</h1>
          </div>
        </header>

        {msj ? (
          <div role="status" className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            <span className="min-w-0">
              <span className="block text-base font-semibold text-slate-900">{msj.titulo}</span>
              {msj.detalle ? <span className="block text-sm text-slate-600">{msj.detalle}</span> : null}
            </span>
          </div>
        ) : null}
        {error ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">{error}</p> : null}

        {!alumno && !error ? <div className="h-64 animate-pulse rounded-3xl bg-white" /> : null}
        {alumno ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><User className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-slate-900">{m ? m.plan : "Sin membresía"}</span>
                <span className="block text-sm text-slate-500">{m ? (m.clases_mes ? `Usaste ${m.usadas} de ${m.clases_mes} clases este mes` : "Clases ilimitadas") : "Cada clase se paga suelta en recepción"}</span>
              </span>
            </div>
            {alumno.bloqueado ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base text-amber-900">Tenés una cuota vencida: podés reservar, pero para marcar tu asistencia pasá por recepción.</p>
            ) : null}

            {orden.map((f) => {
              const clases = dias.get(f) ?? [];
              const esHoy = f === hoy;
              return (
                <section key={f} className="space-y-2">
                  <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-slate-500">{nombreDia(f, hoy)}</h2>
                  {clases.map((c) => {
                    const ya = c.estado === "culminada";
                    const reservada = c.estado === "pendiente" || c.estado === "confirmada" || c.estado === "en_espera";
                    const lleno = !c.estado && c.lugares !== null && c.lugares <= 0;
                    const terminada = new Date(c.fin_at).getTime() < Date.now();
                    const abre = new Date(new Date(c.inicio_at).getTime() - 3_600_000);
                    const acciones = !ya && (c.puede_marcar || c.puede_reservar || c.puede_cancelar);
                    return (
                      <div key={c.cita_id} className={`rounded-2xl border bg-white p-4 ${reservada || ya ? "border-[var(--brand)]" : "border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold tabular-nums text-[var(--brand)]">{hora(c.inicio_at)} – {hora(c.fin_at)}</span>
                            <span className="block truncate text-base font-semibold text-slate-900">{c.titulo}</span>
                            <span className="flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                              {c.profesor ? <span>{c.profesor}</span> : null}
                              {c.ubicacion ? <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{c.ubicacion}</span> : null}
                              {!ya && !reservada && c.lugares !== null && c.lugares > 0 ? <span>{c.lugares} {c.lugares === 1 ? "lugar" : "lugares"}</span> : null}
                            </span>
                          </span>
                          {ya ? <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">Asististe</span>
                            : reservada ? <span className="shrink-0 rounded-full bg-[var(--brand-100)] px-3 py-1 text-sm font-semibold text-[var(--brand)]">Reservada</span>
                            : lleno ? <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-500">Llena</span>
                            : terminada ? <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">Terminó</span> : null}
                        </div>
                        {acciones ? (
                          <div className="mt-3 flex flex-col gap-2">
                            {c.puede_marcar ? <Boton accion="marcar" citaId={c.cita_id} principal>Marcar asistencia</Boton> : null}
                            {c.puede_reservar && !c.puede_marcar ? <Boton accion="reservar" citaId={c.cita_id} principal>Reservar</Boton> : null}
                            {c.puede_cancelar ? (
                              <button type="button" disabled={!!ocupado} onClick={() => void hacer("cancelar", c.cita_id)}
                                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                                {ocupado === `cancelar|${c.cita_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Cancelar reserva
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {esHoy && reservada && !c.puede_marcar && !alumno.bloqueado && Date.now() < abre.getTime() ? (
                          <p className="mt-2 text-sm text-slate-500">Marcás tu asistencia desde las {hora(abre.toISOString())}.</p>
                        ) : null}
                      </div>
                    );
                  })}
                  {esHoy ? (
                    <button type="button" disabled={!!ocupado || alumno.entrada_libre_hoy || alumno.bloqueado} onClick={() => void hacer("libre")}
                      className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-left disabled:opacity-60">
                      <DoorOpen className="h-6 w-6 shrink-0 text-[var(--brand)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-slate-900">Entrada libre</span>
                        <span className="block text-sm text-slate-500">{alumno.entrada_libre_hoy ? "Ya la marcaste hoy" : "Vengo a entrenar sin clase"}</span>
                      </span>
                      {ocupado === "libre|" ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
                    </button>
                  ) : null}
                </section>
              );
            })}
            {orden.length === 1 && !(dias.get(hoy) ?? []).length ? <p className="text-center text-sm text-slate-500">No hay clases esta semana.</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
