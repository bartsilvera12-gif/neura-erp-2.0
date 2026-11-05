"use client";

/**
 * El alumno marca su llegada (receta 153): CI + PIN → ve las clases de hoy y toca "Llegué" en la suya,
 * o "Entrada libre" si viene a la sala. Con una cuota vencida lo manda a recepción. La CI se recuerda
 * en este celular (el PIN no).
 */
import { useEffect, useState } from "react";
import { CalendarCheck, CheckCircle2, DoorOpen, Loader2, LogOut, MapPin, User } from "lucide-react";

type Clase = { cita_id: string; titulo: string; inicio_at: string; fin_at: string; profesor: string | null; ubicacion: string | null; estado: string | null; lugares: number | null };
type Alumno = { nombre: string; bloqueado: boolean; membresia: { plan: string; clases_mes: number | null; usadas: number } | null; entrada_libre_hoy: boolean; clases: Clase[] };
type Marcada = { clase: string; hora: string; cubierta: boolean; valor: number | null };

const CLAVE_CI = "asistencia-ci";
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Asuncion" });
const gs = (n: number | null) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const INPUT = "min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg text-slate-900 outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

async function llamar<T>(token: string, cuerpo: object): Promise<T> {
  const r = await fetch(`/api/publico/asistencia/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? "No se pudo conectar. Probá de nuevo.");
  return j.data as T;
}

export function MarcarAsistencia({ token, empresa, color }: { token: string; empresa: string; color: string }) {
  const estilo = { ["--brand" as string]: color, ["--brand-100" as string]: `color-mix(in srgb, ${color} 18%, white)` } as React.CSSProperties;
  const [ci, setCi] = useState("");
  const [pin, setPin] = useState("");
  const [alumno, setAlumno] = useState<Alumno | null>(null);
  const [marcada, setMarcada] = useState<Marcada | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { try { setCi(localStorage.getItem(CLAVE_CI) ?? ""); } catch { /* sin almacenamiento */ } }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado("entrar"); setError(null);
    try {
      const d = await llamar<{ alumno: Alumno }>(token, { accion: "entrar", documento: ci, pin });
      setAlumno(d.alumno);
      try { localStorage.setItem(CLAVE_CI, ci); } catch { /* sin almacenamiento */ }
    } catch (x) { setError((x as Error).message); } finally { setOcupado(null); }
  }

  async function marcar(citaId: string | null) {
    setOcupado(citaId ?? "libre"); setError(null);
    try {
      const d = await llamar<{ marcada: Marcada; alumno: Alumno }>(token, { accion: "marcar", documento: ci, pin, cita_id: citaId });
      setMarcada(d.marcada); setAlumno(d.alumno);
    } catch (x) { setError((x as Error).message); } finally { setOcupado(null); }
  }

  function salir() { setAlumno(null); setMarcada(null); setPin(""); setError(null); }

  return (
    <div className="min-h-dvh bg-slate-50 px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]" style={estilo}>
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white"><CalendarCheck className="h-6 w-6" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-500">{empresa}</p>
            <h1 className="text-xl font-bold text-slate-900">Marcar mi asistencia</h1>
          </div>
        </header>

        {marcada ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <p className="mt-3 text-xl font-bold text-slate-900">¡Listo, {alumno?.nombre.split(" ")[0]}!</p>
            <p className="mt-1 text-base text-slate-700">{marcada.clase} · {hora(marcada.hora)}</p>
            <p className="mt-2 text-sm text-slate-600">{marcada.cubierta ? "Se descontó de tu membresía." : marcada.valor ? `Clase suelta: ${gs(marcada.valor)}, pagala en recepción.` : ""}</p>
            <button type="button" onClick={salir} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] px-6 text-base font-semibold text-white">Terminar</button>
          </section>
        ) : alumno ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500"><User className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-slate-900">{alumno.nombre}</span>
                  <span className="block text-sm text-slate-500">{alumno.membresia ? `${alumno.membresia.plan}${alumno.membresia.clases_mes ? ` · ${alumno.membresia.usadas} de ${alumno.membresia.clases_mes} clases` : ""}` : "Sin membresía"}</span>
                </span>
              </span>
              <button type="button" onClick={salir} aria-label="Salir" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100"><LogOut className="h-5 w-5" /></button>
            </div>
            {alumno.bloqueado ? (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-base font-medium text-rose-800">Tenés una cuota vencida sin pagar: pasá por recepción para entrar.</p>
            ) : (
              <>
                <h2 className="pt-1 text-base font-semibold text-slate-700">¿A qué venís hoy?</h2>
                {alumno.clases.map((c) => {
                  const ya = c.estado === "culminada";
                  const lleno = !c.estado && c.lugares !== null && c.lugares <= 0;
                  return (
                    <div key={c.cita_id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold tabular-nums text-[var(--brand)]">{hora(c.inicio_at)} – {hora(c.fin_at)}</span>
                        <span className="block truncate text-base font-semibold text-slate-900">{c.titulo}</span>
                        <span className="flex items-center gap-1 text-sm text-slate-500">{c.profesor ?? ""}{c.ubicacion ? <><MapPin className="h-3.5 w-3.5" /> {c.ubicacion}</> : null}</span>
                      </span>
                      {ya ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">Marcada</span>
                      ) : (
                        <button type="button" disabled={!!ocupado || lleno} onClick={() => void marcar(c.cita_id)}
                          className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-base font-semibold text-white disabled:opacity-40">
                          {ocupado === c.cita_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{lleno ? "Llena" : "Llegué"}
                        </button>
                      )}
                    </div>
                  );
                })}
                <button type="button" disabled={!!ocupado || alumno.entrada_libre_hoy} onClick={() => void marcar(null)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left disabled:opacity-60">
                  <DoorOpen className="h-6 w-6 shrink-0 text-[var(--brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-slate-900">Entrada libre</span>
                    <span className="block text-sm text-slate-500">{alumno.entrada_libre_hoy ? "Ya la marcaste hoy" : "Vengo a la sala, sin clase"}</span>
                  </span>
                  {ocupado === "libre" ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
                </button>
              </>
            )}
          </section>
        ) : (
          <form onSubmit={entrar} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-600">Tu cédula</span>
              <input value={ci} onChange={(e) => setCi(e.target.value.replace(/[^\d.]/g, "").slice(0, 15))} inputMode="numeric" autoComplete="off" placeholder="Ej. 4.523.118" className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-600">Tu PIN</span>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" autoComplete="off" placeholder="4 números" className={`${INPUT} tracking-[0.4em]`} />
            </label>
            <button type="submit" disabled={!!ocupado || ci.replace(/\D/g, "").length < 4 || pin.length !== 4}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] text-lg font-semibold text-white disabled:opacity-40">
              {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Entrar
            </button>
            <p className="text-center text-sm text-slate-500">¿No tenés PIN? Pedilo en recepción.</p>
          </form>
        )}
        {error ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-base text-rose-800">{error}</p> : null}
      </div>
    </div>
  );
}