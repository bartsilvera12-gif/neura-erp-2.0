"use client";

/**
 * Envíos (receta 170) — tablero kanban de entregas (rubro Comercio). Columnas = estados
 * configurables; cada tarjeta es un envío que nace de una venta ("Envío a domicilio" en Nueva
 * venta). Se mueve de estado, se le asigna chofer y se editan sus datos. Refresco en vivo (polling).
 * Configuración (estados + choferes) con permiso envios_administrar.
 */
import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
import { MapPin, Phone, Truck, Settings2, Loader2, Plus, Pencil, Trash2, PackageOpen, Package, Banknote, Clock, Search, ChevronRight, User } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { useUsuario, tienePermiso } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { ColorPicker } from "@/components/ColorPicker";
import { Cabecera, ModalDocumento, Pestanas, BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { gs } from "@/modules/clientes/ui";
import { useEnviosTablero } from "@/modules/envios/tablero";
import {
  URL_ENVIOS, URL_ENVIOS_ESTADOS, URL_ENVIOS_CHOFERES, URL_ENVIOS_TABLERO, URL_ENVIOS_HISTORIAL,
  type Envio, type EnvioEstado, type EnvioChofer, type EnvioHistorial,
} from "@/modules/envios/tipos";

const COBRO: Record<string, { texto: string; clase: string } | undefined> = {
  pendiente: { texto: "Cobra al entregar", clase: "bg-amber-100 text-amber-800" },
  cobrado: { texto: "Cobrado", clase: "bg-emerald-100 text-emerald-700" },
};

export default function EnviosPage() {
  const me = useUsuario();
  const puedeConfig = tienePermiso(me, "envios_administrar");
  const { tablero, error, recargar } = useEnviosTablero();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [cobrar, setCobrar] = useState<Envio | null>(null);
  const [filtroChofer, setFiltroChofer] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [arrastrando, setArrastrando] = useState<Envio | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
  );

  const porEstado = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const m = new Map<string, Envio[]>();
    for (const e of tablero?.envios ?? []) {
      if (filtroChofer === "__sin__" ? e.chofer_id : filtroChofer ? e.chofer_id !== filtroChofer : false) continue;
      if (q && ![e.cliente_nombre, e.numero, e.direccion, e.telefono].some((v) => v?.toLowerCase().includes(q))) continue;
      const l = m.get(e.estado_id) ?? [];
      l.push(e);
      m.set(e.estado_id, l);
    }
    return m;
  }, [tablero, filtroChofer, busqueda]);

  const choferesPorId = useMemo(() => new Map((tablero?.choferes ?? []).map((c) => [c.id, c.nombre])), [tablero]);
  const colorDeEstado = (id: string) => tablero?.estados.find((e) => e.id === id)?.color ?? "#94a3b8";
  const filtroChoferOpts: [string, string][] = [["", "Todos los choferes"], ["__sin__", "Sin asignar"], ...(tablero?.choferes ?? []).map((c) => [c.id, c.nombre] as [string, string])];
  // El detalle sale del tablero vivo: tras cada acción + recarga, se re-renderiza con datos frescos.
  const detalle = detalleId ? (tablero?.envios.find((e) => e.id === detalleId) ?? null) : null;

  async function accion(fn: () => Promise<unknown>, id: string) {
    setOcupado(id);
    setAviso(null);
    try {
      await fn();
      invalidar(URL_ENVIOS_TABLERO);
      await recargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const mover = (env: Envio, estado_id: string) =>
    estado_id !== env.estado_id && accion(() => apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "mover", id: env.id, estado_id }) }), env.id);
  const asignar = (env: Envio, chofer_id: string) =>
    accion(() => apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "asignar", id: env.id, chofer_id: chofer_id || null }) }), env.id);

  function onDragStart(e: DragStartEvent) {
    setArrastrando(tablero?.envios.find((x) => x.id === e.active.id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setArrastrando(null);
    const env = tablero?.envios.find((x) => x.id === e.active.id);
    const estadoId = e.over ? String(e.over.id) : null;
    if (env && estadoId && estadoId !== env.estado_id) void mover(env, estadoId);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <Cabecera kicker="Caja · Entregas" titulo="Envíos" subtitulo="Arrastrá cada entrega entre columnas · tocala para ver y cambiar todo" volver={{ href: "/caja/panel", label: "Caja" }}>
        {puedeConfig ? (
          <button type="button" onClick={() => setConfig(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>
            <Settings2 className="h-4 w-4" /> Configurar
          </button>
        ) : null}
      </Cabecera>

      {aviso ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p> : null}
      {error ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

      {tablero && (tablero.envios.length > 0 || filtroChofer || busqueda) ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cliente, N°, dirección…" type="search" aria-label="Buscar envíos"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <div className="w-52">
            <Select value={filtroChofer} onChange={setFiltroChofer} options={filtroChoferOpts} chico block etiqueta="Filtrar por chofer" />
          </div>
        </div>
      ) : null}

      {!tablero ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : tablero.estados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-slate-500">
          <PackageOpen className="h-8 w-8 text-slate-300" /> No hay estados configurados.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          {/* Celular: columnas apiladas a todo el ancho (scroll vertical, arrastre vertical).
              Escritorio (lg+): kanban horizontal. */}
          <div className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:px-0.5 lg:pb-4">
            {tablero.estados.map((est) => (
              <ColumnaEstado key={est.id} estado={est} envios={porEstado.get(est.id) ?? []} arrastrando={!!arrastrando}>
                {(porEstado.get(est.id) ?? []).map((env) => (
                  <TarjetaDraggable key={env.id} env={env} color={est.color ?? "#94a3b8"} chofer={env.chofer_id ? choferesPorId.get(env.chofer_id) ?? null : null}
                    ocupado={ocupado === env.id} onAbrir={() => setDetalleId(env.id)} />
                ))}
              </ColumnaEstado>
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {arrastrando ? <TarjetaEnvio env={arrastrando} color={colorDeEstado(arrastrando.estado_id)} chofer={arrastrando.chofer_id ? choferesPorId.get(arrastrando.chofer_id) ?? null : null} enOverlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {detalle ? (
        <ModalEnvioDetalle env={detalle} estados={tablero?.estados ?? []} choferes={tablero?.choferes ?? []} ocupado={ocupado === detalle.id}
          onClose={() => setDetalleId(null)} onMover={(e) => mover(detalle, e)} onAsignar={(c) => asignar(detalle, c)}
          onCambio={async () => { invalidar(URL_ENVIOS_TABLERO); await recargar(); }} onCobrar={() => setCobrar(detalle)} />
      ) : null}
      {cobrar ? <ModalCobrarEnvio env={cobrar} onClose={() => setCobrar(null)} onCobrado={async () => { setCobrar(null); invalidar(URL_ENVIOS_TABLERO); await recargar(); }} /> : null}
      {config ? <ConfigEnvios onClose={() => { setConfig(false); invalidar(URL_ENVIOS_TABLERO); void recargar(); }} /> : null}
    </div>
  );
}

// Columna = estado (drop target). Resalta cuando se arrastra una tarjeta encima.
function ColumnaEstado({ estado, envios, arrastrando, children }: { estado: EnvioEstado; envios: Envio[]; arrastrando: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: estado.id });
  const col = estado.color ?? "#94a3b8";
  return (
    <section className={`flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border transition-all duration-150 lg:w-[360px] ${
      isOver ? "border-[var(--brand)] bg-[var(--brand-50)] shadow-[0_12px_30px_-10px_color-mix(in_srgb,var(--brand)_60%,transparent)] ring-4 ring-[var(--brand-100)] lg:scale-[1.02]"
      : arrastrando ? "border-2 border-dashed border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-slate-50/50"
      : "border-slate-200/70 bg-slate-50/50"}`}>
      <header className="relative flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: col }} />
        <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: col }} />
        <h2 className={`min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.08em] transition-colors ${isOver ? "text-[var(--brand-700)]" : "text-slate-600"}`}>{estado.nombre}</h2>
        {isOver ? (
          <span className="shrink-0 rounded-full bg-[var(--brand)] px-2 py-0.5 text-[11px] font-bold text-white">Soltá acá</span>
        ) : (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" style={{ backgroundColor: `${col}22`, color: col }}>{envios.length}</span>
        )}
      </header>
      <div ref={setNodeRef} className="flex-1 space-y-2.5 px-2.5 pb-3.5">
        {envios.length === 0 ? (
          <div className={`rounded-xl border-2 border-dashed px-3 py-8 text-center text-xs font-semibold transition-colors ${isOver ? "border-[var(--brand)] bg-white/70 text-[var(--brand-700)]" : arrastrando ? "border-[var(--brand)]/40 text-[var(--brand-700)]" : "border-slate-200 font-normal text-slate-400"}`}>{arrastrando ? "Soltá acá" : "Sin envíos"}</div>
        ) : children}
      </div>
    </section>
  );
}

// Envoltorio arrastrable (@dnd-kit). En desktop se arrastra con el mouse; en táctil, mantené
// apretado un instante y arrastrá. Un toque corto (sin arrastrar) abre el detalle.
function TarjetaDraggable({ env, color, chofer, ocupado, onAbrir }: {
  env: Envio; color: string; chofer: string | null; ocupado: boolean; onAbrir: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: env.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`${isDragging ? "opacity-40" : ""} ${ocupado ? "pointer-events-none opacity-60" : ""}`}>
      <TarjetaEnvio env={env} color={color} chofer={chofer} onAbrir={onAbrir} />
    </div>
  );
}

function TarjetaEnvio({ env, color, chofer, onAbrir, enOverlay = false }: {
  env: Envio; color: string; chofer: string | null; onAbrir?: () => void; enOverlay?: boolean;
}) {
  const cobro = COBRO[env.cobro_estado];
  const inicial = (env.cliente_nombre || "C").trim().charAt(0).toUpperCase() || "C";
  return (
    <div
      onClick={onAbrir}
      role={onAbrir ? "button" : undefined}
      className={`group flex min-h-[244px] flex-col overflow-hidden rounded-xl bg-white ring-1 transition ${
        enOverlay ? "rotate-1 cursor-grabbing shadow-2xl ring-[var(--brand)]"
        : onAbrir ? "cursor-grab ring-slate-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-[var(--brand)] active:cursor-grabbing" : "ring-slate-200"}`}
    >
      <span className="block h-1 w-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 flex-col p-2.5">
        {/* Cliente + cuándo */}
        <div className="flex items-start gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white shadow-sm" style={{ backgroundColor: color }}>{inicial}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold leading-tight text-slate-900">{env.cliente_nombre || "Consumidor final"}</p>
            <p className="mt-0.5 truncate text-[10px] text-slate-400">{env.numero ? <span className="font-mono">#{env.numero}</span> : null}{env.numero ? " · " : ""}{haceCuanto(env.creado_at)}{env.vendedor ? ` · ${env.vendedor}` : ""}</p>
          </div>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-[var(--brand)]" />
        </div>

        {/* Dirección + teléfono (bloque destacado) */}
        <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 px-2.5 py-2">
          {env.direccion ? (
            <div className="flex items-start gap-1.5 text-[11px] leading-snug">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
              <span className="min-w-0 text-slate-700"><span className="font-medium">{env.direccion}</span>{env.referencia ? <span className="mt-0.5 block text-slate-400">{env.referencia}</span> : null}</span>
            </div>
          ) : <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600"><MapPin className="h-3.5 w-3.5 shrink-0" /> Falta cargar la dirección</p>}
          {env.telefono ? <p className="flex items-center gap-1.5 text-[11px] text-slate-600"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{env.telefono}</span></p> : null}
        </div>

        {/* Productos del pedido (nombre + cantidad) */}
        {env.productos.length > 0 ? (
          <div className="mt-2 rounded-lg border border-slate-100 px-2 py-1.5">
            <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400"><Package className="h-3 w-3" />Pedido</p>
            <ul className="space-y-0.5">
              {env.productos.slice(0, 4).map((p, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                  <span className="min-w-[1.5rem] shrink-0 rounded bg-[var(--brand-50)] px-1 py-0.5 text-center text-[10px] font-bold text-[var(--brand-700)]">{fmtCant(p.cantidad)}×</span>
                  <span className="min-w-0 truncate">{p.nombre}</span>
                </li>
              ))}
            </ul>
            {env.productos.length > 4 ? <p className="mt-1 text-[10px] text-slate-400">+{env.productos.length - 4} {env.productos.length - 4 === 1 ? "producto" : "productos"} más</p> : null}
          </div>
        ) : null}
        {env.hora_estimada ? (
          <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--brand-50)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-700)]"><Clock className="h-3 w-3" />Entrega estimada {env.hora_estimada}</p>
        ) : null}

        {/* Total + estado de cobro */}
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">Total</p>
            <p className="text-base font-bold leading-none tabular-nums text-slate-900">{gs(env.total)}</p>
          </div>
          {cobro ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cobro.clase}`}>{cobro.texto}</span> : null}
        </div>

        {/* Chofer */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${chofer ? "bg-[var(--brand-50)] text-[var(--brand-700)]" : "bg-slate-100 text-slate-400"}`}><Truck className="h-3 w-3" /></span>
          {chofer ? <span className="truncate text-xs font-semibold text-slate-700">{chofer}</span> : <span className="text-xs text-slate-400">Sin chofer asignado</span>}
        </div>
      </div>
    </div>
  );
}

function fmtCant(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-PY", { maximumFractionDigits: 3 });
}

function haceCuanto(iso: string): string {
  try {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const dias = Math.floor(h / 24);
    return dias === 1 ? "ayer" : `hace ${dias} días`;
  } catch { return ""; }
}

function ModalEnvioDetalle({ env, estados, choferes, ocupado, onClose, onMover, onAsignar, onCambio, onCobrar }: {
  env: Envio; estados: EnvioEstado[]; choferes: { id: string; nombre: string }[]; ocupado: boolean;
  onClose: () => void; onMover: (estadoId: string) => void; onAsignar: (choferId: string) => void; onCambio: () => void | Promise<void>; onCobrar: () => void;
}) {
  const [direccion, setDireccion] = useState(env.direccion ?? "");
  const [referencia, setReferencia] = useState(env.referencia ?? "");
  const [telefono, setTelefono] = useState(env.telefono ?? "");
  const [horaEstimada, setHoraEstimada] = useState(env.hora_estimada ?? "");
  const [notas, setNotas] = useState(env.notas ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<EnvioHistorial[] | null>(null);

  useEffect(() => {
    apiFetch<EnvioHistorial[]>(`${URL_ENVIOS_HISTORIAL}?id=${env.id}`).then(setHistorial).catch(() => setHistorial([]));
  }, [env.id, env.estado_id]);

  const choferOpts: [string, string][] = [["", "Sin chofer"], ...choferes.map((c) => [c.id, c.nombre] as [string, string])];

  async function guardar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "editar", id: env.id, direccion, referencia, telefono, hora_estimada: horaEstimada || null, notas }) });
      await onCambio();
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo={env.cliente_nombre || "Envío"} subtitulo={`${env.numero ? `#${env.numero} · ` : ""}${gs(env.total)}`} ancho="max-w-md" onClose={busy ? undefined : onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cerrar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar datos
        </button>
      </>}>
      <div className="space-y-4">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}

        {env.cobro_estado === "pendiente" ? (
          <button type="button" onClick={onCobrar} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700">
            <Banknote className="h-4 w-4" /> Cobrar al entregar · {gs(env.total)}
          </button>
        ) : env.cobro_estado === "cobrado" ? (
          <p className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><Banknote className="h-4 w-4" /> Cobrado</p>
        ) : null}

        {/* Estado: tocá para mover (o arrastrá la tarjeta en el tablero). */}
        <div>
          <span className={ET}>Estado</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {estados.map((e) => {
              const activo = e.id === env.estado_id;
              return (
                <button key={e.id} type="button" disabled={ocupado} onClick={() => !activo && onMover(e.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${activo ? "text-white shadow-sm" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  style={activo ? { backgroundColor: e.color ?? "#64748b", borderColor: e.color ?? "#64748b" } : undefined}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activo ? "#ffffff" : (e.color ?? "#94a3b8") }} />
                  {e.nombre}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chofer */}
        <div>
          <span className={ET}>Chofer</span>
          <div className="mt-1.5"><Select value={env.chofer_id ?? ""} onChange={onAsignar} options={choferOpts} block disabled={ocupado} /></div>
        </div>

        {/* Pedido: productos y cantidades */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Package className="h-4 w-4 text-slate-400" /> Pedido<span className="ml-auto font-bold tabular-nums text-slate-900">{gs(env.total)}</span></div>
          {env.productos.length > 0 ? (
            <ul className="space-y-1.5">
              {env.productos.map((p, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="min-w-[2rem] shrink-0 rounded bg-[var(--brand-50)] px-1.5 py-0.5 text-center text-xs font-bold text-[var(--brand-700)]">{fmtCant(p.cantidad)}×</span>
                  <span className="min-w-0 flex-1">{p.nombre}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-400">Sin productos cargados.</p>}
        </div>

        {env.vendedor ? <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><User className="h-3.5 w-3.5" />Cargado por {env.vendedor} · {fechaHora(env.creado_at)}</p> : null}

        {/* Datos de entrega */}
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <label className="block"><span className={ET}>Dirección</span><input value={direccion} onChange={(e) => setDireccion(e.target.value)} maxLength={300} className={INPUT} /></label>
          <label className="block"><span className={ET}>Referencia <span className="font-normal text-slate-400">(entre calles, color de casa…)</span></span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={200} className={INPUT} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={ET}>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} className={INPUT} /></label>
            <label className="block"><span className={ET}>Hora estimada</span><input type="time" value={horaEstimada} onChange={(e) => setHoraEstimada(e.target.value)} className={INPUT} /></label>
          </div>
          <label className="block"><span className={ET}>Notas</span><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} className={`${INPUT} resize-none`} /></label>
        </div>

        {historial && historial.length > 0 ? (
          <div className="border-t border-slate-100 pt-3">
            <p className={ET}>Línea de tiempo</p>
            <ul className="mt-2 space-y-2.5">
              {historial.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-700">{h.estado_nombre ?? "—"}</span>
                    <span className="text-slate-400"> · {fechaHora(h.at)}{h.usuario_nombre ? ` · ${h.usuario_nombre}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ModalDocumento>
  );
}

function fechaHora(iso: string): string {
  try { return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function ModalCobrarEnvio({ env, onClose, onCobrado }: { env: Envio; onClose: () => void; onCobrado: () => void }) {
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const METODOS: [string, string][] = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"]];

  async function cobrar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "cobrar", id: env.id, metodo, referencia: referencia.trim() || null }) });
      onCobrado();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo="Cobrar contra entrega" subtitulo={env.cliente_nombre ?? undefined} ancho="max-w-sm" onClose={busy ? undefined : onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void cobrar()} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50 max-sm:min-h-11 max-sm:flex-[2]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Cobrar {gs(env.total)}
        </button>
      </>}>
      <div className="space-y-3.5">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <div className="rounded-xl bg-[var(--brand-50)] px-3 py-3 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--brand-700)]/70">A cobrar</p>
          <p className="text-2xl font-bold tabular-nums text-[var(--brand-700)]">{gs(env.total)}</p>
        </div>
        <div>
          <span className={ET}>Forma de pago</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {METODOS.map(([v, t]) => (
              <button key={v} type="button" onClick={() => setMetodo(v)}
                className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition ${metodo === v ? "border-[var(--brand)] bg-[var(--brand-50)] text-[var(--brand-700)] ring-2 ring-[var(--brand-100)]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{t}</button>
            ))}
          </div>
        </div>
        {metodo !== "efectivo" ? (
          <label className="block"><span className={ET}>Referencia <span className="font-normal text-slate-400">(opcional)</span></span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={120} className={INPUT} placeholder="N° de operación, últimos dígitos…" /></label>
        ) : null}
        <p className="text-[11px] leading-snug text-slate-400">El cobro entra a tu caja abierta y la cuenta del cliente queda saldada.</p>
      </div>
    </ModalDocumento>
  );
}

// ─────────────────────────────── Configuración ───────────────────────────────
function ConfigEnvios({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"estados" | "choferes">("estados");
  return (
    <ModalDocumento titulo="Configurar envíos" ancho="max-w-2xl" onClose={onClose}
      footer={<button type="button" onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Listo</button>}>
      <div className="mb-3">
        <Pestanas valor={tab} onChange={(v) => setTab(v as "estados" | "choferes")} opciones={[{ id: "estados", label: "Estados" }, { id: "choferes", label: "Choferes" }]} />
      </div>
      {tab === "estados" ? <ConfigEstados /> : <ConfigChoferes />}
    </ModalDocumento>
  );
}

function ConfigEstados() {
  const [estados, setEstados] = useState<EnvioEstado[] | null>(null);
  const [edit, setEdit] = useState<EnvioEstado | "nuevo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    try { setEstados((await apiFetch<{ estados: EnvioEstado[] }>(URL_ENVIOS_ESTADOS)).estados); }
    catch (e) { setError((e as Error).message); }
  };
  useMountEffect(cargar);
  const ordenSugerido = Math.max(0, ...(estados ?? []).map((e) => e.orden)) + 1;

  return (
    <div className="space-y-2">
      {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      <p className="text-[11px] text-slate-500">Las columnas del tablero. El estado inicial es donde cae cada venta; los finales marcan la hora de entrega.</p>
      {estados === null ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-slate-400" /> : estados.map((e) => (
        <button key={e.id} type="button" onClick={() => setEdit(e)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-slate-300">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "#94a3b8" }} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{e.nombre}</span>
          {e.es_inicial ? <Etiqueta tono="sky">Inicial</Etiqueta> : null}
          {e.es_final ? <Etiqueta tono="emerald">Final</Etiqueta> : null}
          {!e.activo ? <Etiqueta tono="slate">Inactivo</Etiqueta> : null}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      ))}
      <button type="button" onClick={() => setEdit("nuevo")} className={`${BOTON_SECUNDARIO} w-full`}><Plus className="h-4 w-4" /> Nuevo estado</button>
      {edit ? <EditarEstado estado={edit === "nuevo" ? null : edit} ordenSugerido={ordenSugerido} onClose={() => setEdit(null)} onGuardado={() => { setEdit(null); void cargar(); }} /> : null}
    </div>
  );
}

function EditarEstado({ estado, ordenSugerido, onClose, onGuardado }: { estado: EnvioEstado | null; ordenSugerido: number; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(estado?.nombre ?? "");
  const [color, setColor] = useState(estado?.color ?? "#64748b");
  const [orden, setOrden] = useState(String(estado?.orden ?? ordenSugerido));
  const [esInicial, setEsInicial] = useState(estado?.es_inicial ?? false);
  const [esFinal, setEsFinal] = useState(estado?.es_final ?? false);
  const [activo, setActivo] = useState(estado?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(URL_ENVIOS_ESTADOS, { method: "POST", body: JSON.stringify({ id: estado?.id, nombre, color, orden: Number(orden) || 0, es_inicial: esInicial, es_final: esFinal, activo }) });
      onGuardado();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function eliminar() {
    setBusy(true); setError(null);
    try { await apiFetch(`${URL_ENVIOS_ESTADOS}?id=${estado!.id}`, { method: "DELETE" }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo={estado ? "Editar estado" : "Nuevo estado"} ancho="max-w-md" z="z-[130]" onClose={busy ? undefined : onClose}
      footer={<>
        {estado && !estado.usado ? <button type="button" onClick={() => void eliminar()} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button> : null}
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy || !nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} className={INPUT} placeholder="Ej. En camino" /></label>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className="block"><span className={ET}>Color</span><ColorPicker value={color} onChange={setColor} block /></label>
          <label className="block"><span className={ET}>Orden</span><input inputMode="numeric" value={orden} onChange={(e) => setOrden(e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} /></label>
        </div>
        <Toggle on={esInicial} onChange={(v) => { setEsInicial(v); if (v) setEsFinal(false); }} texto="Estado inicial" detalle="Donde cae cada venta nueva (solo uno)." />
        <Toggle on={esFinal} onChange={(v) => { setEsFinal(v); if (v) setEsInicial(false); }} texto="Estado final" detalle="Marca la hora de entrega (ej. Entregado, Cancelado)." />
        <Toggle on={activo} onChange={setActivo} texto="Activo" detalle="Los inactivos no aparecen como columna." />
      </div>
    </ModalDocumento>
  );
}

function ConfigChoferes() {
  const [choferes, setChoferes] = useState<EnvioChofer[] | null>(null);
  const [edit, setEdit] = useState<EnvioChofer | "nuevo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    try { setChoferes((await apiFetch<{ choferes: EnvioChofer[] }>(URL_ENVIOS_CHOFERES)).choferes); }
    catch (e) { setError((e as Error).message); }
  };
  useMountEffect(cargar);

  return (
    <div className="space-y-2">
      {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      {choferes === null ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-slate-400" /> : choferes.map((c) => (
        <button key={c.id} type="button" onClick={() => setEdit(c)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-slate-300">
          <Truck className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate"><span className="text-sm font-medium text-slate-800">{c.nombre}</span>{c.telefono ? <span className="ml-2 text-xs text-slate-400">{c.telefono}</span> : null}</span>
          {!c.activo ? <Etiqueta tono="slate">Inactivo</Etiqueta> : null}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      ))}
      <button type="button" onClick={() => setEdit("nuevo")} className={`${BOTON_SECUNDARIO} w-full`}><Plus className="h-4 w-4" /> Nuevo chofer</button>
      {edit ? <EditarChofer chofer={edit === "nuevo" ? null : edit} onClose={() => setEdit(null)} onGuardado={() => { setEdit(null); void cargar(); }} /> : null}
    </div>
  );
}

function EditarChofer({ chofer, onClose, onGuardado }: { chofer: EnvioChofer | null; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(chofer?.nombre ?? "");
  const [telefono, setTelefono] = useState(chofer?.telefono ?? "");
  const [documento, setDocumento] = useState(chofer?.documento ?? "");
  const [activo, setActivo] = useState(chofer?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true); setError(null);
    try { await apiFetch(URL_ENVIOS_CHOFERES, { method: "POST", body: JSON.stringify({ id: chofer?.id, nombre, telefono, documento, activo }) }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function eliminar() {
    setBusy(true); setError(null);
    try { await apiFetch(`${URL_ENVIOS_CHOFERES}?id=${chofer!.id}`, { method: "DELETE" }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo={chofer ? "Editar chofer" : "Nuevo chofer"} ancho="max-w-md" z="z-[130]" onClose={busy ? undefined : onClose}
      footer={<>
        {chofer && !chofer.usado ? <button type="button" onClick={() => void eliminar()} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button> : null}
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy || !nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} className={INPUT} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ET}>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} className={INPUT} /></label>
          <label className="block"><span className={ET}>CI / Documento</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={40} className={INPUT} /></label>
        </div>
        <Toggle on={activo} onChange={setActivo} texto="Activo" detalle="Los inactivos no se pueden asignar." />
      </div>
    </ModalDocumento>
  );
}

// ─────────────────────────────── Helpers UI ───────────────────────────────
function Etiqueta({ tono, children }: { tono: "sky" | "emerald" | "slate"; children: React.ReactNode }) {
  const c = { sky: "bg-sky-100 text-sky-700", emerald: "bg-emerald-100 text-emerald-700", slate: "bg-slate-100 text-slate-500" }[tono];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c}`}>{children}</span>;
}

function Toggle({ on, onChange, texto, detalle }: { on: boolean; onChange: (v: boolean) => void; texto: string; detalle?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{texto}</span>
        {detalle ? <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{detalle}</span> : null}
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-[var(--brand)]" : "bg-slate-300"}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

// Carga al montar (una vez).
function useMountEffect(fn: () => void) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fn(); }, []);
}
