"use client";

/**
 * Kanban del CRM (look del sistema actual): columnas por etapa con cantidad + total en Gs,
 * tarjetas con drag & drop nativo HTML5 y "Cargar más" por columna.
 *
 * Rendimiento: tarjetas y columnas van memoizadas y todos los handlers que reciben son
 * estables (los arma CrmClient con useCallback + refs). Mover una tarjeta re-renderiza solo
 * las dos columnas involucradas; el resto ni se entera. Arrastrar solo cambia el resaltado
 * de la columna de destino.
 */
import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Clock, Copy, Loader2, Pencil, Phone, X } from "lucide-react";
import {
  ORIGEN_LABEL, diaMes, fechaSimple, gsCompleto, gsCorto, telefonoLindo, tonoEtapa,
  type Columna as ColumnaT, type Etapa, type Tarjeta,
} from "@/modules/crm/tipos";
import { AvatarIni } from "./comun";

export type AccionesTarjeta = {
  onAbrir: (id: string) => void;
  onMover: (t: Tarjeta, etapa: string) => void;
  onTransformar: (t: Tarjeta) => void;
  onDragStart: (t: Tarjeta) => void;
  onDragEnd: () => void;
};

const parar = (e: React.SyntheticEvent) => e.stopPropagation();

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* noop */ }
    document.body.removeChild(ta);
  }
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
export const ProspectoCard = memo(function ProspectoCard({
  t, etapas, ganado, perdido, acciones,
}: {
  t: Tarjeta;
  etapas: Etapa[];
  /** código de la primera etapa de ganado / perdido (para los atajos) */
  ganado: string | null;
  perdido: string | null;
  acciones: AccionesTarjeta;
}) {
  const [copiado, setCopiado] = useState(false);
  const etapa = etapas.find((e) => e.codigo === t.etapa);
  const tono = tonoEtapa(etapa?.color);
  const abierta = !!etapa && !etapa.es_ganado && !etapa.es_perdido;
  const tel = (t.telefono ?? "").trim();
  const telDigitos = tel.replace(/[^\d+]/g, "");

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
        acciones.onDragStart(t);
      }}
      onDragEnd={acciones.onDragEnd}
      onClick={() => acciones.onAbrir(t.id)}
      className={`group cursor-grab select-none rounded-2xl border border-l-4 border-slate-200 bg-white p-3 shadow-sm transition-all [contain-intrinsic-size:auto_220px] [content-visibility:auto] hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing ${tono.borderLeft}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tono.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-slate-900">{t.empresa || t.contacto}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{t.numero_control}</p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); acciones.onAbrir(t.id); }}
          className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-[var(--brand)]/10 hover:text-[var(--brand)] group-hover:opacity-100"
          title="Editar"
          aria-label="Editar prospecto"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      {t.servicio ? <p className="mt-1.5 line-clamp-1 text-[11px] text-slate-500">{t.servicio}</p> : null}

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Valor</span>
        <span className="text-sm font-semibold tabular-nums text-slate-900">{gsCompleto(t.valor_estimado)}</span>
      </div>

      {t.origen_creacion && t.origen_creacion !== "manual" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
            t.origen_creacion === "whatsapp" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"
          }`}>
            <span aria-hidden className={`h-1 w-1 rounded-full ${t.origen_creacion === "whatsapp" ? "bg-emerald-500" : "bg-slate-400"}`} />
            {ORIGEN_LABEL[t.origen_creacion] ?? t.origen_creacion}
          </span>
        </div>
      ) : null}

      {t.empresa ? (
        <div className="mt-2 rounded-xl bg-slate-50/80 px-2.5 py-1.5">
          <p className="truncate text-[11px] text-slate-700"><span className="font-medium text-slate-500">Contacto: </span>{t.contacto}</p>
        </div>
      ) : null}

      {tel ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copiar(telDigitos || tel);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1500);
          }}
          title={copiado ? "Copiado" : "Hacé click para copiar el número"}
          className={`mt-2 flex w-full items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
            copiado ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[var(--brand)]/30 bg-[var(--brand)]/[0.08] text-[var(--brand-600)] hover:border-[var(--brand)]/50"
          }`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Phone className={`h-3 w-3 shrink-0 ${copiado ? "text-emerald-600" : "text-[var(--brand)]"}`} />
            <span className="min-w-0 flex-1 break-all font-mono font-medium tabular-nums">{telefonoLindo(tel)}</span>
          </span>
          {copiado ? <Check className="h-3 w-3 shrink-0 text-emerald-600" /> : <Copy className="h-3 w-3 shrink-0 text-[var(--brand)]/70" />}
        </button>
      ) : null}

      {t.proxima_accion || t.fecha_proxima_accion ? (
        <div className={`mt-2 flex items-start gap-1.5 rounded-lg border px-2 py-1.5 ${
          t.accion_vencida && abierta ? "border-rose-200 bg-rose-50/80" : "border-amber-100 bg-amber-50/70"
        }`}>
          <Clock className={`mt-0.5 h-3 w-3 shrink-0 ${t.accion_vencida && abierta ? "text-rose-500" : "text-amber-500"}`} />
          <p className={`line-clamp-2 text-[10px] leading-tight ${t.accion_vencida && abierta ? "text-rose-800" : "text-amber-800"}`}>
            {t.proxima_accion}
            {t.fecha_proxima_accion ? (
              <span className="font-semibold">{t.proxima_accion ? " · " : ""}{fechaSimple(t.fecha_proxima_accion)}{t.accion_vencida && abierta ? " (vencida)" : ""}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
        {t.responsable_nombre ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <AvatarIni nombre={t.responsable_nombre} />
            <span className="truncate text-[10px] text-slate-600">{t.responsable_nombre}</span>
          </div>
        ) : (
          <span className="text-[10px] italic text-slate-300">Sin responsable</span>
        )}
        <span className="shrink-0 text-[10px] text-slate-400">{diaMes(t.created_at)}</span>
      </div>

      {/* Mover a etapa: el select no arrastra la tarjeta ni abre el detalle. */}
      <div
        className="mt-2 rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-1.5"
        draggable={false}
        onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onPointerDown={parar}
        onMouseDown={parar}
        onClick={parar}
      >
        <label className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">Mover a etapa</label>
        <select
          value={t.etapa}
          onChange={(e) => acciones.onMover(t, e.target.value)}
          aria-label="Cambiar etapa del prospecto"
          className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
        >
          {etapas.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
        </select>
      </div>

      {abierta && ganado && perdido ? (
        <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onMover(t, ganado); }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50">
            <Check className="h-3 w-3" /> Ganado
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onMover(t, perdido); }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-semibold text-rose-700 transition-colors hover:bg-rose-50">
            <X className="h-3 w-3" /> Perdido
          </button>
        </div>
      ) : null}

      {t.cliente_id ? (
        <Link href={`/clientes/${t.cliente_id}`} onClick={parar} draggable={false}
          className="mt-2 flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">
          <Check className="h-3 w-3" /> Cliente creado · ver ficha
        </Link>
      ) : (
        <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onTransformar(t); }}
          title="Crear el cliente con estos datos y marcar el lead como Ganado"
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-[var(--brand)] px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-[var(--brand-600)]">
          <Check className="h-3 w-3" /> Transformar a cliente
        </button>
      )}
    </div>
  );
});

