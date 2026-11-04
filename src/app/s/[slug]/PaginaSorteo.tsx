"use client";

/**
 * La página pública de un sorteo: premios, elegir cantidad (o números), datos del comprador y reserva.
 * Al reservar lleva al link privado de la compra (/t/<token>), donde se transfiere y se sube el
 * comprobante. El precio sale del combo o de precio × cantidad (el mismo cálculo que la base).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarClock, Check, Loader2, PlayCircle, Search, ShieldCheck, Ticket, Trophy } from "lucide-react";
import type { SorteoPublico } from "@/modules/sorteos/publico";

const gs = (n: number) => `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const nuevaClave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const INPUT = "min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--brand)_15%,transparent)]";

export function PaginaSorteo({ s, vendedor, color }: { s: SorteoPublico; vendedor: string | null; color: string }) {
  const router = useRouter();
  const opciones = useMemo(() => [{ cantidad: 1, precio: s.precio, etiqueta: null as string | null }, ...s.combos], [s]);
  const [cantidad, setCantidad] = useState(s.combos[0]?.cantidad ?? 1);
  const [elegir, setElegir] = useState(false);
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [libres, setLibres] = useState<string[] | null>(null);
  const [desde, setDesde] = useState(String(s.numero_desde));
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [clave] = useState(nuevaClave);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cant = elegir ? elegidos.length : cantidad;
  const combo = s.combos.find((c) => c.cantidad === cant);
  const monto = combo ? combo.precio : s.precio * cant;
  const lista = s.precio * cant;
  const aLaVenta = s.estado === "activo";
  const tope = Math.min(s.max_por_compra ?? Infinity, s.disponibles);

  async function buscarLibres() {
    setError(null);
    try {
      const r = await fetch(`/api/publico/sorteos/${s.slug}/numeros?libres=${Number(desde) || s.numero_desde}`, { cache: "no-store" });
      const j = await r.json();
      setLibres(j.ok ? j.data : []);
    } catch {
      setError("No se pudieron cargar los números.");
    }
  }

  async function reservar() {
    setError(null);
    if (nombre.trim().length < 3) return setError("Escribí tu nombre y apellido.");
    if (documento.replace(/\D/g, "").length < 5) return setError("Escribí tu número de cédula.");
    if (telefono.replace(/\D/g, "").length < 8) return setError("Escribí tu número de celular.");
    if (cant < 1) return setError(elegir ? "Elegí al menos un número." : "Elegí cuántas boletas.");
    if (cant > tope) return setError(`Podés comprar hasta ${tope.toLocaleString("es-PY")} boletas.`);
    setBusy(true);
    try {
      const r = await fetch(`/api/publico/sorteos/${s.slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(elegir ? { numeros: elegidos } : { cantidad }),
          comprador: { nombre: nombre.trim(), documento: documento.trim(), telefono: telefono.trim(), ciudad: ciudad.trim() || null },
          vendedor, idempotency_key: clave,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? "No se pudo hacer la compra.");
      router.push(`/t/${j.data.token}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 pb-16" style={{ ["--brand" as string]: color }}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand)] text-white"><Ticket className="h-4 w-4" /></span>
          <p className="truncate text-sm font-semibold text-slate-800">{s.empresa}</p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 pt-4">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {s.imagen_url ? <img src={s.imagen_url} alt="" className="aspect-[16/9] w-full object-cover" /> : null}
          <div className="space-y-3 p-5">
            <h1 className="text-2xl font-bold leading-tight text-slate-900">{s.nombre}</h1>
            {s.fecha_sorteo ? <p className="flex items-center gap-2 text-sm text-slate-600"><CalendarClock className="h-4 w-4 shrink-0" /> Sorteo: {fecha(s.fecha_sorteo)}</p> : null}
            {s.descripcion ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{s.descripcion}</p> : null}
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-[color-mix(in_srgb,var(--brand)_10%,white)] px-3 py-1 font-semibold text-[var(--brand)]">{gs(s.precio)} la boleta</span>
              {aLaVenta ? <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">{s.disponibles.toLocaleString("es-PY")} disponibles</span> : null}
            </div>
          </div>
        </section>

        {s.estado !== "activo" ? (
          <p className={`rounded-2xl p-4 text-sm font-medium ${s.estado === "sorteado" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
            {s.estado === "pausado" ? "La venta está pausada por ahora. Volvé a entrar más tarde."
              : s.estado === "cerrado" ? "La venta ya cerró. ¡Pronto se sortea!"
              : "¡El sorteo ya se realizó! Mirá los ganadores abajo."}
          </p>
        ) : null}

        {/* El sorteo se hace en un vivo por redes (receta 127): antes anuncia dónde, después queda la grabación. */}
        {s.vivo_url ? (
          <a href={s.vivo_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_30%,white)] bg-white p-4 no-underline shadow-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white"><PlayCircle className="h-6 w-6" /></span>
            <span className="min-w-0">
              <b className="block text-slate-900">{s.estado === "sorteado" ? "Mirá el vivo del sorteo" : "El sorteo se hace en vivo"}</b>
              <span className="block truncate text-sm text-slate-500">{s.estado === "sorteado" ? "La grabación de cómo salieron los ganadores." : "Entrá a este link el día del sorteo."}</span>
            </span>
          </a>
        ) : null}

        {s.premios.length ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Trophy className="h-5 w-5 text-amber-500" /> Premios</h2>
            <ul className="mt-3 space-y-2">
              {s.premios.map((p) => (
                <li key={p.posicion} className={`rounded-2xl p-3 ${p.numero_ganador ? "bg-amber-50" : "bg-slate-50"}`}>
                  <p className="text-sm font-semibold text-slate-900">{p.posicion}° premio · {p.nombre}</p>
                  {p.descripcion ? <p className="text-xs text-slate-500">{p.descripcion}</p> : null}
                  {p.numero_ganador ? (
                    <p className="mt-1 text-sm text-amber-900">Ganó el <b className="tabular-nums">{p.numero_ganador}</b> · {p.ganador}{p.ciudad ? ` (${p.ciudad})` : ""}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {aLaVenta ? (
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Comprá tus boletas</h2>
            {s.permite_elegir ? (
              <div className="flex gap-1 rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Cómo elegir">
                {[[false, "Elegir cantidad"], [true, "Elegir mis números"]].map(([v, t]) => (
                  <button key={String(v)} type="button" role="tab" aria-selected={elegir === v} onClick={() => setElegir(v as boolean)}
                    className={`min-h-11 flex-1 rounded-xl text-sm font-semibold ${elegir === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{t as string}</button>
                ))}
              </div>
            ) : null}

            {!elegir ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {opciones.filter((o) => o.cantidad <= tope).map((o) => {
                  const sel = cantidad === o.cantidad;
                  const ahorro = s.precio * o.cantidad - o.precio;
                  return (
                    <button key={o.cantidad} type="button" onClick={() => setCantidad(o.cantidad)}
                      className={`relative min-h-20 rounded-2xl border p-3 text-left transition ${sel ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_8%,white)] ring-2 ring-[color-mix(in_srgb,var(--brand)_25%,transparent)]" : "border-slate-200 hover:border-slate-300"}`}>
                      {sel ? <Check className="absolute right-2.5 top-2.5 h-4 w-4 text-[var(--brand)]" /> : null}
                      <span className="block text-lg font-bold text-slate-900">{o.cantidad} {o.cantidad === 1 ? "boleta" : "boletas"}</span>
                      <span className="block text-sm font-semibold text-slate-700">{gs(o.precio)}</span>
                      {ahorro > 0 ? <span className="block text-xs font-medium text-emerald-700">Ahorrás {gs(ahorro)}</span> : null}
                      {o.etiqueta ? <span className="mt-0.5 block text-xs text-slate-500">{o.etiqueta}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input className={INPUT} inputMode="numeric" value={desde} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))} aria-label="Ver números desde" placeholder={`Desde el ${s.numero_desde}`} />
                  <button type="button" onClick={buscarLibres} className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white"><Search className="h-4 w-4" /> Ver libres</button>
                </div>
                {libres ? (
                  libres.length ? (
                    <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
                      {libres.map((n) => {
                        const num = Number(n);
                        const sel = elegidos.includes(num);
                        return (
                          <button key={n} type="button" onClick={() => setElegidos((l) => (sel ? l.filter((x) => x !== num) : [...l, num]))}
                            className={`min-h-11 rounded-xl text-sm font-semibold tabular-nums ${sel ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{n}</button>
                        );
                      })}
                    </div>
                  ) : <p className="text-sm text-slate-500">No hay números libres desde ahí.</p>
                ) : <p className="text-sm text-slate-500">Escribí desde qué número querés ver y tocá «Ver libres».</p>}
                {elegidos.length ? <p className="text-sm text-slate-600">Elegiste: <b className="tabular-nums">{[...elegidos].sort((a, b) => a - b).map((n) => String(n).padStart(s.digitos, "0")).join(", ")}</b></p> : null}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium text-slate-700">Nombre y apellido</span><input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" maxLength={120} /></label>
              <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Cédula</span><input className={INPUT} inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={20} /></label>
              <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Celular</span><input className={INPUT} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="tel" placeholder="09xx xxx xxx" maxLength={30} /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium text-slate-700">Ciudad (opcional)</span><input className={INPUT} value={ciudad} onChange={(e) => setCiudad(e.target.value)} maxLength={80} /></label>
            </div>

            {error ? <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">{cant ? `${cant.toLocaleString("es-PY")} ${cant === 1 ? "boleta" : "boletas"}` : "Sin boletas"}</p>
                  <p className="text-2xl font-black tabular-nums text-slate-900">{gs(monto)}</p>
                  {lista > monto ? <p className="text-xs font-medium text-emerald-700">Ahorrás {gs(lista - monto)}</p> : null}
                </div>
              </div>
              <button type="button" onClick={reservar} disabled={busy || cant < 1}
                className="mt-3 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:opacity-50">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ticket className="h-5 w-5" />} Reservar mis boletas
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">Te guardamos los números {s.reserva_minutos >= 60 ? `${s.reserva_minutos / 60} hora${s.reserva_minutos >= 120 ? "s" : ""}` : `${s.reserva_minutos} minutos`} para que transfieras y subas el comprobante.</p>
            </div>
          </section>
        ) : null}

        <VerificarNumero slug={s.slug} digitos={s.digitos} />

        {s.verificacion.semilla_hash ? (
          <Link href={`/s/${s.slug}/verificar`} className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm no-underline shadow-sm">
            <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" />
            <span className="min-w-0"><b className="block text-slate-900">Sorteo verificable</b><span className="block text-slate-500">Cómo se elige el ganador y cómo comprobarlo vos mismo.</span></span>
          </Link>
        ) : null}
      </main>
    </div>
  );
}

function VerificarNumero({ slug, digitos }: { slug: string; digitos: number }) {
  const [n, setN] = useState("");
  const [r, setR] = useState<{ existe: boolean; numero?: string; estado?: string; participante?: string | null; ciudad?: string | null; premio?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  async function ver() {
    if (!n) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/publico/sorteos/${slug}/numeros?ver=${Number(n)}`, { cache: "no-store" });
      const j = await res.json();
      setR(j.ok ? j.data : null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Verificá tu número</h2>
      <div className="mt-3 flex gap-2">
        <input className={INPUT} inputMode="numeric" value={n} onChange={(e) => { setN(e.target.value.replace(/\D/g, "").slice(0, digitos)); setR(null); }} onKeyDown={(e) => e.key === "Enter" && void ver()} placeholder="Tu número" aria-label="Número a verificar" />
        <button type="button" onClick={ver} disabled={busy || !n} className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Ver
        </button>
      </div>
      {r ? (
        <p className={`mt-3 rounded-2xl p-3 text-sm ${r.premio ? "bg-amber-50 text-amber-900" : r.estado === "vendido" ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-700"}`}>
          {!r.existe ? "Ese número no es de este sorteo."
            : r.premio ? <>¡El <b>{r.numero}</b> ganó: {r.premio}! ({r.participante})</>
            : r.estado === "vendido" ? <>El <b>{r.numero}</b> está participando · {r.participante}{r.ciudad ? ` (${r.ciudad})` : ""}.</>
            : r.estado === "reservado" ? <>El <b>{r.numero}</b> está reservado, esperando el pago.</>
            : <>El <b>{r.numero}</b> todavía está libre.</>}
        </p>
      ) : null}
    </section>
  );
}
