"use client";

/**
 * Piezas del rubro Gimnasio (receta 150) que usan la Recepción y la ficha del cliente:
 *   · ChipEstado: el estado de una asistencia con su color.
 *   · AccionesAsistencia: Llegó / Culminó / No vino (y Confirmar, Reagendar, Cancelar en "Más").
 *     Si la base frena la entrada por deuda y el usuario puede forzarla, pide el motivo y reintenta.
 *   · PanelAlumno: la card "Asistencia" del alumno: al día o debe, membresía con las clases que le
 *     quedan, próximas clases, últimas asistencias, entrada libre, cobrar y su link para marcar solo.
 *   · LinkAlumno: el link personal del alumno (receta 155), por WhatsApp o copiado.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, DoorOpen, Link2, Loader2, MoreHorizontal, ReceiptText, RefreshCw, Send } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { PedirMotivo } from "@/modules/inventario/ui";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import { ESTADOS_ASISTENCIA, SIGUIENTES, gs, hora, type Asistencia, type EstadoAsistencia, type FichaAlumno } from "@/modules/gimnasio/tipos";

const ES_MOROSO = /^Tiene una deuda vencida/;

export function ChipEstado({ estado }: { estado: EstadoAsistencia }) {
  const e = ESTADOS_ASISTENCIA[estado];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.label}</span>;
}

/** Llama a la base para cambiar un estado; si frena por deuda y se puede, pide motivo y fuerza. */
export function useCambiarEstado(onHecho: () => void) {
  const puedeForzar = usePermiso("gimnasio_forzar_entrada");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forzar, setForzar] = useState<{ mensaje: string; reintentar: (motivo: string) => Promise<void> } | null>(null);

  const ejecutar = useCallback(async (clave: string, hacer: (f?: { forzar: true; motivo: string }) => Promise<unknown>) => {
    setOcupado(clave); setError(null);
    try {
      await hacer();
      onHecho();
    } catch (e) {
      const msg = (e as Error).message;
      if (ES_MOROSO.test(msg) && puedeForzar) {
        setForzar({ mensaje: msg, reintentar: async (motivo) => { await hacer({ forzar: true, motivo }); setForzar(null); onHecho(); } });
      } else setError(msg);
    } finally { setOcupado(null); }
  }, [onHecho, puedeForzar]);

  const modalForzar = forzar ? (
    <PedirMotivo titulo="¿Dejarlo entrar con deuda?" confirmar="Dejar entrar"
      descripcion={<><span className="font-semibold text-rose-700">{forzar.mensaje}</span><br />Si lo dejás entrar igual, el motivo queda registrado con tu nombre.</>}
      onConfirmar={forzar.reintentar} onClose={() => setForzar(null)} />
  ) : null;
  return { ejecutar, ocupado, error, setError, modalForzar };
}

const ACCION_RAPIDA: Partial<Record<EstadoAsistencia, string>> = { en_espera: "Llegó", culminada: "Culminó", no_asistio: "No vino" };
const ACCION_MAS: Partial<Record<EstadoAsistencia, string>> = { confirmada: "Confirmar", reagendada: "Reagendar", cancelada: "Cancelar" };

