"use client";

/**
 * Punto de venta del vendedor: PIN → vender (efectivo o transferencia) → mandar el ticket por WhatsApp.
 * El PIN queda solo en esta pestaña (sessionStorage) y viaja en cada venta: la base lo vuelve a validar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Check, Copy, KeyRound, Landmark, Loader2, LogOut, MessageCircle, Plus, Share2, Ticket } from "lucide-react";
import { Select } from "@/components/Select";

type Combo = { cantidad: number; precio: number; etiqueta: string | null; activo: boolean };
type SorteoPV = { id: string; nombre: string; precio: number; imagen_url: string | null; max_por_compra: number | null; combos: Combo[]; mis_boletas: number };
type Vendedor = { id: string; nombre: string; codigo: string; cupo: number | null; comision_pct: number; boletas: number; monto: number; por_rendir: number };
type Orden = {
  id: string; numero: number; token?: string; sorteo: string; estado: string; cantidad: number; monto: number; metodo_pago: string;
  comprador_nombre: string; comprador_telefono: string | null; numeros: string[]; created_at: string;
};
type Datos = { vendedor: Vendedor; sorteos: SorteoPV[]; ultimas: Orden[] };

const gs = (n: number) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const INPUT = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15";
const PRIMARIO = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-base font-semibold text-white shadow-sm disabled:opacity-50";
const SECUNDARIO = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700";
const ESTADO: Record<string, [string, string]> = {
  confirmada: ["Confirmada", "bg-emerald-50 text-emerald-800"], en_revision: ["Por revisar", "bg-amber-50 text-amber-800"],
  pendiente_pago: ["Esperando pago", "bg-slate-100 text-slate-600"], rechazada: ["Rechazada", "bg-rose-50 text-rose-700"],
  anulada: ["Anulada", "bg-rose-50 text-rose-700"], vencida: ["Vencida", "bg-slate-100 text-slate-600"],
};

const leerPin = (t: string) => { try { return sessionStorage.getItem(`rv:${t}`) ?? ""; } catch { return ""; } };
const guardarPin = (t: string, pin: string | null) => {
  try { if (pin) sessionStorage.setItem(`rv:${t}`, pin); else sessionStorage.removeItem(`rv:${t}`); } catch { /* sin almacenamiento */ }
};
const waTelefono = (t: string | null) => {
  const d = (t ?? "").replace(/\D/g, "");
  return /^09\d{8}$/.test(d) ? `595${d.slice(1)}` : d.length >= 8 ? d : null;
};

