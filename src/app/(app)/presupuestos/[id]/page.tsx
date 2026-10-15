"use client";

/**
 * /presupuestos/[id] — ficha del presupuesto: estado, cliente, líneas y totales con IVA
 * desglosado, y todo lo que se hace con él: mandarlo (WhatsApp con el mensaje armado,
 * copiar el link público, PDF), marcar aceptado / rechazado, editar (un enviado pasa a la
 * revisión siguiente), duplicar y convertir en venta (lleva a la Caja con todo cargado).
 * A la derecha, el link del cliente (vistas) y el historial completo.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Ban, CalendarClock, CheckCircle2, Copy, Download, ExternalLink, Eye, FileSignature, History, Loader2,
  MessageCircle, MoreHorizontal, Pencil, Receipt, RotateCcw, ShoppingCart, StickyNote, ThumbsDown, ThumbsUp, UserRound, Wallet, X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante, invalidar } from "@/lib/api/cache-cliente";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { clienteConfig } from "@/cliente.config";
import { MenuAcciones, type ItemMenu } from "@/components/MenuAcciones";
import { VentaDetalle } from "@/modules/caja/VentaDetalle";
import { BadgeEstado, textoVigencia } from "@/modules/presupuestos/ui";
import { ModalRechazo, ModalWhatsApp } from "@/modules/presupuestos/Modales";
import { ModalConvertir } from "@/modules/presupuestos/ModalConvertir";
import { linkPublico } from "@/modules/presupuestos/whatsapp";
import {
  cantidad, condicionTexto, diaCorto, monto, nombreArchivoPresupuesto, pct, type Presupuesto, type PresupuestoEvento,
} from "@/modules/presupuestos/tipos";

const TEAL = clienteConfig.color;
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sin permiso de portapapeles (http, navegador viejo): método clásico.
    const t = document.createElement("textarea");
    t.value = texto;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

export default function PresupuestoPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const url = `/api/presupuestos/${id}`;
  const [p, setP] = useState<Presupuesto | null>(() => guardadoAlInstante<Presupuesto>(url) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"whatsapp" | "rechazo" | "convertir" | "venta" | null>(null);

  const cargar = useCallback(async (fresco = false) => {
    try {
      await apiFetchSWR<Presupuesto>(url, (d) => setP(d), { fresco });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => { void cargar(); }, [cargar]);

  // ?creado=1 / ?guardado=1 (viene del formulario): aviso y URL limpia.
  useEffect(() => {
    if (sp.get("creado")) setAviso("Presupuesto creado. Mandalo por WhatsApp, copiá el link o descargá el PDF.");
    else if (sp.get("guardado")) setAviso("Cambios guardados.");
    else return;
    router.replace(`/presupuestos/${id}`, { scroll: false });
  }, [sp, router, id]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const refrescar = useCallback(async (mensaje?: string) => {
    if (mensaje) setAviso(mensaje);
    invalidar("/api/presupuestos");
    await cargar(true);
  }, [cargar]);

  async function accion(nombre: string, body: Record<string, unknown>, mensaje: string) {
    setBusy(nombre);
    setError(null);
    try {
      const r = await apiFetch<{ id?: string }>(`/api/presupuestos/${id}/accion`, { method: "POST", body: JSON.stringify(body) });
      if (body.accion === "duplicar" && r.id) {
        invalidar("/api/presupuestos");
        router.push(`/presupuestos/nuevo?editar=${r.id}`);
        return;
      }
      await refrescar(mensaje);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function copiarLink() {
    if (!p) return;
    setBusy("link");
    setError(null);
    try {
      await apiFetch(`/api/presupuestos/${id}/accion`, { method: "POST", body: JSON.stringify({ accion: "enviar", canal: "link" }) });
      const ok = await copiar(linkPublico(p.token));
      await refrescar(ok
        ? (p.estado === "borrador" ? "Link copiado. El presupuesto quedó como enviado." : "Link copiado.")
        : `No se pudo copiar: ${linkPublico(p.token)}`);
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

  if (!p) {
    return error
      ? <div className="space-y-3 py-10"><Link href="/presupuestos" className="text-xs text-slate-400 hover:text-slate-600">← Presupuestos</Link><p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p></div>
      : <p className="flex items-center gap-2 py-16 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando presupuesto…</p>;
  }

  const e = p.estado;
  const g = p.estado_guardado;
  const hoy = hoyPY();
  const vig = g === "borrador" || g === "enviado" ? textoVigencia(p.valido_hasta, hoy) : null;
  const puedeEnviar = e === "borrador" || e === "enviado" || e === "aceptado";
  const puedeEditar = g === "borrador" || g === "enviado";
  const puedeConvertir = e !== "rechazado" && e !== "convertido";
  const m = (v: number) => monto(v, p.moneda);
  const hayDesc = p.items.some((i) => Number(i.descuento_pct) > 0);

  const menu: ItemMenu[] = [
    ...(puedeEditar ? [{ etiqueta: "Editar", icono: <Pencil className="h-4 w-4" />, onClick: () => router.push(`/presupuestos/nuevo?editar=${p.id}`) }] : []),
    { etiqueta: "Duplicar", icono: <Copy className="h-4 w-4" />, onClick: () => void accion("duplicar", { accion: "duplicar" }, "") },
    ...(g === "borrador" || g === "enviado" ? [{ etiqueta: "Marcar aceptado", icono: <ThumbsUp className="h-4 w-4" />, tono: "exito" as const, onClick: () => void accion("aceptar", { accion: "aceptar" }, "Marcado como aceptado.") }] : []),
    ...(g === "borrador" || g === "enviado" || g === "aceptado" ? [{ etiqueta: "Rechazar…", icono: <ThumbsDown className="h-4 w-4" />, tono: "peligro" as const, onClick: () => setModal("rechazo") }] : []),
    ...(g === "aceptado" || g === "rechazado" ? [{ etiqueta: "Reabrir", icono: <RotateCcw className="h-4 w-4" />, onClick: () => void accion("reabrir", { accion: "reabrir" }, "Presupuesto reabierto.") }] : []),
    ...(g !== "borrador" ? [{ etiqueta: "Ver como el cliente", icono: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(linkPublico(p.token), "_blank", "noopener") }] : []),
  ];

  const btnSec = "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50";
  const btnPri = "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50";

  return (
    <div className="max-w-7xl space-y-5 pb-10">
      <Link href="/presupuestos" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-600"><ArrowLeft className="h-3.5 w-3.5" /> Presupuestos</Link>

      {/* Encabezado */}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}55` }}>
        <div className="px-6 py-5" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${TEAL}12)` }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Presupuesto</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">{p.numero}</h1>
                {p.revision > 1 ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">rev {p.revision}</span> : null}
                <BadgeEstado estado={e} className="text-xs" />
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                {p.cliente_id ? (
                  <Link href={`/clientes/${p.cliente_id}`} className="font-semibold text-slate-900 hover:text-[var(--brand)]">{p.cliente_nombre}</Link>
                ) : (
                  <><b className="font-semibold text-slate-900">{p.cliente_nombre}</b> <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Prospecto</span></>
                )}
                {p.cliente_ruc ? <span className="text-slate-400"> · {p.cliente_ruc}</span> : null}
                {p.cliente_telefono ? <span className="text-slate-400"> · {p.cliente_telefono}</span> : null}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total{p.moneda === "USD" ? " (US$)" : ""}</p>
              <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{m(p.total)}</p>
              {p.moneda === "USD" ? <p className="text-xs tabular-nums text-slate-500">≈ {monto(p.total * p.tipo_cambio)} · 1 US$ = Gs. {Math.round(p.tipo_cambio).toLocaleString("es-PY")}</p> : null}
            </div>
          </div>

          {/* Acciones */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-4">
            {e === "convertido" && p.venta_id ? (
              <button type="button" onClick={() => setModal("venta")} className={btnPri} style={{ backgroundColor: TEAL }}>
                <Receipt className="h-4 w-4" /> Ver venta {p.venta_numero ?? ""}
              </button>
            ) : null}
            {e === "vencido" ? (
              <Link href={`/presupuestos/nuevo?editar=${p.id}`} className={btnPri} style={{ backgroundColor: TEAL }}>
                <CalendarClock className="h-4 w-4" /> Extender validez
              </Link>
            ) : null}
            {e === "rechazado" ? (
              <button type="button" onClick={() => void accion("duplicar", { accion: "duplicar" }, "")} disabled={!!busy} className={btnPri} style={{ backgroundColor: TEAL }}>
                {busy === "duplicar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Duplicar
              </button>
            ) : null}
            {puedeConvertir && e !== "borrador" && e !== "vencido" ? (
              <button type="button" onClick={() => setModal("convertir")} className={btnPri} style={{ backgroundColor: TEAL }}>
                <ShoppingCart className="h-4 w-4" /> Convertir a venta
              </button>
            ) : null}
            {puedeEnviar ? (
              <button type="button" onClick={() => setModal("whatsapp")} className={g === "borrador" ? `${btnPri} bg-[#25D366]` : btnSec}>
                <MessageCircle className="h-4 w-4" /> {g === "borrador" ? "Enviar por WhatsApp" : "WhatsApp"}
              </button>
            ) : null}
            {puedeEnviar ? (
              <button type="button" onClick={() => void copiarLink()} disabled={!!busy} className={btnSec}>
                {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copiar link
              </button>
            ) : null}
            <button type="button" onClick={() => void pdf()} disabled={!!busy} className={btnSec}>
              {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar PDF
            </button>
            {puedeConvertir && (e === "borrador" || e === "vencido") ? (
              <button type="button" onClick={() => setModal("convertir")} className={btnSec}>
                <ShoppingCart className="h-4 w-4" /> Convertir a venta
              </button>
            ) : null}
            {puedeEditar && e !== "vencido" ? (
              <Link href={`/presupuestos/nuevo?editar=${p.id}`} className={btnSec}><Pencil className="h-4 w-4" /> Editar</Link>
            ) : null}
            <MenuAcciones items={menu} etiqueta="Más acciones" className={`${btnSec} px-2.5`}>
              {busy && ["aceptar", "reabrir", "duplicar"].includes(busy) ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
            </MenuAcciones>
          </div>
        </div>

        {/* Datos rápidos */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/40 sm:grid-cols-4">
          <Dato l="Fecha" v={diaCorto(p.fecha)} />
          <Dato l="Válido hasta" v={diaCorto(p.valido_hasta)} extra={vig} rojo={e === "vencido"} />
          <Dato l="Condición" v={condicionTexto(p.condicion, p.plazo_dias)} />
          <Dato l="Vendedor" v={p.vendedor_nombre ?? "—"} />
        </div>
      </section>

      {aviso ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> {aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {/* Estado: lo importante en una línea */}
      {e === "vencido" ? (
        <Franja tono="ambar" icono={<CalendarClock className="h-4 w-4" />}>
          Venció el <b>{diaCorto(p.valido_hasta)}</b>: el link del cliente ya no muestra los precios. Extendé la validez para volver a mandarlo.
        </Franja>
      ) : null}
      {e === "aceptado" ? (
        <Franja tono="verde" icono={<ThumbsUp className="h-4 w-4" />}>
          Aceptado{p.aceptado_por ? ` por ${p.aceptado_por}` : ""}{p.aceptado_at ? ` el ${fechaHora(p.aceptado_at)}` : ""}. Siguiente paso: <b>Convertir a venta</b>.
        </Franja>
      ) : null}
      {e === "rechazado" ? (
        <Franja tono="rojo" icono={<Ban className="h-4 w-4" />}>
          Rechazado{p.rechazado_por ? ` por ${p.rechazado_por}` : ""}{p.rechazado_at ? ` el ${fechaHora(p.rechazado_at)}` : ""}{p.rechazo_motivo ? <>: <b>{p.rechazo_motivo}</b></> : ""}
        </Franja>
      ) : null}
      {e === "convertido" ? (
        <Franja tono="teal" icono={<Wallet className="h-4 w-4" />}>
          Convertido en la venta <button type="button" onClick={() => setModal("venta")} className="font-mono font-semibold underline-offset-2 hover:underline">{p.venta_numero ?? "—"}</button>
          {p.convertido_at ? ` el ${fechaHora(p.convertido_at)}` : ""}.
        </Franja>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* Líneas */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                    <th className="px-5 py-3">Descripción</th>
                    <th className="px-3 py-3 text-right">Cant.</th>
                    <th className="px-3 py-3 text-right">Precio</th>
                    {hayDesc ? <th className="px-3 py-3 text-right">Desc.</th> : null}
                    <th className="px-3 py-3 text-center">IVA</th>
                    <th className="px-5 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {p.items.map((i) => (
                    <tr key={i.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{i.descripcion}</p>
                        <p className="text-[11px] text-slate-400">
                          {i.producto_id ? <span className="font-mono">{i.sku}</span> : <span className="font-semibold text-amber-600">Línea libre</span>}
                          {i.producto_id && i.precio_lista != null && Number(i.precio_lista) !== Number(i.precio_unitario) ? <> · lista {m(i.precio_lista)}</> : null}
                        </p>
                        {i.detalle ? <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{i.detalle}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{cantidad(i.cantidad)}{i.unidad && i.unidad !== "Unidad" ? <span className="text-[11px] text-slate-400"> {i.unidad}</span> : null}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-slate-700">{m(i.precio_unitario)}</td>
                      {hayDesc ? <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-emerald-700">{Number(i.descuento_pct) > 0 ? `−${pct(i.descuento_pct)}` : <span className="text-slate-300">—</span>}</td> : null}
                      <td className="px-3 py-3 text-center text-xs text-slate-500">{i.tipo_iva === "EXENTA" ? "Exenta" : i.tipo_iva}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-slate-900">{m(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Totales con IVA incluido */}
            <div className="grid gap-4 border-t border-slate-200 bg-slate-50/50 px-5 py-4 sm:grid-cols-2">
              <dl className="space-y-1 text-xs text-slate-500">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">IVA incluido</p>
                {Number(p.total_10) ? <Fila l={`Gravado 10% · ${m(p.total_10)}`} v={m(p.iva_10)} /> : null}
                {Number(p.total_5) ? <Fila l={`Gravado 5% · ${m(p.total_5)}`} v={m(p.iva_5)} /> : null}
                {Number(p.total_exenta) ? <Fila l="Exento" v={m(p.total_exenta)} /> : null}
                <Fila l="Total IVA" v={m(p.total_iva)} fuerte />
              </dl>
              <dl className="space-y-1 text-sm sm:ml-auto sm:w-72">
                {Number(p.descuento_lineas) > 0 || Number(p.descuento_global) > 0 ? <Fila l="Subtotal" v={m(p.subtotal_bruto)} /> : null}
                {Number(p.descuento_lineas) > 0 ? <Fila l="Descuentos por línea" v={`− ${m(p.descuento_lineas)}`} verde /> : null}
                {Number(p.descuento_global) > 0 ? <Fila l={`Descuento general (${pct(p.descuento_pct)})`} v={`− ${m(p.descuento_global)}`} verde /> : null}
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-1.5">
                  <dt className="font-semibold text-slate-800">Total</dt>
                  <dd className="text-lg font-bold tabular-nums text-slate-900">{m(p.total)}</dd>
                </div>
              </dl>
            </div>
          </section>

          {p.condiciones || p.notas_internas ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {p.condiciones ? (
                <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Condiciones comerciales</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.condiciones}</p>
                </section>
              ) : null}
              {p.notas_internas ? (
                <section className="flex gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3.5">
                  <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">Notas internas · no las ve el cliente</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.notas_internas}</p>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="space-y-5">
          {/* Link del cliente */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Link del cliente</p>
            {g === "borrador" ? (
              <p className="mt-1.5 text-xs text-slate-500">Se activa cuando lo mandás (WhatsApp o Copiar link). Vence con la validez.</p>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{linkPublico(p.token).replace(/^https?:\/\//, "")}</span>
                  <a href={linkPublico(p.token)} target="_blank" rel="noopener" title="Ver como el cliente" className="shrink-0 text-slate-400 hover:text-[var(--brand)]"><ExternalLink className="h-3.5 w-3.5" /></a>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                  <Eye className="h-3.5 w-3.5 text-slate-400" />
                  {p.vistas > 0
                    ? <>Lo abrió <b className="font-semibold">{p.vistas} {p.vistas === 1 ? "vez" : "veces"}</b>{p.ultima_vista_at ? <span className="text-slate-400"> · última {fechaHora(p.ultima_vista_at)}</span> : null}</>
                    : <span className="text-slate-500">Todavía no lo abrió.</span>}
                </p>
              </>
            )}
          </section>

          {/* Historial */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"><History className="h-3.5 w-3.5" /> Historial</p>
            <ol className="mt-3 space-y-0">
              {p.eventos.map((ev, n) => (
                <li key={ev.id} className="relative flex gap-3 pb-3.5">
                  {n < p.eventos.length - 1 ? <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-slate-200" /> : null}
                  <span className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">{iconoEvento(ev)}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{textoEvento(ev, p)}</p>
                    <p className="text-[11px] text-slate-400">{fechaHora(ev.created_at)}{ev.usuario_nombre ? ` · ${ev.usuario_nombre}` : ev.canal === "link" ? " · cliente" : ""}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {modal === "whatsapp" ? (
        <ModalWhatsApp p={p} onClose={() => setModal(null)} onEnviado={(msg) => { setModal(null); void refrescar(msg); }} />
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
        <ModalConvertir presupuestoId={p.id} validoHasta={p.valido_hasta} onClose={() => setModal(null)} onCambio={() => void cargar(true)} />
      ) : null}
      {modal === "venta" && p.venta_id ? (
        <VentaDetalle ventaId={p.venta_id} onClose={() => setModal(null)} onAnulada={() => { setModal(null); void refrescar("Venta anulada: el presupuesto volvió a aceptado."); }} />
      ) : null}
    </div>
  );
}

const CANAL: Record<string, string> = { whatsapp: "WhatsApp", link: "link", email: "email", manual: "a mano", caja: "la caja", interno: "" };

function textoEvento(ev: PresupuestoEvento, p: Presupuesto): React.ReactNode {
  const d = (ev.detalle ?? {}) as Record<string, string | number | null>;
  switch (ev.tipo) {
    case "creado": return d.duplicado_de ? <>Creado como copia de <b className="font-mono font-semibold">{d.duplicado_de}</b></> : "Creado";
    case "editado": return "Editado";
    case "revision": return <>Revisión {ev.revision} <span className="text-slate-400">(antes {monto(Number(d.total_anterior), p.moneda)})</span></>;
    case "enviado": return `Enviado${ev.canal && CANAL[ev.canal] ? ` por ${CANAL[ev.canal]}` : ""}`;
    case "reenviado": return `Compartido de nuevo${ev.canal && CANAL[ev.canal] ? ` por ${CANAL[ev.canal]}` : ""}`;
    case "visto": return "El cliente abrió el link";
    case "pdf": return "PDF descargado";
    case "aceptado": return ev.canal === "link" ? <>Aceptado por el cliente desde el link{d.nombre ? ` (${d.nombre})` : ""}</> : `Marcado como aceptado${d.estaba_vencido ? " (estaba vencido)" : ""}`;
    case "rechazado": return <>{ev.canal === "link" ? "Rechazado por el cliente" : "Rechazado"}{d.motivo ? <>: <b className="font-semibold">{d.motivo}</b></> : ""}</>;
    case "reabierto": return "Reabierto";
    case "convertido": return <>Convertido en venta <b className="font-mono font-semibold">{d.numero_control}</b></>;
    case "venta_anulada": return <>Se anuló la venta <b className="font-mono font-semibold">{d.numero_control}</b>: vuelve a aceptado</>;
    case "producto_vinculado": return <>«{d.linea}» ligada al producto <b className="font-semibold">{d.producto}</b></>;
    default: return ev.tipo;
  }
}

function iconoEvento(ev: PresupuestoEvento) {
  const c = "h-3 w-3";
  switch (ev.tipo) {
    case "creado": return <FileSignature className={c} />;
    case "editado": case "revision": case "producto_vinculado": return <Pencil className={c} />;
    case "enviado": case "reenviado": return ev.canal === "whatsapp" ? <MessageCircle className={`${c} text-[#25D366]`} /> : <Copy className={c} />;
    case "visto": return <Eye className={`${c} text-sky-500`} />;
    case "pdf": return <Download className={c} />;
    case "aceptado": return <ThumbsUp className={`${c} text-emerald-600`} />;
    case "rechazado": return <ThumbsDown className={`${c} text-rose-500`} />;
    case "convertido": return <ShoppingCart className={`${c} text-[#3F8E91]`} />;
    case "venta_anulada": return <Ban className={`${c} text-rose-500`} />;
    default: return <UserRound className={c} />;
  }
}

function Dato({ l, v, extra, rojo }: { l: string; v: string; extra?: { texto: string; tono: string } | null; rojo?: boolean }) {
  return (
    <div className="px-5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{l}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold ${rojo ? "text-rose-600" : "text-slate-900"}`}>{v}</p>
      {extra ? <p className={`text-[11px] font-medium ${extra.tono}`}>{extra.texto}</p> : null}
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

function Franja({ tono, icono, children }: { tono: "ambar" | "verde" | "rojo" | "teal"; icono: React.ReactNode; children: React.ReactNode }) {
  const c = {
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
    rojo: "border-rose-200 bg-rose-50 text-rose-900",
    teal: "border-[#4FAEB2]/40 bg-[#4FAEB2]/10 text-[#2b6467]",
  }[tono];
  return <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${c}`}><span className="mt-0.5 shrink-0">{icono}</span><p>{children}</p></div>;
}