export function AccionesAsistencia({ a, onHecho, izquierda }: { a: Asistencia; onHecho: () => void; izquierda?: boolean }) {
  const { ejecutar, ocupado, error, modalForzar } = useCambiarEstado(onHecho);
  const [mas, setMas] = useState(false);
  const siguientes = SIGUIENTES[a.estado];
  if (!siguientes.length) return null;
  const cambiar = (estado: EstadoAsistencia) =>
    ejecutar(estado, (f) => apiFetch(`/api/gimnasio/asistencias/${a.id}`, { method: "POST", body: JSON.stringify({ estado, ...(f ?? {}) }) }));
  const rapidas = siguientes.filter((s) => ACCION_RAPIDA[s]);
  const otras = siguientes.filter((s) => ACCION_MAS[s]);
  const boton = "inline-flex min-h-9 items-center whitespace-nowrap justify-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition disabled:opacity-50 max-sm:min-h-11 max-sm:flex-1";
  return (
    <div className={`flex flex-col items-stretch gap-1.5 ${izquierda ? "" : "sm:items-end"}`}>
      <div className={`flex flex-wrap gap-1.5 ${izquierda ? "" : "sm:justify-end"}`}>
        {rapidas.map((s) => (
          <button key={s} type="button" disabled={!!ocupado} onClick={() => void cambiar(s)}
            className={`${boton} ${s === "culminada" ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : s === "no_asistio" ? "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:text-rose-700" : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>
            {ocupado === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{ACCION_RAPIDA[s]}
          </button>
        ))}
        {otras.length ? (
          <button type="button" aria-label="Más acciones" aria-expanded={mas} onClick={() => setMas((v) => !v)} className={`${boton} border-slate-200 bg-white text-slate-500 hover:text-slate-800 max-sm:flex-none max-sm:px-3`}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {mas ? (
        <div className={`flex flex-wrap gap-1.5 ${izquierda ? "" : "sm:justify-end"}`}>
          {otras.map((s) => (
            <button key={s} type="button" disabled={!!ocupado} onClick={() => { setMas(false); void cambiar(s); }}
              className={`${boton} border-slate-200 bg-white text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]`}>
              {ocupado === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{ACCION_MAS[s]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="max-w-xs rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">{error}</p> : null}
      {modalForzar}
    </div>
  );
}

function Fila({ a, conAcciones, apilado, onHecho }: { a: Asistencia; conAcciones?: boolean; apilado?: boolean; onHecho: () => void }) {
  const fecha = a.inicio_at ? new Date(a.inicio_at).toLocaleDateString("es-PY", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Asuncion" }) : a.fecha.split("-").reverse().slice(0, 2).join("/");
  return (
    <li className={`flex flex-col gap-2 py-2.5 ${apilado ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{a.clase}</span>
          <ChipEstado estado={a.estado} />
        </span>
        <span className="block text-xs text-slate-500">
          {fecha}{a.inicio_at ? ` · ${hora(a.inicio_at)}` : ""}{a.profesor ? ` · ${a.profesor}` : ""}
          {a.estado === "culminada" ? (a.cubierta ? " · Membresía" : a.venta_id ? ` · Clase suelta ${gs(a.valor)}` : "") : ""}
          {a.forzada ? " · Entró con deuda" : ""}
        </span>
      </span>
      {conAcciones ? <AccionesAsistencia a={a} onHecho={onHecho} izquierda={apilado} /> : null}
    </li>
  );
}

/** WhatsApp con el número del alumno si es de Paraguay (09… o 595…); si no, WhatsApp elige a quién. */
export function whatsappAlumno(telefono: string | null | undefined, texto: string): string {
  const tel = (telefono ?? "").replace(/\D/g, "");
  const numero = tel.startsWith("09") ? `595${tel.slice(1)}` : tel.startsWith("595") ? tel : "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

type LinkDatos = { token: string; nombre: string; telefono: string | null };
const urlLink = (token: string) => `${window.location.origin}/a/${token}`;
const textoLink = (d: LinkDatos) => `Hola ${d.nombre.split(" ")[0]}! Con este link reservás tus clases y marcás tu asistencia: ${urlLink(d.token)}`;
const pedirLink = (clienteId: string, extra: object) =>
  apiFetch<LinkDatos>(`/api/gimnasio/clientes/${clienteId}/link`, { method: "POST", body: JSON.stringify(extra) });

/** Abre WhatsApp con el link del alumno (lo crea si no tiene) y anota que se le mandó (receta 156). */
export async function enviarLinkWhatsApp(clienteId: string): Promise<void> {
  const w = window.open("about:blank", "_blank");
  try {
    const d = await pedirLink(clienteId, { enviado: true });
    const destino = whatsappAlumno(d.telefono, textoLink(d));
    if (w) w.location.href = destino; else window.location.href = destino;
  } catch (e) { w?.close(); throw e; }
}

/** Copia el link del alumno (lo crea si no tiene) y anota que se le mandó. */
export async function copiarLinkAlumno(clienteId: string): Promise<void> {
  const d = await pedirLink(clienteId, { enviado: true });
  try { await navigator.clipboard.writeText(urlLink(d.token)); }
  catch { throw new Error(`No se pudo copiar. El link es: ${urlLink(d.token)}`); }
}

/**
 * El link personal del alumno en su card (recetas 155 y 156): Copiar, WhatsApp y Cambiar link (si lo perdió).
 */
export function LinkAlumno({ clienteId }: { clienteId: string }) {
  const [copiado, setCopiado] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function correr(cual: string, fn: () => Promise<void>) {
    setOcupado(cual); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setOcupado(null); }
  }
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700"><Link2 className="h-4 w-4 shrink-0 text-slate-400" /> Su link</span>
        <span className="flex items-center">
          <button type="button" title="Cambiar link" aria-label="Cambiar link" onClick={() => setRehacer((x) => !x)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button type="button" disabled={!!ocupado} onClick={() => void correr("copiar", async () => { await copiarLinkAlumno(clienteId); setCopiado(true); setTimeout(() => setCopiado(false), 2000); })}
            className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            {ocupado === "copiar" ? <Loader2 className="h-4 w-4 animate-spin" /> : copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copiado ? "Copiado" : "Copiar"}
          </button>
          <button type="button" disabled={!!ocupado} onClick={() => void correr("wa", () => enviarLinkWhatsApp(clienteId))}
            className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand-50,#eef7f7)] disabled:opacity-50">
            {ocupado === "wa" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} WhatsApp
          </button>
        </span>
      </div>
      {rehacer ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2">
          <p className="min-w-0 flex-1 text-xs text-rose-900">¿Cambiar el link? El que tiene deja de andar.</p>
          <button type="button" onClick={() => setRehacer(false)} className="min-h-9 rounded-lg px-2 text-xs font-medium text-slate-600 hover:bg-white">No</button>
          <button type="button" disabled={!!ocupado} onClick={() => void correr("rehacer", async () => { await pedirLink(clienteId, { rehacer: true }); setRehacer(false); })}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white disabled:opacity-50">
            {ocupado === "rehacer" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Sí, cambiar
          </button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 break-all text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

/** Card "Asistencia" de un alumno. `compacto` = en la Recepción (sin título grande). */
export function PanelAlumno({ clienteId, compacto, recarga = 0, onCambio }: { clienteId: string; compacto?: boolean; recarga?: number; onCambio?: () => void }) {
  const [d, setD] = useState<FichaAlumno | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const puedeCobrar = usePermiso("registrar_cobros");
  const cargar = useCallback(() => {
    apiFetch<FichaAlumno>(`/api/gimnasio/clientes/${clienteId}`).then((x) => { setD(x); setError(null); }).catch((e: Error) => setError(e.message));
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar, recarga]);
  const hecho = useCallback(() => { cargar(); onCambio?.(); }, [cargar, onCambio]);
  const { ejecutar, ocupado, error: errEntrada, modalForzar } = useCambiarEstado(hecho);

  if (error) return <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>;
  if (!d) return <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />;
  const m = d.membresia;
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {compacto ? (
            <Link href={`/clientes/${d.cliente.id}`} className="block truncate text-base font-semibold text-slate-900 no-underline hover:text-[var(--brand)]">{d.cliente.nombre}</Link>
          ) : <h3 className="text-base font-semibold text-slate-900">Asistencia</h3>}
          <p className="text-xs text-slate-500">{[d.cliente.documento ? `CI ${d.cliente.documento}` : null, d.cliente.telefono].filter(Boolean).join(" · ") || "Sin documento"}</p>
        </div>
        {d.bloqueado ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> Debe {gs(d.deuda_vencida)} vencido</span>
        ) : d.deuda_vencida > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Debe {gs(d.deuda_vencida)} vencido</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> Al día</span>
        )}
      </div>

      <div className={`grid grid-cols-2 gap-2 ${compacto ? "" : "sm:grid-cols-3"}`}>
        <div className={`col-span-2 rounded-xl bg-slate-50 p-3 ${compacto ? "" : "sm:col-span-1"}`}>
          <span className="block text-[11px] font-medium text-slate-500">Membresía</span>
          <span className="block truncate text-sm font-semibold text-slate-800">{m ? m.plan : "Sin membresía"}</span>
          <span className="block text-xs text-slate-500">{m ? (m.clases_mes ? `${m.usadas} de ${m.clases_mes} clases este mes` : "Ilimitada") : "Paga clase suelta"}</span>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <span className="block text-[11px] font-medium text-slate-500">{m?.clases_mes ? "Le quedan" : "Este mes"}</span>
          <span className="block text-lg font-semibold tabular-nums text-slate-900">{m?.clases_mes ? m.restantes : d.mes.culminadas}</span>
          <span className="block text-xs text-slate-500">{m?.clases_mes ? "clases" : `asistencia${d.mes.culminadas === 1 ? "" : "s"}`}</span>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <span className="block text-[11px] font-medium text-slate-500">Debe en total</span>
          <span className={`block text-lg font-semibold tabular-nums ${d.deuda_total > 0 ? "text-rose-700" : "text-slate-900"}`}>{gs(d.deuda_total)}</span>
          <span className="block text-xs text-slate-500">{d.mes.faltas ? `${d.mes.faltas} falta${d.mes.faltas === 1 ? "" : "s"} este mes` : "Sin faltas este mes"}</span>
        </div>
      </div>

      {/* Entrada libre a la derecha (es la principal); Cobrar a su izquierda. */}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" disabled={!!ocupado} onClick={() => void ejecutar("entrada", (f) => apiFetch("/api/gimnasio/entrada", { method: "POST", body: JSON.stringify({ cliente_id: d.cliente.id, ...(f ?? {}) }) }))}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50 sm:min-h-10">
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />} Entrada libre
        </button>
        {d.deuda_total > 0 && puedeCobrar ? (
          <button type="button" onClick={() => setCobrando(true)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)] sm:min-h-10">
            <ReceiptText className="h-4 w-4" /> Cobrar
          </button>
        ) : null}
      </div>
      {errEntrada ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{errEntrada}</p> : null}

      <LinkAlumno clienteId={d.cliente.id} />

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Próximas clases</h4>
        {d.proximas.length ? (
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">{d.proximas.map((a) => <Fila key={a.id} a={a} conAcciones apilado={compacto} onHecho={hecho} />)}</ul>
        ) : <p className="py-2 text-sm text-slate-400">No está anotado en ninguna clase.</p>}
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Últimas asistencias</h4>
        {d.historial.length ? (
          <ul className="m-0 max-h-72 list-none divide-y divide-slate-100 overflow-y-auto p-0">{d.historial.map((a) => <Fila key={a.id} a={a} apilado={compacto} onHecho={hecho} />)}</ul>
        ) : <p className="py-2 text-sm text-slate-400">Todavía no tiene asistencias.</p>}
      </div>
      {modalForzar}
      {cobrando ? <RegistrarCobro clienteId={d.cliente.id} clienteNombre={d.cliente.nombre} onClose={() => setCobrando(false)} onHecho={() => { setCobrando(false); hecho(); }} /> : null}
    </section>
  );
}
