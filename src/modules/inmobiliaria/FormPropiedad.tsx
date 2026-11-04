"use client";

/**
 * Ficha de una propiedad (receta 130), en panel lateral: alta y edición.
 * Bloques: la propiedad (título, tipo, gestión y precios), ubicación (ciudad y barrio de Paraguay,
 * dirección), superficie, catastro (cuenta catastral, finca, manzana, lote), documentación, dueño
 * (propia o de un cliente con su comisión), foto y notas. Con la ficha abierta se cambia el estado.
 */
import { useEffect, useState, type ReactNode } from "react";
import { HandCoins, ImagePlus, Loader2, X } from "lucide-react";
import { Drawer } from "@/components/Drawer";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { CamposCiudadBarrio } from "@/modules/geo/CamposCiudadBarrio";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { subirImagenProducto } from "@/modules/caja/upload-imagen";
import { VenderPropiedad } from "@/modules/inmobiliaria/VenderPropiedad";
import { AvisosInteresados } from "@/modules/inmobiliaria/AvisosInteresados";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import {
  DOCUMENTACION, ESTADOS, GESTIONES, nombreDe,
  type Documentacion, type EstadoPropiedad, type Gestion, type Propiedad, type TipoIvaPropiedad, type TipoPropiedad,
} from "@/modules/inmobiliaria/tipos";

type Form = {
  titulo: string; descripcion: string; imagen_url: string | null; tipo_id: string; gestion: Gestion;
  ciudad: string; barrio: string; direccion: string; superficie_terreno: string; superficie_construida: string;
  cuenta_catastral: string; finca: string; manzana: string; lote: string;
  documentacion: Documentacion; documentacion_nota: string;
  precio_venta: number; precio_alquiler: number; tipo_iva: TipoIvaPropiedad;
  propia: boolean; propietario_id: string | null; propietario: string | null;
  comision_venta_pct: string; comision_alquiler_pct: string; notas: string;
};

const VACIO: Form = {
  titulo: "", descripcion: "", imagen_url: null, tipo_id: "", gestion: "venta",
  ciudad: "", barrio: "", direccion: "", superficie_terreno: "", superficie_construida: "",
  cuenta_catastral: "", finca: "", manzana: "", lote: "", documentacion: "al_dia", documentacion_nota: "",
  precio_venta: 0, precio_alquiler: 0, tipo_iva: "5%", propia: true, propietario_id: null, propietario: null,
  comision_venta_pct: "", comision_alquiler_pct: "", notas: "",
};

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function deFicha(p: Propiedad): Form {
  return {
    titulo: p.titulo, descripcion: txt(p.descripcion), imagen_url: p.imagen_url, tipo_id: txt(p.tipo_id), gestion: p.gestion,
    ciudad: txt(p.ciudad), barrio: txt(p.barrio), direccion: txt(p.direccion),
    superficie_terreno: txt(p.superficie_terreno), superficie_construida: txt(p.superficie_construida),
    cuenta_catastral: txt(p.cuenta_catastral), finca: txt(p.finca), manzana: txt(p.manzana), lote: txt(p.lote),
    documentacion: p.documentacion, documentacion_nota: txt(p.documentacion_nota),
    precio_venta: Number(p.precio_venta) || 0, precio_alquiler: Number(p.precio_alquiler) || 0, tipo_iva: p.tipo_iva,
    propia: p.propia, propietario_id: p.propietario_id, propietario: p.propietario,
    comision_venta_pct: txt(p.comision_venta_pct), comision_alquiler_pct: txt(p.comision_alquiler_pct), notas: txt(p.notas),
  };
}

/** "1.234,5" o "1234.5" → número; vacío → null. */
function numero(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
}

