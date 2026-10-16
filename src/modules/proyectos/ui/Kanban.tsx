"use client";

/**
 * Kanban de Proyectos (look del sistema actual): columnas por estado con su cantidad,
 * tarjetas con drag & drop nativo HTML5, "Mover a" y "Cargar más" por columna.
 *
 * Rendimiento: tarjetas y columnas van memoizadas y todos los handlers que reciben son
 * estables (los arma ProyectosClient con useCallback + refs). Mover una tarjeta
 * re-renderiza solo las dos columnas involucradas. El SLA de cada tarjeta corre solo
 * (un único reloj de 60 s para toda la pantalla) sin re-renderizar la tarjeta entera.
 *
 * Táctil / celular: el drag nativo no anda con el dedo → la tarjeta no es arrastrable y se
 * mueve con "Mover a" (el Select abre una hoja inferior en celular). En celular cada columna
 * ocupa casi todo el ancho, con scroll horizontal con imán (snap) entre columnas.
 */
import { memo } from "react";
import Link from "next/link";
import { CheckSquare, Loader2, Lock } from "lucide-react";
import { Select } from "@/components/Select";
import {
  PRIORIDAD_LABEL, estiloPrioridad, fechaCorta, haceCuanto, monto,
  type Columna as ColumnaT, type Estado, type HorarioLaboral, type Tarjeta,
} from "@/modules/proyectos/tipos";
import { PersonaMeta, SlaBadge } from "./comun";
import { useAhora } from "./reloj";
import { useEsTactil } from "@/lib/ui/responsive";

export type AccionesTarjeta = {
  onAbrir: (id: string) => void;
  onMover: (t: Tarjeta, estadoId: string) => void;
  onDragStart: (t: Tarjeta) => void;
  onDragEnd: () => void;
};

const parar = (e: React.SyntheticEvent) => e.stopPropagation();
const BADGE = "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4";
const NEUTRO = `${BADGE} border-slate-200 bg-slate-50 text-slate-600`;

/** ¿Puede mover la tarjeta? ADMIN, técnico o PM (el comercial no, como el actual). */
export const puedeMoverTarjeta = (t: Pick<Tarjeta, "responsable_tecnico_id" | "project_manager_id">, yo: string | undefined, esAdmin: boolean) =>
  esAdmin || (!!yo && (t.responsable_tecnico_id === yo || t.project_manager_id === yo));

function FechaMeta({ label, value, tono }: { label: string; value: string; tono?: "alerta" | "vencida" }) {
  return (
    <div className="min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <div className={`truncate tabular-nums ${tono === "alerta" ? "font-semibold text-amber-600" : tono === "vencida" ? "font-semibold text-rose-600" : "text-slate-700"}`}>{value}</div>
    </div>
  );
}

/** "Hace 2 h" de la última actividad: usa el reloj compartido. */
function Actividad({ at }: { at: string }) {
  const ahora = useAhora();
  return <FechaMeta label="Actividad" value={ahora ? haceCuanto(at, ahora) : fechaCorta(at)} />;
}

/** Prometida: "A definir" si falta, en rojo si ya pasó (y el proyecto sigue abierto). */
function Prometida({ fecha, abierta }: { fecha: string | null; abierta: boolean }) {
  const ahora = useAhora();
  if (!fecha) return <FechaMeta label="Prometido" value="A definir" tono="alerta" />;
  const vencida = abierta && !!ahora && Date.parse(fecha) < ahora;
  return <FechaMeta label="Prometido" value={fechaCorta(fecha)} tono={vencida ? "vencida" : undefined} />;
}

