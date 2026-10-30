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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { TablaTarjetas, useVistaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
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
const TH = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600";
const TD = "px-4 py-3";
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

export function TabEstadoCuenta({ clienteId, ventas, recarga, esAdmin, onRegistrarPago, onCobroCaja, onFacturaContado, onCambio }: {
  clienteId: string;
  ventas: Venta[];
  recarga: number;
  esAdmin: boolean;
  /** abre Registrar cobro (con la cuenta de esa venta elegida, o general) */
  onRegistrarPago: (cxcId: string | null) => void;
  /** Cobro directo en la caja (efectivo y otros medios), baja la deuda al instante. */
  onCobroCaja: () => void;
  onFacturaContado: () => void;
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
  const vistaTarjetas = useVistaTarjetas();

  // Cache en memoria mientras la ficha está abierta: volver a la pestaña la pinta al instante
  // (sin pedir si se vio hace < 30 s); después de un cambio (`recarga`) se pide fresca.
  const cargar = useCallback((fresco = true) => {
    apiFetchSWR<EstadoCuenta>(`/api/clientes/${clienteId}/estado-cuenta`, (r) => { setEc(r); setError(null); }, { fresco, maxEdadMs: 30_000 })
      .catch((e) => setError((e as Error).message));
  }, [clienteId]);
  const recargaVista = useRef(recarga);
  useEffect(() => {
    const fresco = recargaVista.current !== recarga;
    recargaVista.current = recarga;
    cargar(fresco);
  }, [cargar, recarga]);

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

  // Estado de cada venta (pagada / pendiente / vencida / anulada) y su saldo, una sola vez.
  const infoVenta = useMemo(() => new Map(ventas.map((v) => {
    const cxc = cxcPorVenta.get(v.id);
    const est = estadoUi(v, cxc, hoy);
    return [v.id, { cxc, est, saldo: est === "Anulado" ? 0 : Number(cxc?.saldo ?? 0) }];
  })), [ventas, cxcPorVenta, hoy]);

  // Facturas y cobros: tabla en ≥ 768 px; en celular, tarjetas (tocar una factura la abre).
  const colsVentas: ColumnaTabla<Venta>[] = [
    {
      key: "numero", titulo: "Número", movil: "titulo", claseTd: "font-mono text-slate-800",
      celda: (v) => (
        <button type="button" onClick={() => setViendo(v.id)} className="text-[#4FAEB2] hover:underline font-semibold">
          {v.numero_control}
        </button>
      ),
      celdaMovil: (v) => <span className="font-mono">{v.numero_control}</span>,
    },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (v) => formatFecha(diaPY(v.fecha)) },
    {
      key: "venc", titulo: "Vencimiento", movil: "dato", claseTd: "whitespace-nowrap text-slate-600",
      celda: (v) => formatFecha(infoVenta.get(v.id)?.cxc?.vencimiento ?? diaPY(v.fecha)),
    },
    { key: "total", titulo: "Total", movil: "valor", claseTd: "whitespace-nowrap font-semibold text-slate-800", celda: (v) => gs(v.total) },
    {
      key: "estado", titulo: "Estado", movil: "chip",
      celda: (v) => {
        const est = infoVenta.get(v.id)?.est ?? "Pagado";
        return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CLASES_ESTADO[est]}`}>{est}</span>;
      },
    },
    {
      key: "acc", titulo: "Acción", movil: "pie", claseTh: "text-right", claseTd: "text-right whitespace-nowrap",
      celda: (v) => accionesVenta(v, true),
      // En la tarjeta "Ver" sobra: tocar la tarjeta ya abre la venta.
      celdaMovil: (v) => accionesVenta(v, false),
    },
  ];

  function accionesVenta(v: Venta, ver: boolean) {
    const it = infoVenta.get(v.id);
    return (
      <div className="flex flex-nowrap items-center justify-end gap-2">
        {it && it.saldo > 0 && it.cxc ? (
          <button type="button" onClick={() => onRegistrarPago(it.cxc!.id)} className="rounded-lg px-1 text-xs font-medium text-[#4FAEB2] hover:underline max-sm:px-3 max-sm:text-sm max-sm:font-semibold">
            Registrar pago
          </button>
        ) : null}
        {ver ? (
          <button type="button" onClick={() => setViendo(v.id)} className="text-xs font-medium text-slate-500 hover:text-[#4FAEB2] hover:underline">
            Ver
          </button>
        ) : null}
        {esAdmin && it?.est !== "Anulado" ? (
          <button
            type="button"
            onClick={() => { setError(null); setAnulandoVenta(v); }}
            title="Anular venta (devuelve el stock y revierte el cobro)"
            className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 max-sm:px-3 max-sm:text-xs"
          >
            Anular
          </button>
        ) : null}
      </div>
    );
  }

  type CobroFila = EstadoCuenta["cobros"][number];
  const colsCobros: ColumnaTabla<CobroFila>[] = [
    {
      key: "recibo", titulo: "Recibo", movil: "titulo", claseTd: "font-mono text-slate-800",
      celda: (k) => (
        <>
          <span className={k.anulado_at ? "line-through" : ""}>{k.numero_recibo}</span>
          {k.anulado_at ? <span className="ml-2 text-xs font-sans font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Anulado</span> : null}
          {k.anulado_at && k.anulado_motivo ? <span className="block font-sans text-[11px] font-normal text-slate-500">{k.anulado_motivo}</span> : null}
        </>
      ),
    },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "whitespace-nowrap text-slate-600", celda: (k) => fechaHoraPY(k.fecha) },
    {
      key: "medio", titulo: "Medio", movil: "dato", claseTd: "text-slate-600",
      celda: (k) => (k.pagos ?? []).map((p) => `${nombreMetodo(p.metodo)}${p.referencia ? ` (${p.referencia})` : ""}`).join(" + ") || "—",
    },
    { key: "aplicado", titulo: "Aplicado a", movil: "dato", claseTd: "text-slate-600", celda: (k) => (k.aplicado_a?.length ? k.aplicado_a.map((a) => a.numero).join(", ") : "A favor") },
    {
      key: "total", titulo: "Total", movil: "valor",
      claseTd: "whitespace-nowrap font-semibold",
      celda: (k) => <span className={k.anulado_at ? "text-slate-400 line-through" : "text-slate-800"}>{gs(k.total)}</span>,
    },
    {
      key: "acc", titulo: "Acción", movil: "pie", claseTh: "text-right", claseTd: "text-right whitespace-nowrap",
      celda: (k) => (
        <div className="flex flex-nowrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => descargarArchivo(`/api/cobros/${k.id}/pdf`, `recibo-${k.numero_recibo}.pdf`).catch(() => {})}
            className="text-xs font-medium text-slate-500 hover:text-[#4FAEB2] hover:underline max-sm:rounded-lg max-sm:border max-sm:border-slate-200 max-sm:px-3"
          >
            Recibo
          </button>
          {!k.anulado_at ? (
            <button
              type="button"
              onClick={() => { setError(null); setMotivo(""); setAnulandoCobro(k.id); }}
              className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 max-sm:px-3 max-sm:text-xs"
            >
              Anular
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const BTN = "inline-flex items-center justify-center gap-1.5 text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg disabled:opacity-50 max-sm:min-h-11";
  const cerrarAnular = () => { setAnulandoVenta(null); setAnulandoCobro(null); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Facturas del cliente</SectionTitle>
        {/* En celular: grilla de 2 columnas, botones de 44 px. */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <button type="button" onClick={() => void bajarPdf()} disabled={bajandoPdf} className={BTN}>
            {bajandoPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Estado de cuenta PDF
          </button>
          <button type="button" onClick={onFacturaContado} className={BTN}>
            Factura al contado
          </button>
          <button type="button" onClick={onCobroCaja} className={BTN}>
            Cobro en caja
          </button>
          <button
            type="button"
            onClick={() => onRegistrarPago(null)}
            className="inline-flex items-center justify-center text-sm font-medium text-[#4FAEB2] hover:text-[#3F8E91] max-sm:min-h-11 max-sm:rounded-lg max-sm:border max-sm:border-[#4FAEB2]/40 max-sm:bg-[#4FAEB2]/10 max-sm:font-semibold"
          >
            Registrar pago
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {ventas.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No hay facturas registradas.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <TablaTarjetas filas={ventas} columnas={colsVentas} claveFila={(v) => v.id}
            onFila={vistaTarjetas ? (v) => setViendo(v.id) : undefined}
            claseThead="bg-slate-50" claseFila={() => (vistaTarjetas ? "" : "hover:bg-slate-50")} thBase={TH} tdBase={TD} />
        </div>
      )}
      {ventas.length >= 50 ? <p className="text-center text-[11px] text-slate-400">Se muestran las últimas 50 ventas.</p> : null}

      {/* Cobros (recibos): en el 2.0 se consultan y anulan desde la ficha. */}
      {ec && ec.cobros.length > 0 ? (
        <div className="space-y-4 pt-4">
          <SectionTitle>Cobros del cliente</SectionTitle>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <TablaTarjetas filas={ec.cobros} columnas={colsCobros} claveFila={(k) => k.id}
              claseThead="bg-slate-50" claseFila={(k) => `${vistaTarjetas ? "" : "hover:bg-slate-50"} ${k.anulado_at ? "opacity-60" : ""}`} thBase={TH} tdBase={TD} />
          </div>
        </div>
      ) : null}

      {viendo ? (
        <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); cargar(); onCambio(); }} />
      ) : null}

      {/* Confirmar anulación (mismo modal que el sistema actual). Cabecera y pie fijos, el cuerpo
          scrollea: en celular es una hoja inferior y el pie queda a la vista con el teclado. */}
      {anulandoVenta || anulandoCobro ? (
        <CapaModal onClose={busy ? undefined : cerrarAnular} z="z-[120]" fondo="bg-black/50">
          <div className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl`}
            role="dialog" aria-modal="true" aria-labelledby="anular-titulo" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 px-5 pb-2 pt-5">
              <h4 id="anular-titulo" className="text-sm font-bold text-slate-900">
                {anulandoVenta ? `Anular venta ${anulandoVenta.numero_control}` : "Anular cobro"}
              </h4>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
              {anulandoVenta ? (
                <p className="text-xs leading-relaxed text-slate-600">
                  Esta acción marca la venta como <span className="font-semibold">Anulada</span>: devuelve el stock y revierte su cobro.
                  No elimina la venta ni sus registros.
                </p>
              ) : (
                <>
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
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3 max-sm:[&>button]:flex-1">
              <button
                type="button"
                disabled={busy}
                onClick={cerrarAnular}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 max-sm:text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || (!!anulandoCobro && !motivo.trim())}
                onClick={() => void (anulandoVenta ? anularVenta() : anularCobro(anulandoCobro!))}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 max-sm:text-sm"
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
