"use client";

/**
 * /sorteos/vender — Venta manual de boletas (receta 123): mostrador o staff, confirmada al guardar.
 * El monto sale del precio o del combo (nunca a mano). Los números los asigna la base o se eligen.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShoppingCart, Ticket, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import type { MetodoPago, Orden, Sorteo, SorteoFila, Vendedor } from "@/modules/sorteos/tipos";
import { NOMBRE_METODO, precioDe } from "@/modules/sorteos/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, gs, INPUT, nuevaClave, Tarjeta } from "@/modules/sorteos/ui";

const METODOS: MetodoPago[] = ["efectivo", "transferencia", "tarjeta", "otro"];

/** "12, 15 40-42" → [12, 15, 40, 41, 42] (rango máx. 200 por tramo). */
function leerNumeros(t: string): number[] {
  const out = new Set<number>();
  for (const parte of t.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 200; n++) out.add(n);
  }
  return [...out];
}

export default function VenderPage() {
  const [sorteos, setSorteos] = useState<SorteoFila[] | null>(null);
  const [sorteoId, setSorteoId] = useState("");
  const [s, setS] = useState<Sorteo | null>(null);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [cantidad, setCantidad] = useState(1);
  const [elegir, setElegir] = useState(false);
  const [textoNumeros, setTextoNumeros] = useState("");
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [metodo, setMetodo] = useState<MetodoPago>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [clave, setClave] = useState(nuevaClave);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<Orden | null>(null);

  useEffect(() => {
    const pedido = new URLSearchParams(window.location.search).get("sorteo");
    apiFetch<SorteoFila[]>("/api/sorteos").then((l) => {
      const activos = l.filter((x) => x.estado === "activo");
      setSorteos(activos);
      setSorteoId(activos.find((x) => x.id === pedido)?.id ?? activos[0]?.id ?? "");
    }).catch((e: Error) => setError(e.message));
    apiFetch<Vendedor[]>("/api/sorteos/vendedores").then((l) => setVendedores(l.filter((v) => v.activo))).catch(() => setVendedores([]));
  }, []);

  useEffect(() => {
    if (!sorteoId) { setS(null); return; }
    apiFetch<Sorteo>(`/api/sorteos/${sorteoId}`).then(setS).catch((e: Error) => setError(e.message));
  }, [sorteoId]);

  const numeros = useMemo(() => (elegir ? leerNumeros(textoNumeros) : []), [elegir, textoNumeros]);
  const cant = elegir ? numeros.length : cantidad;
  const precio = s && cant > 0 ? precioDe(s, cant) : null;

  const limpiar = useCallback(() => {
    setCantidad(1); setTextoNumeros(""); setNombre(""); setDocumento(""); setTelefono(""); setCiudad("");
    setReferencia(""); setHecha(null); setError(null); setClave(nuevaClave());
  }, []);

  async function vender() {
    if (!s) return;
    setError(null);
    if (nombre.trim().length < 2) return setError("Poné el nombre del comprador.");
    if (!documento.trim() && !telefono.trim()) return setError("Poné la cédula o el teléfono del comprador.");
    if (cant < 1) return setError(elegir ? "Escribí los números que quiere." : "Elegí cuántas boletas.");
    setBusy(true);
    try {
      const o = await apiFetch<Orden>("/api/sorteos/vender", {
        method: "POST",
        body: JSON.stringify({
          sorteo_id: s.id, ...(elegir ? { numeros } : { cantidad }),
          comprador: { nombre: nombre.trim(), documento: documento.trim() || null, telefono: telefono.trim() || null, ciudad: ciudad.trim() || null },
          metodo_pago: metodo, referencia_pago: metodo === "transferencia" ? referencia.trim() || null : null,
          vendedor_id: vendedorId || null, idempotency_key: clave,
        }),
      });
      setHecha(o);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (hecha) {
    return (
      <div className="mx-auto max-w-xl space-y-4 pb-10">
        <div className="rounded-2xl border border-emerald-200 bg-white p-5 text-center shadow-sm sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-2 text-xl font-bold text-slate-900">Venta registrada</h1>
          <p className="text-sm text-slate-500">Compra {hecha.numero} · {hecha.sorteo} · {hecha.comprador_nombre}</p>
          <p className="mt-4 text-3xl font-black tabular-nums text-slate-900">{gs(hecha.monto)}</p>
          {hecha.precio_lista > hecha.monto ? <p className="text-xs text-emerald-700">Combo: {gs(hecha.precio_lista - hecha.monto)} de descuento</p> : null}
          <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">{hecha.numeros.length === 1 ? "Su número" : `Sus ${hecha.numeros.length} números`}</p>
          <ul className="m-0 mt-2 flex list-none flex-wrap justify-center gap-2 p-0">
            {hecha.numeros.map((n) => <li key={n} className="rounded-xl bg-[var(--brand-50,#eef7f7)] px-3 py-1.5 text-lg font-bold tabular-nums tracking-wider text-[var(--brand)]">{n}</li>)}
          </ul>
        </div>
        <div className="flex gap-2 max-sm:[&>*]:flex-1 sm:justify-center">
          <Link href={`/sorteos/ventas?sorteo=${hecha.sorteo_id}`} className={`${BOTON} no-underline`}>Ver las compras</Link>
          <button type="button" className={BOTON_PRIMARIO} onClick={limpiar}><ShoppingCart className="h-4 w-4" /> Nueva venta</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32 lg:pb-10">
      <EncabezadoPagina titulo="Vender boletas" subtitulo="Venta en mostrador: queda confirmada al guardar. El monto sale del precio o del combo." volver={{ href: "/sorteos/panel", label: "Sorteos" }} />

      {sorteos && !sorteos.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No hay sorteos a la venta. <Link href="/sorteos" className="font-medium text-[var(--brand)]">Ir a Sorteos</Link>
        </div>
      ) : null}

      {sorteos?.length ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Tarjeta icono={<Ticket className="h-4 w-4" />} titulo="Boletas">
              <div className="space-y-3">
                {sorteos.length > 1 ? (
                  <Campo label="Sorteo"><Select value={sorteoId} onChange={(v) => { setSorteoId(v); setClave(nuevaClave()); }} block etiqueta="Sorteo" options={sorteos.map((x) => [x.id, x.nombre])} /></Campo>
                ) : <p className="text-sm font-semibold text-slate-800">{sorteos[0].nombre}</p>}
                {s ? (
                  <>
                    <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Cómo elegir las boletas">
                      {[[false, "Por cantidad"], [true, "Elegir números"]].map(([v, t]) => (
                        <button key={String(v)} type="button" role="tab" aria-selected={elegir === v} onClick={() => setElegir(v as boolean)}
                          className={`min-h-10 flex-1 rounded-lg text-sm font-semibold ${elegir === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{t as string}</button>
                      ))}
                    </div>
                    {!elegir ? (
                      <>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {[{ cantidad: 1, precio: s.precio, etiqueta: null }, ...s.combos.filter((c) => c.activo !== false)].map((c) => (
                            <button key={c.cantidad} type="button" onClick={() => setCantidad(c.cantidad)}
                              className={`min-h-16 rounded-xl border px-2 py-2 text-center transition ${cantidad === c.cantidad ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] ring-2 ring-[var(--brand-100)]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                              <span className="block text-base font-bold tabular-nums text-slate-900">{c.cantidad}</span>
                              <span className="block text-xs tabular-nums text-slate-500">{gs(c.precio)}</span>
                            </button>
                          ))}
                        </div>
                        <Campo label="Otra cantidad">
                          <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={cantidad || ""} onChange={(e) => setCantidad(Number(e.target.value.replace(/\D/g, "")) || 0)} />
                        </Campo>
                      </>
                    ) : (
                      <Campo label="Números" ayuda={`Separados por coma o espacio; un rango con guion (ej. 15, 20, 40-45). Del ${s.numero_desde} al ${s.numero_hasta}.`}>
                        <textarea className={`${INPUT} min-h-20 tabular-nums`} value={textoNumeros} onChange={(e) => setTextoNumeros(e.target.value)} placeholder="Ej. 7, 15, 230" />
                      </Campo>
                    )}
                  </>
                ) : <div className="h-24 animate-pulse rounded-xl bg-slate-100" />}
              </div>
            </Tarjeta>

            <Tarjeta icono={<UserRound className="h-4 w-4" />} titulo="Comprador" detalle="Con la cédula o el teléfono queda en Clientes (si ya está, se usa ese).">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Nombre y apellido" className="sm:col-span-2"><input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" maxLength={120} /></Campo>
                <Campo label="Cédula"><input className={INPUT} inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} autoComplete="off" maxLength={30} /></Campo>
                <Campo label="Teléfono"><input className={INPUT} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="off" placeholder="09xx xxx xxx" maxLength={30} /></Campo>
                <Campo label="Ciudad (opcional)" className="sm:col-span-2"><input className={INPUT} value={ciudad} onChange={(e) => setCiudad(e.target.value)} maxLength={80} /></Campo>
              </div>
            </Tarjeta>
          </div>

          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Tarjeta icono={<ShoppingCart className="h-4 w-4" />} titulo="Cobro">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {METODOS.map((m) => (
                    <button key={m} type="button" onClick={() => setMetodo(m)}
                      className={`min-h-11 rounded-xl border text-sm font-semibold ${metodo === m ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]" : "border-slate-200 text-slate-600"}`}>{NOMBRE_METODO[m]}</button>
                  ))}
                </div>
                {metodo === "transferencia" ? (
                  <Campo label="Nº de operación (opcional)" ayuda="Evita que el mismo comprobante se use dos veces."><input className={INPUT} value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={60} /></Campo>
                ) : null}
                {vendedores.length ? (
                  <Campo label="Vendedor (opcional)" ayuda="Para su comisión y su cupo.">
                    <Select value={vendedorId} onChange={setVendedorId} block etiqueta="Vendedor" options={[["", "Sin vendedor"], ...vendedores.map((v) => [v.id, `${v.nombre} (${v.codigo})`] as [string, string])]} />
                  </Campo>
                ) : null}
              </div>
            </Tarjeta>

            {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

            <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-slate-200 max-lg:bg-white/95 max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:backdrop-blur lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-4">
              <div className="flex items-center justify-between gap-3 lg:block">
                <div className="min-w-0 lg:mb-3">
                  <p className="text-xs text-slate-500">{cant > 0 ? `${cant.toLocaleString("es-PY")} boleta${cant === 1 ? "" : "s"}${precio?.combo ? " · combo" : ""}` : "Sin boletas"}</p>
                  <p className="text-2xl font-black tabular-nums text-slate-900">{gs(precio?.monto ?? 0)}</p>
                  {precio && precio.lista > precio.monto ? <p className="text-xs text-emerald-700">Ahorra {gs(precio.lista - precio.monto)}</p> : null}
                </div>
                <button type="button" className={`${BOTON_PRIMARIO} shrink-0 lg:w-full`} disabled={busy || !s || cant < 1} onClick={vender}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Registrar venta
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {!sorteos && !error ? <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {error && !sorteos ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