// ── Columna ──────────────────────────────────────────────────────────────────
export const ColumnaKanban = memo(function ColumnaKanban({
  col, etapas, ganado, perdido, resaltada, cargandoMas, acciones, onDragSobre, onSoltar, onCargarMas,
}: {
  col: ColumnaT;
  etapas: Etapa[];
  ganado: string | null;
  perdido: string | null;
  resaltada: boolean;
  cargandoMas: boolean;
  acciones: AccionesTarjeta;
  onDragSobre: (codigo: string | null) => void;
  onSoltar: (codigo: string) => void;
  onCargarMas: (codigo: string) => void;
}) {
  const tono = tonoEtapa(col.color);
  const faltan = col.cantidad - col.tarjetas.length;
  return (
    <div
      className={`flex w-64 min-w-64 flex-col rounded-2xl border bg-white/60 backdrop-blur-sm transition-all duration-150 ${
        resaltada ? "border-[var(--brand)] bg-[var(--brand)]/[0.04] ring-2 ring-[var(--brand)]/30" : tono.headerBorder
      }`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragSobre(col.codigo); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragSobre(null); }}
      onDrop={(e) => { e.preventDefault(); onSoltar(col.codigo); }}
    >
      <div className={`sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5 ${tono.headerBorder} ${tono.headerBg}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tono.dot}`} />
          <span className="truncate text-[13px] font-semibold text-slate-800">{col.nombre}</span>
          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
            {col.cantidad.toLocaleString("es-PY")}
          </span>
        </div>
        {col.total > 0 ? <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-500" title={gsCompleto(col.total)}>Gs. {gsCorto(col.total)}</span> : null}
      </div>

      <div className="flex max-h-[calc(100vh-260px)] min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {col.tarjetas.length === 0 ? (
          <div className={`flex h-16 items-center justify-center rounded-xl border-2 border-dashed text-[11px] transition-colors ${
            resaltada ? "border-[var(--brand)]/60 bg-[var(--brand)]/5 text-[var(--brand-600)]" : "border-slate-200 text-slate-300"
          }`}>
            Soltá tarjetas aquí
          </div>
        ) : (
          col.tarjetas.map((t) => (
            <ProspectoCard key={t.id} t={t} etapas={etapas} ganado={ganado} perdido={perdido} acciones={acciones} />
          ))
        )}
        {faltan > 0 ? (
          <button type="button" onClick={() => onCargarMas(col.codigo)} disabled={cargandoMas}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60">
            {cargandoMas ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Cargar más ({faltan.toLocaleString("es-PY")})
          </button>
        ) : null}
      </div>
    </div>
  );
});

