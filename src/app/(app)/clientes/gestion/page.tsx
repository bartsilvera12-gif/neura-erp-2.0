"use client";

/**
 * /clientes/gestion — Gestión del Cliente (copia del sistema actual, con datos genéricos).
 * Panel operativo de UN cliente: sin cliente, un buscador grande al centro (un solo campo
 * para nombre, razón social, RUC, teléfonos, correos, documento y código; Enter = primer
 * resultado, Esc cierra). Con cliente (queda en la URL: ?cliente=<id>): chip "CAMBIAR" + "×"
 * y "Filtros facturas"; tarjeta con sus datos; botones operativos (Tipificación, Contactos,
 * Facturación, Facturar venta, Servicios asociados, Cambio de plan, Cambio fecha venc.,
 * Historial cliente, Ver ficha); y sus documentos (contado, crédito y cuotas de suscripción)
 * con cifras, saldo, mora, estado, último pago y las acciones Cobrar / Ver.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar, CalendarClock, ChevronDown, ChevronUp, ClipboardList, ExternalLink, History,
  Link2, Receipt, RefreshCw, SlidersHorizontal, Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import type { Detalle } from "@/modules/clientes/ficha/tipos";
import { ModalFacturacion } from "@/modules/clientes/suscripciones/ModalFacturacion";
import { ModalCambioPlan } from "@/modules/clientes/suscripciones/ModalCambioPlan";
import type { SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { fechaDia, monto } from "@/modules/clientes/suscripciones/ui";
import { BadgeEstado, TEAL, codigoCliente, estadoDe, fechaCorta, gs } from "@/modules/clientes/ui";
import { BuscadorCliente, IconoLupa } from "@/modules/clientes/gestion/BuscadorCliente";
import { ModalContactos } from "@/modules/clientes/gestion/ModalContactos";
import { ModalCambioVencimiento, ModalElegirSuscripcion, ModalHistorial } from "@/modules/clientes/gestion/Modales";
import {
  FILTROS_VACIOS, type ClienteBuscado, type DocumentoCliente, type Documentos, type EstadoDocumento, type FiltrosDocumentos,
} from "@/modules/clientes/gestion/tipos";

const F_INPUT = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
const F_LABEL = "mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400";

export default function GestionClientesPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[35vh] items-center justify-center text-sm text-slate-400">Cargando gestión de clientes…</div>}>
      <GestionClientes />
    </Suspense>
  );
}

type AccionSusc = { tipo: "facturacion" | "plan" | "vencimiento"; id: string | null };

function GestionClientes() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useUsuario();
  const puedeOperar = me?.rol === "ADMIN" || me?.rol === "VENDEDOR";
  const puedeCobrar = puedeOperar || me?.rol === "CAJERO";

  // Cliente abierto. La URL (?cliente=) es la fuente al entrar / al ir atrás; al elegir se
  // cambia el estado en el acto y la URL después (router.replace no actualiza searchParams
  // al instante: el ref evita que el valor viejo vuelva a abrir el cliente anterior).
  const urlId = searchParams.get("cliente")?.trim() || null;
  const [selId, setSelId] = useState<string | null>(urlId);
  const ultimoUrl = useRef<string | null>(urlId);

  const [cartera, setCartera] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargandoCli, setCargandoCli] = useState(false);
  const [errorCli, setErrorCli] = useState<string | null>(null);
  const [subs, setSubs] = useState<SuscripcionCliente[]>([]);
  const [docs, setDocs] = useState<Documentos | null>(null);
  const [cargandoDocs, setCargandoDocs] = useState(false);
  const [errorDocs, setErrorDocs] = useState<string | null>(null);
  const [totalSinFiltros, setTotalSinFiltros] = useState<number | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDocumentos>(FILTROS_VACIOS);
  const [panelFiltros, setPanelFiltros] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(true);
  const [recarga, setRecarga] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  const [modalContactos, setModalContactos] = useState(false);
  const [modalHistorial, setModalHistorial] = useState(false);
  const [accionSusc, setAccionSusc] = useState<AccionSusc | null>(null);
  const [cobrando, setCobrando] = useState<{ cxc: string | null } | null>(null);
  const [viendoVenta, setViendoVenta] = useState<string | null>(null);

  /** Abre otro cliente (o ninguno): todo lo del anterior se limpia. */
  const abrir = useCallback((id: string | null) => {
    setSelId(id);
    setDetalle(null);
    setSubs([]);
    setDocs(null);
    setErrorCli(null);
    setErrorDocs(null);
    setTotalSinFiltros(null);
    setFiltros(FILTROS_VACIOS);
    setPanelFiltros(false);
    setAccionSusc(null);
    setCobrando(null);
    setViendoVenta(null);
    setModalContactos(false);
    setModalHistorial(false);
  }, []);

  // URL → estado (entrar con ?cliente=, atrás / adelante del navegador).
  useEffect(() => {
    if (urlId === ultimoUrl.current) return;
    ultimoUrl.current = urlId;
    abrir(urlId);
  }, [urlId, abrir]);

  function elegir(c: ClienteBuscado) {
    if (c.id === selId) return;
    ultimoUrl.current = c.id;
    abrir(c.id);
    router.replace(`/clientes/gestion?cliente=${encodeURIComponent(c.id)}`, { scroll: false });
  }

  function quitarCliente() {
    ultimoUrl.current = null;
    abrir(null);
    router.replace("/clientes/gestion", { scroll: false });
  }

  // Chip "N en cartera" (clientes activos).
  useEffect(() => {
    apiFetch<{ activos: number }>("/api/clientes?cartera=1").then((r) => setCartera(Number(r.activos) || 0)).catch(() => {});
  }, []);

  // Datos del cliente + sus suscripciones (para Condición, Facturación, Cambio de plan / venc.).
  useEffect(() => {
    if (!selId) return;
    let vivo = true;
    setCargandoCli(true);
    Promise.all([
      apiFetch<Detalle>(`/api/clientes/${encodeURIComponent(selId)}`),
      apiFetch<SuscripcionCliente[]>(`/api/clientes/${encodeURIComponent(selId)}/facturacion`).catch(() => null),
    ])
      .then(([d, s]) => {
        if (!vivo) return;
        setDetalle(d);
        if (s) setSubs(s);
        setErrorCli(null);
      })
      .catch((e) => { if (vivo) setErrorCli((e as Error).message || "No se pudo cargar el cliente"); })
      .finally(() => { if (vivo) setCargandoCli(false); });
    return () => { vivo = false; };
  }, [selId, recarga]);

  const filtrosActivos = useMemo(
    () => (Object.keys(FILTROS_VACIOS) as (keyof FiltrosDocumentos)[]).some((k) => filtros[k] !== FILTROS_VACIOS[k]),
    [filtros],
  );

  // Documentos (los filtros los aplica la base).
  useEffect(() => {
    if (!selId) return;
    let vivo = true;
    const p = new URLSearchParams();
    if (filtros.emision_desde) p.set("emision_desde", filtros.emision_desde);
    if (filtros.emision_hasta) p.set("emision_hasta", filtros.emision_hasta);
    if (filtros.venc_desde) p.set("venc_desde", filtros.venc_desde);
    if (filtros.venc_hasta) p.set("venc_hasta", filtros.venc_hasta);
    if (!filtros.incluir_saldo_cero) p.set("saldo_cero", "0");
    if (!filtros.incluir_contado) p.set("contado", "0");
    if (filtros.moneda) p.set("moneda", filtros.moneda);
    const qs = p.toString();
    const sinFiltros = qs === "";
    setCargandoDocs(true);
    apiFetch<Documentos>(`/api/clientes/${encodeURIComponent(selId)}/documentos${qs ? `?${qs}` : ""}`)
      .then((r) => {
        if (!vivo) return;
        setDocs(r);
        setErrorDocs(null);
        if (sinFiltros) setTotalSinFiltros(r.rows.length);
      })
      .catch((e) => { if (vivo) setErrorDocs((e as Error).message || "No se pudieron cargar los documentos"); })
      .finally(() => { if (vivo) setCargandoDocs(false); });
    return () => { vivo = false; };
  }, [selId, filtros, recarga]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  /** Algo cambió (cobro, cuota emitida, plan, vencimiento): se recargan tarjeta y documentos. */
  function refrescar(mensaje?: string) {
    if (mensaje) setAviso(mensaje);
    setRecarga((k) => k + 1);
  }

  function setFiltro<K extends keyof FiltrosDocumentos>(k: K, v: FiltrosDocumentos[K]) {
    setFiltros((f) => ({ ...f, [k]: v }));
  }

  const c = detalle && detalle.cliente.id === selId ? detalle.cliente : null;
  const nombre = c ? c.nombre : "";
  const vigentes = subs.filter((s) => s.estado !== "cancelada");
  const activas = subs.filter((s) => s.estado === "activa");
  // Facturación: todas (una cancelada igual muestra lo que se emitió); primero las vigentes.
  const paraFacturacion = [...vigentes, ...subs.filter((s) => s.estado === "cancelada")];

  /** Botón que trabaja sobre una suscripción: con una sola va directo; con varias (o ninguna), elegir. */
  function sobreSuscripcion(tipo: AccionSusc["tipo"]) {
    const lista = tipo === "facturacion" ? paraFacturacion : vigentes;
    if (tipo === "vencimiento") { setAccionSusc({ tipo, id: lista.length ? "todas" : null }); return; }
    setAccionSusc({ tipo, id: lista.length === 1 ? lista[0].suscripcion_id : null });
  }

  const rows = docs?.rows ?? [];
  const k = docs?.kpis ?? null;
  const saldoTotal = Number(k?.saldo_pendiente ?? 0);
  const montoTotal = Number(k?.monto_total ?? 0);
  const vencidas = Number(k?.vencidas ?? 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <header className="shrink-0 border-b border-slate-200/80 pb-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Gestión</p>
            </div>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900">Gestión del Cliente</h1>
            <p className="text-[11px] text-slate-500">Panel operativo · consultas y tipificaciones</p>
          </div>
          {cartera != null && cartera > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums"
              style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
              <span aria-hidden className="h-1 w-1 rounded-full" style={{ backgroundColor: TEAL }} />
              {cartera.toLocaleString("es-PY")} en cartera
            </span>
          ) : null}
        </div>
      </header>

      {aviso ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
          <span className="text-lg">✓</span>
          <p className="text-sm font-medium">{aviso}</p>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        style={{ height: "max(560px, calc(100dvh - 10.5rem))", boxShadow: `0 0 0 1px ${TEAL}26` }}>
        {selId === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
            <div className="space-y-2 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
                <IconoLupa className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold tracking-tight text-slate-800">Buscá un cliente</p>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-500">
                Un solo campo cubre nombre, razón social, RUC, teléfonos, correos, documento y código interno.
              </p>
            </div>
            <BuscadorCliente variant="landing" onSelect={elegir} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Barra: cliente elegido + filtros */}
            <div className="shrink-0 border-b border-slate-200/80 bg-slate-50/70">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
                <BuscadorCliente variant="toolbar" seleccionado={nombre || "Cliente"} onSelect={elegir} onClear={quitarCliente} />
                <button type="button" onClick={() => setPanelFiltros((v) => !v)} aria-expanded={panelFiltros}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${panelFiltros || filtrosActivos ? "" : "border-slate-200 bg-white text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]"}`}
                  style={panelFiltros || filtrosActivos ? { borderColor: `${TEAL}73`, backgroundColor: `${TEAL}1a`, color: TEAL } : undefined}>
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  Filtros facturas
                  {filtrosActivos ? <span className="ml-0.5 inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL }} title="Hay filtros aplicados" /> : null}
                </button>
              </div>
              {panelFiltros ? (
                <div className="space-y-3 border-t border-slate-200/70 bg-white px-3 py-3 sm:px-4">
                  <SectionLabel>Filtros sobre el listado de facturas</SectionLabel>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block">
                      <span className={F_LABEL}>Fecha emisión desde</span>
                      <input type="date" value={filtros.emision_desde} onChange={(e) => setFiltro("emision_desde", e.target.value)} className={F_INPUT} />
                    </label>
                    <label className="block">
                      <span className={F_LABEL}>Fecha emisión hasta</span>
                      <input type="date" value={filtros.emision_hasta} onChange={(e) => setFiltro("emision_hasta", e.target.value)} className={F_INPUT} />
                    </label>
                    <label className="block">
                      <span className={F_LABEL}>Vencimiento desde</span>
                      <input type="date" value={filtros.venc_desde} onChange={(e) => setFiltro("venc_desde", e.target.value)} className={F_INPUT} />
                    </label>
                    <label className="block">
                      <span className={F_LABEL}>Vencimiento hasta</span>
                      <input type="date" value={filtros.venc_hasta} onChange={(e) => setFiltro("venc_hasta", e.target.value)} className={F_INPUT} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={filtros.incluir_saldo_cero} onChange={(e) => setFiltro("incluir_saldo_cero", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                      <span className="text-xs text-slate-600">Incluir saldo cero</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={filtros.incluir_contado} onChange={(e) => setFiltro("incluir_contado", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                      <span className="text-xs text-slate-600">Incluir factura contado</span>
                    </label>
                    <label className="block min-w-[10rem] flex-1">
                      <span className={F_LABEL}>Moneda</span>
                      <select value={filtros.moneda} onChange={(e) => setFiltro("moneda", e.target.value as FiltrosDocumentos["moneda"])} className={F_INPUT}>
                        <option value="">Todas</option>
                        <option value="GS">Guaraníes (GS)</option>
                        <option value="USD">Dólares (USD)</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => setFiltros(FILTROS_VACIOS)}
                      className="self-end rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
                      Restablecer filtros
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
              {/* Tarjeta del cliente */}
              <section className="border-b border-slate-200/80 px-3 py-3 sm:px-5 sm:py-4">
                {!c ? (
                  errorCli ? (
                    <div className="space-y-2 py-6 text-center">
                      <p className="text-sm text-rose-700">{errorCli}</p>
                      <button type="button" onClick={quitarCliente} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        Buscar otro cliente
                      </button>
                    </div>
                  ) : (
                    <TarjetaSkeleton />
                  )
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{c.nombre}</h2>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                          <span className="font-mono text-slate-400">{codigoCliente(c)}</span>
                          {c.ruc ? <span>· RUC {c.ruc}</span> : null}
                          {c.documento && !c.ruc ? <span>· Doc. {c.documento}</span> : null}
                        </div>
                      </div>
                      <BadgeEstado estado={estadoDe(c)} />
                    </div>

                    <div className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${cargandoCli ? "opacity-70" : ""}`}>
                      {[
                        { label: "RUC", value: c.ruc || "—" },
                        { label: "Contacto", value: c.nombre_contacto || "—" },
                        { label: "Correo", value: c.email || "—" },
                        { label: "Teléfono", value: c.telefono || "—" },
                        { label: "Dirección", value: [c.direccion, c.ciudad].filter(Boolean).join(", ") || "—" },
                        { label: "Tipo de cliente", value: `${c.tipo_cliente === "empresa" ? "Empresa" : "Persona"}${c.categoria_nombre ? ` · ${c.categoria_nombre}` : ""}` },
                        { label: "Razón social", value: c.razon_social || "—" },
                        { label: "RUC factura", value: c.ruc || c.documento || "—" },
                        {
                          label: "Condición",
                          value: activas.length ? "Suscripción activa" : c.condicion_pago === "CREDITO" ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado",
                        },
                        { label: "Fecha alta", value: fechaCorta(c.creado_at) || "—" },
                      ].map((it) => (
                        <div key={it.label} className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{it.label}</p>
                          <p className="mt-0.5 truncate text-xs font-medium text-slate-800" title={it.value}>{it.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
                      <BotonOperativo label="Tipificación" icon={<ClipboardList className="h-3.5 w-3.5" />} title="Próximamente (Soporte)" />
                      <BotonOperativo label="Contactos" icon={<Users className="h-3.5 w-3.5" />} onClick={() => setModalContactos(true)} />
                      <BotonOperativo label="Facturación" icon={<Calendar className="h-3.5 w-3.5" />} onClick={() => sobreSuscripcion("facturacion")} />
                      <BotonOperativo label="Facturar venta" icon={<Receipt className="h-3.5 w-3.5" />} href={`/caja/nueva?cliente=${encodeURIComponent(c.id)}`} />
                      <BotonOperativo label="Servicios asociados" icon={<Link2 className="h-3.5 w-3.5" />} title="No disponible" />
                      <BotonOperativo label="Cambio de plan" icon={<RefreshCw className="h-3.5 w-3.5" />}
                        onClick={puedeOperar ? () => sobreSuscripcion("plan") : undefined}
                        title={puedeOperar ? undefined : "Solo un administrador o vendedor"} />
                      <BotonOperativo label="Cambio fecha venc." icon={<CalendarClock className="h-3.5 w-3.5" />}
                        onClick={puedeOperar ? () => sobreSuscripcion("vencimiento") : undefined}
                        title={puedeOperar ? undefined : "Solo un administrador o vendedor"} />
                      <BotonOperativo label="Historial cliente" icon={<History className="h-3.5 w-3.5" />} onClick={() => setModalHistorial(true)} />
                      <BotonOperativo label="Ver ficha" icon={<ExternalLink className="h-3.5 w-3.5" />} href={`/clientes/${c.id}`} />
                    </div>
                  </>
                )}
              </section>

              {/* Documentos del cliente */}
              <section>
                <button type="button" onClick={() => setDetalleAbierto((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 border-b border-slate-200/60 bg-slate-50/90 px-3 py-2.5 text-left transition-colors hover:bg-slate-100/70 sm:px-4">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="inline-flex shrink-0" style={{ color: TEAL }} aria-hidden>
                      {detalleAbierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Facturas</span>
                    <span className="hidden text-[10px] font-normal text-slate-400 sm:inline">del cliente</span>
                    {filtrosActivos && totalSinFiltros != null && docs ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        {rows.length}/{totalSinFiltros} con filtros
                      </span>
                    ) : null}
                    <span className="hidden h-3 w-px bg-slate-200 sm:inline" />
                    <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">
                      {docs ? rows.length : "…"} docs
                    </span>
                    <span className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums" style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
                      Saldo {gs(saldoTotal)}
                    </span>
                    {vencidas > 0 ? (
                      <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{vencidas} venc.</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold" style={{ color: TEAL }}>{detalleAbierto ? "Ocultar detalle" : "Ver detalle"}</span>
                </button>

                {detalleAbierto ? (
                  <div className={cargandoDocs && docs ? "opacity-60 transition-opacity" : ""}>
                    {errorDocs ? <p className="m-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorDocs}</p> : null}
                    {rows.length > 0 && k ? (
                      <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 bg-slate-50/50 p-2 sm:grid-cols-3 lg:grid-cols-6">
                        <Kpi titulo="Facturas" valor={String(k.documentos)} />
                        <Kpi titulo="Monto total" valor={gs(montoTotal)} chico />
                        <Kpi titulo="Saldo pend." valor={gs(saldoTotal)} chico tono={saldoTotal > 0 ? "rojo" : "verde"} marca />
                        <Kpi titulo="Vencidas" valor={String(k.vencidas)} tono="rojo" borde="border-red-200" />
                        <Kpi titulo="Pendientes" valor={String(k.pendientes)} tono="ambar" borde="border-amber-200" />
                        <Kpi titulo="Pagadas" valor={String(k.pagadas)} tono="verde" borde="border-emerald-200" />
                      </div>
                    ) : null}

                    {!docs && !errorDocs ? (
                      <p className="px-4 py-10 text-center text-sm text-slate-400">Cargando facturas…</p>
                    ) : rows.length === 0 && docs ? (
                      <div className="space-y-2 px-4 py-10 text-center text-sm text-slate-400">
                        <p>{filtrosActivos ? "No hay facturas para los filtros seleccionados." : "Este cliente todavía no tiene facturas."}</p>
                        {filtrosActivos && totalSinFiltros ? (
                          <p className="text-xs text-amber-700">Hay {totalSinFiltros} factura(s) cargadas; revisá período, moneda o «Incluir factura contado».</p>
                        ) : null}
                      </div>
                    ) : rows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-sm">
                          <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 shadow-sm">
                            <tr>
                              {["Tipo", "Nro. factura", "Fecha emisión", "Fecha vencimiento", "Monto", "Saldo", "Días mora", "Estado", "Pago registrado", "Operación"].map((h) => (
                                <th key={h} className={`whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:px-3 ${h === "Operación" ? "text-center" : h === "Días mora" ? "text-center" : "text-left"}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.map((d) => (
                              <FilaDocumento key={d.id} d={d} puedeCobrar={puedeCobrar}
                                onVer={() => setViendoVenta(d.id)} onCobrar={() => setCobrando({ cxc: d.cxc_id })} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {rows.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-500 sm:px-4">
                        <span className="tabular-nums">
                          <span className="font-semibold text-slate-700">{rows.length}</span> facturas
                          {filtrosActivos ? <span className="text-slate-400"> (filtradas)</span> : null}
                        </span>
                        <span className="tabular-nums">Total: <span className="font-semibold text-slate-700">{gs(montoTotal)}</span></span>
                        <span className="tabular-nums">
                          Saldo: <span className={`font-semibold ${saldoTotal > 0 ? "text-red-600" : "text-emerald-700"}`}>{gs(saldoTotal)}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* Modales */}
      {c && modalContactos ? (
        <ModalContactos clienteId={c.id} clienteNombre={nombre} puedeEditar={puedeOperar} onClose={() => setModalContactos(false)} />
      ) : null}
      {c && modalHistorial ? <ModalHistorial clienteId={c.id} clienteNombre={nombre} onClose={() => setModalHistorial(false)} /> : null}
      {c && accionSusc ? (
        <AccionSuscripcion accion={accionSusc} clienteId={c.id} clienteNombre={c.razon_social || c.nombre}
          paraFacturacion={paraFacturacion} vigentes={vigentes} puedeEmitir={puedeOperar}
          onElegir={(id) => setAccionSusc({ ...accionSusc, id })}
          onClose={() => setAccionSusc(null)}
          onCambio={(m) => refrescar(m)} />
      ) : null}
      {c && cobrando ? (
        <RegistrarCobro clienteId={c.id} clienteNombre={c.razon_social || c.nombre} cxcInicial={cobrando.cxc}
          onClose={() => setCobrando(null)} onHecho={() => refrescar()} />
      ) : null}
      {viendoVenta ? (
        <VentaDetalle ventaId={viendoVenta} onClose={() => setViendoVenta(null)} onAnulada={() => { setViendoVenta(null); refrescar("Venta anulada"); }} />
      ) : null}
    </div>
  );
}

/** Facturación / Cambio de plan / Cambio fecha venc.: elegir la suscripción si hace falta y abrir su modal. */
function AccionSuscripcion({ accion, clienteId, clienteNombre, paraFacturacion, vigentes, puedeEmitir, onElegir, onClose, onCambio }: {
  accion: AccionSusc;
  clienteId: string;
  clienteNombre: string;
  paraFacturacion: SuscripcionCliente[];
  vigentes: SuscripcionCliente[];
  puedeEmitir: boolean;
  onElegir: (id: string) => void;
  onClose: () => void;
  onCambio: (mensaje?: string) => void;
}) {
  const lista = accion.tipo === "facturacion" ? paraFacturacion : vigentes;
  const titulo = accion.tipo === "facturacion" ? "Facturación" : accion.tipo === "plan" ? "Cambio de plan" : "Cambio de fecha de vencimiento";

  if (accion.tipo === "vencimiento" && accion.id) {
    return <ModalCambioVencimiento suscripciones={vigentes} onClose={onClose} onHecho={(m) => { onClose(); onCambio(m); }} />;
  }
  const s = accion.id ? lista.find((x) => x.suscripcion_id === accion.id) ?? null : null;
  if (!s) {
    return <ModalElegirSuscripcion titulo={titulo} clienteId={clienteId} suscripciones={lista} onElegir={(x) => onElegir(x.suscripcion_id)} onClose={onClose} />;
  }
  if (accion.tipo === "facturacion") {
    return <ModalFacturacion clienteNombre={clienteNombre} suscripcion={s} puedeEmitir={puedeEmitir} onClose={onClose} onCambio={() => onCambio()} />;
  }
  return <ModalCambioPlan suscripcion={s} onClose={onClose} onHecho={(m) => { onClose(); onCambio(m); }} />;
}

const ESTADO_DOC: Record<EstadoDocumento, { t: string; cls: string; dot: string }> = {
  pagado: { t: "Pagado", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  pendiente: { t: "Pendiente", cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  parcial: { t: "Parcial", cls: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  vencido: { t: "Vencido", cls: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  anulado: { t: "Anulado", cls: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
};

function BadgeDocumento({ estado }: { estado: EstadoDocumento }) {
  const it = ESTADO_DOC[estado] ?? ESTADO_DOC.anulado;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${it.cls}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${it.dot}`} />
      {it.t}
    </span>
  );
}

function BadgeTipo({ d }: { d: DocumentoCliente }) {
  if (d.tipo === "suscripcion") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        Suscripción{d.periodo_nombre ? ` · ${d.periodo_nombre}` : ""}
      </span>
    );
  }
  if (d.tipo === "credito") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
        style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}1a`, color: TEAL }}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL }} />
        Crédito
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Contado
    </span>
  );
}

function FilaDocumento({ d, puedeCobrar, onVer, onCobrar }: { d: DocumentoCliente; puedeCobrar: boolean; onVer: () => void; onCobrar: () => void }) {
  const vencido = d.estado === "vencido";
  const anulado = d.estado === "anulado";
  const cobrable = !anulado && Number(d.saldo) > 0 && !!d.cxc_id;
  return (
    <tr className={`transition-colors ${vencido ? "bg-red-50/50 hover:bg-red-50/80" : "hover:bg-slate-50/80"} ${anulado ? "opacity-60" : ""}`}>
      <td className="px-2 py-2 sm:px-3"><BadgeTipo d={d} /></td>
      <td className="px-2 py-2 sm:px-3">
        <button type="button" onClick={onVer} title="Ver la venta"
          className={`font-mono text-xs font-semibold transition-colors hover:underline ${anulado ? "line-through" : ""}`} style={{ color: TEAL }}>
          {d.numero}
        </button>
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500 sm:px-3">{fechaDia(d.emision) || "—"}</td>
      <td className={`whitespace-nowrap px-2 py-2 text-xs font-medium sm:px-3 ${vencido ? "text-red-600" : "text-slate-600"}`}>{d.vencimiento ? fechaDia(d.vencimiento) : "—"}</td>
      <td className={`whitespace-nowrap px-2 py-2 text-xs tabular-nums text-slate-800 sm:px-3 ${anulado ? "line-through" : ""}`}>{monto(d.monto, d.moneda)}</td>
      <td className={`whitespace-nowrap px-2 py-2 text-xs font-semibold tabular-nums sm:px-3 ${Number(d.saldo) > 0 ? "text-red-600" : "text-slate-400"}`}>{monto(d.saldo, d.moneda)}</td>
      <td className="px-2 py-2 text-center text-xs sm:px-3">
        {d.dias_mora > 0 ? <span className="font-bold tabular-nums text-red-600">{d.dias_mora}</span> : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-2 py-2 sm:px-3"><BadgeDocumento estado={d.estado} /></td>
      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-600 sm:px-3">
        {d.pago_registrado ? fechaDia(d.pago_registrado) : "—"}
        {d.recibos > 0 ? <span className="ml-1 text-[10px] text-slate-400">({d.recibos} {d.recibos === 1 ? "recibo" : "recibos"})</span> : null}
      </td>
      <td className="px-2 py-2 sm:px-3">
        <div className="flex items-center justify-center gap-1.5">
          <button type="button" onClick={onVer} title="Ver la venta e imprimir el comprobante"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
            Ver
          </button>
          {cobrable && puedeCobrar ? (
            <button type="button" onClick={onCobrar} title="Registrar un cobro de esta factura"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-95"
              style={{ backgroundColor: TEAL }}>
              Cobrar
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function Kpi({ titulo, valor, chico, tono, borde, marca }: {
  titulo: string; valor: string; chico?: boolean; tono?: "rojo" | "verde" | "ambar"; borde?: string; marca?: boolean;
}) {
  const colorValor = tono === "rojo" ? "text-red-600" : tono === "verde" ? "text-emerald-700" : tono === "ambar" ? "text-amber-700" : "text-slate-800";
  const colorTitulo = marca ? "" : tono === "rojo" ? "text-red-500" : tono === "verde" ? "text-emerald-600" : tono === "ambar" ? "text-amber-600" : "text-slate-400";
  return (
    <div className={`rounded-lg border bg-white px-2 py-1.5 ${borde ?? "border-slate-200"}`}
      style={marca ? { borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}14` } : undefined}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${colorTitulo}`} style={marca ? { color: TEAL } : undefined}>{titulo}</p>
      <p className={`${chico ? "text-[11px] leading-snug" : "text-sm"} font-bold tabular-nums ${colorValor}`}>{valor}</p>
    </div>
  );
}

function BotonOperativo({ label, icon, href, onClick, title }: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** tooltip (en los deshabilitados, el porqué) */
  title?: string;
}) {
  const base = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition";
  const activo = `${base} text-white shadow-sm hover:brightness-90`;
  const estilo = { borderColor: TEAL, backgroundColor: TEAL };
  if (href) {
    return <Link href={href} className={activo} style={estilo} title={title}>{icon}{label}</Link>;
  }
  if (onClick) {
    return <button type="button" onClick={onClick} className={activo} style={estilo} title={title}>{icon}{label}</button>;
  }
  return (
    <span title={title} className="inline-flex">
      <button type="button" disabled className={`${base} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400`}>{icon}{label}</button>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>{children}</p>
    </div>
  );
}

function TarjetaSkeleton() {
  const bar = "animate-pulse rounded-md bg-slate-200/90";
  return (
    <div className="space-y-3" aria-hidden>
      <div className={`h-5 w-64 max-w-full ${bar}`} />
      <div className={`h-3 w-40 ${bar}`} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className={`h-2.5 w-16 ${bar}`} />
            <div className={`h-3.5 w-28 max-w-full ${bar}`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
        {Array.from({ length: 9 }).map((_, i) => <div key={i} className={`h-7 w-24 ${bar}`} />)}
      </div>
    </div>
  );
}
