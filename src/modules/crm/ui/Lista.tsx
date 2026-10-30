"use client";

/**
 * Vista Lista del CRM (tabla, estilo módulo Clientes). Pagina en el servidor con cursor
 * (GET /api/crm), con los mismos filtros del tablero + filtro de etapa. Los cambios hechos
 * desde el tablero/detalle llegan como `parches` (sin volver a pedir la página).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { diaMes, filtrosQuery, gsCompleto, telefonoLindo, tonoEtapa, type Etapa, type Filtros, type Tarjeta } from "@/modules/crm/tipos";
import { AvatarIni } from "./comun";

const PAGINAS: [string, string][] = [["25", "25"], ["50", "50"], ["100", "100"]];

function TelefonoCelda({ telefono }: { telefono: string | null }) {
  const [ok, setOk] = useState(false);
  const raw = (telefono ?? "").trim();
  if (!raw) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="font-mono tabular-nums text-slate-600">{telefonoLindo(raw)}</span>
      <button type="button" title={ok ? "Copiado" : "Copiar número"} aria-label="Copiar número"
        onClick={async () => { try { await navigator.clipboard.writeText(raw); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* ignore */ } }}
        className={`inline-flex shrink-0 items-center justify-center transition-colors [@media(pointer:coarse)]:-my-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${ok ? "text-emerald-600" : "text-slate-400 hover:text-[var(--brand-600)]"}`}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Columnas de la lista: tabla en tablet/escritorio, tarjetas en celular (TablaTarjetas). */
function columnasLista(etapas: Etapa[], onMover: (t: Tarjeta, etapa: string) => void, onTransformar: (t: Tarjeta) => void): ColumnaTabla<Tarjeta>[] {
  return [
    {
      key: "contacto",
      titulo: "Contacto",
      movil: "titulo",
      celda: (p) => (
        <>
          <div className="max-w-[14rem] truncate font-semibold text-slate-900">{p.contacto || p.empresa || "—"}</div>
          <div className="font-mono text-[11px] text-slate-400">{p.numero_control}{p.empresa && p.contacto ? ` · ${p.empresa}` : ""}</div>
        </>
      ),
      celdaMovil: (p) => p.contacto || p.empresa || "—",
    },
    {
      key: "control",
      titulo: "Control",
      movil: "subtitulo",
      claseTh: "hidden",
      claseTd: "hidden",
      celda: (p) => <span className="font-mono text-[12px]">{p.numero_control}{p.empresa && p.contacto ? ` · ${p.empresa}` : ""}</span>,
      celdaMovil: (p) => (p.empresa && p.contacto ? p.empresa : null),
    },
    { key: "valor", titulo: "Valor", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums text-slate-800", celda: (p) => gsCompleto(p.valor_estimado) },
    { key: "tel", titulo: "Teléfono", movil: "dato", celda: (p) => <TelefonoCelda telefono={p.telefono} /> },
    { key: "servicio", titulo: "Servicio", movil: "dato", claseTd: "max-w-[14rem] truncate text-slate-600 max-md:max-w-none max-md:whitespace-normal", celda: (p) => p.servicio || "—" },
    {
      key: "etapa",
      titulo: "Etapa",
      movil: "pie",
      celda: (p) => {
        const tono = tonoEtapa(etapas.find((e) => e.codigo === p.etapa)?.color);
        return (
          <div className="flex min-w-[9rem] flex-1 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${tono.dot}`} />
            <Select
              compacto
              minWidth={150}
              className="w-full"
              etiqueta="Cambiar etapa del prospecto"
              value={p.etapa}
              onChange={(v) => onMover(p, v)}
              options={etapas.map((e): [string, string] => [e.codigo, e.nombre])}
            />
          </div>
        );
      },
    },
    {
      key: "resp",
      titulo: "Responsable",
      movil: "oculto",
      celda: (p) =>
        p.responsable_nombre ? (
          <div className="flex items-center gap-1.5">
            <AvatarIni nombre={p.responsable_nombre} />
            <span className="max-w-[8rem] truncate text-[11px] text-slate-600 max-md:text-[13px]">{p.responsable_nombre}</span>
          </div>
        ) : <span className="text-[11px] italic text-slate-400">Sin responsable</span>,
    },
    { key: "fecha", titulo: "Fecha", movil: "oculto", claseTd: "text-[11px] tabular-nums text-slate-500 max-md:text-[13px]", celda: (p) => diaMes(p.created_at) },
    {
      key: "accion",
      titulo: "Acción",
      movil: "pie",
      claseTh: "text-right",
      claseTd: "text-right",
      celda: (p) => (
        <span className="max-md:flex max-md:flex-1" onClick={(e) => e.stopPropagation()}>
          {p.cliente_id ? (
            <a href={`/clientes/${p.cliente_id}`} className="text-[11px] font-semibold text-emerald-600 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-2 max-md:text-xs">Cliente creado</a>
          ) : (
            <button type="button" onClick={() => onTransformar(p)} title="Crear el cliente con estos datos y marcar el lead como Ganado"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--brand)] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--brand-600)] max-md:px-3 max-md:text-xs">
              Transformar a cliente
            </button>
          )}
        </span>
      ),
    },
  ];
}

