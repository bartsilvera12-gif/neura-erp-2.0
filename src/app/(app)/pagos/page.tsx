"use client";

/**
 * /pagos — Pagos (igual que el sistema actual): registrar pagos de facturas pendientes de cobro.
 *   · Pendientes: facturas (ventas con cuenta a cobrar) con saldo, por vencimiento. "Cobrar"
 *     registra una transferencia que queda pendiente de aprobación en Conciliación (con una
 *     transferencia se pueden cobrar varias facturas del mismo cliente). "En caja" abre el
 *     cobro en caja de siempre (efectivo, tarjeta…).
 *   · Cobrados: lo cobrado aplicado a cada factura (recibos; las transferencias aprobadas
 *     ya son recibos), con método, usuario, fecha y hora y el recibo en PDF.
 * Las tarjetas y el pie suman la vista completa (filtros incluidos), no solo la página.
 * "Tipo de servicio" del actual = categoría del cliente; además se filtra por plan.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Banknote, CheckCircle2, Clock, Inbox, Loader2, Receipt, Search, Wallet, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { BarraFiltros, EncabezadoPagina, GrillaKpis } from "@/components/EncabezadoPagina";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { RegistrarTransferencia } from "@/modules/cobranzas/RegistrarTransferencia";
import { ROLES_REGISTRAR } from "@/modules/cobranzas/tipos";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import { nombreMetodo } from "@/modules/clientes/cobros";
import { SelectorFecha } from "@/components/SelectorFecha";

const POR_PAGINA = 50;
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 hover:border-[#4FAEB2]/60 focus:border-[#4FAEB2] focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/20";
const LABEL = "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500";
const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const fecha = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

type Tab = "pendientes" | "cobrados";

type FilaPendiente = {
  id: string; venta_id: string; numero: string; cliente_id: string; cliente_nombre: string;
  categoria_id: string | null; categoria_nombre: string | null; vendedor: string | null; plan_nombre: string | null;
  fecha_emision: string; vencimiento: string; monto: number; cobrado: number; saldo: number; estado: string;
  dias_atraso: number; en_aprobacion: number;
};
type FilaCobrada = {
  id: string; cobro_id: string; numero_recibo: string; fecha: string; created_at: string; fecha_pago: string;
  cliente_id: string; cliente_nombre: string; usuario_nombre: string | null; factura_numero: string; monto: number;
  categoria_nombre: string | null; plan_nombre: string | null; vendedor: string | null; metodos: string | null; referencia: string | null;
};
type Respuesta = {
  pendientes: { rows: FilaPendiente[]; total: number; total_monto: number; total_saldo: number; total_general: number };
  cobrados: { rows: FilaCobrada[]; total: number; total_monto: number; total_general: number };
  opciones?: { categorias: { id: string; nombre: string }[]; planes: { id: string; nombre: string }[] };
};

export default function PagosPage() {
  const rol = useUsuario()?.rol;
  const puedeCobrar = !!rol && ROLES_REGISTRAR.includes(rol);
  const [tab, setTab] = useState<Tab>("pendientes");
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [categoria, setCategoria] = useState("");
  const [plan, setPlan] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [opciones, setOpciones] = useState<Respuesta["opciones"] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [transferencia, setTransferencia] = useState<FilaPendiente | null>(null);
  const [enCaja, setEnCaja] = useState<FilaPendiente | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [tab, q, desde, hasta, categoria, plan]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 10000);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const sp = new URLSearchParams({ tab, pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (desde) sp.set("desde", desde);
    if (hasta) sp.set("hasta", hasta);
    if (categoria) sp.set("categoria", categoria);
    if (plan) sp.set("plan", plan);
    if (!opciones) sp.set("opciones", "1");
    apiFetch<Respuesta>(`/api/pagos?${sp}`)
      .then((r) => {
        if (!vivo) return;
        setDatos(r);
        if (r.opciones) setOpciones(r.opciones);
        setError(null);
      })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // `opciones` se pide una sola vez: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, desde, hasta, categoria, plan, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const hayFiltros = !!(q || desde || hasta || categoria || plan);
  const limpiar = () => { setBorrador(""); setQ(""); setDesde(""); setHasta(""); setCategoria(""); setPlan(""); };

  const pend = datos?.pendientes;
  const cob = datos?.cobrados;
  const filasTotal = tab === "pendientes" ? pend?.total ?? 0 : cob?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(filasTotal / POR_PAGINA));

  const filtrosActivos = [desde, hasta, categoria, plan].filter(Boolean).length;

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/finanzas", label: "Finanzas" }}
        kicker="Cobranzas"
        titulo="Pagos"
        subtitulo="Registrar pagos de facturas pendientes de cobro"
        acciones={
          <div role="tablist" aria-label="Vista" className="flex w-full gap-1 rounded-2xl border border-[#4FAEB2]/45 bg-white p-1.5 shadow-sm sm:w-auto">
            <BotonTab activo={tab === "pendientes"} onClick={() => setTab("pendientes")} icono={<Clock className="h-4 w-4" />} label="Pendientes" n={pend?.total} />
            <BotonTab activo={tab === "cobrados"} onClick={() => setTab("cobrados")} icono={<CheckCircle2 className="h-4 w-4" />} label="Cobrados" n={cob?.total} />
          </div>
        }
      />

      <GrillaKpis columnas={3}>
        <Kpi icono={<Receipt className="h-4 w-4" />} label="Facturas con saldo" valor={String(pend?.total ?? 0)}
          sub={pend && (hayFiltros || pend.total !== pend.total_general) ? `de ${pend.total_general} en total` : "vista actual"} />
        <Kpi icono={<Clock className="h-4 w-4" />} label="Saldo pendiente" valor={gs(pend?.total_saldo)} sub={`Total: ${gs(pend?.total_monto)}`} acento="aviso" />
        <Kpi icono={<CheckCircle2 className="h-4 w-4" />} label="Cobrado (filtros)" valor={gs(cob?.total_monto)}
          sub={`${cob?.total ?? 0} ${cob?.total === 1 ? "pago" : "pagos"}`} acento="destacado" className="max-sm:col-span-2" />
      </GrillaKpis>

      {/* Filtros: búsqueda siempre a la vista; en celular fechas, categoría y plan van en la hoja "Filtros". */}
      <BarraFiltros
        className="md:items-end md:rounded-2xl md:border-[#4FAEB2]/45 md:p-4"
        activos={filtrosActivos}
        onLimpiar={limpiar}
        busqueda={
          <div>
            <label htmlFor="pagos-buscar" className={`${LABEL} max-md:sr-only`}>Buscar por nombre de cliente</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="pagos-buscar" type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Nombre del cliente o número de factura…" enterKeyHint="search"
                className={`${INPUT} pl-9 max-md:h-11 max-md:py-0`} />
            </div>
          </div>
        }
      >
        <div className="md:min-w-[10rem]">
          <label className={LABEL}>Desde {tab === "pendientes" ? "(vencimiento)" : "(fecha de pago)"}</label>
          <SelectorFecha compacto block etiqueta="Desde" value={desde} onChange={setDesde} claseBoton="rounded-xl px-3.5 py-2.5 text-slate-900 shadow-sm" />
        </div>
        <div className="md:min-w-[10rem]">
          <label className={LABEL}>Hasta {tab === "pendientes" ? "(vencimiento)" : "(fecha de pago)"}</label>
          <SelectorFecha compacto block etiqueta="Hasta" value={hasta} onChange={setHasta} claseBoton="rounded-xl px-3.5 py-2.5 text-slate-900 shadow-sm" />
        </div>
        <div className="md:min-w-[12rem]">
          <label className={LABEL}>Tipo de servicio (categoría)</label>
          <Select value={categoria} onChange={setCategoria} block etiqueta="Tipo de servicio (categoría)"
            options={[["", "Todas las categorías"], ["__sin__", "Sin clasificar"], ...(opciones?.categorias ?? []).map((c): [string, string] => [c.id, c.nombre])]} />
        </div>
        <div className="md:min-w-[12rem]">
          <label className={LABEL}>Plan</label>
          <Select value={plan} onChange={setPlan} block etiqueta="Plan"
            options={[["", "Todos los planes"], ["__sin__", "Sin plan"], ...(opciones?.planes ?? []).map((p): [string, string] => [p.id, p.nombre])]} />
        </div>
      </BarraFiltros>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 [overflow-wrap:anywhere]">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-[#4FAEB2]/45 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="block h-5 w-1 shrink-0 rounded-full bg-[#4FAEB2]" />
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#4FAEB2]" />
              {tab === "pendientes" ? "Facturas pendientes de cobro" : "Pagos registrados"}
            </h2>
            {cargando ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" /> : null}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#3F8E91]">
            {tab === "pendientes"
              ? hayFiltros ? `${pend?.total ?? 0} según filtros · ${pend?.total_general ?? 0} en total` : `${pend?.total ?? 0} facturas con saldo`
              : hayFiltros ? `${cob?.total ?? 0} según filtros · ${cob?.total_general ?? 0} en total` : `${cob?.total ?? 0} pagos`}
          </span>
        </div>

        {tab === "pendientes" ? (
          <TablaPendientes filas={pend?.rows ?? []} cargando={cargando && !datos} recargando={cargando && !!datos} hayFiltros={hayFiltros} onLimpiar={limpiar}
            totalMonto={pend?.total_monto ?? 0} totalSaldo={pend?.total_saldo ?? 0} total={pend?.total ?? 0}
            puedeCobrar={puedeCobrar} onTransferencia={setTransferencia} onCaja={setEnCaja} />
        ) : (
          <TablaCobrados filas={cob?.rows ?? []} cargando={cargando && !datos} recargando={cargando && !!datos} hayFiltros={hayFiltros} onLimpiar={limpiar}
            totalMonto={cob?.total_monto ?? 0} total={cob?.total ?? 0} />
        )}

        {filasTotal > POR_PAGINA ? (
          <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <span className="text-center sm:text-left">Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40 max-sm:min-h-11 max-sm:flex-1 max-sm:text-sm">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {transferencia ? (
        <RegistrarTransferencia
          clienteInicial={{ id: transferencia.cliente_id, nombre: transferencia.cliente_nombre, cxcId: transferencia.id }}
          onClose={() => setTransferencia(null)}
          onHecho={(m) => { setTransferencia(null); setAviso(m); refrescar(); }} />
      ) : null}
      {enCaja ? (
        <RegistrarCobro clienteId={enCaja.cliente_id} clienteNombre={enCaja.cliente_nombre} cxcInicial={enCaja.id}
          onClose={() => setEnCaja(null)} onHecho={refrescar} />
      ) : null}
      {aviso ? (
        <div role="status" className="fixed inset-x-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-[130] flex items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-lg sm:left-auto sm:right-5 sm:max-w-sm"
          style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso"
            className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 max-sm:-m-3 max-sm:h-11 max-sm:w-11"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </div>
  );
}

const TH = "px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 first:pl-5 last:pr-5 sm:px-4";
const TD = "px-3 py-3 text-sm text-slate-600 first:pl-5 last:pr-5 sm:px-4";

function estadoPendiente(f: FilaPendiente) {
  return f.dias_atraso > 0
    ? { t: "Vencida", c: "border-rose-200 bg-rose-50 text-rose-700", p: "bg-rose-500" }
    : f.estado === "parcial"
      ? { t: "Pagada en parte", c: "border-amber-200 bg-amber-50 text-amber-700", p: "bg-amber-500" }
      : { t: "Pendiente", c: "border-amber-200 bg-amber-50 text-amber-700", p: "bg-amber-500" };
}

function TablaPendientes({ filas, cargando, recargando, hayFiltros, onLimpiar, totalMonto, totalSaldo, total, puedeCobrar, onTransferencia, onCaja }: {
  filas: FilaPendiente[]; cargando: boolean; recargando: boolean; hayFiltros: boolean; onLimpiar: () => void;
  totalMonto: number; totalSaldo: number; total: number; puedeCobrar: boolean;
  onTransferencia: (f: FilaPendiente) => void; onCaja: (f: FilaPendiente) => void;
}) {
  if (cargando) return <Cargando texto="Cargando facturas…" />;
  if (filas.length === 0) {
    return hayFiltros ? (
      <Vacio titulo="Ninguna factura con saldo coincide con los filtros"
        cta={<button type="button" onClick={onLimpiar} className="text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline max-sm:min-h-11 max-sm:px-3 max-sm:text-sm">Limpiar filtros</button>} />
    ) : (
      <Vacio titulo="No hay facturas pendientes de cobro"
        cta={<Link href="/clientes" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline max-sm:min-h-11 max-sm:px-3 max-sm:text-sm">Ir a Clientes →</Link>} />
    );
  }
  const columnas: ColumnaTabla<FilaPendiente>[] = [
    {
      key: "numero", titulo: "Número", movil: "subtitulo", claseTd: "whitespace-nowrap",
      celda: (f) => <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{f.numero}</span>,
      celdaMovil: (f) => <span className="font-mono text-[12px]">{f.numero}</span>,
    },
    {
      key: "cliente", titulo: "Cliente", movil: "titulo", claseTd: "min-w-[12rem] lg:min-w-[16rem]",
      celda: (f) => (
        <>
          <Link href={`/clientes/${f.cliente_id}`} className="block min-w-0 break-words font-medium text-[#3F8E91] hover:underline" title={f.cliente_nombre}>{f.cliente_nombre}</Link>
          {f.plan_nombre ? <span className="block text-[11px] text-slate-400">{f.plan_nombre}</span> : null}
        </>
      ),
      celdaMovil: (f) => (
        <>
          <Link href={`/clientes/${f.cliente_id}`} className="text-[#3F8E91] hover:underline">{f.cliente_nombre}</Link>
          {f.plan_nombre ? <span className="block text-[11px] font-normal text-slate-400">{f.plan_nombre}</span> : null}
        </>
      ),
    },
    { key: "tipo", titulo: "Tipo de cliente", movil: "dato", celda: (f) => <span className="inline-block max-w-[14rem] truncate align-bottom">{f.categoria_nombre ?? "Sin clasificar"}</span>, celdaMovil: (f) => f.categoria_nombre ?? "Sin clasificar" },
    { key: "vendedor", titulo: "Vendedor", celda: (f) => <span className="inline-block max-w-[12rem] truncate align-bottom">{f.vendedor ?? "—"}</span>, celdaMovil: (f) => f.vendedor ?? "—" },
    { key: "fecha", titulo: "Fecha", claseTd: "whitespace-nowrap", celda: (f) => fecha(f.fecha_emision) },
    {
      key: "vence", titulo: "Vencimiento", movil: "dato", claseTd: "whitespace-nowrap",
      celda: (f) => (
        <>
          {fecha(f.vencimiento)}
          {f.dias_atraso > 0 ? <span className="block text-[11px] font-semibold text-rose-600">{f.dias_atraso} {f.dias_atraso === 1 ? "día" : "días"} de atraso</span> : null}
        </>
      ),
    },
    { key: "total", titulo: "Total", movil: "dato", claseTd: "whitespace-nowrap font-semibold tabular-nums text-slate-900", celda: (f) => gs(f.monto) },
    { key: "saldo", titulo: "Saldo", movil: "valor", claseTd: "whitespace-nowrap font-semibold tabular-nums text-amber-600", celda: (f) => gs(f.saldo), celdaMovil: (f) => <span className="text-amber-600">{gs(f.saldo)}</span> },
    {
      key: "estado", titulo: "Estado", movil: "chip", claseTd: "whitespace-nowrap",
      celda: (f) => {
        const est = estadoPendiente(f);
        return (
          <>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${est.c}`}>
              <span aria-hidden className={`h-1 w-1 rounded-full ${est.p}`} />{est.t}
            </span>
            {Number(f.en_aprobacion) > 0 ? <span className="mt-0.5 block text-[10px] font-medium text-sky-700">{gs(f.en_aprobacion)} en aprobación</span> : null}
          </>
        );
      },
      celdaMovil: (f) => {
        const est = estadoPendiente(f);
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${est.c}`}>
              <span aria-hidden className={`h-1 w-1 rounded-full ${est.p}`} />{est.t}
            </span>
            {Number(f.en_aprobacion) > 0 ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">{gs(f.en_aprobacion)} en aprobación</span> : null}
          </span>
        );
      },
    },
    {
      key: "accion", titulo: "Acción", movil: "acciones", claseTd: "whitespace-nowrap",
      celda: (f) => {
        const libre = Math.max(0, Number(f.saldo) - Number(f.en_aprobacion));
        return puedeCobrar ? (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onTransferencia(f)} disabled={libre <= 0}
              title={libre <= 0 ? "Todo el saldo ya está esperando aprobación en Conciliación" : "Registrar el pago por transferencia (va a Conciliación)"}
              className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] disabled:opacity-40 max-md:px-4 max-md:text-[13px]">
              <Banknote className="h-3.5 w-3.5" /> Cobrar
            </button>
            <button type="button" onClick={() => onCaja(f)} title="Cobrar en caja (efectivo, tarjeta, POS…)"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#4FAEB2]/60 hover:text-[#3F8E91] max-md:px-3.5 max-md:text-[13px]">
              <Wallet className="h-3.5 w-3.5" /> En caja
            </button>
          </div>
        ) : <span className="text-xs text-slate-400">—</span>;
      },
    },
  ];
  return (
    <>
      <TablaTarjetas filas={filas} columnas={columnas} claveFila={(f) => f.id} cargando={recargando} minAncho={1040}
        claseTabla="w-full text-sm" claseThead="bg-slate-50/80" thBase={TH} tdBase={TD} />
      {/* Suma de la vista completa (filtros incluidos), no solo de la página. */}
      <div role="status" className="flex flex-col gap-2 border-t-2 border-slate-100 bg-slate-50/80 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">{hayFiltros ? "Suma con filtros activos" : "Suma de la vista"}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">{total} {total === 1 ? "registro" : "registros"} · recalcula al cambiar fecha, tipo o tabla</p>
        </div>
        <div className="flex gap-6">
          <div>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
            <p className="mt-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-slate-900">{gs(totalMonto)}</p>
          </div>
          <div>
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-600">Saldo</span>
            <p className="mt-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-amber-600">{gs(totalSaldo)}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function TablaCobrados({ filas, cargando, recargando, hayFiltros, onLimpiar, totalMonto, total }: {
  filas: FilaCobrada[]; cargando: boolean; recargando: boolean; hayFiltros: boolean; onLimpiar: () => void; totalMonto: number; total: number;
}) {
  const [bajando, setBajando] = useState<string | null>(null);
  if (cargando) return <Cargando texto="Cargando pagos…" />;
  if (filas.length === 0) {
    return hayFiltros ? (
      <Vacio titulo="Ningún pago coincide con los filtros"
        cta={<button type="button" onClick={onLimpiar} className="text-xs font-semibold text-[#4FAEB2] hover:text-[#3F8E91] hover:underline max-sm:min-h-11 max-sm:px-3 max-sm:text-sm">Limpiar filtros</button>} />
    ) : (
      <Vacio titulo="No hay pagos registrados" subtitulo="Los pagos aparecen acá cuando se cobran en caja o se aprueban en Conciliación." />
    );
  }
  async function recibo(f: FilaCobrada) {
    setBajando(f.id);
    try { await descargarArchivo(`/api/cobros/${f.cobro_id}/pdf`, `recibo-${f.numero_recibo}.pdf`); } catch { /* best-effort */ } finally { setBajando(null); }
  }
  const metodo = (f: FilaCobrada) => (f.metodos ?? "").split(",").filter(Boolean).map(nombreMetodo).join(" + ") || "—";
  const columnas: ColumnaTabla<FilaCobrada>[] = [
    {
      key: "factura", titulo: "Factura", movil: "subtitulo", claseTd: "whitespace-nowrap",
      celda: (f) => <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{f.factura_numero}</span>,
      celdaMovil: (f) => <span className="font-mono text-[12px]">{f.factura_numero}</span>,
    },
    {
      key: "cliente", titulo: "Cliente", movil: "titulo", claseTd: "min-w-[12rem] lg:min-w-[16rem]",
      celda: (f) => <Link href={`/clientes/${f.cliente_id}`} className="block min-w-0 break-words font-medium text-slate-900 hover:text-[#3F8E91] hover:underline" title={f.cliente_nombre}>{f.cliente_nombre}</Link>,
      celdaMovil: (f) => <Link href={`/clientes/${f.cliente_id}`} className="hover:text-[#3F8E91] hover:underline">{f.cliente_nombre}</Link>,
    },
    { key: "tipo", titulo: "Tipo de servicio", celda: (f) => <span className="inline-block max-w-[16rem] truncate align-bottom">{f.plan_nombre ?? f.categoria_nombre ?? "Sin clasificar"}</span>, celdaMovil: (f) => f.plan_nombre ?? f.categoria_nombre ?? "Sin clasificar" },
    { key: "vendedor", titulo: "Vendedor", celda: (f) => <span className="inline-block max-w-[12rem] truncate align-bottom">{f.vendedor ?? "—"}</span>, celdaMovil: (f) => f.vendedor ?? "—" },
    { key: "monto", titulo: "Monto pagado", movil: "valor", claseTd: "whitespace-nowrap font-semibold tabular-nums text-[#3F8E91]", celda: (f) => gs(f.monto), celdaMovil: (f) => <span className="text-[#3F8E91]">{gs(f.monto)}</span> },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "whitespace-nowrap", celda: (f) => fecha(f.fecha_pago) },
    {
      key: "metodo", titulo: "Método", movil: "chip",
      celda: (f) => (
        <>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
            <Wallet className="h-3 w-3 text-slate-400" />
            {metodo(f)}
          </span>
          {f.referencia ? <span className="mt-0.5 block max-w-[14rem] truncate text-[10px] text-slate-400" title={f.referencia}>{f.referencia}</span> : null}
        </>
      ),
      celdaMovil: (f) => (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
          <Wallet className="h-3 w-3 shrink-0 text-slate-400" />
          {metodo(f)}
        </span>
      ),
    },
    // Solo en la tarjeta: la referencia (en la tabla va debajo del método).
    { key: "referencia", titulo: "Referencia", claseTh: "hidden", claseTd: "hidden", celda: (f) => f.referencia || "—" },
    { key: "usuario", titulo: "Usuario", movil: "dato", claseTd: "break-words [overflow-wrap:anywhere]", celda: (f) => f.usuario_nombre ?? "—" },
    { key: "hora", titulo: "Fecha y hora", claseTd: "min-w-[6rem] text-slate-500", celda: (f) => fechaHora(f.created_at) },
    {
      key: "recibo", titulo: "Recibo", movil: "acciones", claseTd: "whitespace-nowrap",
      celda: (f) => (
        <button type="button" onClick={() => recibo(f)} title={`Descargar el recibo ${f.numero_recibo}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-2.5 py-1 text-[11px] font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/20 max-md:px-3.5 max-md:text-[13px]">
          {bajando === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />} {f.numero_recibo}
        </button>
      ),
    },
  ];
  return (
    <>
      <TablaTarjetas filas={filas} columnas={columnas} claveFila={(f) => f.id} cargando={recargando} minAncho={1100}
        claseTabla="w-full text-sm" claseThead="bg-slate-50/80" thBase={TH} tdBase={TD} />
      <div role="status" className="flex w-full min-w-0 flex-col items-stretch gap-1 border-t-2 border-slate-100 bg-slate-50/80 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-5">
        <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">{hayFiltros ? "Total cobrado (filtros activos)" : "Total cobrado en esta vista"}</p>
        <p className="min-w-0 flex-1 whitespace-nowrap text-base font-bold tabular-nums text-[#3F8E91] sm:text-center sm:text-lg">{gs(totalMonto)}</p>
        <p className="shrink-0 text-[10px] text-slate-500 sm:text-right">{total} {total === 1 ? "registro" : "registros"} · recalcula al cambiar el filtro</p>
      </div>
    </>
  );
}

function BotonTab({ activo, onClick, icono, label, n }: { activo: boolean; onClick: () => void; icono: React.ReactNode; label: string; n?: number }) {
  return (
    <button type="button" role="tab" aria-selected={activo} onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all max-sm:min-h-11 sm:flex-none ${activo ? "bg-[#4FAEB2] text-white shadow-md shadow-[#4FAEB2]/30" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>
      <span className={activo ? "text-white" : "text-slate-400"}>{icono}</span>
      {label}
      {typeof n === "number" ? (
        <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${activo ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{n}</span>
      ) : null}
    </button>
  );
}

function Kpi({ icono, label, valor, sub, acento = "neutro", className = "" }: { icono: React.ReactNode; label: string; valor: string; sub?: string; acento?: "neutro" | "destacado" | "aviso"; className?: string }) {
  const chip = acento === "destacado" ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/10 text-[#4FAEB2]" : acento === "aviso" ? "border-amber-200 bg-amber-50 text-amber-600" : "border-slate-200 bg-slate-50 text-slate-500";
  const tarjeta = acento === "destacado"
    ? "relative min-w-0 overflow-hidden rounded-xl border border-[#4FAEB2]/55 bg-gradient-to-br from-white via-white to-[#4FAEB2]/[0.08] px-3 py-3 shadow-[0_4px_18px_rgba(79,174,178,0.08)] sm:px-3.5"
    : "relative min-w-0 overflow-hidden rounded-xl border border-[#4FAEB2]/45 bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-3.5";
  return (
    <div className={`${tarjeta} ${className}`}>
      {acento === "destacado" ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/70 to-[#4FAEB2]/30" /> : null}
      <div className="flex items-start gap-2.5">
        {/* En celular sin ícono: el monto entero entra en media pantalla. */}
        <span className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg border sm:flex ${chip}`}>{icono}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className={`mt-0.5 text-base font-semibold leading-tight tracking-tight tabular-nums sm:truncate sm:text-lg ${acento === "destacado" ? "text-[#3F8E91]" : acento === "aviso" ? "text-amber-600" : "text-slate-900"}`}>{valor}</p>
          {sub ? <p className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" /> {texto}
    </div>
  );
}

function Vacio({ titulo, subtitulo, cta }: { titulo: string; subtitulo?: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#4FAEB2]/25 bg-[#4FAEB2]/[0.08] text-[#4FAEB2]"><Inbox className="h-6 w-6" /></span>
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {subtitulo ? <p className="text-xs text-slate-500">{subtitulo}</p> : null}
      {cta ? <div className="mt-1">{cta}</div> : null}
    </div>
  );
}
