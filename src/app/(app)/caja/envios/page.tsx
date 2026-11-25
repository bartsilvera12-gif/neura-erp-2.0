"use client";

/**
 * Envíos (receta 170) — tablero kanban de entregas (rubro Comercio). Columnas = estados
 * configurables; cada tarjeta es un envío que nace de una venta ("Envío a domicilio" en Nueva
 * venta). Se mueve de estado, se le asigna chofer y se editan sus datos. Refresco en vivo (polling).
 * Configuración (estados + choferes) con permiso envios_administrar.
 */
import { useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
import { Truck, Settings2, Loader2, Plus, Pencil, Trash2, PackageOpen, Package, Banknote, Clock, Search, User } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { useUsuario, tienePermiso } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { ColorPicker } from "@/components/ColorPicker";
import { Cabecera, ModalDocumento, Pestanas, BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { gs } from "@/modules/clientes/ui";
import { useEnviosTablero } from "@/modules/envios/tablero";
import { filtrar } from "@/lib/busqueda";
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
    const q = busqueda.trim();
    const nombreChofer = new Map((tablero?.choferes ?? []).map((c) => [c.id, c.nombre]));
    // Búsqueda INTELIGENTE (regla del 2.0): tildes, typos, N° de documento ("demo 5"),
    // teléfono en cualquier forma y monto exacto ("12000"). Solo se usa para filtrar
    // (qué envíos pasan); el orden dentro de cada columna no cambia.
    const coincideIds = q
      ? new Set(
          filtrar(tablero?.envios ?? [], q, (e) => ({
            principal: e.cliente_nombre,
            otros: [e.direccion, e.referencia, e.vendedor, e.chofer_id ? nombreChofer.get(e.chofer_id) : null, ...e.productos.map((p) => p.nombre)],
            codigos: [e.telefono],
            documentos: [e.numero],
            montos: [e.total],
          })).map((e) => e.id),
        )
      : null;
    const m = new Map<string, Envio[]>();
    for (const e of tablero?.envios ?? []) {
      if (filtroChofer === "__sin__" ? e.chofer_id : filtroChofer ? e.chofer_id !== filtroChofer : false) continue;
      if (coincideIds && !coincideIds.has(e.id)) continue;
      const l = m.get(e.estado_id) ?? [];
      l.push(e);
      m.set(e.estado_id, l);
    }
    return m;
  }, [tablero, filtroChofer, busqueda]);

  const totalFiltrado = useMemo(() => { let n = 0; for (const l of porEstado.values()) n += l.length; return n; }, [porEstado]);
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
        <div className="mb-4 flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm sm:flex-row sm:items-center">
          <div className="group relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[var(--brand)]" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cliente, N°, dirección, teléfono, producto…" type="search" aria-label="Buscar envíos"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-9 text-sm font-medium outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white focus:ring-4 focus:ring-[var(--brand-100)]" />
            {busqueda ? (
              <button type="button" onClick={() => setBusqueda("")} aria-label="Limpiar búsqueda"
                className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">✕</button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-11 items-center gap-1.5 rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-600 max-sm:flex-1 max-sm:justify-center">
              <Package className="h-4 w-4 text-slate-400" />
              <span className="tabular-nums text-slate-900">{totalFiltrado}</span>
              <span className="font-medium text-slate-400">{totalFiltrado === 1 ? "envío" : "envíos"}</span>
            </div>
            <Select value={filtroChofer} onChange={setFiltroChofer} options={filtroChoferOpts} chip prefijo="Chofer" textoVacio="Todos" etiqueta="Filtrar por chofer" className="min-w-[150px] max-sm:flex-1" />
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
                    estados={tablero.estados} ocupado={ocupado === env.id} onAbrir={() => setDetalleId(env.id)} onMover={(estadoId) => mover(env, estadoId)} />
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
function TarjetaDraggable({ env, color, chofer, estados, ocupado, onAbrir, onMover }: {
  env: Envio; color: string; chofer: string | null; estados: EnvioEstado[]; ocupado: boolean; onAbrir: () => void; onMover: (estadoId: string) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: env.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`${isDragging ? "opacity-40" : ""} ${ocupado ? "pointer-events-none opacity-60" : ""}`}>
      <TarjetaEnvio env={env} color={color} chofer={chofer} estados={estados} onAbrir={onAbrir} onMover={onMover} />
    </div>
  );
}

// Diseño inspirado en el tablero de proyectos de sistemas-propio: acento de color
// a la izquierda, título + pills, un bloque con personas (Vend/Chofer) y datos, y
// abajo el link al detalle + "Mover a". Toda la tarjeta arrastra; el footer no.
const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4";
const BADGE_NEUTRO = "inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium leading-4 text-slate-600";

function TarjetaEnvio({ env, color, chofer, estados, onAbrir, onMover, enOverlay = false }: {
  env: Envio; color: string; chofer: string | null; estados?: EnvioEstado[]; onAbrir?: () => void; onMover?: (estadoId: string) => void; enOverlay?: boolean;
}) {
  const cobro = COBRO[env.cobro_estado];
  return (
    <div
      className={`rounded-xl border border-l-4 border-slate-200 bg-white p-2.5 shadow-sm transition-all ${
        enOverlay ? "rotate-1 cursor-grabbing shadow-2xl"
        : onAbrir ? "cursor-grab hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing" : ""}`}
      style={{ borderLeftColor: color }}
    >
      {/* Contenido: tocar abre el detalle */}
      <div onClick={onAbrir} role={onAbrir ? "button" : undefined} className={onAbrir ? "block w-full cursor-pointer text-left" : undefined}>
        <div className="flex items-start gap-1.5">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-snug text-slate-950">{env.cliente_nombre || "Consumidor final"}</p>
            <p className="truncate text-[10.5px] font-medium text-slate-500">
              {env.numero ? <span className="font-mono">#{env.numero}</span> : null}{env.numero ? " · " : ""}{haceCuanto(env.creado_at)}
            </p>
          </div>
        </div>

        {/* Pills: cantidad, cobro y hora estimada */}
        <div className="mt-2 flex flex-wrap gap-1">
          <span className={BADGE_NEUTRO}>{env.items} {env.items === 1 ? "producto" : "productos"}</span>
          {cobro ? <span className={`${BADGE} border-transparent font-semibold ${cobro.clase}`}>{cobro.texto}</span> : <span className={BADGE_NEUTRO}>Contado</span>}
          {env.hora_estimada ? <span className={`${BADGE} border-[color-mix(in_srgb,var(--brand)_30%,transparent)] bg-[var(--brand-50)] font-semibold text-[var(--brand-700)]`}><Clock className="mr-1 h-3 w-3" />{env.hora_estimada}</span> : null}
        </div>

        {/* Bloque: personas + datos del envío */}
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50/80 px-2.5 py-2">
          <PersonaMeta rol="Vend" nombre={env.vendedor} />
          <PersonaMeta rol="Chofer" nombre={chofer} />

          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-slate-200/70 pt-1 text-[10px]">
            <DatoMeta label="Teléfono" value={env.telefono || "—"} />
            <DatoMeta label="Entrega est." value={env.hora_estimada || "A coordinar"} alerta={!env.hora_estimada} />
            <div className="col-span-2">
              <DatoMeta label="Dirección" value={env.direccion || "Falta cargar la dirección"} alerta={!env.direccion} sub={env.referencia} />
            </div>
          </div>

          {env.productos.length > 0 ? (
            <div className="border-t border-slate-200/70 pt-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">Pedido</span>
                {env.productos.length > 2 ? <span className="text-[9px] text-slate-400">+{env.productos.length - 2} más</span> : null}
              </div>
              <ul className="mt-0.5 space-y-px">
                {env.productos.slice(0, 2).map((p, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[10.5px] text-slate-700">
                    <span className="min-w-[1.3rem] shrink-0 rounded bg-white px-1 text-center text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">{fmtCant(p.cantidad)}×</span>
                    <span className="min-w-0 truncate">{p.nombre}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between border-t border-slate-200/70 pt-1">
            <span className="text-[8.5px] font-bold uppercase tracking-wide text-slate-400">Total</span>
            <span className="text-[13px] font-bold tabular-nums text-slate-900">{gs(env.total)}</span>
          </div>
        </div>
      </div>

      {/* Footer: ver detalle + mover a (no arrastra ni abre el detalle) */}
      {!enOverlay && onMover && estados ? (
        <>
          <div className="mt-2 border-t border-slate-100 pt-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir?.(); }} className="text-[10.5px] font-semibold text-[var(--brand)] hover:underline">
              Ver detalle completo
            </button>
          </div>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5" onClick={(e) => e.stopPropagation()} onPointerDownCapture={(e) => e.stopPropagation()}>
            <label className="block text-[9px] font-semibold uppercase tracking-wide text-slate-500">Mover a</label>
            <div className="mt-1">
              <Select value={env.estado_id} onChange={(id) => { if (id !== env.estado_id) onMover(id); }}
                options={estados.map((e) => [e.id, e.nombre] as [string, string])} chico block etiqueta="Mover a" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Paleta de avatares: el color sale del nombre (misma persona, mismo color). */
const COLORES_PERSONA = ["#4FAEB2", "#8b5cf6", "#f59e0b", "#ec4899", "#22c55e", "#0ea5e9"];
function colorDePersona(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return COLORES_PERSONA[h % COLORES_PERSONA.length];
}
function inicialesNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 2) return `${p[0][0]}${p[1][0]}`.toUpperCase();
  return nombre.trim().slice(0, 2).toUpperCase();
}

/** Rol + avatar + nombre en una línea (Vend / Chofer). */
function PersonaMeta({ rol, nombre }: { rol: string; nombre?: string | null }) {
  const completo = (nombre ?? "").trim();
  if (!completo) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-10 shrink-0 text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{rol}</span>
        <span className="text-[10.5px] text-slate-300">Sin asignar</span>
      </div>
    );
  }
  const color = colorDePersona(completo);
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`${rol}: ${completo}`}>
      <span className="w-10 shrink-0 text-[8.5px] font-bold uppercase tracking-wide text-slate-400">{rol}</span>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold" style={{ background: `${color}22`, color }}>{inicialesNombre(completo)}</span>
      <span className="min-w-0 truncate text-[10.5px] font-medium text-slate-700">{completo}</span>
    </div>
  );
}

/** Etiqueta + valor; con `alerta` se resalta en ámbar. `sub` es una segunda línea gris. */
function DatoMeta({ label, value, alerta, sub }: { label: string; value: string; alerta?: boolean; sub?: string | null }) {
  return (
    <div className="min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <div className={`truncate ${alerta ? "font-semibold text-amber-600" : "text-slate-700"}`}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-slate-400">{sub}</div> : null}
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

  const completo = !!nombre.trim() && !!telefono.trim() && !!documento.trim();
  async function guardar() {
    if (!completo) { setError("Completá nombre, teléfono y CI / documento."); return; }
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
        <button type="button" onClick={() => void guardar()} disabled={busy || !completo} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} className={INPUT} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ET}>Teléfono *</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} className={INPUT} /></label>
          <label className="block"><span className={ET}>CI / Documento *</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={40} className={INPUT} /></label>
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