export function ProspectoLista({
  filtros, etapas, conteos, parches, eliminados, version, onAbrir, onMover, onTransformar,
}: {
  filtros: Filtros;
  etapas: Etapa[];
  /** cantidad por etapa (del tablero, con los mismos filtros) */
  conteos: Record<string, number>;
  parches: Record<string, Partial<Tarjeta>>;
  eliminados: Set<string>;
  /** sube cuando hay que volver a pedir (alta de prospecto, etapas editadas) */
  version: number;
  onAbrir: (id: string) => void;
  onMover: (t: Tarjeta, etapa: string) => void;
  onTransformar: (t: Tarjeta) => void;
}) {
  const [etapa, setEtapa] = useState("");
  const [porPagina, setPorPagina] = useState("25");
  const [filas, setFilas] = useState<Tarjeta[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const url = useCallback((cursor?: Tarjeta) => {
    const sp = filtrosQuery(filtros);
    if (etapa) sp.set("etapa", etapa);
    sp.set("limite", porPagina);
    if (cursor) { sp.set("cursor_at", cursor.updated_at); sp.set("cursor_id", cursor.id); }
    return `/api/crm?${sp}`;
  }, [filtros, etapa, porPagina]);

  useEffect(() => {
    const mio = ++seq.current;
    setCargando(true);
    setError(null);
    apiFetch<Tarjeta[]>(url())
      .then((r) => { if (mio === seq.current) { setFilas(r); setHayMas(r.length >= Number(porPagina)); } })
      .catch((e) => mio === seq.current && setError((e as Error).message))
      .finally(() => mio === seq.current && setCargando(false));
  }, [url, porPagina, version]);

  async function cargarMas() {
    const ultimo = filas[filas.length - 1];
    if (!ultimo || cargandoMas) return;
    const mio = seq.current;
    setCargandoMas(true);
    try {
      const r = await apiFetch<Tarjeta[]>(url(ultimo));
      if (mio !== seq.current) return;
      setFilas((prev) => {
        const ya = new Set(prev.map((x) => x.id));
        return [...prev, ...r.filter((x) => !ya.has(x.id))];
      });
      setHayMas(r.length >= Number(porPagina));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  }

  const columnas = useMemo(() => columnasLista(etapas, onMover, onTransformar), [etapas, onMover, onTransformar]);
  const visibles = filas.filter((f) => !eliminados.has(f.id)).map((f) => (parches[f.id] ? { ...f, ...parches[f.id] } : f));
  const total = etapa ? (conteos[etapa] ?? 0) : Object.values(conteos).reduce((s, n) => s + n, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>Mostrando <strong className="text-slate-700">{visibles.length.toLocaleString("es-PY")}</strong> de {total.toLocaleString("es-PY")}</span>
          <label className="flex items-center gap-1.5">
            <span>Etapa:</span>
            <Select etiqueta="Etapa" value={etapa} onChange={setEtapa} minWidth={150} options={[["", "Todas"], ...etapas.map((e) => [e.codigo, e.nombre] as [string, string])]} />
          </label>
        </div>
        <label className="flex items-center gap-1.5">
          <span><span className="max-sm:hidden">Registros </span>por página:</span>
          <Select etiqueta="Registros por página" value={porPagina} onChange={setPorPagina} minWidth={80} options={PAGINAS} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {cargando ? (
          <div className="px-4 py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
        ) : error ? (
          <div className="px-4 py-12 text-center text-sm text-rose-600">{error}</div>
        ) : (
          <TablaTarjetas
            filas={visibles}
            claveFila={(p) => p.id}
            onFila={(p) => onAbrir(p.id)}
            columnas={columnas}
            claseTabla="w-full border-collapse text-sm"
            claseThead="bg-slate-50/95"
            thBase="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500"
            tdBase="px-4 py-2.5"
            claseFila={() => "border-t border-slate-100 hover:!bg-slate-50/70"}
            vacio={<div className="px-4 py-12 text-center text-sm text-slate-400">Sin prospectos</div>}
          />
        )}
        {!cargando && hayMas ? (
          <div className="border-t border-slate-100 p-3 text-center">
            <button type="button" onClick={cargarMas} disabled={cargandoMas}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60 max-md:min-h-11">
              {cargandoMas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Cargar más
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