/** El porqué cuando la tarjeta está parada (pausa / bloqueo) o cancelada. */
function MotivoMeta({ t, estado }: { t: Tarjeta; estado: Estado | undefined }) {
  const cancelado = estado?.rol === "cancelado";
  const pausa = estado?.tipo_sla === "pausado";
  if (!cancelado && !pausa && !t.bloqueado) return null;
  const texto = (cancelado ? t.cancelacion_motivo : t.bloqueado ? t.bloqueo_motivo : t.pausa_motivo)?.trim();
  const pal = cancelado ? { caja: "bg-slate-100 text-slate-600", rot: "text-slate-500" } : { caja: "bg-amber-50 text-amber-800", rot: "text-amber-600" };
  return (
    <div className={`mt-1.5 rounded-lg px-2 py-1.5 ${pal.caja}`}>
      <span className={`block text-[9.5px] font-semibold uppercase tracking-wide ${pal.rot}`}>
        {cancelado ? "Motivo de cancelación" : t.bloqueado ? "Motivo del bloqueo" : "Motivo de la pausa"}
      </span>
      {texto ? (
        <span className="mt-0.5 line-clamp-3 block text-[11px] leading-snug">{texto}</span>
      ) : cancelado && t.cancelacion_motivo === undefined ? (
        <span className="mt-0.5 block text-[11px] italic leading-snug opacity-70">Ver en el detalle</span>
      ) : (
        <span className="mt-0.5 block text-[11px] italic leading-snug opacity-70">Sin cargar</span>
      )}
      {!cancelado && t.bloqueado && (t.bloqueo_responsable || t.bloqueo_proxima_accion) ? (
        <div className="mt-1 space-y-0.5 border-t border-amber-200/70 pt-1 text-[10px] leading-snug">
          {t.bloqueo_responsable ? <span className="block"><span className={`font-semibold ${pal.rot}`}>Destraba:</span> {t.bloqueo_responsable}</span> : null}
          {t.bloqueo_proxima_accion ? <span className="block"><span className={`font-semibold ${pal.rot}`}>Próxima acción:</span> {t.bloqueo_proxima_accion}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
export const ProyectoCard = memo(function ProyectoCard({
  t, estado, opcionesEstado, horario, puedeMover, acciones,
}: {
  t: Tarjeta;
  estado: Estado | undefined;
  opcionesEstado: [string, string][];
  horario: HorarioLaboral;
  puedeMover: boolean;
  acciones: AccionesTarjeta;
}) {
  const prio = estiloPrioridad(t.prioridad);
  const abierta = !estado?.es_final;
  const tactil = useEsTactil();
  return (
    <div
      draggable={puedeMover && !tactil}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
        acciones.onDragStart(t);
      }}
      onDragEnd={acciones.onDragEnd}
      onClick={() => acciones.onAbrir(t.id)}
      className={`group select-none rounded-2xl border border-l-4 border-slate-200 bg-white p-3.5 shadow-sm transition-all [contain-intrinsic-size:auto_320px] [content-visibility:auto] sm:p-4 ${tactil ? "active:bg-slate-50" : "hover:-translate-y-0.5 hover:shadow-md"} ${prio.borde} ${puedeMover && !tactil ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${prio.punto}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug text-slate-950 [overflow-wrap:anywhere] group-hover:underline">{t.titulo}</div>
          {t.cliente_id ? (
            <div className="mt-1 truncate text-xs font-medium text-slate-600">{t.cliente_nombre || "—"}</div>
          ) : (
            <div className="mt-1">
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                title="Este proyecto no tiene un cliente asignado: no aparece en la ficha de ningún cliente.">
                Sin cliente asignado
              </span>
            </div>
          )}
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{t.numero}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`${BADGE} font-semibold ${prio.badge}`}>{PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad}</span>
        <SlaBadge desde={t.estado_desde} estado={estado} horario={horario} />
        {t.bloqueado ? (
          <span className={`${BADGE} gap-1 border-rose-200 bg-rose-50 text-rose-800`}><Lock className="h-2.5 w-2.5" /> Bloqueado</span>
        ) : null}
        {t.tareas_total > 0 ? (
          <span className={`${NEUTRO} gap-1 ${t.tareas_hechas === t.tareas_total ? "!border-emerald-200 !bg-emerald-50 !text-emerald-700" : ""}`} title="Tareas completadas">
            <CheckSquare className="h-2.5 w-2.5" /> {t.tareas_hechas}/{t.tareas_total}
          </span>
        ) : null}
        {t.monto_vendido > 0 ? <span className={`${NEUTRO} tabular-nums`}>{monto(t.monto_vendido, t.moneda)}</span> : null}
      </div>

      <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50/80 px-3 py-2.5">
        <PersonaMeta rol="PM" nombre={t.pm_nombre} />
        <PersonaMeta rol="Téc" nombre={t.tecnico_nombre} />
        <PersonaMeta rol="Com" nombre={t.comercial_nombre} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-200/70 pt-1.5 text-[10.5px]">
          {t.fecha_ingreso !== undefined ? <FechaMeta label="Ingreso" value={fechaCorta(t.fecha_ingreso)} /> : null}
          {estado?.rol === "entregado" && t.fecha_entrega ? (
            <FechaMeta label="Entregado" value={fechaCorta(t.fecha_entrega)} />
          ) : (
            <Prometida fecha={t.fecha_prometida} abierta={abierta} />
          )}
          <div className="col-span-2"><Actividad at={t.ultimo_movimiento_at} /></div>
        </div>
        <MotivoMeta t={t} estado={estado} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3" onClick={parar}>
        <Link href={`/proyectos/${t.id}`} onClick={parar} draggable={false} className="text-[11px] font-semibold text-[var(--brand)] hover:text-[var(--brand-600)] hover:underline [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:text-xs">
          Abrir en página completa
        </Link>
      </div>
      {puedeMover ? (
        <div
          className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2"
          draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onPointerDown={parar}
          onMouseDown={parar}
          onClick={parar}
        >
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mover a</label>
          <div className="mt-1">
            <Select value={t.estado_id} onChange={(v) => acciones.onMover(t, v)} options={opcionesEstado} block etiqueta="Mover a" className="[&>button]:py-1.5 [&>button]:text-xs [@media(pointer:coarse)]:[&>button]:min-h-11 [@media(pointer:coarse)]:[&>button]:text-sm" />
          </div>
        </div>
      ) : null}
    </div>
  );
});

// ── Columna ──────────────────────────────────────────────────────────────────
export const ColumnaKanban = memo(function ColumnaKanban({
  col, estados, opcionesEstado, horario, yo, esAdmin, resaltada, cargandoMas, acciones, onDragSobre, onSoltar, onCargarMas,
}: {
  col: ColumnaT;
  estados: Map<string, Estado>;
  opcionesEstado: [string, string][];
  horario: HorarioLaboral;
  yo: string | undefined;
  esAdmin: boolean;
  resaltada: boolean;
  cargandoMas: boolean;
  acciones: AccionesTarjeta;
  onDragSobre: (id: string | null) => void;
  onSoltar: (id: string) => void;
  onCargarMas: (id: string) => void;
}) {
  const faltan = col.cantidad - col.tarjetas.length;
  const estado = estados.get(col.id);
  const tactil = useEsTactil();
  return (
    <div
      className={`flex w-[300px] shrink-0 snap-start flex-col rounded-xl border bg-slate-50/80 transition-colors max-md:w-[calc(100vw-3.5rem)] max-md:max-w-[22rem] ${resaltada ? "border-[var(--brand)]/50 bg-[var(--brand)]/[0.06] ring-2 ring-[var(--brand)]/20" : "border-slate-200"}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragSobre(col.id); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragSobre(null); }}
      onDrop={(e) => { e.preventDefault(); onSoltar(col.id); }}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-xl border-b border-slate-200 bg-white px-3 py-2 shadow-sm" style={{ borderTopColor: col.color, borderTopWidth: 3 }}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{col.nombre}</span>
          {col.tipo_sla === "interno" && col.sla_horas_objetivo ? (
            <span className="shrink-0 text-[10px] font-medium text-slate-400" title="Objetivo de SLA en horas laborales">· {col.sla_horas_objetivo} h</span>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{col.cantidad.toLocaleString("es-PY")}</span>
      </div>

      <div className="flex max-h-[calc(100dvh-19rem)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2 md:max-h-[calc(100dvh-300px)]">
        {col.tarjetas.length === 0 ? (
          <div className={`flex h-20 items-center justify-center rounded-xl border-2 border-dashed text-xs transition-colors ${resaltada ? "border-[var(--brand)]/60 bg-[var(--brand)]/5 text-[var(--brand-600)]" : "border-slate-200 text-slate-400"}`}>
            {tactil ? "Sin proyectos" : "Soltá tarjetas acá"}
          </div>
        ) : (
          col.tarjetas.map((t) => (
            <ProyectoCard
              key={t.id}
              t={t}
              estado={estado}
              opcionesEstado={opcionesEstado}
              horario={horario}
              puedeMover={puedeMoverTarjeta(t, yo, esAdmin)}
              acciones={acciones}
            />
          ))
        )}
        {faltan > 0 ? (
          <button type="button" onClick={() => onCargarMas(col.id)} disabled={cargandoMas}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-xs">
            {cargandoMas ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Cargar más ({faltan.toLocaleString("es-PY")})
          </button>
        ) : null}
      </div>
    </div>
  );
});
