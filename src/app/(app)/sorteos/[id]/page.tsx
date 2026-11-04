"use client";

/**
 * /sorteos/<id> — Ficha de un sorteo (receta 123): avance, acciones según el estado (activar, pausar,
 * cerrar, anular), combos y cuentas, premios y ganadores (digital, urna o externo), cupones para la urna
 * y los datos para verificar el sorteo digital.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, Copy, Dices, ExternalLink, FileSpreadsheet, Gift, ImageDown, Loader2, MessageCircle, Pause, Pencil, Play, Plus, Printer, Radio, ShieldCheck, Lock, Tag, Trash2, Trophy, Tv, Users, XCircle } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { descargarImagenGanador, nombreCorto } from "@/modules/sorteos/imagenGanador";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Pestanas } from "@/modules/inventario/ui";
import { imprimirHtml } from "@/modules/mesas/imprimirComanda";
import type { Cupon, Premio, Sorteo } from "@/modules/sorteos/tipos";
import { descuentoCombo } from "@/modules/sorteos/tipos";
import { BarraVenta, BOTON, BOTON_PRIMARIO, Campo, Cifra, EstadoSorteoChip, Etiqueta, fechaHoraPY, gs, htmlCupones, INPUT, Interruptor, Tarjeta, telefonoLindo, type FormatoCupon } from "@/modules/sorteos/ui";

type Accion = { estado: "activo" | "pausado" | "cerrado" | "anulado"; titulo: string; texto: string; boton: string; peligro?: boolean };

const ACCIONES: Record<string, Accion> = {
  activar: { estado: "activo", titulo: "Activar la venta", boton: "Activar",
    texto: "Se generan los números (no se pueden cambiar después) y se publica la huella del sorteo digital. Desde ahí se puede vender por todos los canales." },
  reanudar: { estado: "activo", titulo: "Reanudar la venta", boton: "Reanudar", texto: "El sorteo vuelve a estar a la venta." },
  pausar: { estado: "pausado", titulo: "Pausar la venta", boton: "Pausar", texto: "Nadie puede comprar mientras está pausado. Las compras por revisar se pueden seguir confirmando." },
  cerrar: { estado: "cerrado", titulo: "Cerrar la venta", boton: "Cerrar la venta",
    texto: "Ya no se vende más y se publica la huella de la lista de números vendidos. Después se cargan los ganadores. No se puede volver a abrir." },
  anular: { estado: "anulado", titulo: "Anular el sorteo", boton: "Anular", peligro: true, texto: "El sorteo queda anulado y no se puede usar. Solo se puede si no tiene compras." },
};

export default function FichaSorteoPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Sorteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("resumen");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [busy, setBusy] = useState(false);
  const [errAccion, setErrAccion] = useState<string | null>(null);
  const admin = usePermiso("sorteos_administrar");

  const cargar = useCallback(() => {
    apiFetch<Sorteo>(`/api/sorteos/${id}`).then(setS).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiarEstado() {
    if (!accion) return;
    setBusy(true);
    setErrAccion(null);
    try {
      setS(await apiFetch<Sorteo>(`/api/sorteos/${id}/estado`, { method: "POST", body: JSON.stringify({ estado: accion.estado }) }));
      setAccion(null);
    } catch (e) {
      setErrAccion((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>;
  if (!s) return <div className="space-y-4">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>;

  const botones: { key: string; icono: React.ReactNode }[] = [];
  if (admin) {
    if (s.estado === "borrador") botones.push({ key: "activar", icono: <Play className="h-4 w-4" /> });
    if (s.estado === "pausado") botones.push({ key: "reanudar", icono: <Play className="h-4 w-4" /> });
    if (s.estado === "activo") botones.push({ key: "pausar", icono: <Pause className="h-4 w-4" /> });
    if (s.estado === "activo" || s.estado === "pausado") botones.push({ key: "cerrar", icono: <Lock className="h-4 w-4" /> });
  }

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        kicker="Sorteo"
        titulo={s.nombre}
        subtitulo={`${s.fecha_sorteo ? `Sorteo: ${fechaHoraPY(s.fecha_sorteo)} · ` : ""}${gs(s.precio)} la boleta · números del ${s.numero_desde.toLocaleString("es-PY")} al ${s.numero_hasta.toLocaleString("es-PY")}`}
        volver={{ href: "/sorteos", label: "Sorteos" }}
        acciones={
          <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
            {admin && ["borrador", "activo", "pausado"].includes(s.estado) ? <Link href={`/sorteos/${s.id}/editar`} className={`${BOTON} no-underline`}><Pencil className="h-4 w-4" /> Editar</Link> : null}
            {botones.map((b) => (
              <button key={b.key} type="button" className={b.key === "activar" || b.key === "reanudar" ? BOTON_PRIMARIO : BOTON} onClick={() => { setErrAccion(null); setAccion(ACCIONES[b.key]); }}>
                {b.icono} {ACCIONES[b.key].boton}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <EstadoSorteoChip estado={s.estado} />
        {s.stats.por_revisar ? <Link href={`/sorteos/revision?sorteo=${s.id}`} className="no-underline"><Etiqueta tono="alerta">{s.stats.por_revisar} compra{s.stats.por_revisar === 1 ? "" : "s"} por revisar</Etiqueta></Link> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra label="Vendidas" valor={s.stats.vendidos.toLocaleString("es-PY")} sub={`de ${s.stats.total.toLocaleString("es-PY")}`} />
        <Cifra label="Recaudado" valor={gs(s.stats.monto)} sub={`${s.stats.ordenes.toLocaleString("es-PY")} compras confirmadas`} />
        <Cifra label="Hoy" valor={gs(s.stats.hoy_monto)} sub={`${s.stats.hoy_boletas.toLocaleString("es-PY")} boletas`} />
        <Cifra label="Libres" valor={(s.stats.total - s.stats.vendidos - s.stats.reservados).toLocaleString("es-PY")} sub={s.stats.reservados ? `${s.stats.reservados.toLocaleString("es-PY")} esperando pago` : "sin reservas"} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><BarraVenta stats={s.stats} /></div>

      <Pestanas
        valor={tab}
        onChange={setTab}
        opciones={[
          { id: "resumen", label: "Combos y cobro" },
          { id: "premios", label: "Premios y ganadores", badge: s.premios.length || undefined },
          { id: "cupones", label: "Participantes y urna" },
          { id: "verificacion", label: "Verificación" },
        ]}
      />

      {tab === "resumen" ? <Resumen s={s} /> : null}
      {tab === "premios" ? <Premios s={s} admin={admin} onCambio={setS} /> : null}
      {tab === "cupones" ? <div className="grid gap-4 lg:grid-cols-2"><Cupones s={s} /><ListaParticipantes s={s} /></div> : null}
      {tab === "verificacion" ? <Verificacion s={s} /> : null}

      {admin && ["borrador"].includes(s.estado) ? (
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-rose-600 hover:underline" onClick={() => { setErrAccion(null); setAccion(ACCIONES.anular); }}>
          <Trash2 className="h-4 w-4" /> Anular este sorteo
        </button>
      ) : null}

      {accion ? (
        <Modal titulo={accion.titulo} onClose={() => !busy && setAccion(null)}>
          <p className="text-sm text-slate-600">{accion.texto}</p>
          {errAccion ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{errAccion}</p> : null}
          <div className="mt-5 flex justify-end gap-2 max-sm:[&>*]:flex-1">
            <button type="button" className={BOTON} disabled={busy} onClick={() => setAccion(null)}>Volver</button>
            <button type="button" className={accion.peligro ? `${BOTON_PRIMARIO} !bg-rose-600` : BOTON_PRIMARIO} disabled={busy} onClick={cambiarEstado}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {accion.boton}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Resumen({ s }: { s: Sorteo }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Tarjeta icono={<Tag className="h-4 w-4" />} titulo="Combos" detalle="Se cobran solos al vender esa cantidad.">
        {s.combos.length ? (
          <ul className="m-0 list-none divide-y divide-slate-100 p-0">
            {s.combos.map((c) => {
              const d = descuentoCombo(s.precio, c);
              return (
                <li key={c.cantidad} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">{c.cantidad} boletas{c.etiqueta ? ` · ${c.etiqueta}` : ""}</span>
                    <span className="block text-xs text-slate-500">{gs(Math.round(c.precio / c.cantidad))} cada una{d ? ` · ${d}% menos` : ""}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{gs(c.precio)}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-slate-500">Sin combos: cada boleta a {gs(s.precio)}.</p>}
      </Tarjeta>
      <Tarjeta icono={<Banknote className="h-4 w-4" />} titulo="Cuentas para cobrar" detalle="Lo que ve el comprador para transferir.">
        {s.datos_pago.length ? (
          <ul className="m-0 list-none space-y-2 p-0">
            {s.datos_pago.map((c, i) => (
              <li key={i} className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <b className="block text-slate-900">{c.banco}</b>
                {c.titular} · Cuenta {c.cuenta}{c.documento ? ` · ${c.documento}` : ""}{c.alias ? ` · Alias ${c.alias}` : ""}
              </li>
            ))}
          </ul>
        ) : <p className="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Falta cargar una cuenta: sin eso no se puede activar.</p>}
      </Tarjeta>
      <div className="flex flex-wrap gap-2 lg:col-span-2">
        <Link href={`/sorteos/ventas?sorteo=${s.id}`} className={`${BOTON} no-underline`}>Ver las compras</Link>
        {s.estado === "activo" ? <Link href={`/sorteos/vender?sorteo=${s.id}`} className={`${BOTON} no-underline`}>Vender</Link> : null}
      </div>
    </div>
  );
}

function Premios({ s, admin, onCambio }: { s: Sorteo; admin: boolean; onCambio: (s: Sorteo) => void }) {
  const hayGanadores = s.premios.some((p) => p.numero_ganador);
  const [editando, setEditando] = useState(false);
  const [lista, setLista] = useState<{ nombre: string; descripcion: string }[]>(() => s.premios.map((p) => ({ nombre: p.nombre, descripcion: p.descripcion ?? "" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Premio | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<Sorteo>(`/api/sorteos/${s.id}/premios`, { method: "PUT", body: JSON.stringify({ premios: lista.filter((p) => p.nombre.trim()).map((p) => ({ nombre: p.nombre.trim(), descripcion: p.descripcion.trim() || null })) }) });
      onCambio(r);
      setEditando(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sortear(p: Premio) {
    setBusy(true);
    setError(null);
    try {
      onCambio(await apiFetch<Sorteo>(`/api/sorteos/premios/${p.id}`, { method: "POST", body: JSON.stringify({ accion: "sortear" }) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editando || (!s.premios.length && admin)) {
    return (
      <Tarjeta icono={<Gift className="h-4 w-4" />} titulo="Premios" detalle="En orden: el 1° es el premio mayor. Se pueden cambiar hasta que haya un ganador.">
        <div className="space-y-2.5">
          {lista.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-[auto_1fr_1.4fr_auto] sm:items-end">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--brand-50,#eef7f7)] text-sm font-bold text-[var(--brand)]">{i + 1}°</span>
              <Campo label="Premio"><input className={INPUT} value={p.nombre} onChange={(e) => setLista((l) => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} placeholder="Ej. Moto 150 cc" maxLength={120} /></Campo>
              <Campo label="Detalle (opcional)"><input className={INPUT} value={p.descripcion} onChange={(e) => setLista((l) => l.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)))} maxLength={300} /></Campo>
              <button type="button" aria-label="Quitar premio" className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:h-10 sm:w-10" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" className={BOTON} onClick={() => setLista((l) => [...l, { nombre: "", descripcion: "" }])}><Plus className="h-4 w-4" /> Agregar premio</button>
          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
            {s.premios.length ? <button type="button" className={BOTON} disabled={busy} onClick={() => setEditando(false)}>Cancelar</button> : null}
            <button type="button" className={BOTON_PRIMARIO} disabled={busy || !lista.some((p) => p.nombre.trim())} onClick={guardar}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar premios
            </button>
          </div>
        </div>
      </Tarjeta>
    );
  }

  const cerrado = s.estado === "cerrado";
  return (
    <div className="space-y-4">
      <LinkVivo s={s} admin={admin} onCambio={onCambio} />
      {!s.premios.length ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Todavía no hay premios cargados.</p> : null}
      {s.premios.length && !["cerrado", "sorteado"].includes(s.estado) ? (
        <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><Lock className="mt-0.5 h-4 w-4 shrink-0" /> Los ganadores se cargan con la venta cerrada: el día del vivo, cerrá la venta y cargá el número que salió en cada premio.</p>
      ) : null}
      {cerrado && s.premios.some((p) => !p.numero_ganador) ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--brand-100)] bg-[var(--brand-50,#eef7f7)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700"><b>Cargá el número que salió en el vivo</b> en cada premio: el sistema busca al comprador y lo publica en la página del sorteo. Si preferís, el sistema también puede sortear con su pantalla en vivo.</p>
          <Link href={`/sorteos/${s.id}/en-vivo`} className={`${BOTON} shrink-0 no-underline`}><Tv className="h-4 w-4" /> Pantalla de sorteo</Link>
        </div>
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
        {s.premios.map((p) => (
          <li key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold ${p.numero_ganador ? "bg-[var(--brand)] text-white" : "bg-slate-100 text-slate-500"}`}>{p.posicion}°</span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-slate-900">{p.nombre}</p>
                {p.descripcion ? <p className="text-xs text-slate-500">{p.descripcion}</p> : null}
              </div>
            </div>
            {p.numero_ganador ? (
              <div className="mt-3 space-y-3 rounded-xl bg-[var(--brand-50,#eef7f7)] p-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--brand)]"><Trophy className="h-3.5 w-3.5" /> Ganador · {NOMBRE_METODO_GANADOR[p.metodo ?? "externo"]}</p>
                  <p className="mt-1 text-2xl font-black tabular-nums tracking-widest text-slate-900">{p.numero_ganador}</p>
                  <p className="text-sm text-slate-800">{p.ganador}{p.ganador_documento ? ` · CI ${p.ganador_documento}` : ""}</p>
                  <p className="text-xs text-slate-500">{[telefonoLindo(p.ganador_telefono), p.orden_numero ? `Compra ${p.orden_numero}` : null, p.nota].filter(Boolean).join(" · ")}</p>
                </div>
                <AccionesGanador s={s} p={p} />
              </div>
            ) : cerrado && admin ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:[&>button:first-child]:w-full">
                <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={() => setManual(p)}><Trophy className="h-4 w-4" /> Cargar el número que salió</button>
                <button type="button" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-slate-600 hover:text-[var(--brand)]" disabled={busy} onClick={() => sortear(p)}>
                  <Dices className="h-4 w-4" /> Que lo sortee el sistema
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {admin && !hayGanadores && s.premios.length ? <button type="button" className={BOTON} onClick={() => setEditando(true)}><Pencil className="h-4 w-4" /> Cambiar premios</button> : null}
      {manual ? <GanadorManual s={s} premio={manual} onClose={() => setManual(null)} onListo={(r) => { onCambio(r); setManual(null); }} /> : null}
    </div>
  );
}

const NOMBRE_METODO_GANADOR: Record<string, string> = { externo: "salió en el vivo", urna: "salió de la urna", digital: "sorteado por el sistema" };

/** Link del vivo por redes donde se sortea (receta 127): se muestra en la página pública del sorteo. */
function LinkVivo({ s, admin, onCambio }: { s: Sorteo; admin: boolean; onCambio: (s: Sorteo) => void }) {
  const [url, setUrl] = useState(s.vivo_url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function guardar() {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      onCambio(await apiFetch<Sorteo>(`/api/sorteos/${s.id}/vivo`, { method: "POST", body: JSON.stringify({ url: url.trim() || null }) }));
      setOk(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!admin && !s.vivo_url) return null;
  return (
    <Tarjeta icono={<Radio className="h-4 w-4" />} titulo="El vivo del sorteo" detalle="El link de la transmisión en Facebook, Instagram o TikTok. Sale en la página del sorteo: antes avisa dónde se sortea y después queda la grabación.">
      {admin ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={INPUT} value={url} onChange={(e) => { setUrl(e.target.value); setOk(false); }} placeholder="https://www.facebook.com/…" inputMode="url" maxLength={500} />
          <button type="button" className={`${BOTON_PRIMARIO} shrink-0`} disabled={busy || url.trim() === (s.vivo_url ?? "")} onClick={guardar}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
        </div>
      ) : null}
      {s.vivo_url ? <a href={s.vivo_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand)]">Abrir el vivo <ExternalLink className="h-3.5 w-3.5" /></a> : null}
      {ok ? <p className="mt-2 text-sm text-emerald-700">Guardado: ya se ve en la página del sorteo.</p> : null}
      {error ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </Tarjeta>
  );
}

/** Lo que se hace con un ganador: la imagen para redes y avisarle por WhatsApp. */
function AccionesGanador({ s, p }: { s: Sorteo; p: Premio }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tel = (p.ganador_telefono ?? "").replace(/\D/g, "");
  const wa = /^09\d{8}$/.test(tel) ? `595${tel.slice(1)}` : tel.length >= 8 ? tel : null;
  const texto = `¡Hola ${nombreCorto(p.ganador).split(" ")[0]}! 🎉 Te escribimos de ${clienteConfig.nombre}: ganaste el ${p.posicion}° premio (${p.nombre}) del sorteo ${s.nombre} con el número ${p.numero_ganador}. ¡Felicitaciones! Escribinos para coordinar la entrega.`;
  async function imagen() {
    setBusy(true);
    setError(null);
    try {
      await descargarImagenGanador({
        empresa: clienteConfig.nombre, sorteo: s.nombre, posicion: p.posicion, premio: p.nombre, numero: p.numero_ganador ?? "", ganador: p.ganador,
        imagenPremio: p.imagen_url, color: clienteConfig.color, fecha: s.fecha_sorteo ? fechaHoraPY(s.fecha_sorteo).split(",")[0] : null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
        <button type="button" className={BOTON} disabled={busy} onClick={() => void imagen()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />} Imagen para redes</button>
        {wa ? <a className={`${BOTON} no-underline`} href={`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /> Avisarle por WhatsApp</a> : null}
      </div>
      {error ? <p className="mt-2 rounded-xl bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function GanadorManual({ s, premio, onClose, onListo }: { s: Sorteo; premio: Premio; onClose: () => void; onListo: (s: Sorteo) => void }) {
  const [numero, setNumero] = useState("");
  const [metodo, setMetodo] = useState<"urna" | "externo">("externo");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      onListo(await apiFetch<Sorteo>(`/api/sorteos/premios/${premio.id}`, { method: "POST", body: JSON.stringify({ accion: "manual", numero: Number(numero), metodo, nota: nota || null }) }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal titulo={`Ganador del ${premio.posicion}° premio`} onClose={() => !busy && onClose()}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{premio.nombre}. Escribí el número que salió en el vivo: el sistema busca quién lo compró. Tiene que estar vendido en este sorteo.</p>
        <Campo label="Número que salió"><input className={`${INPUT} text-lg font-bold tabular-nums tracking-widest`} inputMode="numeric" autoFocus value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, String(s.numero_hasta).length))} /></Campo>
        <Select value={metodo} onChange={(v) => setMetodo(v as "urna" | "externo")} block etiqueta="Cómo salió"
          options={[["externo", "En el vivo (ruleta, app, tómbola o lotería)"], ["urna", "De la urna, con los cupones impresos"]]} />
        <Campo label="Nota (opcional)" ayuda="Ej. minuto del vivo, quién lo sacó, escribano."><input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} /></Campo>
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 max-sm:[&>*]:flex-1">
          <button type="button" className={BOTON} disabled={busy} onClick={onClose}>Volver</button>
          <button type="button" className={BOTON_PRIMARIO} disabled={busy || !numero} onClick={guardar}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cargar ganador</button>
        </div>
      </div>
    </Modal>
  );
}

function Cupones({ s }: { s: Sorteo }) {
  const [formato, setFormato] = useState<FormatoCupon>("80");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pendientes, setPendientes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impresos, setImpresos] = useState<Cupon[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (desde) q.set("desde", desde);
    if (hasta) q.set("hasta", hasta);
    if (pendientes) q.set("pendientes", "1");
    return q.toString();
  }, [desde, hasta, pendientes]);

  async function imprimir() {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      const r = await apiFetch<{ sorteo: string; cupones: Cupon[] }>(`/api/sorteos/${s.id}/cupones?${query}`);
      if (!r.cupones.length) { setAviso(pendientes ? "No hay cupones sin imprimir en ese rango." : "No hay números vendidos en ese rango."); return; }
      await imprimirHtml(htmlCupones(r.sorteo, r.cupones, formato));
      setImpresos(r.cupones.filter((c) => !c.impreso));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function marcar() {
    if (!impresos?.length) { setImpresos(null); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ marcados: number }>(`/api/sorteos/${s.id}/cupones`, { method: "POST", body: JSON.stringify({ numeros: impresos.map((c) => Number(c.numero)) }) });
      setAviso(`${r.marcados.toLocaleString("es-PY")} cupones marcados como impresos.`);
      setImpresos(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tarjeta icono={<Printer className="h-4 w-4" />} titulo="Cupones para la urna" detalle="Uno por cada número vendido (solo compras confirmadas), con el nombre, la cédula y el teléfono del comprador. Hasta 5.000 por tanda.">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo label="Papel">
            <Select value={formato} onChange={(v) => setFormato(v as FormatoCupon)} block etiqueta="Papel"
              options={[["80", "Ticketera 80 mm"], ["58", "Ticketera 58 mm"], ["a4", "Hoja A4 (3 por fila)"]]} />
          </Campo>
          <Campo label="Desde el número (opcional)"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={desde} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))} placeholder={String(s.numero_desde)} /></Campo>
          <Campo label="Hasta el número (opcional)"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={hasta} onChange={(e) => setHasta(e.target.value.replace(/\D/g, ""))} placeholder={String(s.numero_hasta)} /></Campo>
        </div>
        <Interruptor valor={pendientes} onChange={setPendientes} label="Solo los que todavía no se imprimieron" />
        {formato !== "a4" ? <p className="text-xs text-slate-500">Ticketera: cada cupón sale en su propia hoja para que la impresora lo corte. En el diálogo de impresión elegí el mismo ancho de papel y sacá encabezados y pies de página.</p> : null}
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {aviso ? <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p> : null}
        <button type="button" className={BOTON_PRIMARIO} disabled={busy || s.stats.vendidos === 0} onClick={imprimir}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Imprimir cupones
        </button>
      </div>
      {impresos ? (
        <Modal titulo="¿Salieron bien los cupones?" onClose={() => setImpresos(null)}>
          <p className="text-sm text-slate-600">Si se imprimieron bien, marcalos como impresos: así la próxima tanda trae solo los nuevos.</p>
          <div className="mt-5 flex justify-end gap-2 max-sm:[&>*]:flex-1">
            <button type="button" className={BOTON} onClick={() => setImpresos(null)}>No, los vuelvo a imprimir</button>
            <button type="button" className={BOTON_PRIMARIO} disabled={busy} onClick={marcar}>Sí, marcar {impresos.length.toLocaleString("es-PY")}</button>
          </div>
        </Modal>
      ) : null}
    </Tarjeta>
  );
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Participantes para el vivo: la planilla completa (Excel) para el equipo y una lista para mostrar en
 * la transmisión, solo con el número, el nombre corto y la ciudad (sin cédula ni teléfono).
 */
function ListaParticipantes({ s }: { s: Sorteo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function traer() {
    const r = await apiFetch<{ sorteo: string; cupones: Cupon[] }>(`/api/sorteos/${s.id}/cupones`);
    if (!r.cupones.length) throw new Error("Todavía no hay números vendidos.");
    return r.cupones;
  }
  async function planilla() {
    setBusy("planilla");
    setError(null);
    try {
      const c = await traer();
      const celda = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const filas = [["Número", "Nombre", "Cédula", "Teléfono", "Ciudad", "Compra", "Fecha"], ...c.map((x) => [x.numero, x.nombre, x.documento, x.telefono, x.ciudad, x.orden, fechaHoraPY(x.fecha)])];
      // Con BOM y punto y coma: Excel en castellano lo abre en columnas y con acentos.
      const blob = new Blob(["﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `participantes-${s.slug}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function paraMostrar() {
    setBusy("mostrar");
    setError(null);
    try {
      const c = await traer();
      const items = c.map((x) => `<li><b>${esc(x.numero)}</b><span>${esc(nombreCorto(x.nombre))}${x.ciudad ? ` · ${esc(x.ciudad)}` : ""}</span></li>`).join("");
      await imprimirHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Participantes</title><style>
        body{font-family:system-ui,sans-serif;margin:24px;color:#0f172a}
        h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px;color:#475569;font-size:13px}
        ul{list-style:none;padding:0;margin:0;columns:4;column-gap:18px}
        li{break-inside:avoid;padding:5px 0;border-bottom:1px solid #e2e8f0;font-size:13px;display:flex;gap:8px}
        b{font-variant-numeric:tabular-nums;min-width:3.5em;color:${clienteConfig.color}}
        @media print{body{margin:10mm}}
      </style></head><body><h1>${esc(s.nombre)}</h1><p>${c.length.toLocaleString("es-PY")} números participando · ${esc(clienteConfig.nombre)}</p><ul>${items}</ul></body></html>`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Tarjeta icono={<Users className="h-4 w-4" />} titulo="Participantes" detalle="Para el vivo: todos los números vendidos (compras confirmadas).">
      <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
        <button type="button" className={BOTON} disabled={!!busy || s.stats.vendidos === 0} onClick={() => void paraMostrar()}>
          {busy === "mostrar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Lista para mostrar en el vivo
        </button>
        <button type="button" className={BOTON} disabled={!!busy || s.stats.vendidos === 0} onClick={() => void planilla()}>
          {busy === "planilla" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Planilla para Excel
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">La lista para mostrar lleva solo el número, el nombre corto y la ciudad. La planilla tiene todos los datos: es para el equipo, no se publica.</p>
      {error ? <p className="mt-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
    </Tarjeta>
  );
}

function Verificacion({ s }: { s: Sorteo }) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const copiar = (t: string, k: string) => { void navigator.clipboard?.writeText(t); setCopiado(k); setTimeout(() => setCopiado(null), 1500); };
  const Huella = ({ titulo, valor, k, ayuda }: { titulo: string; valor: string | null; k: string; ayuda: string }) => (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-700">{titulo}</p>
      <p className="mt-0.5 text-xs text-slate-500">{ayuda}</p>
      {valor ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700">{valor}</code>
          <button type="button" aria-label={`Copiar ${titulo}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 sm:h-9 sm:w-9" onClick={() => copiar(valor, k)}>
            {copiado === k ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      ) : <p className="mt-2 text-xs italic text-slate-400">Todavía no.</p>}
    </div>
  );
  return (
    <Tarjeta icono={<ShieldCheck className="h-4 w-4" />} titulo="Sorteo digital verificable" detalle="Cómo cualquiera puede comprobar que el ganador no se eligió a mano.">
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
        <li>Al <b>activar</b> el sorteo se fija una semilla secreta y se publica su huella. Nadie sabe todavía quién va a comprar.</li>
        <li>Al <b>cerrar</b> la venta se publica la huella de la lista de números vendidos.</li>
        <li>Cada ganador digital sale de mezclar la semilla, esa lista y el número de premio. Al terminar se <b>revela la semilla</b>: con ella y la lista, cualquiera recalcula el mismo ganador.</li>
      </ol>
      <div className="grid gap-3 lg:grid-cols-2">
        <Huella titulo="Huella de la semilla" valor={s.semilla_hash} k="semilla_hash" ayuda="Publicada desde que se activó el sorteo." />
        <Huella titulo="Huella de la lista de vendidos" valor={s.lista_hash} k="lista_hash" ayuda={s.lista_cantidad != null ? `${s.lista_cantidad.toLocaleString("es-PY")} números al cerrar la venta.` : "Se publica al cerrar la venta."} />
      </div>
      {s.estado === "anulado" ? <p className="mt-3 flex items-center gap-1.5 text-sm text-rose-700"><XCircle className="h-4 w-4" /> Sorteo anulado.</p> : null}
      {s.semilla_revelada ? <p className="mt-3 text-sm text-emerald-700">Sorteo terminado: la semilla ya está revelada en la página pública.</p> : null}
    </Tarjeta>
  );
}
