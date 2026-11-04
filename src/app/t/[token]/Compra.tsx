"use client";

/** La compra por su link privado: pagar y subir el comprobante, esperar la revisión o ver el ticket. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Clock, Copy, FileUp, Loader2, Printer, RefreshCw, Ticket, XCircle } from "lucide-react";
import type { CompraPublica } from "@/modules/sorteos/publico";

const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const corto = (n: string) => { const p = n.trim().split(/\s+/); return `${p[0]}${p[1] ? ` ${p[1][0]}.` : ""}`; };

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" aria-label={`Copiar ${texto}`} onClick={() => { void navigator.clipboard?.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">
      {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function Numeros({ c, grande = false }: { c: CompraPublica; grande?: boolean }) {
  return (
    <ul className={`m-0 grid list-none gap-2 p-0 ${grande ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-4 sm:grid-cols-6"}`}>
      {c.numeros.map((n) => (
        <li key={n} className={`rounded-xl bg-[color-mix(in_srgb,var(--brand)_10%,white)] text-center font-bold tabular-nums tracking-wider text-[var(--brand)] ${grande ? "py-2.5 text-xl" : "py-1.5 text-sm"}`}>{n}</li>
      ))}
    </ul>
  );
}

function useRestante(vence: string | null) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!vence) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vence]);
  if (!vence) return null;
  const ms = Math.max(0, new Date(vence).getTime() - ahora);
  return { ms, texto: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}` };
}

export function Compra({ token, inicial, color }: { token: string; inicial: CompraPublica; color: string }) {
  const [c, setC] = useState(inicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [referencia, setReferencia] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const restante = useRestante(c.estado === "pendiente_pago" ? c.vence_at : null);

  const recargar = useCallback(async () => {
    const r = await fetch(`/api/publico/sorteos/compra/${token}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setC(r.data);
  }, [token]);

  // Mientras se revisa, se consulta sola cada 30 s; al vencer la reserva, se actualiza.
  useEffect(() => {
    if (c.estado !== "en_revision") return;
    const t = setInterval(() => void recargar(), 30_000);
    return () => clearInterval(t);
  }, [c.estado, recargar]);
  useEffect(() => { if (restante && restante.ms === 0) void recargar(); }, [restante?.ms === 0, recargar]); // eslint-disable-line react-hooks/exhaustive-deps

  async function subir() {
    if (!archivo) return setError("Elegí la foto o el PDF del comprobante.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", archivo);
      if (referencia.trim()) form.append("referencia", referencia.trim());
      const r = await fetch(`/api/publico/sorteos/compra/${token}`, { method: "POST", body: form });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? "No se pudo subir el comprobante.");
      setC(j.data);
      setArchivo(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-16 print:bg-white print:pb-0" style={{ ["--brand" as string]: color }}>
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand)] text-white"><Ticket className="h-4 w-4" /></span>
          <p className="truncate text-sm font-semibold text-slate-800">{c.empresa}</p>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {c.estado === "confirmada" ? (
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm print:border-slate-400 print:shadow-none">
            <div className="bg-[var(--brand)] px-5 py-4 text-white print:bg-white print:text-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-80">Ticket · Compra {c.numero}</p>
              <h1 className="mt-1 text-xl font-bold leading-tight">{c.sorteo}</h1>
              <p className="text-sm opacity-90">{c.empresa}</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">Participante</p>
                  <p className="text-base font-semibold text-slate-900">{corto(c.comprador_nombre)}{c.comprador_ciudad ? ` · ${c.comprador_ciudad}` : ""}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" /> Pago confirmado</span>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{c.numeros.length === 1 ? "Tu número" : `Tus ${c.numeros.length} números`}</p>
                <Numeros c={c} grande />
              </div>
              <div className="flex flex-wrap justify-between gap-2 border-t border-dashed border-slate-200 pt-3 text-sm text-slate-600">
                <span>{c.cantidad} {c.cantidad === 1 ? "boleta" : "boletas"} · {gs(c.monto)}</span>
                {c.fecha_sorteo ? <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" /> {fecha(c.fecha_sorteo)}</span> : null}
              </div>
              {c.mensaje_ticket ? <p className="whitespace-pre-line rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">{c.mensaje_ticket}</p> : null}
            </div>
          </section>
        ) : null}

        {c.estado === "pendiente_pago" ? (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Compra {c.numero} · {c.sorteo}</p>
              <h1 className="mt-1 text-xl font-bold text-slate-900">Te guardamos estos números</h1>
              {restante ? (
                <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${restante.ms < 5 * 60_000 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>
                  <Clock className="h-4 w-4" /> Tenés {restante.texto} para pagar y subir el comprobante
                </p>
              ) : null}
              <div className="mt-4"><Numeros c={c} /></div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">1. Transferí {gs(c.monto)}</h2>
              {c.precio_lista > c.monto ? <p className="text-xs text-emerald-700">Con el combo ahorrás {gs(c.precio_lista - c.monto)}.</p> : null}
              <ul className="mt-3 space-y-2">
                {(c.datos_pago ?? []).map((d, i) => (
                  <li key={i} className="rounded-2xl bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">{d.banco}</p>
                    <p className="text-slate-600">{d.titular}{d.documento ? ` · ${d.documento}` : ""}</p>
                    <div className="mt-1 flex items-center justify-between gap-2"><span className="font-mono text-base text-slate-900">{d.cuenta}</span><Copiar texto={d.cuenta} /></div>
                    {d.alias ? <div className="flex items-center justify-between gap-2"><span className="text-slate-600">Alias: <b className="text-slate-900">{d.alias}</b></span><Copiar texto={d.alias} /></div> : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">2. Subí el comprobante</h2>
              <button type="button" onClick={() => input.current?.click()}
                className="flex min-h-20 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 text-sm font-semibold text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]">
                <FileUp className="h-5 w-5" /> {archivo ? archivo.name : "Elegir foto o PDF"}
              </button>
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setError(null); }} />
              <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Nº de operación (opcional)</span>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={60}
                  className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-[var(--brand)]" />
              </label>
              {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
              <button type="button" onClick={subir} disabled={busy || !archivo}
                className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] text-base font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />} Enviar comprobante
              </button>
            </section>
          </>
        ) : null}

        {c.estado === "en_revision" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600"><Clock className="h-6 w-6" /></span>
            <h1 className="mt-3 text-xl font-bold text-slate-900">Estamos revisando tu pago</h1>
            <p className="mt-1 text-sm text-slate-600">Recibimos tu comprobante de la compra {c.numero}. Cuando lo confirmemos, en este mismo link vas a ver tu ticket. Tus números quedan guardados.</p>
            <div className="mt-4"><Numeros c={c} /></div>
            <button type="button" onClick={() => void recargar()} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"><RefreshCw className="h-4 w-4" /> Actualizar</button>
          </section>
        ) : null}

        {["rechazada", "anulada", "vencida"].includes(c.estado) ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-rose-50 text-rose-600">{c.estado === "vencida" ? <AlertTriangle className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}</span>
            <h1 className="mt-3 text-xl font-bold text-slate-900">
              {c.estado === "vencida" ? "Se venció el tiempo para pagar" : c.estado === "rechazada" ? "No pudimos confirmar tu pago" : "Esta compra fue anulada"}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {c.estado === "vencida" ? "Los números se liberaron. Si todavía querés participar, hacé la compra de nuevo." : c.motivo ? `Motivo: ${c.motivo}.` : "Si creés que es un error, escribinos."}
            </p>
            <Link href={`/s/${c.slug}`} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[var(--brand)] px-5 text-sm font-bold text-white no-underline">Volver al sorteo</Link>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2 print:hidden">
          {c.estado === "confirmada" ? <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"><Printer className="h-4 w-4" /> Guardar o imprimir</button> : null}
          <Link href={`/s/${c.slug}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 no-underline">Ver el sorteo</Link>
        </div>
        <p className="text-center text-xs text-slate-400 print:hidden">Guardá este link: es tu comprobante de participación.</p>
      </main>
    </div>
  );
}
