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
import { Cabecera, INPUT_FILTRO, Paginador, Pestanas, TEAL } from "@/modules/inventario/ui";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { formatGs } from "@/modules/caja/lib";
import { etiquetaCaja, useEstadoCajas } from "@/modules/caja/turno";

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
    <div className="space-y-6 pb-10">
      <Cabecera kicker="Finanzas · Caja" titulo="Ventas a crédito" subtitulo="Lo que se vendió a crédito en las cajas: cliente, vencimiento, cobrado y saldo" />

      <div className="flex flex-wrap items-center gap-3">
        <Pestanas valor={periodo} onChange={cambiar(setPeriodo)} opciones={[
          { id: "hoy", label: "Hoy" },
          { id: "turno", label: "Turno abierto" },
          { id: "mes", label: "Este mes" },
          { id: "rango", label: "Rango" },
        ]} />
        {periodo === "turno" ? (
          abiertas.length ? (
            <Select value={turno} onChange={cambiar(setTurno)} minWidth={260}
              options={abiertas.map((c): [string, string] => [c.id, `${etiquetaCaja(c)} · turno N° ${c.numero_caja}`])} />
          ) : <span className="text-xs text-slate-500">No hay cajas abiertas.</span>
        ) : null}
        {periodo === "rango" ? (
          <div className="flex items-center gap-2">
            <input type="date" value={desde} max={hasta || undefined} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} className={INPUT_FILTRO} />
            <span className="text-xs text-slate-400">a</span>
            <input type="date" value={hasta} min={desde || undefined} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} className={INPUT_FILTRO} />
          </div>
        ) : null}
      </div>

      {/* Totales */}
      <section className="grid grid-cols-2 divide-x divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:grid-cols-4 sm:divide-y-0">
        <Cifra label={`Vendido a crédito${t ? ` · ${t.cantidad}` : ""}`} valor={t ? formatGs(t.total) : "…"} icono={Wallet} destacado />
        <Cifra label="Cobrado" valor={t ? formatGs(t.cobrado) : "…"} icono={CircleDollarSign} />
        <Cifra label="Saldo pendiente" valor={t ? formatGs(t.saldo) : "…"} icono={CalendarClock} />
        <Cifra label={`Vencido${t?.vencidas ? ` · ${t.vencidas}` : ""}`} valor={t ? formatGs(t.vencido) : "…"} icono={AlertTriangle} alerta={!!t?.vencido} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 p-4">
          <div className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Cliente, RUC o número de venta…" className={`${INPUT_FILTRO} w-full pl-9`} />
          </div>
          {periodo !== "turno" ? (
            <>
              {sucursalesOpts.length > 2 ? <Select value={sucursal} onChange={cambiar((v: string) => { setSucursal(v); setPunto(""); })} options={sucursalesOpts} minWidth={180} /> : null}
              <Select value={punto} onChange={cambiar(setPunto)} options={cajasOpts} minWidth={190} />
            </>
          ) : null}
          <Select value={estado} onChange={cambiar(setEstado)} options={ESTADOS} minWidth={170} />
          <span className={`ml-auto text-sm text-slate-400 ${cargando ? "opacity-50" : ""}`}>{(datos?.total ?? 0).toLocaleString("es-PY")} venta{datos?.total === 1 ? "" : "s"}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Venta</th>
                <th className="px-4 py-2.5 text-left">Cliente</th>
                <th className="px-4 py-2.5 text-left">Caja</th>
                <th className="px-4 py-2.5 text-left">Vence</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5 text-right">Cobrado</th>
                <th className="px-4 py-2.5 text-right">Saldo</th>
                <th className="px-4 py-2.5 text-left">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {error ? (
                <tr><td colSpan={8} className="py-10 text-center text-rose-600">{error}</td></tr>
              ) : !datos ? (
                <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
              ) : datos.rows.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">{periodo === "turno" && !turno ? "Elegí un turno abierto." : "No hay ventas a crédito con estos filtros."}</td></tr>
              ) : datos.rows.map((f) => (
                <tr key={f.venta_id} onClick={() => setViendo(f.venta_id)} className={`cursor-pointer transition hover:bg-slate-50 ${f.estado === "anulada" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-600">{f.numero_control}</span>
                    <span className="block text-[11px] text-slate-400">{new Date(f.fecha).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-800">{f.cliente_nombre ?? "—"}</span>
                    {f.cliente_ruc ? <span className="block text-[11px] text-slate-400">{f.cliente_ruc}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {f.punto_nombre ?? "—"}{f.numero_caja ? <span className="text-slate-400"> · N° {f.numero_caja}</span> : null}
                    <span className="block text-[11px] text-slate-400">{[f.sucursal_nombre, f.cajero_nombre ?? f.usuario_nombre].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="tabular-nums text-slate-700">{fechaCorta(f.vencimiento)}</span>
                    {f.plazo_dias ? <span className="text-slate-400"> · {f.plazo_dias} d</span> : null}
                    {f.vencida ? <span className="block text-[11px] font-semibold text-rose-600">vencida hace {f.dias_vencida} día{f.dias_vencida === 1 ? "" : "s"}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{formatGs(f.total)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatGs(f.cobrado)}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${f.saldo > 0 ? (f.vencida ? "text-rose-600" : "text-slate-900") : "text-emerald-600"}`}>{f.estado === "anulada" ? "—" : formatGs(f.saldo)}</td>
                  <td className="px-4 py-3"><EstadoChip estado={f.estado} vencida={!!f.vencida} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <p className="mt-1 truncate text-lg font-bold tabular-nums" style={{ color: alerta ? "#e11d48" : destacado ? TEAL : "#0f172a" }}>{valor}</p>
    </div>
  );
}
