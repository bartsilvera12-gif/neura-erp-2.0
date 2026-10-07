"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import { clienteConfig } from "@/cliente.config";
import { formatGs } from "@/modules/caja/lib";

const TEAL = clienteConfig.color;

type Item = {
  id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  precio_venta: number;
  tipo_precio: string;
  tipo_iva: string;
  monto_iva: number;
  total_linea: number;
};
type Venta = {
  id: string;
  numero_control: string;
  fecha: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  estado: string;
  tipo_venta: string;
  metodo_pago: string | null;
};
type Detalle = { venta: Venta; items: Item[]; cliente_nombre: string };

const METODO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
  qr: "QR",
  billetera: "Billetera",
  otro: "Otro",
};
const PRECIO: Record<string, string> = { minorista: "Minorista", mayorista: "Mayorista", distribuidor: "Distribuidor", costo: "Costo" };

export function VentaDetalle({ ventaId, onClose, onAnulada }: { ventaId: string; onClose: () => void; onAnulada: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [anulando, setAnulando] = useState(false);

  useEffect(() => {
    apiFetch<Detalle>(`/api/ventas/${ventaId}`).then(setD).catch((e) => setError((e as Error).message)).finally(() => setCargando(false));
  }, [ventaId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function anular() {
    setAnulando(true);
    try {
      await apiFetch(`/api/ventas/${ventaId}/anular`, { method: "POST" });
      onAnulada();
    } catch (e) {
      setError((e as Error).message);
      setAnulando(false);
    }
  }

  // Abre el MISMO ticket térmico del POS (/api/ventas/[id]/ticket) en pestaña
  // normal. La auth del 2.0 es por Bearer, así que lo traemos con el token y lo
  // abrimos como blob (una pestaña nueva directa no llevaría el token).
  async function verComprobante() {
    if (!d) return;
    try {
      const { data } = await browserClient().auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/ventas/${d.venta.id}/ticket?auto=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const html = await res.text();
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort */ }
  }

  const venta = d?.venta;
  const anulada = venta?.estado === "anulada";
  const credito = venta?.tipo_venta === "CREDITO";

  // Portal a <body>: ningún contenedor (scroll/transform) lo recorta. Overlay con
  // scroll propio y centrado: si es más alto que la pantalla, se scrollea, no se corta.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-900/30" onClick={onClose}>
     <div className="flex min-h-full items-center justify-center p-4">
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 24px 50px -24px rgba(2,48,71,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Venta {venta?.numero_control ?? "…"}</h2>
            {venta ? <p className="mt-0.5 text-xs text-slate-500">{new Date(venta.fecha).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {cargando ? (
            <p className="py-8 text-center text-sm text-slate-400">Cargando…</p>
          ) : error ? (
            <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          ) : d && venta ? (
            <>
              {anulada ? <p className="mb-4 rounded-lg bg-rose-50 p-2.5 text-center text-xs font-semibold uppercase tracking-wide text-rose-700">Venta anulada</p> : null}
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Campo label="Cliente" valor={d.cliente_nombre} />
                <Campo label="Condición">
                  <span className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: credito ? "#ea580c" : "#16a34a" }} />
                    {credito ? "Crédito" : "Contado"}
                  </span>
                </Campo>
                <Campo label="Forma de pago" valor={credito ? "A crédito" : (METODO[venta.metodo_pago ?? "efectivo"] ?? "—")} />
                <Campo label="Precio" valor={PRECIO[d.items[0]?.tipo_precio ?? "minorista"] ?? "Minorista"} />
                <Campo label="Salió de" valor="Mostrador" />
              </div>

              <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Productos ({d.items.length})</p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{i.producto_nombre}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{i.cantidad} × {formatGs(i.precio_venta)}{i.sku ? ` · ${i.sku}` : ""}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatGs(i.total_linea)}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">IVA {i.tipo_iva}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3.5 space-y-1.5 rounded-xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between text-sm text-slate-500"><span>IVA incluido</span><span className="tabular-nums">{formatGs(venta.monto_iva)}</span></div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5"><span className="text-sm font-semibold text-slate-900">Total</span><span className="text-lg font-bold tabular-nums text-slate-900">{formatGs(venta.total)}</span></div>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          {!anulada && venta ? (
            confirmar ? (
              <div className="flex items-center gap-2">
                <button onClick={anular} disabled={anulando} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {anulando ? "Anulando…" : "Confirmar anulación"}
                </button>
                <button onClick={() => setConfirmar(false)} disabled={anulando} className="h-10 whitespace-nowrap rounded-xl px-3 text-sm font-medium text-slate-500 hover:text-slate-700">Cancelar</button>
              </div>
            ) : (
              <button onClick={() => setConfirmar(true)} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 transition hover:bg-rose-50">
                <Trash2 className="h-4 w-4" /> Anular venta
              </button>
            )
          ) : <span />}
          <button onClick={verComprobante} className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-5 text-sm font-semibold text-white transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
            <FileText className="h-4 w-4" /> Ver comprobante
          </button>
        </div>
      </div>
     </div>
    </div>,
    document.body,
  );
}

function Campo({ label, valor, children }: { label: string; valor?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      {children ?? <p className="mt-1 text-[15px] text-slate-800">{valor}</p>}
    </div>
  );
}
