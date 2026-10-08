"use client";

/**
 * Pestaña "Cuenta corriente" de la ficha: ventas a crédito (con vencimiento, lo cobrado y
 * lo que falta; las vencidas en rojo) y los cobros (recibo PDF, a qué se aplicó, anular).
 */
import { useCallback, useEffect, useState } from "react";
import { Ban, Download, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { nombreMetodo, type EstadoCuenta } from "@/modules/clientes/cobros";

const BRAND = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const ESTADO: Record<string, { t: string; c: string }> = {
  pendiente: { t: "Pendiente", c: "bg-sky-50 text-sky-700" },
  parcial: { t: "Pagada en parte", c: "bg-amber-50 text-amber-700" },
  pagada: { t: "Pagada", c: "bg-emerald-50 text-emerald-700" },
  anulada: { t: "Anulada", c: "bg-slate-100 text-slate-500" },
};

export function CuentaCorriente({ clienteId, recarga, onCambio }: { clienteId: string; recarga: number; onCambio: () => void }) {
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<EstadoCuenta>(`/api/clientes/${clienteId}/estado-cuenta`).then(setEc).catch((e) => setError((e as Error).message));
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar, recarga]);

  async function anular(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/cobros/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      setAnulando(null);
      setMotivo("");
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ec) return error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>;

  const cuentas = ec.cuentas.filter((c) => verTodas || c.estado === "pendiente" || c.estado === "parcial");

  return (
    <div className="space-y-6">
      {error ? (
        <div className="flex items-start justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span><button onClick={() => setError(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Ventas a crédito</p>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={verTodas} onChange={(e) => setVerTodas(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            Ver también las pagadas
          </label>
        </div>
        {cuentas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">{ec.cuentas.length ? "No debe nada." : "Todavía no le vendiste a crédito."}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${BRAND}26`, backgroundColor: `${BRAND}0d`, color: BRAND }}>
                <th className="px-4 py-2.5">Venta</th>
                <th className="px-4 py-2.5">Vence</th>
                <th className="px-4 py-2.5 text-right">Importe</th>
                <th className="px-4 py-2.5 text-right">Cobrado</th>
                <th className="px-4 py-2.5 text-right">Debe</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cuentas.map((c) => (
                <tr key={c.id} className={c.estado === "anulada" ? "opacity-50" : ""}>
                  <td className="px-4 py-2.5"><span className="font-mono text-xs font-semibold text-slate-800">{c.numero}</span><span className="block text-[11px] text-slate-500">{dia(c.fecha_emision)}</span></td>
                  <td className={`px-4 py-2.5 text-xs ${c.dias_atraso > 0 ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                    {dia(c.vencimiento)}{c.dias_atraso > 0 ? <span className="block">hace {c.dias_atraso} días</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{gs(c.monto)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{Number(c.cobrado) ? gs(c.cobrado) : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{Number(c.saldo) ? gs(c.saldo) : "—"}</td>
                  <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.dias_atraso > 0 ? "bg-rose-50 text-rose-700" : ESTADO[c.estado].c}`}>{c.dias_atraso > 0 ? "Vencida" : ESTADO[c.estado].t}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Cobros</p>
        {ec.cobros.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Todavía no le cobraste nada.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ec.cobros.map((k) => (
              <li key={k.id} className={`px-4 py-3 ${k.anulado_at ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      <span className={`font-mono text-xs ${k.anulado_at ? "line-through" : ""}`}>{k.numero_recibo}</span>
                      <span className="ml-2 text-xs font-normal text-slate-500">{fecha(k.fecha)}{k.usuario ? ` · ${k.usuario}` : ""}</span>
                      {k.anulado_at ? <span className="ml-2 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Anulado</span> : null}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {(k.pagos ?? []).map((p) => `${nombreMetodo(p.metodo)} ${gs(p.monto)}${p.referencia ? ` (${p.referencia})` : ""}`).join(" + ")}
                      {k.aplicado_a?.length ? ` · aplicado a ${k.aplicado_a.map((a) => a.numero).join(", ")}` : ""}
                      {k.anulado_at && k.anulado_motivo ? ` · anulado: ${k.anulado_motivo}` : ""}
                    </p>
                  </div>
                  <p className={`text-sm font-bold tabular-nums ${k.anulado_at ? "text-slate-400 line-through" : "text-emerald-700"}`}>{gs(k.total)}</p>
                  <button onClick={() => descargarArchivo(`/api/cobros/${k.id}/pdf`, `recibo-${k.numero_recibo}.pdf`).catch(() => {})}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    <Download className="h-3.5 w-3.5" /> Recibo
                  </button>
                  {!k.anulado_at && anulando !== k.id ? (
                    <button onClick={() => { setAnulando(k.id); setMotivo(""); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Ban className="h-3.5 w-3.5" /> Anular
                    </button>
                  ) : null}
                </div>
                {anulando === k.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 p-2.5">
                    <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} placeholder="¿Por qué lo anulás? Ej: se cargó al cliente equivocado"
                      className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-rose-400" />
                    <button onClick={() => anular(k.id)} disabled={busy || !motivo.trim()} className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Anular cobro
                    </button>
                    <button onClick={() => setAnulando(null)} className="text-xs text-slate-500 hover:underline">Volver</button>
                    <p className="w-full text-[11px] text-slate-500">La deuda vuelve a esas ventas y el movimiento de caja se anula.</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
