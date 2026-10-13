"use client";

/**
 * Ficha del cliente (copia del sistema actual, con datos genéricos). Se usa en la página
 * /clientes/[id] y, como en el sistema actual, dentro del modal "Detalle del cliente" que
 * abre la lista (onCerrar).
 * Encabezado: avatar, nombre, código CL-…, estado, "Cliente desde", Dar de baja / Reactivar
 * y Eliminar (administrador); acciones Nueva suscripción, Venta al contado y Registrar pago;
 * franja de datos (origen, categoría, condición, suscripción activa, moneda, vendedor,
 * creado por). Pestañas, iguales al sistema actual: Información (formulario editable en el
 * lugar), Estado de cuenta (ventas, cobros y PDF), Suscripciones (facturación, cambio de
 * plan, pausa y cancelación), Proyectos (si el módulo está activo) e Historial.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClipboardPen, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
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

type Tab = "informacion" | "estado_cuenta" | "suscripciones" | "proyectos" | "historial";
const CON_PROYECTOS = moduloEstaActivo("proyectos");

export function FichaCliente({ id, onCerrar, onCambio }: { id: string; onCerrar?: () => void; onCambio?: () => void }) {
  const router = useRouter();
  // En el modal, salir de la ficha cierra el modal (y la lista se refresca); en la página, navega.
  const salir = (url: string) => {
    if (onCerrar) { onCambio?.(); onCerrar(); } else router.push(url);
  };
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const [data, setData] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("informacion");
  // Registrar cobro: null = cerrado; "" = general; id = la cuenta de esa venta.
  const [cobrando, setCobrando] = useState<string | null>(null);
  const [recargaCuenta, setRecargaCuenta] = useState(0);
  const [recargaHist, setRecargaHist] = useState(0);
  const [bajando, setBajando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [subs, setSubs] = useState<SuscripcionCliente[]>([]);
  const [subsCargando, setSubsCargando] = useState(true);
  const [subsError, setSubsError] = useState<string | null>(null);
  const [nuevaSusc, setNuevaSusc] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const puedeSuscribir = me?.rol === "ADMIN" || me?.rol === "VENDEDOR";

  const cargar = useCallback(async () => {
    try {
      const d = await apiFetch<Detalle>(`/api/clientes/${id}`);
      setData(d);
      onCambio?.();
      setRecargaHist((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  const cargarSubs = useCallback(async () => {
    setSubsCargando(true);
    try {
      setSubs(await apiFetch<SuscripcionCliente[]>(`/api/clientes/${id}/facturacion`));
      setSubsError(null);
    } catch (e) {
      setSubsError((e as Error).message);
    } finally {
      setSubsCargando(false);
    }
  }, [id]);
  useEffect(() => { void cargarSubs(); }, [cargarSubs]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  /** Algo cambió en las suscripciones: se emitió una cuota, cambió el plan o el estado. */
  async function suscripcionesCambiaron(mensaje?: string) {
    if (mensaje) setAviso(mensaje);
    setRecargaCuenta((k) => k + 1);
    await Promise.all([cargarSubs(), cargar()]);
  }

  async function cambiarActivo(activo: boolean) {
    setCambiando(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
      await cargar();
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
    ...(CON_PROYECTOS ? [{ id: "proyectos" as Tab, label: "Proyectos" }] : []),
    { id: "historial", label: "Historial" },
  ];
  const datos: { label: string; value: React.ReactNode }[] = [
    { label: "Origen", value: c.origen ?? "MANUAL" },
    { label: "Categoría", value: c.categoria_nombre ? <CategoriaChip nombre={c.categoria_nombre} color={c.categoria_color} /> : "—" },
    { label: "Condición", value: credito ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado" },
    {
      label: "Suscripción activa",
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
    <div className={onCerrar ? "space-y-6" : "max-w-7xl space-y-6 pb-10"}>
      {onCerrar ? null : <Link href="/clientes" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-600">← Clientes</Link>}

      {/* Panel resumen */}
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}73` }}>
        <div className="px-6 py-5" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${TEAL}14)` }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar nombre={c.nombre} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Cliente</p>
                </div>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{c.nombre}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CodigoChip codigo={codigoCliente(c)} fondo="bg-white" />
                  {c.ruc || (c.tipo_cliente === "empresa" && c.documento) ? (
                    <span className="text-[11px] text-slate-500"><span className="font-medium text-slate-400">RUC:</span> {c.ruc || c.documento}</span>
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
            <div className="flex shrink-0 items-center gap-2">
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
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200/70 pt-4">
            <span title={puedeSuscribir ? undefined : "Solo un administrador o vendedor puede crear suscripciones"}>
              <button type="button" disabled={!puedeSuscribir} onClick={() => setNuevaSusc(true)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nueva suscripción
              </button>
            </span>
            <Link href="/caja/nueva"
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
              style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}14`, color: TEAL }}>
              Venta al contado
            </Link>
            <button type="button" onClick={() => setCobrando("")}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              Registrar pago
            </button>
            <Link href={`/clientes/${encodeURIComponent(c.id)}/tipificacion`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              <ClipboardPen className="h-3.5 w-3.5" /> Tipificación
            </Link>
            <Link href={`/clientes/gestion?cliente=${encodeURIComponent(c.id)}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              Abrir en Gestión
            </Link>
          </div>
        </div>

        {/* Datos rápidos */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/40 sm:grid-cols-4 xl:grid-cols-7">
          {datos.map((d) => (
            <div key={d.label} className="px-5 py-3.5">
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
        <div className="border-b border-gray-200 flex overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                tab === t.id ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-h-[220px]">
          <div className="p-6">
            {tab === "informacion" ? (
              <TabInformacion cliente={c} esAdmin={esAdmin} onGuardado={() => void cargar()} />
            ) : null}
            {tab === "estado_cuenta" ? (
              <TabEstadoCuenta clienteId={c.id} ventas={data.ventas} recarga={recargaCuenta} esAdmin={esAdmin}
                onRegistrarPago={(cxc) => setCobrando(cxc ?? "")}
                onCambio={() => { void cargar(); void cargarSubs(); }} />
            ) : null}
            {tab === "suscripciones" ? (
              <TabSuscripciones clienteNombre={c.razon_social || c.nombre} suscripciones={subs} cargando={subsCargando} error={subsError}
                rol={me?.rol} onNueva={() => setNuevaSusc(true)} onCambio={suscripcionesCambiaron} />
            ) : null}
            {tab === "proyectos" && CON_PROYECTOS ? <ProyectosDeCliente clienteId={c.id} /> : null}
            {tab === "historial" ? <TabHistorial clienteId={c.id} recarga={recargaHist} /> : null}
          </div>
        </div>
      </div>

      {cobrando !== null ? (
        <RegistrarCobro clienteId={c.id} clienteNombre={c.razon_social || c.nombre} cxcInicial={cobrando || null} onClose={() => setCobrando(null)}
          onHecho={() => { void cargar(); void cargarSubs(); setRecargaCuenta((k) => k + 1); setTab("estado_cuenta"); }} />
      ) : null}
      {nuevaSusc ? (
        <ModalNuevaSuscripcion clienteId={c.id} suscripciones={subs} esAdmin={esAdmin} onClose={() => setNuevaSusc(false)}
          onCreada={(m) => { setNuevaSusc(false); setTab("suscripciones"); void suscripcionesCambiaron(m); }} />
      ) : null}
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
    <div className="max-w-7xl space-y-6">
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
