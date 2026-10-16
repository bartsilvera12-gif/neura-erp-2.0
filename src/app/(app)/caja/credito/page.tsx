"use client";

/**
 * Caja › Ventas a crédito: lo que se vendió a crédito en las cajas — del día, de un turno
 * abierto o de un rango — con cliente, vencimiento, cobrado, saldo y estado (pendiente,
 * parcial, pagada, vencida, anulada). Filtros por sucursal, caja y estado.
 * (Los reportes generales de cuentas por cobrar están en Cobranzas.)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CircleDollarSign, Loader2, Search, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { BarraFiltros } from "@/components/EncabezadoPagina";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Cabecera, INPUT_FILTRO, Paginador, Pestanas, TEAL } from "@/modules/inventario/ui";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { formatGs } from "@/modules/caja/lib";
import { etiquetaCaja, useEstadoCajas } from "@/modules/caja/turno";
import { SelectorFecha } from "@/components/SelectorFecha";

type Fila = {
  venta_id: string;
  numero_control: string;
  fecha: string;
  total: number;
  plazo_dias: number | null;
  cliente_nombre: string | null;
  cliente_ruc: string | null;
  vencimiento: string | null;
  cobrado: number;
  saldo: number;
  estado: "pendiente" | "parcial" | "pagada" | "anulada";
  vencida: boolean | null;
  dias_vencida: number;
  sucursal_nombre: string | null;
  punto_nombre: string | null;
  numero_caja: number | null;
  cajero_nombre: string | null;
  usuario_nombre: string | null;
};
type Respuesta = { rows: Fila[]; total: number; totales: { cantidad: number; total: number; cobrado: number; saldo: number; vencido: number; vencidas: number } };

const ESTADOS: [string, string][] = [["", "Todos los estados"], ["abiertas", "Con saldo"], ["vencida", "Vencidas"], ["pendiente", "Pendientes"], ["parcial", "Pagadas en parte"], ["pagada", "Pagadas"], ["anulada", "Anuladas"]];
const fechaCorta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—");
const primeroDelMes = () => `${hoyPY().slice(0, 7)}-01`;

export default function VentasCreditoPage() {
  const { datos: cajas } = useEstadoCajas();
  const [periodo, setPeriodo] = useState("hoy");
  const [turno, setTurno] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyPY());
  const [sucursal, setSucursal] = useState("");
  const [punto, setPunto] = useState("");
  const [estado, setEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const pedido = useRef(0);
  const POR_PAGINA = 50;

  const abiertas = cajas?.abiertas ?? [];
  // "Turno": arranca en la caja que le toca al usuario.
  useEffect(() => {
    if (periodo === "turno" && !turno && abiertas.length) setTurno(cajas?.predeterminada ?? abiertas[0].id);
  }, [periodo, turno, abiertas, cajas?.predeterminada]);

  useEffect(() => {
    const t = setTimeout(() => { if (busqueda.trim() !== q) { setQ(busqueda.trim()); setPagina(1); } }, 300);
    return () => clearTimeout(t);
  }, [busqueda, q]);

  useEffect(() => {
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (periodo === "hoy") { sp.set("desde", hoyPY()); sp.set("hasta", hoyPY()); }
    else if (periodo === "mes") { sp.set("desde", primeroDelMes()); sp.set("hasta", hoyPY()); }
    else if (periodo === "rango") { if (desde) sp.set("desde", desde); if (hasta) sp.set("hasta", hasta); }
    else if (periodo === "turno") { if (!turno) { setDatos({ rows: [], total: 0, totales: { cantidad: 0, total: 0, cobrado: 0, saldo: 0, vencido: 0, vencidas: 0 } }); setCargando(false); return; } sp.set("turno", turno); }
    if (periodo !== "turno") {
      if (sucursal) sp.set("sucursal", sucursal);
      if (punto) sp.set("punto", punto);
    }
    if (estado) sp.set("estado", estado);
    if (q) sp.set("q", q);
    const n = ++pedido.current;
    setCargando(true);
    apiFetch<Respuesta>(`/api/caja/credito?${sp}`)
      .then((r) => { if (n === pedido.current) { setDatos(r); setError(null); } })
      .catch((e) => { if (n === pedido.current) setError((e as Error).message); })
      .finally(() => { if (n === pedido.current) setCargando(false); });
  }, [periodo, turno, desde, hasta, sucursal, punto, estado, q, pagina, recarga]);

  const sucursalesOpts = useMemo<[string, string][]>(
    () => [["", "Todas las sucursales"], ...(cajas?.sucursales ?? []).map((s): [string, string] => [s.id, s.nombre])],
    [cajas],
  );
  const cajasOpts = useMemo<[string, string][]>(
    () => [["", "Todas las cajas"], ...(cajas?.sucursales ?? []).filter((s) => !sucursal || s.id === sucursal)
      .flatMap((s) => s.cajas.map((c): [string, string] => [c.id, `${c.nombre} · ${s.nombre}`]))],
    [cajas, sucursal],
  );
  const t = datos?.totales;
  const cambiar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  return (
    <div className="space-y-4 pb-10 sm:space-y-6">
      <Cabecera kicker="Finanzas · Caja" titulo="Ventas a crédito" subtitulo="Lo que se vendió a crédito en las cajas: cliente, vencimiento, cobrado y saldo" />

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Pestanas valor={periodo} onChange={cambiar(setPeriodo)} opciones={[
          { id: "hoy", label: "Hoy" },
          { id: "turno", label: "Turno abierto" },
          { id: "mes", label: "Este mes" },
          { id: "rango", label: "Rango" },
        ]} />
        {periodo === "turno" ? (
          abiertas.length ? (
            <Select value={turno} onChange={cambiar(setTurno)} minWidth={260} etiqueta="Turno abierto" className="max-sm:w-full max-sm:!min-w-0"
              options={abiertas.map((c): [string, string] => [c.id, `${etiquetaCaja(c)} · turno N° ${c.numero_caja}`])} />
          ) : <span className="text-xs text-slate-500">No hay cajas abiertas.</span>
        ) : null}
        {periodo === "rango" ? (
          <div className="flex items-center gap-2 max-sm:w-full">
            <SelectorFecha compacto etiqueta="Desde" value={desde} max={hasta || undefined} onChange={(v) => { setDesde(v); setPagina(1); }} claseBoton="h-10 rounded-xl px-3 text-slate-800" className="w-[150px] min-w-0 max-sm:w-auto max-sm:flex-1" />
            <span className="text-xs text-slate-400">a</span>
            <SelectorFecha compacto etiqueta="Hasta" value={hasta} min={desde || undefined} onChange={(v) => { setHasta(v); setPagina(1); }} claseBoton="h-10 rounded-xl px-3 text-slate-800" className="w-[150px] min-w-0 max-sm:w-auto max-sm:flex-1" />
          </div>
        ) : null}
      </div>

      {/* Totales */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm sm:grid-cols-4 [&>*]:bg-white">
        <Cifra label={`Vendido a crédito${t ? ` · ${t.cantidad}` : ""}`} valor={t ? formatGs(t.total) : "…"} icono={Wallet} destacado />
        <Cifra label="Cobrado" valor={t ? formatGs(t.cobrado) : "…"} icono={CircleDollarSign} />
        <Cifra label="Saldo pendiente" valor={t ? formatGs(t.saldo) : "…"} icono={CalendarClock} />
        <Cifra label={`Vencido${t?.vencidas ? ` · ${t.vencidas}` : ""}`} valor={t ? formatGs(t.vencido) : "…"} icono={AlertTriangle} alerta={!!t?.vencido} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Búsqueda siempre visible; sucursal / caja / estado en línea (≥ 768) o en una hoja (celular). */}
        <BarraFiltros plano className="border-b border-slate-100 p-3 sm:p-4"
          activos={(sucursal ? 1 : 0) + (punto ? 1 : 0) + (estado ? 1 : 0)}
          onLimpiar={() => { setSucursal(""); setPunto(""); setEstado(""); setPagina(1); }}
          busqueda={
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Cliente, RUC o número de venta…" type="search" enterKeyHint="search" aria-label="Buscar ventas a crédito" className={`${INPUT_FILTRO} w-full pl-9 max-md:h-11`} />
            </div>
          }
          extra={<span className={`hidden whitespace-nowrap text-sm text-slate-400 md:inline ${cargando ? "opacity-50" : ""}`}>{(datos?.total ?? 0).toLocaleString("es-PY")} venta{datos?.total === 1 ? "" : "s"}</span>}>
          {periodo !== "turno" && sucursalesOpts.length > 2 ? <Select value={sucursal} onChange={cambiar((v: string) => { setSucursal(v); setPunto(""); })} options={sucursalesOpts} minWidth={180} etiqueta="Sucursal" /> : null}
          {periodo !== "turno" ? <Select value={punto} onChange={cambiar(setPunto)} options={cajasOpts} minWidth={190} etiqueta="Caja" /> : null}
          <Select value={estado} onChange={cambiar(setEstado)} options={ESTADOS} minWidth={170} etiqueta="Estado" />
        </BarraFiltros>
        <p className={`px-4 pt-2 text-xs text-slate-400 md:hidden ${cargando ? "opacity-50" : ""}`}>{(datos?.total ?? 0).toLocaleString("es-PY")} venta{datos?.total === 1 ? "" : "s"}</p>

        {error ? (
          <p className="py-10 text-center text-sm text-rose-600">{error}</p>
        ) : !datos ? (
          <div className="py-12"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          // Celular: cada venta es una tarjeta (cliente, saldo, vence y estado).
          <TablaTarjetas
            filas={datos.rows}
            claveFila={(f) => f.venta_id}
            onFila={(f) => setViendo(f.venta_id)}
            claseFila={(f) => (f.estado === "anulada" ? "opacity-50" : "")}
            cargando={cargando}
            claseThead="bg-slate-50"
            thBase="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            tdBase="px-4 py-3"
            vacio={<p className="py-12 text-center text-sm text-slate-400">{periodo === "turno" && !turno ? "Elegí un turno abierto." : "No hay ventas a crédito con estos filtros."}</p>}
            columnas={[
              { key: "venta", titulo: "Venta", movil: "subtitulo",
                celda: (f) => <><span className="font-mono text-xs text-slate-600">{f.numero_control}</span><span className="block text-[11px] text-slate-400 max-md:ml-1.5 max-md:inline">{new Date(f.fecha).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></> },
              { key: "cliente", titulo: "Cliente", movil: "titulo",
                celda: (f) => <><span className="text-slate-800">{f.cliente_nombre ?? "—"}</span>{f.cliente_ruc ? <span className="block text-[11px] font-normal text-slate-400">{f.cliente_ruc}</span> : null}</> },
              { key: "caja", titulo: "Caja", claseTd: "text-xs text-slate-600", movil: "detalle",
                celda: (f) => <>{f.punto_nombre ?? "—"}{f.numero_caja ? <span className="text-slate-400"> · N° {f.numero_caja}</span> : null}<span className="block text-[11px] text-slate-400">{[f.sucursal_nombre, f.cajero_nombre ?? f.usuario_nombre].filter(Boolean).join(" · ")}</span></> },
              { key: "vence", titulo: "Vence", claseTd: "text-xs", movil: "dato",
                celda: (f) => <><span className="tabular-nums text-slate-700">{fechaCorta(f.vencimiento)}</span>{f.plazo_dias ? <span className="text-slate-400"> · {f.plazo_dias} d</span> : null}{f.vencida ? <span className="block text-[11px] font-semibold text-rose-600">vencida hace {f.dias_vencida} día{f.dias_vencida === 1 ? "" : "s"}</span> : null}</> },
              { key: "total", titulo: "Total", claseTh: "!text-right", claseTd: "text-right font-semibold tabular-nums text-slate-800", movil: "dato", celda: (f) => formatGs(f.total) },
              { key: "cobrado", titulo: "Cobrado", claseTh: "!text-right", claseTd: "text-right tabular-nums text-slate-600", movil: "detalle", celda: (f) => formatGs(f.cobrado) },
              { key: "saldo", titulo: "Saldo", claseTh: "!text-right", movil: "valor",
                claseTd: "text-right font-semibold tabular-nums",
                celda: (f) => <span className={f.saldo > 0 ? (f.vencida ? "text-rose-600" : "text-slate-900") : "text-emerald-600"}>{f.estado === "anulada" ? "—" : formatGs(f.saldo)}</span> },
              { key: "estado", titulo: "Estado", movil: "chip", celda: (f) => <EstadoChip estado={f.estado} vencida={!!f.vencida} /> },
            ]}
          />
        )}
        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={datos?.total ?? 0} cargando={cargando} onCambiar={setPagina} />
      </section>

      {viendo ? <VentaDetalle ventaId={viendo} onClose={() => setViendo(null)} onAnulada={() => { setViendo(null); setRecarga((k) => k + 1); }} /> : null}
    </div>
  );
}

function EstadoChip({ estado, vencida }: { estado: Fila["estado"]; vencida: boolean }) {
  const [txt, cls] =
    estado === "anulada" ? ["Anulada", "bg-slate-100 text-slate-500"]
    : estado === "pagada" ? ["Pagada", "bg-emerald-50 text-emerald-700"]
    : vencida ? ["Vencida", "bg-rose-50 text-rose-700"]
    : estado === "parcial" ? ["Pagada en parte", "bg-amber-50 text-amber-700"]
    : ["Pendiente", "bg-orange-50 text-orange-700"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>{txt}</span>;
}

function Cifra({ label, valor, icono: Icono, destacado, alerta }: { label: string; valor: string; icono: React.ComponentType<{ className?: string }>; destacado?: boolean; alerta?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5" style={destacado ? { backgroundColor: `${TEAL}12` } : undefined}>
      <p className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${alerta ? "text-rose-600" : "text-slate-500"}`}><Icono className="h-3 w-3" /> {label}</p>
      <p className="mt-1 truncate text-base font-bold tabular-nums sm:text-lg" style={{ color: alerta ? "#e11d48" : destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}