// ── Scroll horizontal con flechas al acercarse a los costados (también arrastrando) ──
export function KanbanScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const dirRef = useRef<-1 | 0 | 1>(0);
  const rafRef = useRef<number | null>(null);
  const [hint, setHint] = useState<-1 | 0 | 1>(0);

  const loop = () => {
    const el = ref.current;
    if (el && dirRef.current !== 0) {
      el.scrollLeft += dirRef.current * 16;
      rafRef.current = requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
    }
  };
  const setDir = (d: -1 | 0 | 1) => {
    if (d === dirRef.current) return;
    dirRef.current = d;
    setHint(d);
    if (d !== 0 && rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
  };
  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const band = 72;
    const canL = el.scrollLeft > 2;
    const canR = el.scrollLeft < el.scrollWidth - el.clientWidth - 2;
    if (x < band && canL) setDir(-1);
    else if (x > r.width - band && canR) setDir(1);
    else setDir(0);
  };
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  const flecha = (dir: "left" | "right") => (
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/75 text-[var(--brand-600)] shadow-lg ring-1 ring-[var(--brand)]/30 backdrop-blur">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7" aria-hidden>
        {dir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </span>
  );

  return (
    <div className="relative -mx-1 min-h-0 flex-1 px-1 pb-2">
      <div
        ref={ref}
        onMouseMove={(e) => onMove(e.clientX)}
        onDragOver={(e) => onMove(e.clientX)}
        onMouseLeave={() => setDir(0)}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDir(0); }}
        onDrop={() => setDir(0)}
        className="h-full overflow-x-auto"
      >
        {children}
      </div>
      <div className={`pointer-events-none absolute inset-y-0 left-0 flex w-16 items-center justify-start pl-1 transition-opacity duration-150 ${hint === -1 ? "opacity-100" : "opacity-0"}`}>{flecha("left")}</div>
      <div className={`pointer-events-none absolute inset-y-0 right-0 flex w-16 items-center justify-end pr-1 transition-opacity duration-150 ${hint === 1 ? "opacity-100" : "opacity-0"}`}>{flecha("right")}</div>
    </div>
  );
}
