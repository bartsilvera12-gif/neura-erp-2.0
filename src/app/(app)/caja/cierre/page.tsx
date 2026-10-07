"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { formatGs } from "@/modules/caja/lib";

const TEAL = clienteConfig.color;

type Arqueo = {
  caja: { id: string; numero_caja: number; fecha_apertura: string };
  monto_apertura: number;
  ingresos: { total: number; por_medio: { medio: string; label: string; cantidad: number; total: number }[] };
  salidas: { total: number; cantidad: number };
  ajustes: { total: number; cantidad: number };
  efectivo_esperado: number;
  credito: { cantidad: number; total: number };
};

type Cierre = { numero_caja: number; contado: number; esperado: number; diferencia: number };

export default function CierrePage() {
  const [arqueo, setArqueo] = useState<Arqueo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cierre, setCierre] = useState<Cierre | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await apiFetch<{ arqueo: Arqueo | null }>("/api/caja/cierre");
      setArqueo(r.arqueo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cerrar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await apiFetch<Cierre>("/api/caja/cierre", {
        method: "POST",
        body: JSON.stringify({ monto_cierre_contado: Number(contado) || 0, observacion: obs || null }),
      });
      setCierre(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <p className="text-sm text-slate-500">Cargando arqueo…</p>;

  // Resultado del cierre.
  if (cierre) {
    const sobra = cierre.diferencia > 0;
    const falta = cierre.diferencia < 0;
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Caja N° {cierre.numero_caja} cerrada</h1>
          <dl className="mt-6 space-y-2 text-left">
            <Fila label="Efectivo esperado" valor={formatGs(cierre.esperado)} />
            <Fila label="Efectivo contado" valor={formatGs(cierre.contado)} />
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <dt className="text-sm font-semibold text-slate-900">Diferencia</dt>
              <dd
                className={`text-xl font-bold tabular-nums ${falta ? "text-rose-600" : sobra ? "text-amber-600" : "text-emerald-600"}`}
              >
                {sobra ? "+" : ""}
                {formatGs(cierre.diferencia)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            {falta ? "Falta efectivo en el cajón." : sobra ? "Sobra efectivo en el cajón." : "El cajón cuadra exacto."}
          </p>
          <Link
            href="/caja"
            className="mt-6 block w-full rounded-xl py-3 text-sm font-semibold text-white"
            style={{ backgroundColor: TEAL }}
          >
            Volver a la caja
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5 flex items-center gap-3">
        <Link href="/caja" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Arqueo y cierre</h1>
          <p className="mt-0.5 text-sm text-slate-500">Compará lo que hay en el cajón con lo que el sistema esperaba.</p>
        </div>
      </header>

      {error ? <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {!arqueo ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No hay ninguna caja abierta para arquear.
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          {/* Resumen del arqueo */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Caja N° {arqueo.caja.numero_caja}
            </p>
            <dl className="mt-3 space-y-2.5">
              <Fila label="Monto de apertura" valor={formatGs(arqueo.monto_apertura)} />
              <div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-sm text-slate-600">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Ingresos
                  </dt>
                  <dd className="text-sm font-medium tabular-nums text-slate-900">{formatGs(arqueo.ingresos.total)}</dd>
                </div>
                {arqueo.ingresos.por_medio.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 pl-5">
                    {arqueo.ingresos.por_medio.map((m) => (
                      <li key={m.medio} className="flex items-center justify-between text-xs text-slate-400">
                        <span>
                          {m.label} ({m.cantidad})
                        </span>
                        <span className="tabular-nums">{formatGs(m.total)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-sm text-slate-600">
                  <TrendingDown className="h-3.5 w-3.5 text-rose-500" /> Salidas ({arqueo.salidas.cantidad})
                </dt>
                <dd className="text-sm font-medium tabular-nums text-slate-900">− {formatGs(arqueo.salidas.total)}</dd>
              </div>
              {arqueo.ajustes.cantidad > 0 ? (
                <Fila label={`Ajustes (${arqueo.ajustes.cantidad})`} valor={formatGs(arqueo.ajustes.total)} />
              ) : null}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                <dt className="text-sm font-semibold text-slate-900">Efectivo esperado</dt>
                <dd className="text-lg font-bold tabular-nums" style={{ color: TEAL }}>
                  {formatGs(arqueo.efectivo_esperado)}
                </dd>
              </div>
              {arqueo.credito.cantidad > 0 ? (
                <p className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
                  Además, {arqueo.credito.cantidad} venta(s) a crédito por {formatGs(arqueo.credito.total)} (no entran al cajón).
                </p>
              ) : null}
            </dl>
          </section>

          {/* Cierre */}
          <aside className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Efectivo contado
              </span>
              <input
                autoFocus
                inputMode="numeric"
                value={contado}
                onChange={(e) => setContado(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-right text-lg font-semibold tabular-nums outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: TEAL }}
              />
            </label>
            {contado !== "" ? (
              <p className="mt-2 text-right text-xs text-slate-500">
                Diferencia: {formatGs((Number(contado) || 0) - arqueo.efectivo_esperado)}
              </p>
            ) : null}
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                Observación
              </span>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={3}
                placeholder="Opcional"
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2"
                style={{ ["--tw-ring-color" as string]: TEAL }}
              />
            </label>
            <button
              type="button"
              onClick={cerrar}
              disabled={guardando || contado === ""}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: TEAL }}
            >
              {guardando ? "Cerrando…" : "Cerrar caja"}
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-slate-900">{valor}</dd>
    </div>
  );
}
