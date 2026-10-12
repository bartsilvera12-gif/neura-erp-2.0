"use client";

/**
 * Pestaña Archivos: subir (arrastrar y soltar, directo al Storage), filtrar por tipo,
 * ver, descargar y eliminar. Las URLs firmadas llegan todas en una sola llamada; si la
 * pestaña quedó abierta más de 9 minutos, se pide una nueva al hacer clic.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FileArchive, FileSpreadsheet, FileText, Film, Files, ImageIcon, Loader2, Music, Trash2, UploadCloud } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import ZonaArchivos from "@/modules/soporte/detalle/ZonaArchivos";
import { tamanoLegible } from "@/modules/soporte/dominio";
import { CATEGORIAS_ARCHIVO, categoriaArchivo, fechaHoraPY, type Archivo, type CategoriaArchivo } from "@/modules/proyectos/tipos";
import { PANEL, TituloPanel } from "./comun";
import { abrirArchivo, subirArchivos } from "./api";

const VIGENCIA_MS = 9 * 60_000;

function Icono({ cat }: { cat: CategoriaArchivo }) {
  const cls = "h-4 w-4";
  if (cat === "imagen") return <ImageIcon className={cls} />;
  if (cat === "video") return <Film className={cls} />;
  if (cat === "audio") return <Music className={cls} />;
  if (cat === "excel") return <FileSpreadsheet className={cls} />;
  if (cat === "comprimido") return <FileArchive className={cls} />;
  return <FileText className={cls} />;
}

const COLOR: Record<CategoriaArchivo, string> = {
  pdf: "bg-rose-50 text-rose-600",
  imagen: "bg-sky-50 text-sky-600",
  video: "bg-violet-50 text-violet-600",
  audio: "bg-amber-50 text-amber-600",
  excel: "bg-emerald-50 text-emerald-600",
  documento: "bg-blue-50 text-blue-600",
  comprimido: "bg-orange-50 text-orange-600",
  otro: "bg-slate-100 text-slate-500",
};

export function TabArchivos({ proyectoId, puedeEditar }: { proyectoId: string; puedeEditar: boolean }) {
  const [lista, setLista] = useState<Archivo[] | null>(null);
  const [filtro, setFiltro] = useState<CategoriaArchivo | "todos">("todos");
  const [nuevos, setNuevos] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const cargadoEn = useRef(0);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<Archivo[]>(`/api/proyectos/${proyectoId}/archivos`);
      cargadoEn.current = Date.now();
      setLista(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [proyectoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const conCat = useMemo(() => (lista ?? []).map((a) => ({ ...a, cat: categoriaArchivo(a.nombre, a.mime) })), [lista]);
  const conteo = useMemo(() => {
    const m = new Map<CategoriaArchivo, number>();
    for (const a of conCat) m.set(a.cat, (m.get(a.cat) ?? 0) + 1);
    return m;
  }, [conCat]);
  const visibles = filtro === "todos" ? conCat : conCat.filter((a) => a.cat === filtro);

  async function subir() {
    if (!nuevos.length) return;
    setError(null);
    setSubiendo(`Subiendo 0/${nuevos.length}…`);
    const r = await subirArchivos(proyectoId, nuevos, { alAvanzar: (h, n) => setSubiendo(`Subiendo ${h}/${n}…`) });
    if (r.errores.length) setError(r.errores.join(" · "));
    setNuevos([]);
    setSubiendo(null);
    await cargar();
  }

  function abrir(a: Archivo, descargar: boolean) {
    const url = descargar ? a.url_descarga : a.url;
    if (url && Date.now() - cargadoEn.current < VIGENCIA_MS) {
      window.open(url, "_blank", "noopener");
      return;
    }
    void abrirArchivo(proyectoId, a.id, descargar).catch((e) => setError((e as Error).message));
  }

  async function borrar(a: Archivo) {
    setBorrando(a.id);
    try {
      await apiFetch(`/api/proyectos/${proyectoId}/archivos/${a.id}`, { method: "DELETE" });
      setLista((prev) => (prev ?? []).filter((x) => x.id !== a.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBorrando(null);
    }
  }

  return (
    <div className={`space-y-4 ${PANEL}`}>
      <TituloPanel extra={lista ? <span className="text-xs tabular-nums text-slate-500">{lista.length} archivo{lista.length === 1 ? "" : "s"}</span> : null}>Archivos</TituloPanel>

      <div className="space-y-2">
        <ZonaArchivos archivos={nuevos} onCambio={setNuevos} compacta deshabilitada={!!subiendo} />
        {nuevos.length ? (
          <div className="flex items-center justify-end gap-2">
            {subiendo ? <span className="text-xs text-slate-500">{subiendo}</span> : null}
            <button type="button" onClick={() => void subir()} disabled={!!subiendo}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)] disabled:opacity-60">
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Subir {nuevos.length} archivo{nuevos.length === 1 ? "" : "s"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">{error}</div> : null}

      {conCat.length ? (
        <div className="flex flex-wrap gap-1.5">
          {[{ key: "todos" as const, label: "Todos", n: conCat.length }, ...CATEGORIAS_ARCHIVO.filter((c) => conteo.get(c.key)).map((c) => ({ key: c.key, label: c.label, n: conteo.get(c.key) ?? 0 }))].map((c) => (
            <button key={c.key} type="button" onClick={() => setFiltro(c.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${filtro === c.key ? "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--brand-600)]" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
              {c.label} <span className="tabular-nums text-slate-400">{c.n}</span>
            </button>
          ))}
        </div>
      ) : null}

      {lista === null ? (
        error ? null : <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando archivos…</div>
      ) : visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          <Files className="h-6 w-6 text-slate-300" /> Todavía no hay archivos.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {visibles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${COLOR[a.cat]}`}><Icono cat={a.cat} /></span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => abrir(a, false)} className="block max-w-full truncate text-left text-sm font-medium text-slate-800 hover:text-[var(--brand-600)] hover:underline" title={a.nombre}>{a.nombre}</button>
                <p className="mt-0.5 text-[11px] text-slate-500">{tamanoLegible(a.size)} · {a.subido_por_nombre ?? "—"} · {fechaHoraPY(a.created_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => abrir(a, false)} title="Ver" aria-label={`Ver ${a.nombre}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-[var(--brand)]/10 hover:text-[var(--brand-600)]"><Eye className="h-4 w-4" /></button>
                <button type="button" onClick={() => abrir(a, true)} title="Descargar" aria-label={`Descargar ${a.nombre}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-[var(--brand)]/10 hover:text-[var(--brand-600)]"><Download className="h-4 w-4" /></button>
                {puedeEditar ? (
                  <button type="button" onClick={() => void borrar(a)} disabled={borrando === a.id} title="Eliminar" aria-label={`Eliminar ${a.nombre}`} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                    {borrando === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
