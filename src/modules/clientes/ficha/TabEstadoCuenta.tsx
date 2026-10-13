"use client";

/**
 * Pestaña "Estado de cuenta" de la ficha, igual que el sistema actual: "Facturas del
 * cliente" con Venta al contado / Registrar pago (y el PDF del estado de cuenta del 2.0) y
 * la tabla Número, Fecha, Vencimiento, Total, Estado y Acción (Registrar pago, Ver,
 * Anular). En el 2.0 las "facturas" son las ventas del cliente; vencimiento y saldo salen
 * de su cuenta a cobrar (estado_cuenta_cliente). Debajo, los cobros registrados (recibo
 * PDF y anular), que en el 2.0 solo se ven acá.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { CapaModal } from "@/components/CapaModal";
import { hoyPY, TZ_PY } from "@/lib/fecha/paraguay";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { nombreMetodo, type CuentaCobrar, type EstadoCuenta } from "@/modules/clientes/cobros";
import type { Venta } from "@/modules/clientes/ficha/tipos";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">{children}</p>;
}

/** Fecha date-safe: corta YYYY-MM-DD sin convertir zona (para columnas DATE). */
function formatFecha(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : "";
}
/** Día en Paraguay de un timestamp (YYYY-MM-DD). */
const diaPY = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_PY }));
const fechaHoraPY = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric" });
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;

type EstadoUi = "Pagado" | "Pendiente" | "Vencido" | "Anulado";
/** Estado como el sistema actual: anulada, pagada (contado o saldada), vencida (saldo y vencimiento pasado) o pendiente. */
function estadoUi(v: Venta, cxc: CuentaCobrar | undefined, hoy: string): EstadoUi {
  if (v.estado === "anulada" || cxc?.estado === "anulada") return "Anulado";
  if (!cxc) return "Pagado";
  if (cxc.estado === "pagada" || Number(cxc.saldo) <= 0) return "Pagado";
  if (cxc.dias_atraso > 0 || cxc.vencimiento < hoy) return "Vencido";
  return "Pendiente";
}
const CLASES_ESTADO: Record<EstadoUi, string> = {
  Pagado: "bg-green-100 text-green-700",
  Vencido: "bg-red-100 text-red-700",
  Anulado: "bg-gray-100 text-gray-500",
  Pendiente: "bg-amber-100 text-amber-700",
};

