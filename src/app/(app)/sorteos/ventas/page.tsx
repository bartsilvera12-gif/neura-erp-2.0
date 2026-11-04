"use client";

/**
 * /sorteos/ventas — Compras de los sorteos (receta 123): filtros por sorteo, estado y canal; búsqueda
 * por nº de compra, nombre, cédula, teléfono o número de boleta. Tocar una abre su detalle.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Paginador } from "@/modules/inventario/ui";
import { OrdenDetalle } from "@/modules/sorteos/OrdenDetalle";
import type { Orden, SorteoFila } from "@/modules/sorteos/tipos";
import { NOMBRE_CANAL, NOMBRE_ESTADO_ORDEN } from "@/modules/sorteos/tipos";
import { EstadoOrdenChip, fechaHoraPY, gs, INPUT } from "@/modules/sorteos/ui";

const POR_PAGINA = 50;

export default function ComprasSorteoPage() {
  const [sorteos, setSorteos] = useState<SorteoFila[]>([]);
  const [sorteo, setSorteo] = useState("");
  const [estado, setEstado] = useState("");
  const [canal, setCanal] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ total: number; filas: Orden[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("sorteo")) setSorteo(p.get("sorteo")!);
    if (p.get("estado")) setEstado(p.get("estado")!);
    apiFetch<SorteoFila[]>("/api/sorteos").then(setSorteos).catch(() => setSorteos([]));
  }, []);

  const cargar = useCallback(async () => {
    const n = ++pedido.current;
    setCargando(true);
    setError(null);
    const params = new URLSearchParams({ desde: String((pagina - 1) * POR_PAGINA), limite: String(POR_PAGINA) });
    if (sorteo) params.set("sorteo", sorteo);
    if (estado) params.set("estado", estado);
    if (canal) params.set("canal", canal);
    if (q.trim()) params.set("q", q.trim());
    try {
      const d = await apiFetch<{ total: number; filas: Orden[] }>(`/api/sorteos/ordenes?${params}`);
      if (n === pedido.current) setDatos(d);
    } catch (e) {
      if (n === pedido.current) setError((e as Error).message);
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, [sorteo, estado, canal, q, pagina]);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => void cargar(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, q]);

  const filtro = (set: (v: string) => void) => (v: string) => { set(v); setPagina(1); };

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina titulo="Compras" subtitulo="Todas las compras de boletas, de todos los canales." volver={{ href: "/sorteos/panel", label: "Sorteos" }} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className={`${INPUT} pl-9`} value={q} onChange={(e) => { setQ(e.target.value); setPagina(1); }} placeholder="Nombre, cédula, teléfono o nº de boleta" aria-label="Buscar compras" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select chip prefijo="Sorteo" textoVacio="Todos" value={sorteo} onChange={filtro(setSorteo)} etiqueta="Sorteo" options={[["", "Todos los sorteos"], ...sorteos.map((s) => [s.id, s.nombre] as [string, string])]} />
          <Select chip prefijo="Estado" textoVacio="Todos" value={estado} onChange={filtro(setEstado)} etiqueta="Estado" options={[["", "Todos los estados"], ...Object.entries(NOMBRE_ESTADO_ORDEN)]} />
          <Select chip prefijo="Canal" textoVacio="Todos" value={canal} onChange={filtro(setCanal)} etiqueta="Canal" options={[["", "Todos los canales"], ...Object.entries(NOMBRE_CANAL)]} />
        </div>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {!datos ? <div className="h-48 animate-pulse bg-slate-50" /> : (
          <TablaTarjetas
            filas={datos.filas}
            claveFila={(o) => o.id}
            onFila={(o) => setAbierta(o.id)}
            cargando={cargando}
            vacio={<p className="p-10 text-center text-sm text-slate-400">{q || sorteo || estado || canal ? "No hay compras con esos filtros." : "Todavía no hay compras."}</p>}
            columnas={[
              { key: "num", titulo: "Nº", celda: (o) => <span className="tabular-nums text-slate-500">{o.numero}</span>, movil: "oculto", claseTd: "w-16" },
              { key: "comprador", titulo: "Comprador", celda: (o) => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium text-slate-900">{o.comprador_nombre}</span>
                  <span className="block truncate text-xs text-slate-500">{[o.comprador_documento ? `CI ${o.comprador_documento}` : null, o.comprador_ciudad].filter(Boolean).join(" · ")}</span>
                </span>
              ), movil: "titulo" },
              { key: "sorteo", titulo: "Sorteo", celda: (o) => o.sorteo, movil: "subtitulo", claseTh: "hidden xl:table-cell", claseTd: "hidden xl:table-cell max-w-48 truncate" },
              { key: "boletas", titulo: "Boletas", celda: (o) => `${o.cantidad.toLocaleString("es-PY")} bol.`, movil: "dato", claseTd: "tabular-nums" },
              { key: "canal", titulo: "Canal", celda: (o) => `${NOMBRE_CANAL[o.canal]}${o.vendedor ? ` · ${o.vendedor}` : ""}`, movil: "dato", claseTh: "hidden lg:table-cell", claseTd: "hidden lg:table-cell" },
              { key: "fecha", titulo: "Fecha", celda: (o) => fechaHoraPY(o.created_at), movil: "dato", claseTd: "whitespace-nowrap text-slate-500" },
              { key: "estado", titulo: "Estado", celda: (o) => <EstadoOrdenChip estado={o.estado} />, movil: "chip" },
              { key: "monto", titulo: "Monto", celda: (o) => <span className="font-semibold tabular-nums">{gs(o.monto)}</span>, movil: "valor", claseTh: "text-right", claseTd: "text-right" },
            ]}
          />
        )}
      </div>
      {datos ? <Paginador pagina={pagina} porPagina={POR_PAGINA} total={datos.total} cargando={cargando} onCambiar={setPagina} /> : null}

      {abierta ? <OrdenDetalle id={abierta} onClose={() => setAbierta(null)} onCambio={() => void cargar()} /> : null}
    </div>
  );
}