async function llamar<T>(token: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`/api/publico/sorteos/vendedor/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw Object.assign(new Error(j?.error ?? "No se pudo completar"), { status: r.status });
  return j.data as T;
}

function Copiar({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={SECUNDARIO} onClick={() => { void navigator.clipboard?.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {ok ? "Copiado" : label}
    </button>
  );
}

export function PuntoVenta({ token, color, empresa }: { token: string; color: string; empresa: string }) {
  const [pin, setPin] = useState("");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const entrar = useCallback(async (p: string) => {
    setEntrando(true);
    setError(null);
    try {
      const d = await llamar<Datos>(token, { accion: "entrar", pin: p });
      setDatos(d);
      setPin(p);
      guardarPin(token, p);
    } catch (e) {
      guardarPin(token, null);
      setError((e as Error).message);
    } finally {
      setEntrando(false);
    }
  }, [token]);

  useEffect(() => {
    const p = leerPin(token);
    if (p) void entrar(p);
    setListo(true);
  }, [token, entrar]);

  const salir = () => { guardarPin(token, null); setDatos(null); setPin(""); };
  const estilo = { ["--brand" as string]: color } as React.CSSProperties;

  if (!datos) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-4" style={estilo}>
        <form className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={(e) => { e.preventDefault(); if (/^\d{4,8}$/.test(pin)) void entrar(pin); }}>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand)_12%,white)] text-[var(--brand)]"><KeyRound className="h-6 w-6" /></span>
          <h1 className="mt-4 text-center text-lg font-semibold text-slate-900">Punto de venta</h1>
          <p className="mt-1 text-center text-sm text-slate-500">{empresa} · Ingresá tu PIN para vender boletas.</p>
          <input className={`${INPUT} mt-5 text-center text-2xl tracking-[0.5em]`} type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus
            maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" placeholder="••••" />
          {error ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-center text-sm text-rose-700">{error}</p> : null}
          <button type="submit" className={`${PRIMARIO} mt-4`} disabled={!listo || entrando || !/^\d{4,8}$/.test(pin)}>
            {entrando ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Entrar
          </button>
        </form>
      </div>
    );
  }
  return <Vender token={token} pin={pin} datos={datos} setDatos={setDatos} salir={salir} estilo={estilo} reentrar={() => entrar(pin)} />;
}

function Vender({ token, pin, datos, salir, estilo, reentrar }: {
  token: string; pin: string; datos: Datos; setDatos: (d: Datos) => void; salir: () => void; estilo: React.CSSProperties; reentrar: () => Promise<void>;
}) {
  const { vendedor, sorteos } = datos;
  const [sorteoId, setSorteoId] = useState(sorteos[0]?.id ?? "");
  const s = sorteos.find((x) => x.id === sorteoId) ?? null;
  const combos = useMemo(() => (s?.combos ?? []).filter((c) => c.activo), [s]);
  const [cantidad, setCantidad] = useState(1);
  const [otra, setOtra] = useState("");
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [metodo, setMetodo] = useState<"efectivo" | "transferencia">("efectivo");
  const [referencia, setReferencia] = useState("");
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<Orden | null>(null);

  const precio = s ? combos.find((c) => c.cantidad === cantidad)?.precio ?? cantidad * s.precio : 0;
  const quedan = vendedor.cupo != null && s ? Math.max(vendedor.cupo - s.mis_boletas, 0) : null;
  const opciones = useMemo(() => {
    const base = [1, ...combos.map((c) => c.cantidad)];
    return [...new Set(base)].filter((n) => !s?.max_por_compra || n <= s.max_por_compra).sort((a, b) => a - b);
  }, [combos, s]);
  const linkRef = typeof window !== "undefined" ? `${window.location.origin}/r/${vendedor.codigo}` : "";

  const valida = !!s && cantidad >= 1 && nombre.trim().length >= 2 && (documento.replace(/\D/g, "").length >= 5 || telefono.replace(/\D/g, "").length >= 8);

  async function vender() {
    if (!s || !valida) return;
    setBusy(true);
    setError(null);
    try {
      const r = await llamar<{ orden: Orden }>(token, {
        accion: "vender", pin,
        venta: {
          sorteo_id: s.id, cantidad, metodo_pago: metodo, referencia_pago: metodo === "transferencia" ? referencia.trim() || null : null, idempotency_key: clave,
          comprador: { nombre: nombre.trim(), documento: documento.trim() || null, telefono: telefono.trim() || null, ciudad: ciudad.trim() || null },
        },
      });
      setHecha(r.orden);
      void reentrar();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401 || err.status === 403) salir();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function nueva() {
    setHecha(null);
    setNombre(""); setDocumento(""); setTelefono(""); setCiudad(""); setReferencia("");
    setCantidad(1); setOtra(""); setMetodo("efectivo"); setClave(crypto.randomUUID()); setError(null);
  }

  const ticket = hecha?.token ? `${window.location.origin}/t/${hecha.token}` : null;
  const wa = hecha ? waTelefono(hecha.comprador_telefono) : null;
  const textoWa = hecha && ticket
    ? `¡Hola ${hecha.comprador_nombre.split(" ")[0]}! ${hecha.estado === "confirmada" ? `Tu compra N° ${hecha.numero} de ${hecha.sorteo} está confirmada. Tus números: ${hecha.numeros.join(", ")}.` : `Registramos tu compra N° ${hecha.numero} de ${hecha.sorteo}; te avisamos cuando se confirme el pago.`} Tu ticket: ${ticket}`
    : "";

  return (
    <div className="min-h-dvh bg-slate-50 pb-10" style={estilo}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--brand)]">Punto de venta</p>
            <p className="truncate text-base font-semibold text-slate-900">{vendedor.nombre}</p>
          </div>
          <button type="button" onClick={salir} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"><LogOut className="h-4 w-4" /> Salir</button>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        <section className="grid grid-cols-3 gap-2">
          {[["Vendidas", vendedor.boletas.toLocaleString("es-PY")], ["Cobrado", gs(vendedor.monto)], ["A rendir", gs(vendedor.por_rendir)]].map(([l, v]) => (
            <div key={l} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{l}</p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-900">{v}</p>
            </div>
          ))}
        </section>

        {!sorteos.length ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No hay sorteos a la venta en este momento.</p>
        ) : hecha ? (
          <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-full ${hecha.estado === "confirmada" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                {hecha.estado === "confirmada" ? <Check className="h-6 w-6" /> : <Ticket className="h-6 w-6" />}
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-900">Venta N° {hecha.numero} registrada</p>
                <p className="text-sm text-slate-500">{hecha.comprador_nombre} · {hecha.cantidad} boleta{hecha.cantidad === 1 ? "" : "s"} · {gs(hecha.monto)}</p>
              </div>
            </div>
            {hecha.estado === "confirmada" ? (
              <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0">
                {hecha.numeros.map((n) => <li key={n} className="rounded-xl bg-[color-mix(in_srgb,var(--brand)_10%,white)] py-2 text-center font-bold tabular-nums text-[var(--brand)]">{n}</li>)}
              </ul>
            ) : (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">El pago por transferencia queda para revisar. Los números se le confirman al comprador cuando lo aprueben.</p>
            )}
            {ticket ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {wa ? (
                  <a href={`https://wa.me/${wa}?text=${encodeURIComponent(textoWa)}`} target="_blank" rel="noopener noreferrer" className={`${PRIMARIO} no-underline`}>
                    <MessageCircle className="h-5 w-5" /> Mandar por WhatsApp
                  </a>
                ) : null}
                <Copiar texto={ticket} label="Copiar link del ticket" />
              </div>
            ) : null}
            <button type="button" className={SECUNDARIO} onClick={nueva}><Plus className="h-4 w-4" /> Nueva venta</button>
          </section>
        ) : (
          <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); void vender(); }}>
            <h1 className="text-base font-semibold text-slate-900">Nueva venta</h1>
            {sorteos.length > 1 ? (
              <Select value={sorteoId} onChange={(v) => { setSorteoId(v); setCantidad(1); setOtra(""); }} options={sorteos.map((x) => [x.id, x.nombre] as [string, string])} block etiqueta="Sorteo" />
            ) : <p className="text-sm font-medium text-slate-700">{s?.nombre}</p>}

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Boletas{quedan != null ? ` · te quedan ${quedan.toLocaleString("es-PY")} en tu cupo` : ""}</p>
              <div className="flex flex-wrap gap-2">
                {opciones.map((n) => (
                  <button key={n} type="button" onClick={() => { setCantidad(n); setOtra(""); }}
                    className={`min-h-11 rounded-xl border px-3.5 text-sm font-semibold ${cantidad === n && !otra ?"border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_10%,white)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700"}`}>
                    {n}
                  </button>
                ))}
                <input className={`${INPUT} !min-h-11 w-24`} inputMode="numeric" aria-label="Otra cantidad" placeholder="Otra"
                  value={otra} onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtra(v);
                    setCantidad(Math.max(1, Number(v) || 1));
                  }} />
              </div>
              <p className="mt-2 text-sm text-slate-600">Total: <b className="text-lg tabular-nums text-slate-900">{gs(precio)}</b>{s && precio < cantidad * s.precio ? <span className="ml-2 text-xs font-semibold text-emerald-700">combo</span> : null}</p>
            </div>

            <div className="grid gap-3">
              <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido del comprador" autoComplete="off" maxLength={120} aria-label="Nombre y apellido" />
              <div className="grid grid-cols-2 gap-3">
                <input className={INPUT} value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Cédula" inputMode="numeric" maxLength={20} aria-label="Cédula" />
                <input className={INPUT} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Celular" inputMode="tel" maxLength={30} aria-label="Celular" />
              </div>
              <input className={INPUT} value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ciudad (opcional)" maxLength={80} aria-label="Ciudad" />
              <p className="-mt-1 text-[11px] text-slate-500">Con el celular le mandás el ticket por WhatsApp.</p>
            </div>

            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cómo pagó">
              {([["efectivo", "Efectivo", Banknote], ["transferencia", "Transferencia", Landmark]] as const).map(([v, l, Icono]) => (
                <button key={v} type="button" role="radio" aria-checked={metodo === v} onClick={() => setMetodo(v)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${metodo === v ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_10%,white)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700"}`}>
                  <Icono className="h-4 w-4" /> {l}
                </button>
              ))}
            </div>
            {metodo === "transferencia" ? (
              <input className={INPUT} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Nº de operación (opcional)" maxLength={60} aria-label="Número de operación" />
            ) : <p className="-mt-2 text-[11px] text-slate-500">En efectivo la venta queda confirmada y la plata la rendís después.</p>}

            {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <button type="submit" className={PRIMARIO} disabled={busy || !valida}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ticket className="h-5 w-5" />} Registrar venta · {gs(precio)}
            </button>
          </form>
        )}

        <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Share2 className="h-4 w-4 text-[var(--brand)]" /> Tu link para compartir</h2>
          <p className="text-xs text-slate-500">Quien compre desde este link queda a tu nombre (código {vendedor.codigo}){vendedor.comision_pct ? ` · tu comisión: ${vendedor.comision_pct}%` : ""}.</p>
          <p className="break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{linkRef}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Copiar texto={linkRef} label="Copiar link" />
            <a className={`${SECUNDARIO} no-underline`} href={`https://wa.me/?text=${encodeURIComponent(`¡Participá del sorteo! Comprá tus boletas acá: ${linkRef}`)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> Compartir por WhatsApp
            </a>
          </div>
        </section>

        {datos.ultimas.length ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Tus últimas ventas</h2>
            <ul className="m-0 mt-2 list-none divide-y divide-slate-100 p-0">
              {datos.ultimas.map((o) => {
                const [txt, cls] = ESTADO[o.estado] ?? [o.estado, "bg-slate-100 text-slate-600"];
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{o.comprador_nombre}</p>
                      <p className="text-xs text-slate-500">N° {o.numero} · {o.cantidad} boleta{o.cantidad === 1 ? "" : "s"} · {o.metodo_pago === "efectivo" ? "efectivo" : "transferencia"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(o.monto)}</p>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{txt}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