function Campo({ label, children, ancho }: { label: string; children: ReactNode; ancho?: boolean }) {
  return <label className={`block min-w-0 ${ancho ? "sm:col-span-2" : ""}`}><span className={ET}>{label}</span>{children}</label>;
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{titulo}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Monto({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">Gs.</span>
      <input inputMode="numeric" className={`${INPUT} pl-10 text-right tabular-nums`} value={valor ? valor.toLocaleString("es-PY") : ""} placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
    </div>
  );
}

export function FormPropiedad({ id, tipos, puedeEditar, onCerrar, onGuardada }: {
  /** null = propiedad nueva */
  id: string | null;
  tipos: TipoPropiedad[];
  puedeEditar: boolean;
  onCerrar: () => void;
  /** `cerrar`: se guardó la ficha (no solo el estado). */
  onGuardada: (p: Propiedad, cerrar: boolean) => void;
}) {
  const [f, setF] = useState<Form>(VACIO);
  const [ficha, setFicha] = useState<Propiedad | null>(null);
  const [cargando, setCargando] = useState(!!id);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Receta 140: avisos a los clientes con una búsqueda que esta propiedad cumple. Se releen cada vez
  // que la ficha cambia (al guardar, al vender): los avisos nuevos se crean al confirmar el guardado.
  const [verAvisos, setVerAvisos] = useState(0);
  useEffect(() => { setVerAvisos((v) => v + 1); }, [ficha]);

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    apiFetch<Propiedad>(`/api/inmobiliaria/propiedades/${id}`)
      .then((p) => { if (vivo) { setFicha(p); setF(deFicha(p)); } })
      .catch((e: Error) => { if (vivo) setError(e.message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setError(null); };
  const [vendiendo, setVendiendo] = useState(false);
  const sePuedeVender = !!ficha && ficha.gestion !== "alquiler" && (ficha.estado === "disponible" || ficha.estado === "reservada");
  const venta = f.gestion !== "alquiler";
  const alquiler = f.gestion !== "venta";
  const soloVer = !puedeEditar;

  async function foto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    try { set("imagen_url", await subirImagenProducto(file)); } catch (err) { setError((err as Error).message); } finally { setSubiendo(false); }
  }

  async function guardar() {
    const nums = { superficie_terreno: numero(f.superficie_terreno), superficie_construida: numero(f.superficie_construida),
      comision_venta_pct: numero(f.comision_venta_pct), comision_alquiler_pct: numero(f.comision_alquiler_pct) };
    if (Object.values(nums).some((n) => Number.isNaN(n))) { setError("Revisá los números: superficie y comisión van sin letras."); return; }
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = {
        titulo: f.titulo, descripcion: f.descripcion || null, imagen_url: f.imagen_url, tipo_id: f.tipo_id || null, gestion: f.gestion,
        ciudad: f.ciudad || null, barrio: f.barrio || null, direccion: f.direccion || null,
        cuenta_catastral: f.cuenta_catastral || null, finca: f.finca || null, manzana: f.manzana || null, lote: f.lote || null,
        documentacion: f.documentacion, documentacion_nota: f.documentacion_nota || null,
        precio_venta: venta ? f.precio_venta : 0, precio_alquiler: alquiler ? f.precio_alquiler : null, tipo_iva: f.tipo_iva,
        propia: f.propia, propietario_id: f.propia ? null : f.propietario_id, notas: f.notas || null,
        ...nums,
      };
      const p = await apiFetch<Propiedad>(id ? `/api/inmobiliaria/propiedades/${id}` : "/api/inmobiliaria/propiedades",
        { method: id ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
      onGuardada(p, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(estado: EstadoPropiedad) {
    if (!id) return;
    setGuardando(true);
    try {
      const p = await apiFetch<Propiedad>(`/api/inmobiliaria/propiedades/${id}`, { method: "PATCH", body: JSON.stringify({ estado }) });
      setFicha(p);
      onGuardada(p, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const opcionesTipo: [string, string][] = [["", "Sin tipo"], ...tipos.filter((t) => t.activo || t.id === f.tipo_id).map((t) => [t.id, t.nombre] as [string, string])];

  return (
    <Drawer
      titulo={id ? (ficha ? ficha.titulo : "Propiedad") : "Nueva propiedad"}
      subtitulo={ficha ? `${ficha.codigo} · ${nombreDe(ESTADOS, ficha.estado)}` : "Se guarda como producto sin stock: se puede vender y presupuestar."}
      onClose={onCerrar}
      footer={soloVer ? (
        <button type="button" onClick={onCerrar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Cerrar</button>
      ) : (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {ficha ? (
            <div className="flex gap-2">
              <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                <Select value={ficha.estado} onChange={(v) => void cambiarEstado(v as EstadoPropiedad)} options={ESTADOS} etiqueta="Estado de la propiedad" disabled={guardando} block />
              </div>
              {sePuedeVender ? (
                <button type="button" onClick={() => setVendiendo(true)} disabled={guardando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                  <HandCoins className="h-4 w-4" /> Vender
                </button>
              ) : null}
            </div>
          ) : <span />}
          <div className="flex gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
            <button type="button" onClick={onCerrar} disabled={guardando} className={BOTON_SECUNDARIO}>Cancelar</button>
            <button type="button" onClick={() => void guardar()} disabled={guardando || cargando || subiendo} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
            </button>
          </div>
        </div>
      )}
    >
      {cargando ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : (
        <div className="space-y-6">
        {/* Fuera del fieldset: quien solo puede ver la ficha también avisa a los interesados. */}
        {id ? <AvisosInteresados propiedadId={id} recargar={verAvisos} /> : null}
        <fieldset disabled={soloVer} className="space-y-6">
          {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}


          <Bloque titulo="La propiedad">
            <Campo label="Título" ancho>
              <input className={INPUT} value={f.titulo} maxLength={160} placeholder="Ej: Casa de 3 dormitorios en Luque" onChange={(e) => set("titulo", e.target.value)} />
            </Campo>
            <Campo label="Tipo"><Select value={f.tipo_id} onChange={(v) => set("tipo_id", v)} options={opcionesTipo} etiqueta="Tipo de propiedad" block /></Campo>
            <Campo label="Gestión"><Select value={f.gestion} onChange={(v) => set("gestion", v as Gestion)} options={GESTIONES} etiqueta="Gestión" block /></Campo>
            {venta ? <Campo label="Precio de venta"><Monto valor={f.precio_venta} onChange={(n) => set("precio_venta", n)} /></Campo> : null}
            {alquiler ? <Campo label="Alquiler por mes"><Monto valor={f.precio_alquiler} onChange={(n) => set("precio_alquiler", n)} /></Campo> : null}
            <Campo label="IVA">
              <Select value={f.tipo_iva} onChange={(v) => set("tipo_iva", v as TipoIvaPropiedad)} etiqueta="IVA" block
                options={[["5%", "5 % (inmuebles)"], ["10%", "10 %"], ["EXENTA", "Exenta"]]} />
            </Campo>
          </Bloque>

          <Bloque titulo="Ubicación">
            <CamposCiudadBarrio ciudad={f.ciudad} barrio={f.barrio} onCiudad={(v) => set("ciudad", v)} onBarrio={(v) => set("barrio", v)} claseInput={INPUT}
              Campo={({ label, children }) => <Campo label={label}>{children}</Campo>} />
            <Campo label="Dirección" ancho>
              <input className={INPUT} value={f.direccion} maxLength={240} placeholder="Calle, número y referencias" onChange={(e) => set("direccion", e.target.value)} />
            </Campo>
          </Bloque>

          <Bloque titulo="Superficie">
            <Campo label="Terreno (m²)"><input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={f.superficie_terreno} placeholder="0" onChange={(e) => set("superficie_terreno", e.target.value)} /></Campo>
            <Campo label="Construcción (m²)"><input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={f.superficie_construida} placeholder="0" onChange={(e) => set("superficie_construida", e.target.value)} /></Campo>
          </Bloque>

          <Bloque titulo="Catastro">
            <Campo label="Cuenta catastral"><input className={INPUT} value={f.cuenta_catastral} maxLength={60} placeholder="Ej: 27-1234-05" onChange={(e) => set("cuenta_catastral", e.target.value)} /></Campo>
            <Campo label="Finca / matrícula"><input className={INPUT} value={f.finca} maxLength={60} onChange={(e) => set("finca", e.target.value)} /></Campo>
            <Campo label="Manzana"><input className={INPUT} value={f.manzana} maxLength={30} onChange={(e) => set("manzana", e.target.value)} /></Campo>
            <Campo label="Lote"><input className={INPUT} value={f.lote} maxLength={30} onChange={(e) => set("lote", e.target.value)} /></Campo>
          </Bloque>

          <Bloque titulo="Documentación">
            <Campo label="Estado"><Select value={f.documentacion} onChange={(v) => set("documentacion", v as Documentacion)} options={DOCUMENTACION} etiqueta="Estado de la documentación" block /></Campo>
            <Campo label="Qué falta o qué se observó">
              <input className={INPUT} value={f.documentacion_nota} maxLength={500} placeholder={f.documentacion === "al_dia" ? "Opcional" : "Ej: falta la mensura"} onChange={(e) => set("documentacion_nota", e.target.value)} />
            </Campo>
          </Bloque>

          <Bloque titulo="Dueño">
            <div className="sm:col-span-2">
              <div role="radiogroup" aria-label="Dueño" className="grid grid-cols-2 gap-2">
                {[[true, "Propia"], [false, "De un dueño"]].map(([v, l]) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={f.propia === v} onClick={() => set("propia", v as boolean)}
                    className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition ${f.propia === v ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-slate-900 ring-2 ring-[var(--brand-100)]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {l as string}
                  </button>
                ))}
              </div>
            </div>
            {!f.propia ? (
              <>
                <div className="sm:col-span-2">
                  <span className={ET}>Dueño (cliente)</span>
                  {f.propietario_id ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-medium text-slate-800">{f.propietario}</span>
                      <button type="button" aria-label="Cambiar dueño" onClick={() => { set("propietario_id", null); set("propietario", null); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <BuscadorCliente variant="toolbar" onSelect={(c) => { set("propietario_id", c.id); set("propietario", c.nombre); }} />
                  )}
                </div>
                {venta ? <Campo label="Comisión por la venta (%)"><input inputMode="decimal" className={`${INPUT} text-right`} value={f.comision_venta_pct} placeholder="Ej: 5" onChange={(e) => set("comision_venta_pct", e.target.value)} /></Campo> : null}
                {alquiler ? <Campo label="Comisión del alquiler (%)"><input inputMode="decimal" className={`${INPUT} text-right`} value={f.comision_alquiler_pct} placeholder="Ej: 8" onChange={(e) => set("comision_alquiler_pct", e.target.value)} /></Campo> : null}
              </>
            ) : null}
          </Bloque>

          <Bloque titulo="Foto y descripción">
            <div className="sm:col-span-2 flex items-center gap-3">
              <label className="relative grid h-24 w-32 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-[var(--brand)]">
                {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : f.imagen_url ? <img src={f.imagen_url} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void foto(e)} aria-label="Foto de la propiedad" />
              </label>
              <div className="text-xs text-slate-500">
                <p>JPG, PNG o WEBP de hasta 5 MB.</p>
                {f.imagen_url ? <button type="button" onClick={() => set("imagen_url", null)} className="mt-1 min-h-9 text-rose-600 hover:underline">Quitar la foto</button> : null}
              </div>
            </div>
            <Campo label="Descripción" ancho>
              <textarea className={`${INPUT} min-h-24`} value={f.descripcion} maxLength={4000} placeholder="Dormitorios, baños, cochera, patio, servicios…" onChange={(e) => set("descripcion", e.target.value)} />
            </Campo>
            <Campo label="Notas internas" ancho>
              <textarea className={`${INPUT} min-h-20`} value={f.notas} maxLength={2000} placeholder="Solo las ve la inmobiliaria" onChange={(e) => set("notas", e.target.value)} />
            </Campo>
          </Bloque>
        </fieldset>
        </div>
      )}
      {vendiendo && ficha ? (
        <VenderPropiedad propiedad={ficha} onCerrar={() => setVendiendo(false)}
          onVendida={() => { void apiFetch<Propiedad>(`/api/inmobiliaria/propiedades/${ficha.id}`).then((p) => { setFicha(p); onGuardada(p, false); }); }} />
      ) : null}
    </Drawer>
  );
}
