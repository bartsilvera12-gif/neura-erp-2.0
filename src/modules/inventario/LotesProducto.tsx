"use client";

/**
 * Sección "Lotes" de la ficha del producto (solo productos que controlan lotes):
 * tabla Lote · Vence · Unidades · Estado (Vencido rojo / Vence pronto ámbar / OK) y la
 * acción "Dar de baja" (vencido, roto…) que saca las unidades de ESE lote y queda en el
 * kardex. Abajo, si el stock no coincide con los lotes, se muestra lo que está sin lote.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, PackageX } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { parseNumero } from "@/lib/imports/consolidacion-productos";
import {
  chipEstado, diasAlerta, diasHasta, fechaCorta, textoDias,
  type LoteProducto, type LotesDeProducto,
} from "@/modules/inventario/vencimientos";

const fmt = (n: number) => Number(n).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";

export function LotesProducto({
  productoId,
  unidad,
  puedeEditar,
  onStockCambiado,
}: {
  productoId: string;
  unidad: string;
  puedeEditar: boolean;
  /** después de una baja: el stock nuevo del producto */
  onStockCambiado?: (stock: number) => void;
}) {
  const [datos, setDatos] = useState<LotesDeProducto | null>(null);
  const [error, setError] = useState(false);
  const [baja, setBaja] = useState<LoteProducto | null>(null);
  const [alerta, setAlerta] = useState(30);

  const cargar = useCallback(() => {
    setError(false);
    return apiFetch<LotesDeProducto>(`/api/productos/${productoId}/lotes`)
      .then((d) => { setDatos(d); return d; })
      .catch(() => { setError(true); return null; });
  }, [productoId]);

  useEffect(() => {
    setAlerta(diasAlerta());
    void cargar();
  }, [cargar]);

  if (error) return <p className="text-xs text-rose-600">No se pudieron cargar los lotes.</p>;
  if (!datos) return <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando lotes…</p>;

  const u = unidad === "Unidad" ? "u." : unidad;
  return (
    <div>
      {datos.lotes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
          No hay lotes con unidades. Cargá una compra o un movimiento de entrada con lote y vencimiento.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2">Vence</th>
                <th className="px-3 py-2 text-right">Unidades</th>
                <th className="px-3 py-2 text-center">Estado</th>
                {puedeEditar ? <th className="w-px px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {datos.lotes.map((l) => {
                const dias = diasHasta(l.vencimiento, datos.hoy);
                const chip = chipEstado(dias, alerta);
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      <p className="font-mono text-xs font-semibold text-slate-800">{l.numero}</p>
                      <p className="text-[10px] text-slate-400">{l.compra_numero ? `${l.compra_numero}${l.proveedor_nombre ? ` · ${l.proveedor_nombre}` : ""}` : "Movimiento manual"}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">
                      {fechaCorta(l.vencimiento)}
                      <span className="block text-[10px] text-slate-400">{textoDias(dias)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-900">{fmt(l.cantidad)} <span className="text-[10px] font-normal text-slate-400">{u}</span></td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.clase}`}>{chip.texto}</span>
                    </td>
                    {puedeEditar ? (
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => setBaja(l)} className="whitespace-nowrap rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                          Dar de baja
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        En lotes: <strong className="tabular-nums text-slate-700">{fmt(datos.en_lotes)} {u}</strong> · stock {fmt(datos.stock_actual)} {u}
        {datos.sin_lote > 0 ? <> · <span className="font-semibold text-slate-700">{fmt(datos.sin_lote)} {u} sin lote</span> (stock que tenía antes de activar lotes o de un ajuste)</> : null}
        {datos.sin_lote < 0 ? <> · <span className="font-semibold text-amber-700">{fmt(-datos.sin_lote)} {u} vendidas sin lote vigente</span> (los lotes dicen más de lo que hay: revisá y dá de baja lo que falte)</> : null}
        . La caja descuenta primero el que vence antes y no vende los vencidos.
      </p>

      {baja ? (
        <DarDeBajaLote
          lote={baja}
          unidad={u}
          onClose={() => setBaja(null)}
          onHecho={async () => {
            setBaja(null);
            const d = await cargar();
            if (d) onStockCambiado?.(Number(d.stock_actual));
          }}
        />
      ) : null}
    </div>
  );
}

const MOTIVOS: [string, string][] = [
  ["Vencido", "Vencido"],
  ["Roto / dañado", "Roto / dañado"],
  ["Devuelto al proveedor", "Devuelto al proveedor"],
  ["Otro", "Otro motivo"],
];

/** Modal "Dar de baja lote": cantidad (por defecto todo el lote) y motivo. */
export function DarDeBajaLote({ lote, unidad, onClose, onHecho }: { lote: { id: string; numero: string; vencimiento: string; cantidad: number; producto?: string }; unidad: string; onClose: () => void; onHecho: () => void }) {
  const [cantidad, setCantidad] = useState(String(Number(lote.cantidad)));
  const [motivo, setMotivo] = useState("Vencido");
  const [detalle, setDetalle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cant = parseNumero(cantidad) ?? NaN;
  const motivoFinal = motivo === "Otro" ? detalle.trim() : detalle.trim() ? `${motivo} — ${detalle.trim()}` : motivo;
  const invalido = !(cant > 0) || cant > Number(lote.cantidad) || !motivoFinal;

  async function confirmar() {
    if (invalido || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/inventario/lotes/${lote.id}/baja`, {
        method: "POST",
        body: JSON.stringify({ cantidad: cant, motivo: motivoFinal }),
      });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]" fondo="bg-slate-900/40 backdrop-blur-sm">
      <div className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5`} onClick={(e) => e.stopPropagation()} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50 text-rose-600"><PackageX className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Dar de baja lote</h3>
            <p className="truncate text-xs text-slate-500">
              {lote.producto ? `${lote.producto} · ` : ""}Lote <span className="font-mono font-semibold">{lote.numero}</span> · vence {fechaCorta(lote.vencimiento)} · quedan {fmt(lote.cantidad)} {unidad}
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={ET}>Unidades a dar de baja</span>
              <input autoFocus inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ""))} className={`${INPUT} text-right tabular-nums`} />
            </label>
            <div>
              <span className={ET}>Motivo</span>
              <Select value={motivo} onChange={setMotivo} options={MOTIVOS} block />
            </div>
          </div>
          <label className="block">
            <span className={ET}>{motivo === "Otro" ? "Contá el motivo *" : <>Detalle <span className="font-normal text-slate-400">(opcional)</span></>}</span>
            <input value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={90} placeholder="Ej: se cortó la cadena de frío" className={INPUT} />
          </label>
          {cant > Number(lote.cantidad) ? <p className="text-xs font-medium text-rose-600">Del lote quedan {fmt(lote.cantidad)}.</p> : null}
          <p className="text-xs text-slate-500">Baja el stock y queda en Movimientos como ajuste manual, con el lote y el motivo.</p>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={busy || invalido} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Dando de baja…" : `Dar de baja ${Number.isFinite(cant) && cant > 0 ? fmt(cant) : ""} ${unidad}`}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

