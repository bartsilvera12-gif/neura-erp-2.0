"use client";

/**
 * Kanban del CRM (look del sistema actual): columnas por etapa con cantidad + total en Gs,
 * tarjetas con drag & drop nativo HTML5 y "Cargar más" por columna.
 *
 * Rendimiento: tarjetas y columnas van memoizadas y todos los handlers que reciben son
 * estables (los arma CrmClient con useCallback + refs). Mover una tarjeta re-renderiza solo
 * las dos columnas involucradas; el resto ni se entera. Arrastrar solo cambia el resaltado
 * de la columna de destino.
 *
 * Táctil / celular: el drag nativo no anda con el dedo → la tarjeta no es arrastrable y
 * ofrece "Mover a…" (el selector de etapa, a 44 px) y los atajos Ganado / Perdido siempre
 * visibles. En celular las columnas ocupan casi todo el ancho y se pasa de una a otra con
 * scroll horizontal con imán (snap), dejando ver el borde de la siguiente.
 */
import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Check, ChevronDown, Clock, Loader2, Phone, X } from "lucide-react";
import { MenuAcciones } from "@/components/MenuAcciones";
import { Select } from "@/components/Select";
import {
  ORIGEN_LABEL, diaMes, fechaSimple, gsCompleto, gsCorto, telefonoLindo, tonoEtapa,
  type Columna as ColumnaT, type Etapa, type Tarjeta,
} from "@/modules/crm/tipos";
import { useEsTactil } from "@/lib/ui/responsive";
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
  const tactil = useEsTactil();
  const etapa = etapas.find((e) => e.codigo === t.etapa);
  const tono = tonoEtapa(etapa?.color);
  const abierta = !!etapa && !etapa.es_ganado && !etapa.es_perdido;
  const tel = (t.telefono ?? "").trim();
  const telDigitos = tel.replace(/[^\d+]/g, "");

  return (
    <div
      draggable={!tactil}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
        acciones.onDragStart(t);
      }}
      onDragEnd={acciones.onDragEnd}
      onClick={() => acciones.onAbrir(t.id)}
      className={`group flex shrink-0 select-none flex-col rounded-2xl border border-l-4 border-slate-200 bg-white p-2.5 shadow-sm transition-all [contain-intrinsic-size:auto_210px] [content-visibility:auto] [@media(pointer:coarse)]:[contain-intrinsic-size:auto_340px] ${tactil ? "cursor-pointer active:bg-slate-50" : "cursor-grab hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing"} ${tono.borderLeft}`}
    >
      {/* Compacta: cada dato en una sola línea y sin cajas de más. Las filas tienen alto fijo (con
          un texto gris si están vacías): así todas las tarjetas miden lo mismo, en cualquier columna. */}
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tono.dot}`} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-slate-900 max-md:text-sm" title={t.empresa || t.contacto}>{t.empresa || t.contacto}</p>
        <span className="shrink-0 text-[10px] text-slate-400">{diaMes(t.created_at)}</span>
      </div>

      <p className="mt-0.5 h-4 truncate text-[11px] leading-4" title={t.servicio || undefined}>
        <span className="font-mono text-[10px] text-slate-400">{t.numero_control}</span>
        <span className="text-slate-300"> · </span>
        <span className={t.servicio ? "text-slate-500" : "italic text-slate-300"}>{t.servicio || "Sin plan"}</span>
      </p>

      <div className="mt-1.5 flex h-5 items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold tabular-nums text-slate-900">{gsCompleto(t.valor_estimado)}</span>
        {t.origen_creacion && t.origen_creacion !== "manual" ? (
          <span className={`inline-flex min-w-0 shrink items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
            t.origen_creacion === "whatsapp" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"
          }`}>
            <span aria-hidden className={`h-1 w-1 shrink-0 rounded-full ${t.origen_creacion === "whatsapp" ? "bg-emerald-500" : "bg-slate-400"}`} />
            <span className="truncate">{ORIGEN_LABEL[t.origen_creacion] ?? t.origen_creacion}</span>
          </span>
        ) : null}
      </div>

      {/* Contacto y teléfono en una sola fila: tocarla copia el número. */}
      {tel ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copiar(telDigitos || tel);
            setCopiado(true);
            window.setTimeout(() => setCopiado(false), 1500);
          }}
          title={copiado ? "Copiado" : `${t.empresa && t.contacto ? `${t.contacto} · ` : ""}Hacé click para copiar el número`}
          className={`mt-1.5 flex h-7 w-full items-center gap-1.5 rounded-lg border px-2 text-left text-[11px] transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[13px] ${
            copiado ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[var(--brand)]/30 bg-[var(--brand)]/[0.08] text-[var(--brand-600)] hover:border-[var(--brand)]/50"
          }`}
        >
          {copiado ? <Check className="h-3 w-3 shrink-0 text-emerald-600" /> : <Phone className="h-3 w-3 shrink-0 text-[var(--brand)]" />}
          <span className="shrink-0 font-mono font-medium tabular-nums">{telefonoLindo(tel)}</span>
          {t.empresa && t.contacto ? <span className="min-w-0 flex-1 truncate text-right text-slate-500">{t.contacto}</span> : null}
        </button>
      ) : (
        <div className="mt-1.5 flex h-7 w-full items-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-2 text-[11px] text-slate-300 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[13px]">
          <Phone className="h-3 w-3 shrink-0" aria-hidden />
          <span className="shrink-0 italic">Sin teléfono</span>
          {t.empresa && t.contacto ? <span className="min-w-0 flex-1 truncate text-right text-slate-500">{t.contacto}</span> : null}
        </div>
      )}

      <div
        className={`mt-1.5 flex h-4 items-center gap-1.5 ${t.proxima_accion || t.fecha_proxima_accion ? (t.accion_vencida && abierta ? "text-rose-700" : "text-amber-700") : "text-slate-300"}`}
        title={[t.proxima_accion, t.fecha_proxima_accion ? fechaSimple(t.fecha_proxima_accion) : ""].filter(Boolean).join(" · ") || undefined}
      >
        <Clock className="h-3 w-3 shrink-0" aria-hidden />
        {t.proxima_accion || t.fecha_proxima_accion ? (
          // La fecha nunca se corta: si no entra, se acorta el texto de la acción.
          <p className="flex min-w-0 flex-1 items-center justify-between gap-2 text-[10px] leading-tight">
            <span className="min-w-0 truncate">{t.proxima_accion}</span>
            {t.fecha_proxima_accion ? (
              <span className="shrink-0 font-semibold">{t.accion_vencida && abierta ? "Venció " : ""}{fechaSimple(t.fecha_proxima_accion)}</span>
            ) : null}
          </p>
        ) : <p className="truncate text-[10px] italic leading-tight">Sin próxima acción</p>}
      </div>

      <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5">
        {t.responsable_nombre ? (
          <>
            <AvatarIni nombre={t.responsable_nombre} />
            <span className="truncate text-[10px] text-slate-600">{t.responsable_nombre}</span>
          </>
        ) : (
          <span className="text-[10px] italic text-slate-300">Sin responsable</span>
        )}
      </div>

      {tactil ? (
        <>
          {/* Táctil: "Mover a…" abre la lista de etapas (hoja inferior en celular). */}
          <div className="mt-2" draggable={false} onPointerDown={parar} onMouseDown={parar} onClick={parar}>
            <MenuAcciones
              etiqueta="Mover a…"
              items={etapas
                .filter((e) => e.codigo !== t.etapa)
                .map((e) => ({
                  etiqueta: e.nombre,
                  icono: <span className={`h-2.5 w-2.5 rounded-full ${tonoEtapa(e.color).dot}`} />,
                  onClick: () => acciones.onMover(t, e.codigo),
                  tono: e.es_ganado ? ("exito" as const) : e.es_perdido ? ("peligro" as const) : undefined,
                }))}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm font-medium text-slate-700"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate">Mover a…</span>
              </span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
                <span className="truncate">{etapa?.nombre ?? t.etapa}</span>
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              </span>
            </MenuAcciones>
          </div>
          {abierta && ganado && perdido ? (
            <div className="mt-2 flex h-11 gap-1">
              <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onMover(t, ganado); }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-200 px-2 text-xs font-semibold text-emerald-700">
                <Check className="h-3 w-3" /> Ganado
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onMover(t, perdido); }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-rose-200 px-2 text-xs font-semibold text-rose-700">
                <X className="h-3 w-3" /> Perdido
              </button>
            </div>
          ) : null}
        </>
      ) : (
        // Escritorio: etapa y atajos en una sola fila; el select no arrastra la tarjeta ni abre el detalle.
        <div
          className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2"
          draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onPointerDown={parar}
          onMouseDown={parar}
          onClick={parar}
        >
          <div className="min-w-0 flex-1">
            <Select chico block etiqueta="Mover a etapa" value={t.etapa} onChange={(v) => acciones.onMover(t, v)}
              options={etapas.map((e): [string, string] => [e.codigo, e.nombre])} />
          </div>
          {abierta && ganado && perdido ? (
            <>
              <button type="button" onClick={() => acciones.onMover(t, ganado)} title="Marcar como ganado" aria-label="Marcar como ganado"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 text-emerald-700 transition-colors hover:bg-emerald-50">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => acciones.onMover(t, perdido)} title="Marcar como perdido" aria-label="Marcar como perdido"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 text-rose-700 transition-colors hover:bg-rose-50">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Acción final anclada abajo */}
      <div className="mt-auto pt-1.5">
      {t.cliente_id ? (
        <Link href={`/clientes/${t.cliente_id}`} onClick={parar} draggable={false}
          className="flex h-7 w-full items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/80 px-2 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-xs">
          <Check className="h-3 w-3" /> Cliente creado · ver ficha
        </Link>
      ) : (
        <button type="button" onClick={(e) => { e.stopPropagation(); acciones.onTransformar(t); }}
          title="Crear el cliente con estos datos y marcar el lead como Ganado"
          className="flex h-7 w-full items-center justify-center gap-1 rounded-lg bg-[var(--brand)] px-2 text-[10px] font-semibold text-white transition-colors hover:bg-[var(--brand-600)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-xs">
          <Check className="h-3 w-3" /> Transformar a cliente
        </button>
      )}
      </div>
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
  const tactil = useEsTactil();
  return (
    <div
      className={`flex w-60 min-w-60 snap-start flex-col rounded-2xl border bg-white/60 backdrop-blur-sm transition-all duration-150 max-md:w-[calc(100vw-3.5rem)] max-md:min-w-[calc(100vw-3.5rem)] max-md:max-w-80 ${
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

      <div className="flex max-h-[calc(100dvh-17rem)] min-h-16 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2 md:max-h-[calc(100dvh-260px)]">
        {col.tarjetas.length === 0 ? (
          <div className={`flex h-16 items-center justify-center rounded-xl border-2 border-dashed text-[11px] transition-colors ${
            resaltada ? "border-[var(--brand)]/60 bg-[var(--brand)]/5 text-[var(--brand-600)]" : "border-slate-200 text-slate-300"
          }`}>
            {tactil ? "Sin prospectos" : "Soltá tarjetas aquí"}
          </div>
        ) : (
          col.tarjetas.map((t) => (
            <ProspectoCard key={t.id} t={t} etapas={etapas} ganado={ganado} perdido={perdido} acciones={acciones} />
          ))
        )}
        {faltan > 0 ? (
          <button type="button" onClick={() => onCargarMas(col.codigo)} disabled={cargandoMas}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-xs">
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
        className="h-full snap-x overflow-x-auto overscroll-x-contain max-md:snap-mandatory max-md:scroll-px-1 md:snap-none"
      >
        {children}
      </div>
      <div className={`pointer-events-none absolute inset-y-0 left-0 flex w-16 items-center justify-start pl-1 transition-opacity duration-150 ${hint === -1 ? "opacity-100" : "opacity-0"}`}>{flecha("left")}</div>
      <div className={`pointer-events-none absolute inset-y-0 right-0 flex w-16 items-center justify-end pr-1 transition-opacity duration-150 ${hint === 1 ? "opacity-100" : "opacity-0"}`}>{flecha("right")}</div>
    </div>
  );
}