export function TabEstadoCuenta({ clienteId, ventas, recarga, esAdmin, onRegistrarPago, onCambio }: {
  clienteId: string;
  ventas: Venta[];
  recarga: number;
  esAdmin: boolean;
  /** abre Registrar cobro (con la cuenta de esa venta elegida, o general) */
  onRegistrarPago: (cxcId: string | null) => void;
  /** se anuló una venta o un cobro: la ficha recarga */
  onCambio: () => void;
}) {
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const [anulandoVenta, setAnulandoVenta] = useState<Venta | null>(null);
  const [anulandoCobro, setAnulandoCobro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [bajandoPdf, setBajandoPdf] = useState(false);
  const hoy = hoyPY();

  const cargar = useCallback(() => {
    apiFetch<EstadoCuenta>(`/api/clientes/${clienteId}/estado-cuenta`).then((r) => { setEc(r); setError(null); }).catch((e) => setError((e as Error).message));
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar, recarga]);

  const cxcPorVenta = useMemo(() => new Map((ec?.cuentas ?? []).map((c) => [c.venta_id, c])), [ec]);

  async function anularVenta() {
    if (!anulandoVenta) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/ventas/${anulandoVenta.id}/anular`, { method: "POST" });
      setAnulandoVenta(null);
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function anularCobro(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/cobros/${id}/anular`, { method: "POST", body: JSON.stringify({ motivo }) });
      setAnulandoCobro(null);
      setMotivo("");
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function bajarPdf() {
    setBajandoPdf(true);
    try { await descargarArchivo(`/api/clientes/${clienteId}/estado-cuenta/pdf`, "estado-cuenta.pdf"); } catch { /* best-effort */ } finally { setBajandoPdf(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Facturas del cliente</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void bajarPdf()}
            disabled={bajandoPdf}
            className="inline-flex items-center gap-1.5 text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            {bajandoPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Estado de cuenta PDF
          </button>
          <Link
            href={`/caja/nueva?cliente=${encodeURIComponent(clienteId)}`}
            className="text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg"
          >
            Venta al contado
          </Link>
          <button
            type="button"
            onClick={() => onRegistrarPago(null)}
            className="text-sm font-medium text-[#4FAEB2] hover:text-[#3F8E91]"
          >
            Registrar pago
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {ventas.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No hay facturas registradas.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Número", "Fecha", "Vencimiento", "Total", "Estado"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                ))}
                <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ventas.map((v) => {
                const cxc = cxcPorVenta.get(v.id);
                const est = estadoUi(v, cxc, hoy);
                const saldo = est === "Anulado" ? 0 : Number(cxc?.saldo ?? 0);
                return (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-800">
                      <button type="button" onClick={() => setViendo(v.id)} className="text-[#4FAEB2] hover:underline font-semibold">
                        {v.numero_control}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatFecha(diaPY(v.fecha))}</td>
                    <td className="px-4 py-3 text-slate-600">{formatFecha(cxc?.vencimiento ?? diaPY(v.fecha))}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{gs(v.total)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CLASES_ESTADO[est]}`}>{est}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex flex-nowrap items-center justify-end gap-2">
                        {saldo > 0 && cxc ? (
                          <button type="button" onClick={() => onRegistrarPago(cxc.id)} className="text-xs font-medium text-[#4FAEB2] hover:underline">
                            Registrar pago
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setViendo(v.id)} className="text-xs font-medium text-slate-500 hover:text-[#4FAEB2] hover:underline">
                          Ver
                        </button>
                        {esAdmin && est !== "Anulado" ? (
                          <button
                            type="button"
                            onClick={() => { setError(null); setAnulandoVenta(v); }}
                            title="Anular venta (devuelve el stock y revierte el cobro)"
                            className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                          >
                            Anular
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {ventas.length >= 50 ? <p className="text-center text-[11px] text-slate-400">Se muestran las últimas 50 ventas.</p> : null}

      {/* Cobros (recibos): en el 2.0 se consultan y anulan desde la ficha. */}
      {ec && ec.cobros.length > 0 ? (
        <div className="space-y-4 pt-4">
          <SectionTitle>Cobros del cliente</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Recibo", "Fecha", "Medio", "Aplicado a", "Total"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                  ))}
                  <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ec.cobros.map((k) => (
                  <tr key={k.id} className={`hover:bg-slate-50 ${k.anulado_at ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 font-mono text-slate-800">
                      <span className={k.anulado_at ? "line-through" : ""}>{k.numero_recibo}</span>
                      {k.anulado_at ? <span className="ml-2 text-xs font-sans font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Anulado</span> : null}
                      {k.anulado_at && k.anulado_motivo ? <span className="block font-sans text-[11px] text-slate-500">{k.anulado_motivo}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{fechaHoraPY(k.fecha)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {(k.pagos ?? []).map((p) => `${nombreMetodo(p.metodo)}${p.referencia ? ` (${p.referencia})` : ""}`).join(" + ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{k.aplicado_a?.length ? k.aplicado_a.map((a) => a.numero).join(", ") : "A favor"}</td>
                    <td className={`px-4 py-3 font-semibold ${k.anulado_at ? "text-slate-400 line-through" : "text-slate-800"}`}>{gs(k.total)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex flex-nowrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => descargarArchivo(`/api/cobros/${k.id}/pdf`, `recibo-${k.numero_recibo}.pdf`).catch(() => {})}
                          className="text-xs font-medium text-slate-500 hover:text-[#4FAEB2] hover:underline"
                        >
                          Recibo
                        </button>
                        {!k.anulado_at ? (
                          <button
                            type="button"
                            onClick={() => { setError(null); setMotivo(""); setAnulandoCobro(k.id); }}
                            className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
                          >
                            Anular
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(); onCambio(); }} />
      ) : null}

      {/* Confirmar anulación (mismo modal que el sistema actual) */}
      {anulandoVenta || anulandoCobro ? (
        <CapaModal onClose={busy ? undefined : () => { setAnulandoVenta(null); setAnulandoCobro(null); }} z="z-[120]" fondo="bg-black/50">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {anulandoVenta ? (
              <>
                <h4 className="text-sm font-bold text-slate-900">Anular venta {anulandoVenta.numero_control}</h4>
                <p className="text-xs leading-relaxed text-slate-600">
                  Esta acción marca la venta como <span className="font-semibold">Anulada</span>: devuelve el stock y revierte su cobro.
                  No elimina la venta ni sus registros.
                </p>
              </>
            ) : (
              <>
                <h4 className="text-sm font-bold text-slate-900">Anular cobro</h4>
                <p className="text-xs leading-relaxed text-slate-600">
                  La deuda vuelve a esas ventas y el movimiento de caja se anula.
                </p>
                <label className="block text-xs font-semibold text-slate-600">
                  Motivo (obligatorio)
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                    placeholder="Ej.: se cargó al cliente equivocado"
                  />
                </label>
              </>
            )}
            {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setAnulandoVenta(null); setAnulandoCobro(null); }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || (!!anulandoCobro && !motivo.trim())}
                onClick={() => void (anulandoVenta ? anularVenta() : anularCobro(anulandoCobro!))}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Anulando…" : "Confirmar anulación"}
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </div>
  );
}
