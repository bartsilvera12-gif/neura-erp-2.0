"use client";

/**
 * Historial de costos de compra (ficha del producto): cuánto se pagó cada vez, a quién,
 * con qué factura y cuánto subió o bajó contra la compra anterior. Muestra las últimas 5
 * y el resto con "Ver todas".
 */
import { useEffect, useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { TZ_PY } from "@/lib/fecha/paraguay";

export type CompraCosto = {
  id: string;
  fecha: string;
  cantidad: number;
  costo: number;
  proveedor: string | null;
  factura: string | null;
  origen: string;
  referencia: string | null;
  usuario: string | null;
  variacion_pct: number | null;
};
export type HistorialCostosData = { costo_promedio: number | null; total_compras: number; compras: CompraCosto[] };

const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

export function HistorialCostos({ productoId, unidad }: { productoId: string; unidad: string }) {
  const [data, setData] = useState<HistorialCostosData | null>(null);
  const [error, setError] = useState(false);
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiFetch<HistorialCostosData>(`/api/productos/${productoId}/costos`)
      .then((r) => vivo && setData(r))
      .catch(() => vivo && setError(true));
    return () => { vivo = false; };
  }, [productoId]);

  if (error) return <p className="text-xs text-rose-600">No se pudo cargar el historial de costos.</p>;
  if (!data) {
    return <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando historial…</p>;
  }
  if (!data.compras.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
        Todavía no hay compras registradas. Cargalas en <strong className="font-semibold text-slate-700">Inventario › Movimientos › Nuevo movimiento</strong> como
        entrada por compra, con el costo, el proveedor y la factura.
      </p>
    );
  }

  const ultima = data.compras[0];
  const visibles = todas ? data.compras : data.compras.slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Última compra</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">{gs(ultima.costo)}</p>
          <p className="truncate text-[11px] text-slate-400">{fecha(ultima.fecha)}{ultima.proveedor ? ` · ${ultima.proveedor}` : ""}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] text-slate-500">Costo promedio actual</p>
          <p className="text-sm font-bold tabular-nums text-slate-900">{gs(Number(data.costo_promedio))}</p>
          <p className="text-[11px] text-slate-400">{data.total_compras === 1 ? "1 compra" : `${data.total_compras} compras`}</p>
        </div>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
        {visibles.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">
                {fecha(c.fecha)} <span className="font-normal text-slate-400">· {num(c.cantidad)} {unidad === "Unidad" ? "u." : unidad}</span>
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {c.origen === "inventario_inicial" ? "Inventario inicial" : c.proveedor || "Sin proveedor"}
                {c.factura ? ` · Fact. ${c.factura}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-slate-900">{gs(c.costo)}</p>
              <Variacion pct={c.variacion_pct} />
            </div>
          </li>
        ))}
      </ul>
      {data.compras.length > 5 ? (
        <button type="button" onClick={() => setTodas((v) => !v)} className="text-xs font-semibold text-[var(--brand)] hover:underline">
          {todas ? "Ver menos" : `Ver todas (${data.compras.length})`}
        </button>
      ) : null}
    </div>
  );
}

/** ▲ subió (rojo: cuesta más) / ▼ bajó (verde) contra la compra anterior. */
export function Variacion({ pct }: { pct: number | null }) {
  if (pct == null) return <p className="text-[11px] text-slate-400">primera compra</p>;
  if (Number(pct) === 0) return <p className="text-[11px] text-slate-400">igual que la anterior</p>;
  const sube = Number(pct) > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <p className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${sube ? "text-rose-600" : "text-emerald-600"}`}>
      <Icono className="h-3 w-3" /> {sube ? "+" : "−"}{Math.abs(Number(pct)).toLocaleString("es-PY")} %
    </p>
  );
}
