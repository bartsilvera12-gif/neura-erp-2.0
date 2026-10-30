"use client";

/**
 * Ficha del cliente (copia del sistema actual, con datos genéricos). Se usa en la página
 * /clientes/[id] y, como en el sistema actual, dentro del modal "Detalle del cliente" que
 * abre la lista (onCerrar).
 * Encabezado: avatar, nombre, código CL-…, estado, "Cliente desde", Dar de baja / Reactivar
 * y Eliminar (administrador); acciones Nueva suscripción, Factura al contado (servicio puntual sin caja) y
 * Registrar pago (transferencia → Conciliación, como el actual);
 * franja de datos (origen, categoría, condición, suscripción activa, moneda, vendedor,
 * creado por). Pestañas, iguales al sistema actual: Información (formulario editable en el
 * lugar), Estado de cuenta (ventas, cobros y PDF), Suscripciones (facturación, cambio de
 * plan, pausa y cancelación), Proyectos (si el módulo está activo) e Historial.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPen, FileSignature, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { urlFicha } from "@/modules/clientes/ficha/url";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import { RegistrarTransferencia } from "@/modules/cobranzas/RegistrarTransferencia";
import { FacturaContadoModal } from "@/modules/clientes/ficha/FacturaContadoModal";
import { avisoRucCliente, nombreParaFactura, rucParaFactura } from "@/modules/empresa/tipos";
import type { Detalle } from "@/modules/clientes/ficha/tipos";
import { TabInformacion } from "@/modules/clientes/ficha/TabInformacion";
import { TabEstadoCuenta } from "@/modules/clientes/ficha/TabEstadoCuenta";
import { TabHistorial } from "@/modules/clientes/ficha/TabHistorial";
import { ModalEliminar, PanelBaja } from "@/modules/clientes/ficha/Modales";
import { TabSuscripciones } from "@/modules/clientes/ficha/TabSuscripciones";
import { ModalNuevaSuscripcion } from "@/modules/clientes/suscripciones/ModalNuevaSuscripcion";
import type { SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { Avatar, BadgeEstado, CategoriaChip, CodigoChip, TEAL, codigoCliente, estadoDe, fechaCorta } from "@/modules/clientes/ui";
import { moduloEstaActivo } from "@/modules/registry";
import { ProyectosDeCliente } from "@/modules/proyectos/ui/ProyectosDeCliente";
import { PresupuestosDeCliente } from "@/modules/presupuestos/PresupuestosDeCliente";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { AccionesPagina } from "@/components/EncabezadoPagina";
import { ModalTipificacion, useAvisoTipificacion } from "@/modules/tipificacion/ModalTipificacion";
import { precargarTipificacion } from "@/modules/tipificacion/datos";

type Tab = "informacion" | "estado_cuenta" | "suscripciones" | "presupuestos" | "proyectos" | "historial";
const CON_PROYECTOS = moduloEstaActivo("proyectos");
const CON_PRESUPUESTOS = moduloEstaActivo("presupuestos");
const ROLES_PRESUPUESTOS = ["ADMIN", "SUPERVISOR", "VENDEDOR", "CAJERO"];

export function FichaCliente({ id, onCerrar, onCambio }: { id: string; onCerrar?: () => void; onCambio?: () => void }) {
  const router = useRouter();
  // En el modal, salir de la ficha cierra el modal (y la lista se refresca); en la página, navega.
  const salir = (url: string) => {
    if (onCerrar) { onCambio?.(); onCerrar(); } else router.push(url);
  };
  // Datos de entrada: si la lista ya los precargó (hover sobre la fila) o la ficha se abrió
  // hace poco, se pintan en el primer render, sin skeleton.
  const [inicial] = useState(() => guardadoAlInstante<Detalle & { suscripciones?: SuscripcionCliente[] }>(urlFicha(id)));
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const [data, setData] = useState<Detalle | null>(inicial ?? null);
  const [loading, setLoading] = useState(!inicial);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("informacion");
  // Registrar cobro: null = cerrado; "" = general; id = la cuenta de esa venta.
  const [cobrando, setCobrando] = useState<string | null>(null);
  const [transfiriendo, setTransfiriendo] = useState<string | null>(null);
  const [facturaContado, setFacturaContado] = useState(false);
  const [recargaCuenta, setRecargaCuenta] = useState(0);
  const [recargaHist, setRecargaHist] = useState(0);
  const [bajando, setBajando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [subs, setSubs] = useState<SuscripcionCliente[]>(inicial?.suscripciones ?? []);
  const [subsCargando, setSubsCargando] = useState(!inicial);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [nuevaSusc, setNuevaSusc] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tipificando, setTipificando] = useState(false);
  const avisoTip = useAvisoTipificacion();
  const puedeSuscribir = me?.rol === "ADMIN" || me?.rol === "VENDEDOR";
  const puedePresupuestar = CON_PRESUPUESTOS && !!me?.rol && ROLES_PRESUPUESTOS.includes(me.rol);

  // UNA llamada trae lo que se ve de entrada (cliente, resumen, suscripciones + facturación).
  // Con cache en memoria (stale-while-revalidate): si viene del prefetch de la lista se usa
  // tal cual (maxEdad 15 s); si no, se muestra lo guardado y se refresca atrás.
  // `fresco` = después de guardar algo. Ya NO avisa onCambio: la lista solo se recarga al
  // cerrar si de verdad cambió algo (ver `cambio`).
  const vigente = useRef<AbortController | null>(null);
  const cargar = useCallback(async (fresco = true) => {
    vigente.current?.abort();
    const ctrl = new AbortController();
    vigente.current = ctrl;
    try {
      await apiFetchSWR<Detalle & { suscripciones?: SuscripcionCliente[] }>(urlFicha(id), (d) => {
        setData(d);
        setSubs(d.suscripciones ?? []);
        setSubsError(null);
        setSubsCargando(false);
        setLoading(false);
      }, { fresco, maxEdadMs: fresco ? 0 : 15_000, signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError((e as Error).message);
      setSubsError((e as Error).message);
      setSubsCargando(false);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [id]);
  useEffect(() => { void cargar(false); }, [cargar]);

  /** Se guardó algo: la ficha se recarga (fresca), la Actividad también y la lista sabrá que debe refrescar al cerrar. */
  const cambio = useCallback(async () => {
    onCambio?.();
    setRecargaHist((k) => k + 1);
    await cargar(true);
  }, [cargar, onCambio]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  /** Algo cambió en las suscripciones: se emitió una cuota, cambió el plan o el estado. */
  async function suscripcionesCambiaron(mensaje?: string) {
    if (mensaje) setAviso(mensaje);
    setRecargaCuenta((k) => k + 1);
    await cambio();
  }

  async function cambiarActivo(activo: boolean) {
    setCambiando(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
      await cambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCambiando(false);
    }
  }

  if (loading) return <FichaSkeleton />;
  if (error && !data) {
    return (
      <div className="space-y-4">
        {onCerrar ? null : <Link href="/clientes" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">← Clientes</Link>}
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const c = data.cliente;
  const estado = estadoDe(c);
  const credito = c.condicion_pago === "CREDITO";
  const activas = subs.filter((s) => s.estado === "activa");
  const tabs: { id: Tab; label: string }[] = [
    { id: "informacion", label: "Información" },
    { id: "estado_cuenta", label: "Estado de cuenta" },
    { id: "suscripciones", label: "Suscripciones" },
    ...(puedePresupuestar ? [{ id: "presupuestos" as Tab, label: "Presupuestos" }] : []),
    ...(CON_PROYECTOS ? [{ id: "proyectos" as Tab, label: "Proyectos" }] : []),
    { id: "historial", label: "Historial" },
  ];
  // `movil`: lo que queda a la vista en el celular (el resto está en la pestaña Información).
  const datos: { label: string; value: React.ReactNode; movil?: boolean; ancho?: boolean }[] = [
    { label: "Origen", value: c.origen ?? "MANUAL" },
    { label: "Categoría", value: c.categoria_nombre ? <CategoriaChip nombre={c.categoria_nombre} color={c.categoria_color} /> : "—", movil: true },
    { label: "Condición", value: credito ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado", movil: true },
    {
      label: "Suscripción activa",
      movil: activas.length > 0,
      ancho: true,
      value: subsCargando && subs.length === 0
        ? <span className="inline-block h-4 w-28 max-w-full animate-pulse rounded-md bg-slate-200" aria-hidden />
        : activas.length
          ? <span title={activas.map((s) => `${s.plan} (${s.moneda})`).join(", ")}>{activas.map((s) => `${s.plan} (${s.moneda})`).join(", ")}</span>
          : "—",
    },
    { label: "Moneda", value: c.moneda_preferida ?? "GS" },
    { label: "Vendedor", value: c.vendedor_nombre || <span className="text-slate-400">Sin asignar</span> },
    { label: "Creado por", value: c.creado_por_nombre || "—" },
  ];

  return (
    <div className={onCerrar ? "space-y-4 sm:space-y-6" : "max-w-7xl space-y-4 pb-10 sm:space-y-6"}>
      {onCerrar ? null : <Link href="/clientes" className="-my-2 flex min-h-11 w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-600 sm:my-0 sm:min-h-0">← Clientes</Link>}

      {/* Panel resumen */}
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}73` }}>
        <div className="px-4 py-4 sm:px-6 sm:py-5" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${TEAL}14)` }}>
          <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <Avatar nombre={c.nombre} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 max-sm:hidden">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Cliente</p>
                </div>
                <h1 className="mt-1 text-xl font-semibold leading-tight [overflow-wrap:anywhere] sm:truncate tracking-tight text-slate-900 sm:text-2xl">{c.nombre}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="contents max-sm:hidden"><CodigoChip codigo={codigoCliente(c)} fondo="bg-white" /></span>
                  {rucParaFactura(c) ? (
                    <span className="text-[11px] text-slate-500"><span className="font-medium text-slate-400">RUC:</span> {rucParaFactura(c)}</span>
                  ) : c.documento ? (
                    <span className="text-[11px] text-slate-500"><span className="font-medium text-slate-400">CI:</span> {c.documento}</span>
                  ) : null}
                  <BadgeEstado estado={estado} />
                  <span className="text-[11px] text-slate-500">
                    Cliente desde <span className="font-medium text-slate-700">{fechaCorta(c.creado_at)}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:hidden">
              {estado === "activo" ? (
                esAdmin ? (
                  <button type="button" onClick={() => { setBajando(true); setEliminando(false); }}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-100">
                    Dar de baja
                  </button>
                ) : (
                  <button type="button" onClick={() => void cambiarActivo(false)} disabled={cambiando}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
                    Desactivar
                  </button>
                )
              ) : (
                <button type="button" onClick={() => void cambiarActivo(true)} disabled={cambiando}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 disabled:opacity-50">
                  {cambiando ? "Reactivando…" : "Reactivar"}
                </button>
              )}
              {esAdmin ? (
                <button type="button" onClick={() => setEliminando(true)} title="Eliminar cliente"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm transition-colors hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              ) : null}
            </div>
          </div>
          {/* Celular: "Registrar pago" a la vista y todo lo demás en el menú ⋯ (las pestañas quedan arriba). */}
          <div className="mt-3 sm:hidden">
            <AccionesPagina acciones={[
              { etiqueta: "Registrar pago", onClick: () => setTransfiriendo(""), primaria: true },
              { etiqueta: "Factura al contado", onClick: () => setFacturaContado(true) },
              ...(puedeSuscribir ? [{ etiqueta: "Nueva suscripción", icono: <Plus />, onClick: () => setNuevaSusc(true) }] : []),
              ...(puedePresupuestar ? [{ etiqueta: "Nuevo presupuesto", icono: <FileSignature />, href: `/presupuestos/nuevo?cliente=${encodeURIComponent(c.id)}` }] : []),
              { etiqueta: "Tipificación", icono: <ClipboardPen />, onClick: () => { precargarTipificacion(c.id); setTipificando(true); } },
              { etiqueta: "Abrir en Gestión", href: `/clientes/gestion?cliente=${encodeURIComponent(c.id)}` },
              ...(estado !== "activo"
                ? [{ etiqueta: cambiando ? "Reactivando…" : "Reactivar", onClick: () => void cambiarActivo(true), deshabilitada: cambiando }]
                : esAdmin
                  ? [{ etiqueta: "Dar de baja", onClick: () => { setBajando(true); setEliminando(false); } }]
                  : [{ etiqueta: "Desactivar", onClick: () => void cambiarActivo(false), deshabilitada: cambiando }]),
              ...(esAdmin ? [{ etiqueta: "Eliminar cliente", icono: <Trash2 />, onClick: () => setEliminando(true), tono: "peligro" as const }] : []),
            ]} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/70 pt-4 max-sm:hidden sm:mt-5">
            <span title={puedeSuscribir ? undefined : "Solo un administrador o vendedor puede crear suscripciones"} className="flex">
              <button type="button" disabled={!puedeSuscribir} onClick={() => setNuevaSusc(true)}
                className="inline-flex w-full items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nueva suscripción
              </button>
            </span>
            {puedePresupuestar ? (
              <Link href={`/presupuestos/nuevo?cliente=${encodeURIComponent(c.id)}`}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
                style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}14`, color: TEAL }}>
                <FileSignature className="h-3.5 w-3.5" /> Nuevo presupuesto
              </Link>
            ) : null}
            <button type="button" onClick={() => setFacturaContado(true)}
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
              style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}14`, color: TEAL }}>
              Factura al contado
            </button>
            <button type="button" onClick={() => setTransfiriendo("")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              Registrar pago
            </button>
            <button type="button" onClick={() => setTipificando(true)} onMouseEnter={() => precargarTipificacion(c.id)} onFocus={() => precargarTipificacion(c.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              <ClipboardPen className="h-3.5 w-3.5" /> Tipificación
            </button>
            <Link href={`/clientes/gestion?cliente=${encodeURIComponent(c.id)}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              Abrir en Gestión
            </Link>
          </div>
        </div>

        {/* Datos rápidos */}
        {/* Grilla con líneas de 1 px (gap sobre fondo gris): prolija en 2, 4 o 7 columnas. La última
            celda completa la fila (2 y 4 columnas). */}
        <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-4 xl:grid-cols-7">
          {datos.map((d, i) => (
            <div key={d.label} className={`min-w-0 bg-[#fcfdfd] px-3 py-3 sm:px-5 sm:py-3.5 ${d.movil ? "" : "max-sm:hidden"} ${d.ancho ? "max-sm:col-span-2" : ""} ${i === datos.length - 1 && datos.length % 2 ? "col-span-2 xl:col-span-1" : ""}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{d.label}</p>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      {bajando ? (
        <PanelBaja clienteId={c.id} onCancel={() => setBajando(false)} onHecho={() => salir("/clientes?baja_ok=1")} />
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {aviso ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
          <span className="text-lg">✓</span>
          <p className="text-sm font-medium">{aviso}</p>
        </div>
      ) : null}

      {/* Pestañas */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Responsive: scroll horizontal interno con desvanecido; la pestaña elegida a la vista. */}
        <ScrollHorizontal role="tablist" className="border-b border-gray-200" claseFila="gap-0" dependencias={[tab]}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 sm:px-5 sm:py-3.5 ${
                tab === t.id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}>
              {t.label}
            </button>
          ))}
        </ScrollHorizontal>
        <div className="relative min-h-[220px]">
          <div className="p-3 sm:p-6">
            {tab === "informacion" ? (
              <TabInformacion cliente={c} esAdmin={esAdmin} onGuardado={() => void cambio()} />
            ) : null}
            {tab === "estado_cuenta" ? (
              <TabEstadoCuenta clienteId={c.id} ventas={data.ventas} recarga={recargaCuenta} esAdmin={esAdmin}
                onRegistrarPago={(cxc) => setTransfiriendo(cxc ?? "")}
                onCobroCaja={() => setCobrando("")}
                onFacturaContado={() => setFacturaContado(true)}
                onCambio={() => void cambio()} />
            ) : null}
            {tab === "suscripciones" ? (
              <TabSuscripciones clienteNombre={c.razon_social || c.nombre} ruc={rucParaFactura(c)} avisoRuc={avisoRucCliente(c)} suscripciones={subs} cargando={subsCargando} error={subsError}
                rol={me?.rol} onNueva={() => setNuevaSusc(true)} onCambio={suscripcionesCambiaron} />
            ) : null}
            {tab === "presupuestos" && puedePresupuestar ? <PresupuestosDeCliente clienteId={c.id} clienteNombre={c.razon_social || c.nombre} /> : null}
            {tab === "proyectos" && CON_PROYECTOS ? <ProyectosDeCliente clienteId={c.id} /> : null}
            {tab === "historial" ? <TabHistorial clienteId={c.id} recarga={recargaHist} /> : null}
          </div>
        </div>
      </div>

      {transfiriendo !== null ? (
        <RegistrarTransferencia clienteInicial={{ id: c.id, nombre: c.razon_social || c.nombre, cxcId: transfiriendo || null }}
          onClose={() => setTransfiriendo(null)}
          onHecho={(m) => { setTransfiriendo(null); setAviso(m); setRecargaCuenta((k) => k + 1); setTab("estado_cuenta"); void cambio(); }} />
      ) : null}
      {facturaContado ? (
        <FacturaContadoModal clienteId={c.id} clienteNombre={nombreParaFactura(c)} ruc={rucParaFactura(c)} avisoRuc={avisoRucCliente(c)} moneda={c.moneda_preferida === "USD" ? "USD" : "GS"}
          onClose={() => setFacturaContado(false)}
          onEditarCliente={() => { setFacturaContado(false); setTab("informacion"); }}
          onEmitida={(m) => { setFacturaContado(false); setAviso(m); setRecargaCuenta((k) => k + 1); setTab("estado_cuenta"); void cambio(); }} />
      ) : null}
      {cobrando !== null ? (
        <RegistrarCobro clienteId={c.id} clienteNombre={c.razon_social || c.nombre} cxcInicial={cobrando || null} onClose={() => setCobrando(null)}
          onHecho={() => { void cambio(); setRecargaCuenta((k) => k + 1); setTab("estado_cuenta"); }} />
      ) : null}
      {nuevaSusc ? (
        <ModalNuevaSuscripcion clienteId={c.id} suscripciones={subs} esAdmin={esAdmin} onClose={() => setNuevaSusc(false)}
          onCreada={(m) => { setNuevaSusc(false); setTab("suscripciones"); void suscripcionesCambiaron(m); }} />
      ) : null}
      {tipificando ? (
        <ModalTipificacion clienteId={c.id} clienteNombre={c.nombre} onClose={() => setTipificando(false)}
          onGuardada={(r) => { avisoTip.mostrar(r); setRecargaHist((k) => k + 1); }} />
      ) : null}
      {avisoTip.nodo}
      {eliminando ? (
        <ModalEliminar clienteId={c.id} onClose={() => setEliminando(false)} onEliminado={() => salir("/clientes")}
          onDarDeBaja={estado === "activo" ? () => { setEliminando(false); setBajando(true); } : undefined} />
      ) : null}
    </div>
  );
}

function FichaSkeleton() {
  const bar = "animate-pulse rounded-md bg-slate-200/90";
  return (
    <div className="max-w-7xl space-y-4 sm:space-y-6">
      <div className={`h-3 w-28 ${bar}`} aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-40 animate-pulse bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200" aria-hidden />
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 sm:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2 px-5 py-3">
              <div className={`h-2.5 w-16 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex gap-2 border-b border-slate-100 px-3 py-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`h-8 max-w-[7rem] flex-1 ${bar}`} />)}
        </div>
        <div className="space-y-3 p-6">
          <div className={`h-4 w-full max-w-md ${bar}`} />
          <div className={`h-4 w-full max-w-sm ${bar}`} />
          <div className={`h-32 w-full ${bar}`} />
        </div>
      </div>
    </div>
  );
}
