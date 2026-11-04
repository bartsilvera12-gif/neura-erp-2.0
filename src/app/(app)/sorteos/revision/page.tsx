"use client";

/**
 * /sorteos/revision — Pagos por revisar (receta 123): las compras con comprobante esperando que alguien
 * confirme o rechace el pago. Se abren de a una, con la imagen del comprobante al lado de los datos.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { OrdenDetalle } from "@/modules/sorteos/OrdenDetalle";
import type { Orden, SorteoFila } from "@/modules/sorteos/tipos";
import { NOMBRE_CANAL } from "@/modules/sorteos/tipos";
import { BOTON, fechaHoraPY, gs } from "@/modules/sorteos/ui";

export default function RevisionSorteoPage() {
  const [sorteos, setSorteos] = useState<SorteoFila[]>([]);
  const [sorteo, setSorteo] = useState("");
  const [filas, setFilas] = useState<Orden[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("sorteo");
    if (p) setSorteo(p);
    apiFetch<SorteoFila[]>("/api/sorteos").then(setSorteos).catch(() => setSorteos([]));
  }, []);

  const cargar = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ estado: "en_revision", limite: "100" });
    if (sorteo) params.set("sorteo", sorteo);
    try {
      const d = await apiFetch<{ total: number; filas: Orden[] }>(`/api/sorteos/ordenes?${params}`);
      // Las más viejas primero: se atienden por orden de llegada.
      setFilas([...d.filas].reverse());
      setTotal(d.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [sorteo]);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Pagos por revisar"
        subtitulo="Compras con comprobante que esperan que alguien confirme o rechace el pago. La más vieja primero."
        volver={{ href: "/sorteos/panel", label: "Sorteos" }}
        acciones={<button type="button" className={`${BOTON} max-sm:w-full`} onClick={() => void cargar()}><RefreshCw className="h-4 w-4" /> Actualizar</button>}
      />
      {sorteos.length > 1 ? (
        <Select chip prefijo="Sorteo" textoVacio="Todos" value={sorteo} onChange={setSorteo} etiqueta="Sorteo" options={[["", "Todos los sorteos"], ...sorteos.map((s) => [s.id, s.nombre] as [string, string])]} />
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!filas && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {filas ? (
        filas.length ? (
          <>
            {total > filas.length ? <p className="text-xs text-slate-500">Se muestran las {filas.length} más viejas de {total.toLocaleString("es-PY")}.</p> : null}
            <ul className="m-0 list-none divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0">
              {filas.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setAbierta(o.id)} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-slate-900">{o.comprador_nombre}</span>
                      <span className="block truncate text-[13px] text-slate-500">
                        {o.sorteo} · {o.cantidad.toLocaleString("es-PY")} boleta{o.cantidad === 1 ? "" : "s"} · {NOMBRE_CANAL[o.canal]} · {fechaHoraPY(o.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-slate-900">{gs(o.monto)}</span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-sm font-semibold text-slate-800">No hay pagos por revisar</p>
            <p className="text-sm text-slate-500">Cuando alguien suba un comprobante por la web, WhatsApp o un vendedor, aparece acá.</p>
          </div>
        )
      ) : null}
      {abierta ? <OrdenDetalle id={abierta} onClose={() => setAbierta(null)} onCambio={() => { setAbierta(null); void cargar(); }} /> : null}
    </div>
  );
}
