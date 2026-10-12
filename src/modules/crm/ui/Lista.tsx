"use client";

/**
 * Vista Lista del CRM (tabla, estilo módulo Clientes). Pagina en el servidor con cursor
 * (GET /api/crm), con los mismos filtros del tablero + filtro de etapa. Los cambios hechos
 * desde el tablero/detalle llegan como `parches` (sin volver a pedir la página).
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
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
        className={`shrink-0 transition-colors ${ok ? "text-emerald-600" : "text-slate-400 hover:text-[var(--brand-600)]"}`}>
        {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const Fila = memo(function Fila({ p, etapas, onAbrir, onMover, onTransformar }: {
  p: Tarjeta; etapas: Etapa[]; onAbrir: (id: string) => void; onMover: (t: Tarjeta, etapa: string) => void; onTransformar: (t: Tarjeta) => void;
}) {
  const tono = tonoEtapa(etapas.find((e) => e.codigo === p.etapa)?.color);
  return (
    <tr onClick={() => onAbrir(p.id)} className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50/70">
      <td className="px-4 py-2.5">
        <div className="max-w-[14rem] truncate font-semibold text-slate-900">{p.contacto || p.empresa || "—"}</div>
        <div className="font-mono text-[11px] text-slate-400">{p.numero_control}{p.empresa && p.contacto ? ` · ${p.empresa}` : ""}</div>
      </td>
      <td className="px-4 py-2.5"><TelefonoCelda telefono={p.telefono} /></td>
      <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-600">{p.servicio || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{gsCompleto(p.valor_estimado)}</td>
      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex min-w-[9rem] items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${tono.dot}`} />
          <select value={p.etapa} onChange={(e) => onMover(p, e.target.value)} aria-label="Cambiar etapa del prospecto"
            className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20">
            {etapas.map((e) => <option key={e.codigo} value={e.codigo}>{e.nombre}</option>)}
          </select>
        </div>
      </td>
      <td className="px-4 py-2.5">
        {p.responsable_nombre ? (
          <div className="flex items-center gap-1.5">
            <AvatarIni nombre={p.responsable_nombre} />
            <span className="max-w-[8rem] truncate text-[11px] text-slate-600">{p.responsable_nombre}</span>
          </div>
        ) : <span className="text-[11px] italic text-slate-400">Sin responsable</span>}
      </td>
      <td className="px-4 py-2.5 text-[11px] tabular-nums text-slate-500">{diaMes(p.created_at)}</td>
      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        {p.cliente_id ? (
          <a href={`/clientes/${p.cliente_id}`} className="text-[11px] font-semibold text-emerald-600 hover:underline">Cliente creado</a>
        ) : (
          <button type="button" onClick={() => onTransformar(p)} title="Crear el cliente con estos datos y marcar el lead como Ganado"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--brand)] px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--brand-600)]">
            Transformar a cliente
          </button>
        )}
      </td>
    </tr>
  );
});

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

  const visibles = filas.filter((f) => !eliminados.has(f.id)).map((f) => (parches[f.id] ? { ...f, ...parches[f.id] } : f));
  const total = etapa ? (conteos[etapa] ?? 0) : Object.values(conteos).reduce((s, n) => s + n, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-3">
          <span>Mostrando <strong className="text-slate-700">{visibles.length.toLocaleString("es-PY")}</strong> de {total.toLocaleString("es-PY")}</span>
          <label className="flex items-center gap-1.5">
            <span>Etapa:</span>
            <Select value={etapa} onChange={setEtapa} minWidth={150} options={[["", "Todas"], ...etapas.map((e) => [e.codigo, e.nombre] as [string, string])]} />
          </label>
        </div>
        <label className="flex items-center gap-1.5">
          <span>Registros por página:</span>
          <Select value={porPagina} onChange={setPorPagina} minWidth={80} options={PAGINAS} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">Servicio</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : error ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-rose-600">{error}</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">Sin prospectos</td></tr>
            ) : (
              visibles.map((p) => <Fila key={p.id} p={p} etapas={etapas} onAbrir={onAbrir} onMover={onMover} onTransformar={onTransformar} />)
            )}
          </tbody>
        </table>
        {!cargando && hayMas ? (
          <div className="border-t border-slate-100 p-3 text-center">
            <button type="button" onClick={cargarMas} disabled={cargandoMas}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--brand)] disabled:opacity-60">
              {cargandoMas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Cargar más
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
