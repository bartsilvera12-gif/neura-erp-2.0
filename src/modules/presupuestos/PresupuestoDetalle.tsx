"use client";

/**
 * Detalle del presupuesto (lo usan la página /presupuestos/[id] y el modal de la lista): estado, cliente, líneas y totales con IVA
 * desglosado, y todo lo que se hace con él: descargar el PDF (y en celular compartirlo como
 * ARCHIVO, si el navegador lo permite), marcar enviado / aceptado / rechazado A MANO, editar
 * (un enviado pasa a la revisión siguiente), duplicar y convertir en venta (lleva a la Caja).
 * No hay link para el cliente: el presupuesto se manda como PDF.
 * Orden: encabezado único (número, estado, cliente, datos, total y acciones con jerarquía) →
 * productos con los totales al pie → condiciones y notas (una columna centrada). El
 * "Historial" se abre en un panel desde la barra de acciones.
 * En celular la acción principal y el total quedan en un pie fijo (en el modal, pegado al pie
 * del modal).
 * Con `onCerrar` está dentro del modal de la lista: no muestra "← Presupuestos", lo que lleva a
 * otra pantalla (editar, duplicar, caja) cierra el modal antes, y `onCambio` avisa que la lista
 * tiene que recargarse al cerrar.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CalendarClock, CheckCircle2, ChevronDown, Copy, Download, ExternalLink, FileSignature, History, Loader2,
  MoreHorizontal, Pencil, Receipt, RotateCcw, Send, Share2, ShoppingCart, StickyNote, ThumbsDown, ThumbsUp, UserRound, X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante, invalidar } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { clienteConfig } from "@/cliente.config";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { TablaTarjetas } from "@/components/TablaResponsive";
import { Drawer } from "@/components/Drawer";
import { useEsMovil } from "@/lib/ui/responsive";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { BadgeEstado, textoVigencia } from "@/modules/presupuestos/ui";
import { ModalRechazo } from "@/modules/presupuestos/Modales";
import { ModalConvertir } from "@/modules/presupuestos/ModalConvertir";
import { HistorialPresupuesto } from "@/modules/presupuestos/HistorialPresupuesto";
import { browserClient } from "@/lib/supabase/browser";
import {
  cantidad, condicionTexto, diaCorto, monto, nombreArchivoPresupuesto, pct, type Presupuesto,
} from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;
type Item = Presupuesto["items"][number];
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function PresupuestoDetalle({ id, onCerrar, onCambio, avisoInicial }: {
  id: string;
  /** Dentro del modal: cierra el modal (y limpia ?ver= de la URL). */
  onCerrar?: () => void;
  /** Algo cambió (estado, duplicado, conversión…): la lista se recarga al cerrar. */
  onCambio?: () => void;
  /** Aviso al llegar (ej. "Cambios guardados." desde el formulario). */
  avisoInicial?: string | null;
}) {
  const router = useRouter();
  const enModal = !!onCerrar;
  const url = `/api/presupuestos/${id}`;
  const [p, setP] = useState<Presupuesto | null>(() => guardadoAlInstante<Presupuesto>(url) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(avisoInicial ?? null);
  useEffect(() => { if (avisoInicial) setAviso(avisoInicial); }, [avisoInicial]);
  // Ir a otra pantalla: en el modal, primero se cierra (la lista queda sin ?ver=).
  const irA = useCallback((href: string) => {
    onCerrar?.();
    router.push(href);
  }, [onCerrar, router]);
  // Links a otra pantalla: en el modal, un clic normal cierra el modal antes de navegar
  // (Ctrl/Cmd/Shift + clic abre en otra pestaña y el modal queda).
  const alSalir = useCallback((ev: React.MouseEvent) => {
    if (!onCerrar || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
    onCerrar();
  }, [onCerrar]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"rechazo" | "convertir" | "venta" | null>(null);
  const [verIva, setVerIva] = useState(false);
  const [verSeguimiento, setVerSeguimiento] = useState(false);
  // Compartir el PDF como archivo (Web Share API con archivos: celulares modernos).
  const [puedeCompartir, setPuedeCompartir] = useState(false);
  useEffect(() => {
    try {
      const f = new File([new Blob(["x"], { type: "application/pdf" })], "x.pdf", { type: "application/pdf" });
      setPuedeCompartir(typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [f] }));
    } catch { setPuedeCompartir(false); }
  }, []);
  const esMovil = useEsMovil();

  const cargar = useCallback(async (fresco = false) => {
    try {
      await apiFetchSWR<Presupuesto>(url, (d) => setP(d), { fresco });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const refrescar = useCallback(async (mensaje?: string) => {
    if (mensaje) setAviso(mensaje);
    invalidar("/api/presupuestos");
    onCambio?.();
    await cargar(true);
  }, [cargar, onCambio]);

  async function accion(nombre: string, body: Record<string, unknown>, mensaje: string) {
    setBusy(nombre);
    setError(null);
    try {
      const r = await apiFetch<{ id?: string }>(`/api/presupuestos/${id}/accion`, { method: "POST", body: JSON.stringify(body) });
      if (body.accion === "duplicar" && r.id) {
        // La copia se abre en su edición (como siempre); la lista ya tiene un presupuesto más.
        invalidar("/api/presupuestos");
        onCambio?.();
        irA(`/presupuestos/nuevo?editar=${r.id}`);
        return;
      }
      await refrescar(mensaje);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pdf() {
    if (!p) return;
    setBusy("pdf");
    try {
      await descargarArchivo(`/api/presupuestos/${id}/pdf`, nombreArchivoPresupuesto(p.numero, p.revision));
      void cargar(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Comparte el PDF como archivo (WhatsApp, mail…) con la hoja de compartir del celular. */
  async function compartirPdf() {
    if (!p) return;
    setBusy("compartir");
    setError(null);
    try {
      const { data } = await browserClient().auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`/api/presupuestos/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const nombre = nombreArchivoPresupuesto(p.numero, p.revision);
      const archivo = new File([await res.blob()], nombre, { type: "application/pdf" });
      await navigator.share({ files: [archivo], title: nombre });
      void cargar(true);
    } catch (e) {
      // Cancelar la hoja de compartir no es un error.
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!p) {
    return error
      ? <div className="space-y-3 py-10">{enModal ? null : <Link href="/presupuestos" className="text-xs text-slate-400 hover:text-slate-600">← Presupuestos</Link>}<p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p></div>
      : <p className="flex items-center gap-2 py-16 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando presupuesto…</p>;
  }

  const e = p.estado;
  const g = p.estado_guardado;
  const hoy = hoyPY();
  const vig = g === "borrador" || g === "enviado" ? textoVigencia(p.valido_hasta, hoy) : null;
  const puedeEditar = g === "borrador" || g === "enviado";
  const puedeConvertir = e !== "rechazado" && e !== "convertido";
  const m = (v: number) => monto(v, p.moneda);
  const hayDesc = p.items.some((i) => Number(i.descuento_pct) > 0);

  const menu: ItemMenu[] = [
    ...(puedeEditar ? [{ etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => irA(`/presupuestos/nuevo?editar=${p.id}`) }] : []),
    { etiqueta: "Duplicar", icono: <Copy className="h-4 w-4" />, onClick: () => void accion("duplicar", { accion: "duplicar" }, "") },
    ...(g === "borrador" ? [{ etiqueta: "Marcar como enviado", icono: <Send className="h-4 w-4" />, onClick: () => void accion("enviar", { accion: "enviar", canal: "manual" }, "Marcado como enviado.") }] : []),
    ...(g === "borrador" || g === "enviado" ? [{ etiqueta: "Marcar aceptado", icono: <ThumbsUp className="h-4 w-4" />, tono: "exito" as const, onClick: () => void accion("aceptar", { accion: "aceptar" }, "Marcado como aceptado.") }] : []),
    ...(g === "borrador" || g === "enviado" || g === "aceptado" ? [{ etiqueta: "Marcar rechazado…", icono: <ThumbsDown className="h-4 w-4" />, tono: "peligro" as const, onClick: () => setModal("rechazo") }] : []),
    ...(g === "aceptado" || g === "rechazado" ? [{ etiqueta: "Reabrir", icono: <RotateCcw className="h-4 w-4" />, onClick: () => void accion("reabrir", { accion: "reabrir" }, "Presupuesto reabierto.") }] : []),
  ];

  // ── Acciones con jerarquía ─────────────────────────────────────────────────
  // UNA principal según el estado (en celular va al pie fijo); el resto, secundarias: las más
  // usadas a la vista y lo demás en "⋯".
  type Acc = { id: string; etiqueta: string; corta?: string; icono: React.ReactNode; onClick?: () => void; href?: string; cargando?: boolean; color?: string };
  const principal: Acc | null =
    e === "convertido" && p.venta_id ? { id: "venta", etiqueta: `Ver venta ${p.venta_numero ?? ""}`.trim(), icono: <Receipt className="h-4 w-4" />, onClick: () => setModal("venta") }
    : e === "vencido" ? { id: "extender", etiqueta: "Extender validez", icono: <CalendarClock className="h-4 w-4" />, href: `/presupuestos/nuevo?editar=${p.id}` }
    : e === "rechazado" ? { id: "duplicar", etiqueta: "Duplicar", icono: <Copy className="h-4 w-4" />, onClick: () => void accion("duplicar", { accion: "duplicar" }, ""), cargando: busy === "duplicar" }
    : e === "borrador" ? { id: "pdf", etiqueta: "Descargar PDF", icono: <Download className="h-4 w-4" />, onClick: () => void pdf(), cargando: busy === "pdf" }
    : e === "enviado" ? { id: "aceptar", etiqueta: "Marcar aceptado", icono: <ThumbsUp className="h-4 w-4" />, onClick: () => void accion("aceptar", { accion: "aceptar" }, "Marcado como aceptado."), cargando: busy === "aceptar" }
    : puedeConvertir ? { id: "convertir", etiqueta: "Convertir a venta", icono: <ShoppingCart className="h-4 w-4" />, onClick: () => setModal("convertir") }
    : null;
  const secundarias: Acc[] = [
    ...(principal?.id !== "pdf" ? [{ id: "pdf", etiqueta: "Descargar PDF", corta: "PDF", icono: <Download className="h-4 w-4" />, onClick: () => void pdf(), cargando: busy === "pdf" }] : []),
    ...(puedeCompartir ? [{ id: "compartir", etiqueta: "Compartir PDF", corta: "Compartir", icono: <Share2 className="h-4 w-4" />, onClick: () => void compartirPdf(), cargando: busy === "compartir" }] : []),
    ...(g === "borrador" ? [{ id: "enviado", etiqueta: "Marcar como enviado", corta: "Enviado", icono: <Send className="h-4 w-4" />, onClick: () => void accion("enviar", { accion: "enviar", canal: "manual" }, "Marcado como enviado."), cargando: busy === "enviar" }] : []),
    ...(puedeEditar && e !== "vencido" ? [{ id: "editar", etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, href: `/presupuestos/nuevo?editar=${p.id}` }] : []),
    ...(puedeConvertir && principal?.id !== "convertir" ? [{ id: "convertir", etiqueta: "Convertir a venta", icono: <ShoppingCart className="h-4 w-4" />, onClick: () => setModal("convertir") }] : []),
  ];
  // Celular: 2 secundarias a la vista; el resto se suma al menú "⋯".
  const visiblesMovil = 2;
  const menuCompleto: ItemMenu[] = [
    ...(esMovil ? secundarias.slice(visiblesMovil).map((a) => ({ etiqueta: a.etiqueta, icono: a.icono, onClick: a.href ? () => irA(a.href!) : a.onClick! })) : []),
    ...menu.filter((it) => !(principal?.id === "duplicar" && it.etiqueta === "Duplicar") && !(it.etiqueta === "Editar" && secundarias.some((s) => s.id === "editar"))
      && !(it.etiqueta === "Marcar aceptado" && principal?.id === "aceptar") && !(it.etiqueta === "Marcar como enviado" && secundarias.some((s) => s.id === "enviado"))),
  ];
  const btnSec = "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50 sm:min-h-0";
  const btnPri = "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50 sm:min-h-0";
  const boton = (a: Acc, clase: string, estilo?: React.CSSProperties, corta = false) => {
    const cont = <>{a.cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : a.icono} <span className="truncate">{corta && a.corta ? a.corta : a.etiqueta}</span></>;
    return a.href
      ? <Link key={a.id} href={a.href} onClick={alSalir} className={clase} style={estilo}>{cont}</Link>
      : <button key={a.id} type="button" onClick={a.onClick} disabled={!!busy} className={clase} style={estilo}>{cont}</button>;
  };

  const ivaLineas = [
    Number(p.total_10) ? { l: "10%", base: p.total_10, iva: p.iva_10 } : null,
    Number(p.total_5) ? { l: "5%", base: p.total_5, iva: p.iva_5 } : null,
  ].filter(Boolean) as { l: string; base: number; iva: number }[];

  // Historial: en un panel aparte que se abre desde la barra de acciones.
  const seguimiento = (
    <div className="-mx-4 -my-4 sm:-mx-6 sm:-my-5">
      {e === "convertido" && p.venta_id ? (
        <button type="button" onClick={() => setModal("venta")}
          className="flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left sm:px-6 transition hover:bg-[var(--brand-50)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}18`, color: TEAL }}><Receipt className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">Venta <span className="font-mono">{p.venta_numero ?? "—"}</span></span>
            {p.convertido_at ? <span className="block text-[11px] text-slate-500">Convertido el {fechaHora(p.convertido_at)}</span> : null}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      ) : null}

      <div className="px-4 py-3.5 sm:px-6">
        <HistorialPresupuesto p={p} />
      </div>
    </div>
  );

  return (
    <div className={enModal ? `space-y-4 sm:space-y-5 ${principal ? "" : "pb-3 sm:pb-0"}` : "mx-auto max-w-5xl space-y-5 pb-10 max-sm:pb-28"}>
      {enModal ? null : <Link href="/presupuestos" className="-ml-1 flex min-h-9 w-fit items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Presupuestos</Link>}

      {/* ── 1. ENCABEZADO ÚNICO ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}55` }}>
        <div className="px-4 pb-4 pt-4 sm:px-6 sm:pt-5" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${TEAL}12)` }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Presupuesto</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{p.numero}</h1>
                {p.revision > 1 ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">rev {p.revision}</span> : null}
                <BadgeEstado estado={e} className="text-xs" />
              </div>
              <div className="mt-2 flex items-start gap-2">
                <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 text-sm">
                  {p.cliente_id ? (
                    <Link href={`/clientes/${p.cliente_id}`} onClick={alSalir} className="font-semibold text-slate-900 [overflow-wrap:anywhere] hover:text-[var(--brand)]">{p.cliente_nombre}</Link>
                  ) : (
                    <><b className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{p.cliente_nombre}</b> <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Prospecto</span></>
                  )}
                  {p.cliente_ruc || p.cliente_telefono ? (
                    <p className="text-xs text-slate-500">{[p.cliente_ruc ? `RUC ${p.cliente_ruc}` : null, p.cliente_telefono].filter(Boolean).join(" · ")}</p>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Total: en celular a todo el ancho, alineado a la izquierda bajo el cliente */}
            <div className="shrink-0 rounded-xl bg-white/70 ring-1 ring-slate-100 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:px-3.5 max-sm:py-2.5 sm:bg-transparent sm:text-right sm:ring-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total{p.moneda === "USD" ? " (US$)" : ""}</p>
              <div>
                <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">{m(p.total)}</p>
                {p.moneda === "USD" ? <p className="text-right text-xs tabular-nums text-slate-500">≈ {monto(p.total * p.tipo_cambio)}</p> : null}
              </div>
            </div>
          </div>

          {/* Datos en una fila compacta */}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3.5 sm:grid-cols-3 lg:grid-cols-5">
            <Dato l="Fecha" v={diaCorto(p.fecha)} />
            <Dato l="Válido hasta" v={diaCorto(p.valido_hasta)} extra={vig} rojo={e === "vencido"} />
            <Dato l="Condición" v={condicionTexto(p.condicion, p.plazo_dias, p.cuotas, p.cuotas_cada)} />
            <Dato l="Vendedor" v={p.vendedor_nombre ?? "—"} />
            <Dato l="Moneda" v={p.moneda === "USD" ? "Dólares (US$)" : "Guaraníes"} extra={p.moneda === "USD" ? { texto: `1 US$ = Gs. ${Math.round(p.tipo_cambio).toLocaleString("es-PY")}`, tono: "text-slate-400" } : null} />
          </dl>

        </div>

        {/* Barra de acciones: principal + secundarias + ⋯ */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:flex-wrap sm:px-6">
          {principal ? boton(principal, `${btnPri} max-sm:hidden`, { backgroundColor: principal.color ?? TEAL }) : null}
          {secundarias.map((a, n) => boton(a, `${btnSec} ${n >= visiblesMovil ? "max-sm:hidden" : "max-sm:min-w-0 max-sm:flex-1 max-sm:px-2"}`, undefined, esMovil))}
          {/* Historial (panel aparte) */}
          <button type="button" onClick={() => setVerSeguimiento(true)} aria-label="Seguimiento" title="Seguimiento: historial del presupuesto"
            className={`${btnSec} shrink-0 max-sm:w-11 max-sm:px-0 sm:ml-auto`}>
            <History className="h-4 w-4" /> <span className="max-sm:hidden">Seguimiento</span>
          </button>
          <MenuAcciones items={menuCompleto} etiqueta="Más acciones" className={`${btnSec} w-11 shrink-0 px-0 sm:w-auto sm:px-2.5`}>
            {busy && ["aceptar", "reabrir", "duplicar"].includes(busy) ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </MenuAcciones>
        </div>
      </section>

      {aviso ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" /> {aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar" className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center sm:h-8 sm:w-8"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar" className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center sm:h-8 sm:w-8"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <div>
        <div className="min-w-0 space-y-5">
          {/* ── 2. PRODUCTOS Y SERVICIOS + TOTALES ─────────────────────────── */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold text-slate-900">Productos y servicios</h2>
              <span className="text-xs tabular-nums text-slate-400">{p.items.length} línea{p.items.length === 1 ? "" : "s"}</span>
            </div>
            <TablaTarjetas
              filas={p.items}
              claveFila={(i) => i.id}
              minAncho={600}
              claseTabla="w-full text-left text-sm"
              claseThead="border-b border-slate-100 bg-slate-50/70"
              thBase="whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 first:pl-5 last:pr-5"
              tdBase="px-3 py-3 align-top first:pl-5 last:pr-5"
              columnas={[
                {
                  key: "desc", titulo: "Descripción", movil: "titulo",
                  celda: (i) => (
                    <>
                      <p className="font-medium text-slate-900">{i.descripcion}</p>
                      <p className="text-[11px] font-normal text-slate-400">
                        {i.producto_id ? <span className="font-mono">{i.sku}</span> : <span className="font-semibold text-amber-600" title="Línea de antes de la regla «solo productos del inventario»">Sin producto</span>}
                        {i.producto_id && i.precio_lista != null && Number(i.precio_lista) !== Number(i.precio_unitario) ? <> · lista {m(i.precio_lista)}</> : null}
                      </p>
                      {i.detalle ? <p className="mt-0.5 whitespace-pre-wrap text-xs font-normal text-slate-500">{i.detalle}</p> : null}
                    </>
                  ),
                  // Celular: una sola línea "cantidad × precio · desc · IVA" bajo la descripción.
                  celdaMovil: (i) => (
                    <>
                      <p className="font-medium text-slate-900">{i.descripcion}</p>
                      <p className="mt-0.5 text-[13px] font-normal tabular-nums text-slate-600">
                        {cantidad(i.cantidad)}{i.unidad && i.unidad !== "Unidad" ? ` ${i.unidad}` : ""} × {m(i.precio_unitario)}
                        {Number(i.descuento_pct) > 0 ? <span className="ml-1.5 rounded bg-emerald-50 px-1 text-[11px] font-semibold text-emerald-700">−{pct(i.descuento_pct)}</span> : null}
                        <span className="ml-1.5 text-[11px] text-slate-400">IVA {i.tipo_iva === "EXENTA" ? "exenta" : i.tipo_iva}</span>
                      </p>
                      <p className="text-[11px] font-normal text-slate-400">
                        {i.producto_id ? <span className="font-mono">{i.sku}</span> : <span className="font-semibold text-amber-600" title="Línea de antes de la regla «solo productos del inventario»">Sin producto</span>}
                        {i.producto_id && i.precio_lista != null && Number(i.precio_lista) !== Number(i.precio_unitario) ? <> · lista {m(i.precio_lista)}</> : null}
                      </p>
                      {i.detalle ? <p className="mt-0.5 whitespace-pre-wrap text-xs font-normal text-slate-500">{i.detalle}</p> : null}
                    </>
                  ),
                },
                { key: "cant", titulo: "Cant.", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-700", movil: "oculto", celda: (i) => <>{cantidad(i.cantidad)}{i.unidad && i.unidad !== "Unidad" ? <span className="text-[11px] text-slate-400"> {i.unidad}</span> : null}</> },
                { key: "precio", titulo: "Precio", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-slate-700", movil: "oculto", celda: (i) => m(i.precio_unitario) },
                ...(hayDesc ? [{ key: "dto", titulo: "Desc.", claseTh: "text-right", claseTd: "whitespace-nowrap text-right tabular-nums text-emerald-700", movil: "oculto" as const, celda: (i: Item) => (Number(i.descuento_pct) > 0 ? `−${pct(i.descuento_pct)}` : <span className="text-slate-300">—</span>) }] : []),
                { key: "iva", titulo: "IVA", claseTh: "text-center", claseTd: "text-center text-xs text-slate-500", movil: "oculto", celda: (i) => (i.tipo_iva === "EXENTA" ? "Exenta" : i.tipo_iva) },
                { key: "total", titulo: "Total", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-900", movil: "valor", celda: (i) => m(i.total) },
              ]}
            />
            {/* Totales al pie de la MISMA tarjeta, alineados bajo la columna Total */}
            <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4 sm:px-5">
              <dl className="ml-auto w-full space-y-1.5 text-sm sm:w-80">
                <Fila l="Subtotal" v={m(p.subtotal_bruto)} />
                {Number(p.descuento_lineas) > 0 ? <Fila l="Descuentos por línea" v={`− ${m(p.descuento_lineas)}`} verde /> : null}
                {Number(p.descuento_global) > 0 ? <Fila l={`Descuento general (${pct(p.descuento_pct)})`} v={`− ${m(p.descuento_global)}`} verde /> : null}
                <div className="flex items-baseline justify-between gap-3 text-slate-500">
                  <dt>
                    <button type="button" onClick={() => setVerIva((v) => !v)} aria-expanded={verIva}
                      className="-my-1 inline-flex min-h-9 items-center gap-1 rounded-lg text-left hover:text-slate-700 max-sm:min-h-11">
                      IVA incluido
                      <span className="text-[11px] text-slate-400">{ivaLineas.length ? `(${ivaLineas.map((x) => x.l).join(" · ")})` : ""}</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verIva ? "rotate-180" : ""}`} />
                    </button>
                  </dt>
                  <dd className="tabular-nums">{m(p.total_iva)}</dd>
                </div>
                {verIva ? (
                  <div className="space-y-1 rounded-lg bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-100">
                    {ivaLineas.map((x) => (
                      <div key={x.l} className="flex justify-between gap-3"><span>Gravado {x.l} · {m(x.base)}</span><span className="tabular-nums">IVA {m(x.iva)}</span></div>
                    ))}
                    {Number(p.total_exenta) ? <div className="flex justify-between gap-3"><span>Exento</span><span className="tabular-nums">{m(p.total_exenta)}</span></div> : null}
                  </div>
                ) : null}
                <div className="!mt-3 flex items-baseline justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ backgroundColor: `${TEAL}12` }}>
                  <dt className="font-semibold text-slate-800">Total</dt>
                  <dd className="text-xl font-bold tabular-nums text-slate-900">{m(p.total)}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* ── 3. CONDICIONES Y NOTAS (a todo el ancho) ──────────────────── */}
          {p.condiciones ? (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5"><FileSignature className="h-4 w-4 text-slate-400" /> Condiciones comerciales</h2>
              <p className="whitespace-pre-wrap px-4 py-3.5 text-sm leading-relaxed text-slate-700 sm:px-5">{p.condiciones}</p>
            </section>
          ) : null}
          {p.notas_internas ? (
            <section className="rounded-2xl border border-amber-200/70 bg-amber-50/40">
              <h2 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-amber-200/60 px-4 py-3 text-sm font-semibold text-amber-900 sm:px-5">
                <StickyNote className="h-4 w-4 text-amber-600" /> Notas internas <span className="text-xs font-normal text-amber-700/80">· no las ve el cliente</span>
              </h2>
              <p className="whitespace-pre-wrap px-4 py-3.5 text-sm leading-relaxed text-slate-700 sm:px-5">{p.notas_internas}</p>
            </section>
          ) : null}
        </div>

      </div>

      {/* Celular: total y acción principal en un pie fijo (safe-area). En el modal va pegado al
          pie del modal (sticky dentro del cuerpo que scrollea), no al body. */}
      {principal ? (
        <div className={`${enModal ? "sticky -mx-3 mt-4" : "fixed inset-x-0"} bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur pb-safe sm:hidden`}>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-slate-500">Total{p.moneda === "USD" ? " (US$)" : ""}</p>
              <p className="truncate text-xl font-bold leading-tight tabular-nums text-slate-900">{m(p.total)}</p>
            </div>
            {boton(principal, `${btnPri} h-12 max-w-[60%] shrink-0 px-5 text-base`, { backgroundColor: principal.color ?? TEAL })}
          </div>
        </div>
      ) : null}

      {verSeguimiento ? (
        <Drawer titulo="Seguimiento" subtitulo={`${p.numero}${p.revision > 1 ? ` rev ${p.revision}` : ""} · ${p.cliente_nombre}`} onClose={() => setVerSeguimiento(false)}>
          {seguimiento}
        </Drawer>
      ) : null}
      {modal === "rechazo" ? (
        <ModalRechazo numero={p.numero} onClose={() => setModal(null)}
          onConfirmar={async (motivo) => {
            await apiFetch(`/api/presupuestos/${id}/accion`, { method: "POST", body: JSON.stringify({ accion: "rechazar", motivo }) });
            setModal(null);
            await refrescar("Marcado como rechazado.");
          }} />
      ) : null}
      {modal === "convertir" ? (
        <ModalConvertir presupuestoId={p.id} validoHasta={p.valido_hasta} onClose={() => setModal(null)} onCambio={() => { onCambio?.(); void cargar(true); }} />
      ) : null}
      {modal === "venta" && p.venta_id ? (
        <VentaDetalle ventaId={p.venta_id} onClose={() => setModal(null)} onAnulada={() => { setModal(null); void refrescar("Venta anulada: el presupuesto volvió a aceptado."); }} />
      ) : null}
    </div>
  );
}

function Dato({ l, v, extra, rojo }: { l: string; v: string; extra?: { texto: string; tono: string } | null; rojo?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{l}</dt>
      <dd className={`mt-0.5 text-sm font-semibold [overflow-wrap:anywhere] ${rojo ? "text-rose-600" : "text-slate-900"}`}>
        {v}
        {extra ? <span className={`block text-[11px] font-medium ${extra.tono}`}>{extra.texto}</span> : null}
      </dd>
    </div>
  );
}

function Fila({ l, v, verde, fuerte }: { l: string; v: string; verde?: boolean; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${fuerte ? "font-semibold text-slate-700" : ""}`}>
      <dt>{l}</dt>
      <dd className={`tabular-nums ${verde ? "text-emerald-700" : ""}`}>{v}</dd>
    </div>
  );
}
