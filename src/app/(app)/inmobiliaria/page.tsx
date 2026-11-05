"use client";

/**
 * /inmobiliaria — Propiedades (receta 130). Tarjetas con foto, estado, gestión, ubicación, m² y precios;
 * filtros por estado (pestañas con cantidades), gestión, tipo y ciudad, y búsqueda (título, código,
 * dirección, catastro, finca, manzana, lote, dueño). Tocar una abre su ficha en el panel lateral.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AvisosInteresados } from "@/modules/inmobiliaria/AvisosInteresados";
import { Building2, FileWarning, ImageOff, MapPin, Plus, Ruler, Search, Tags, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT_FILTRO, Pestanas } from "@/modules/inventario/ui";
import { FormPropiedad } from "@/modules/inmobiliaria/FormPropiedad";
import { TiposPropiedad } from "@/modules/inmobiliaria/TiposPropiedad";
import {
  DOCUMENTACION, ESTADOS, GESTIONES, nombreDe,
  type EstadoPropiedad, type ListaPropiedades, type PropiedadFila, type TipoPropiedad,
} from "@/modules/inmobiliaria/tipos";

const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const m2 = (n: number | null | undefined) => (n ? `${Number(n).toLocaleString("es-PY", { maximumFractionDigits: 2 })} m²` : null);

const CHIP_ESTADO: Record<EstadoPropiedad, string> = {
  disponible: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  reservada: "bg-amber-50 text-amber-800 ring-amber-200",
  vendida: "bg-slate-100 text-slate-600 ring-slate-200",
  alquilada: "bg-sky-50 text-sky-800 ring-sky-200",
  retirada: "bg-slate-100 text-slate-500 ring-slate-200",
};

function Chip({ clase, children }: { clase: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${clase}`}>{children}</span>;
}

function Tarjeta({ p, onAbrir }: { p: PropiedadFila; onAbrir: () => void }) {
  const sup = [m2(p.superficie_terreno) && `Terreno ${m2(p.superficie_terreno)}`, m2(p.superficie_construida) && `Construido ${m2(p.superficie_construida)}`].filter(Boolean).join(" · ");
  const ubic = [p.barrio, p.ciudad].filter(Boolean).join(", ");
  return (
    <li>
      <button type="button" onClick={onAbrir} className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[var(--brand)] hover:shadow-md">
        <div className="relative aspect-[16/9] bg-slate-100">
          {p.imagen_url
            ? <img src={p.imagen_url} alt="" className="h-full w-full object-cover" loading="lazy" />
            : <span className="grid h-full place-items-center text-slate-300"><ImageOff className="h-7 w-7" aria-hidden /></span>}
          <span className="absolute left-3 top-3 flex flex-wrap gap-1">
            <Chip clase={CHIP_ESTADO[p.estado]}>{nombreDe(ESTADOS, p.estado)}</Chip>
            <Chip clase="bg-white/90 text-slate-700 ring-slate-200">{nombreDe(GESTIONES, p.gestion)}</Chip>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-slate-400">{p.codigo}{p.tipo ? ` · ${p.tipo}` : ""}</p>
            <h2 className="line-clamp-2 text-[15px] font-semibold text-slate-900">{p.titulo}</h2>
          </div>
          {ubic || p.direccion ? (
            <p className="flex items-start gap-1.5 text-xs text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0">{[p.direccion, ubic].filter(Boolean).join(" — ")}</span></p>
          ) : null}
          {sup ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><Ruler className="h-3.5 w-3.5 shrink-0" aria-hidden />{sup}</p> : null}
          {!p.propia && p.propietario ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />Dueño: {p.propietario}</p> : null}
          {p.documentacion !== "al_dia" ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700"><FileWarning className="h-3.5 w-3.5 shrink-0" aria-hidden />Documentación: {nombreDe(DOCUMENTACION, p.documentacion).toLowerCase()}</p>
          ) : null}
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
            {p.gestion !== "alquiler" ? (
              <span><span className="block text-[11px] text-slate-500">Venta</span><span className="block text-sm font-semibold tabular-nums text-slate-900">{gs(p.precio_venta)}</span></span>
            ) : null}
            {p.gestion !== "venta" ? (
              <span className={p.gestion === "alquiler" ? "" : "text-right"}><span className="block text-[11px] text-slate-500">Alquiler</span><span className="block text-sm font-semibold tabular-nums text-slate-900">{gs(p.precio_alquiler)}<span className="text-xs font-normal text-slate-500">/mes</span></span></span>
            ) : null}
          </div>
        </div>
      </button>
    </li>
  );
}

export default function PaginaPropiedades() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-slate-400">Cargando…</div>}>
      <Propiedades />
    </Suspense>
  );
}

function Propiedades() {
  const puedeEditar = usePermiso("editar_productos");
  // Receta 140: la campanita trae /inmobiliaria?propiedad=<id> → abre esa ficha.
  const params = useSearchParams();
  const router = useRouter();
  const propiedadUrl = params.get("propiedad");
  const [verAvisos, setVerAvisos] = useState(0);
  const [lista, setLista] = useState<ListaPropiedades | null>(null);
  const [tipos, setTipos] = useState<TipoPropiedad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [qListo, setQListo] = useState("");
  const [estado, setEstado] = useState("");
  const [gestion, setGestion] = useState("");
  const [tipo, setTipo] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [abierta, setAbierta] = useState<string | null | undefined>(undefined); // undefined = cerrado, null = nueva
  const [editarTipos, setEditarTipos] = useState(false);

  useEffect(() => { const h = setTimeout(() => setQListo(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  useEffect(() => { if (propiedadUrl) setAbierta(propiedadUrl); }, [propiedadUrl]);
  const cerrarFicha = () => {
    setAbierta(undefined);
    setVerAvisos((v) => v + 1);
    if (propiedadUrl) router.replace("/inmobiliaria", { scroll: false });
  };

  const cargar = useCallback(async () => {
    const p = new URLSearchParams();
    if (qListo) p.set("q", qListo);
    if (estado) p.set("estado", estado);
    if (gestion) p.set("gestion", gestion);
    if (tipo) p.set("tipo_id", tipo);
    if (ciudad) p.set("ciudad", ciudad);
    p.set("limite", "120");
    try {
      setLista(await apiFetch<ListaPropiedades>(`/api/inmobiliaria/propiedades?${p}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [qListo, estado, gestion, tipo, ciudad]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { apiFetch<TipoPropiedad[]>("/api/inmobiliaria/tipos").then(setTipos).catch(() => setTipos([])); }, []);

  const pestanas = useMemo(() => {
    const pe = lista?.por_estado ?? {};
    const total = Object.values(pe).reduce((a, n) => a + (n ?? 0), 0);
    return [{ id: "", label: "Todas", badge: total }, ...ESTADOS.map(([id, label]) => ({ id, label, badge: pe[id] ?? 0 }))];
  }, [lista]);
  const filtrando = !!(qListo || gestion || tipo || ciudad);

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        volver={{ href: "/inmobiliaria/panel", label: "Inmobiliaria" }}
        titulo="Propiedades"
        subtitulo="Las casas, lotes, departamentos y locales que vendés o alquilás, propios o de un dueño. Tocá una para ver o editar su ficha."
        acciones={puedeEditar ? (
          <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
            <button type="button" onClick={() => setEditarTipos(true)} className={BOTON_SECUNDARIO}><Tags className="h-4 w-4" /> Tipos</button>
            <button type="button" onClick={() => setAbierta(null)} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}><Plus className="h-4 w-4" /> Nueva propiedad</button>
          </div>
        ) : null}
      />

      <AvisosInteresados onAbrir={(id) => setAbierta(id)} recargar={verAvisos} />

      <Pestanas opciones={pestanas} valor={estado} onChange={setEstado} />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, dirección, catastro, lote, dueño…" aria-label="Buscar propiedades" className={`${INPUT_FILTRO} w-full pl-9 max-sm:h-11`} />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
          <Select chip prefijo="Gestión" textoVacio="Todas" value={gestion} onChange={setGestion} options={[["", "Todas las gestiones"], ...GESTIONES]} etiqueta="Gestión" />
          <Select chip prefijo="Tipo" textoVacio="Todos" value={tipo} onChange={setTipo} options={[["", "Todos los tipos"], ...tipos.map((t) => [t.id, t.nombre] as [string, string])]} etiqueta="Tipo de propiedad" />
          <Select chip prefijo="Ciudad" textoVacio="Todas" value={ciudad} onChange={setCiudad} options={[["", "Todas las ciudades"], ...(lista?.ciudades ?? []).map((c) => [c, c] as [string, string])]} etiqueta="Ciudad" />
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!lista && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : null}
      {lista ? (
        lista.items.length ? (
          <>
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {lista.items.map((p) => <Tarjeta key={p.id} p={p} onAbrir={() => setAbierta(p.id)} />)}
            </ul>
            {lista.total > lista.items.length ? <p className="text-center text-xs text-slate-500">Se muestran {lista.items.length} de {lista.total}: usá la búsqueda o los filtros para encontrar el resto.</p> : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Building2 className="h-6 w-6" /></span>
            <p className="text-sm font-semibold text-slate-800">{filtrando || estado ? "No hay propiedades con esos filtros" : "Todavía no hay propiedades"}</p>
            <p className="max-w-sm text-sm text-slate-500">{filtrando || estado ? "Probá con otra búsqueda o sacá algún filtro." : "Cargá la primera: dónde está, cuánto mide, sus datos de catastro y si es para vender o alquilar."}</p>
            {puedeEditar && !filtrando && !estado ? <button type="button" onClick={() => setAbierta(null)} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}><Plus className="h-4 w-4" /> Nueva propiedad</button> : null}
          </div>
        )
      ) : null}

      {abierta !== undefined ? (
        <FormPropiedad
          key={abierta ?? "nueva"}
          id={abierta}
          tipos={tipos}
          puedeEditar={puedeEditar}
          onCerrar={cerrarFicha}
          onGuardada={(p, cerrar) => { void cargar(); setVerAvisos((v) => v + 1); if (abierta === null) setAbierta(p.id); else if (cerrar) cerrarFicha(); }}
        />
      ) : null}
      {editarTipos ? <TiposPropiedad tipos={tipos} onCerrar={() => setEditarTipos(false)} onGuardados={(t) => { setTipos(t); setEditarTipos(false); void cargar(); }} /> : null}
    </div>
  );
}
