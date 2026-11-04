"use client";

/**
 * Pestaña "Inmobiliaria" de la ficha del cliente (receta 134): qué busca (con las propiedades
 * disponibles que le sirven), sus propiedades como dueño, las que compró (con lo que debe) y sus
 * contratos de alquiler.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { CamposCiudadBarrio } from "@/modules/geo/CamposCiudadBarrio";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { ESTADOS, nombreDe, type Busqueda, type FichaInmobiliaria, type TipoPropiedad } from "@/modules/inmobiliaria/tipos";

const gs = (n: number | null | undefined) => `Gs. ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;

function Seccion({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{titulo}</h3>
        {accion}
      </div>
      {children}
    </section>
  );
}

function NuevaBusqueda({ clienteId, tipos, onGuardada, onCancelar }: { clienteId: string; tipos: TipoPropiedad[]; onGuardada: () => void; onCancelar: () => void }) {
  const [gestion, setGestion] = useState<"venta" | "alquiler">("venta");
  const [tipo, setTipo] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [barrio, setBarrio] = useState("");
  const [precio, setPrecio] = useState(0);
  const [m2, setM2] = useState("");
  const [notas, setNotas] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    setEnviando(true); setError(null);
    try {
      await apiFetch<Busqueda>("/api/inmobiliaria/busquedas", { method: "POST", body: JSON.stringify({
        cliente_id: clienteId, gestion, tipo_id: tipo || null, ciudad: ciudad.trim() || null, precio_max: precio || null,
        superficie_min: Number(m2.replace(",", ".")) || null, notas: notas.trim() || null, activa: true,
      }) });
      onGuardada();
    } catch (e) { setError((e as Error).message); } finally { setEnviando(false); }
  }
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><span className={ET}>Busca</span><Select block value={gestion} onChange={(v) => setGestion(v as "venta" | "alquiler")} options={[["venta", "Comprar"], ["alquiler", "Alquilar"]]} etiqueta="Qué busca" /></div>
        <div className="min-w-0"><span className={ET}>Tipo</span><Select block value={tipo} onChange={setTipo} options={[["", "Cualquiera"], ...tipos.filter((t) => t.activo).map((t) => [t.id, t.nombre] as [string, string])]} etiqueta="Tipo de propiedad" /></div>
        <CamposCiudadBarrio ciudad={ciudad} barrio={barrio} onCiudad={setCiudad} onBarrio={setBarrio} claseInput={INPUT}
          Campo={({ label, children }) => label === "Ciudad" ? <div className="min-w-0"><span className={ET}>Ciudad</span>{children}</div> : null} />
        <div className="min-w-0"><span className={ET}>{gestion === "venta" ? "Hasta (precio)" : "Hasta (por mes)"}</span>
          <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={precio ? precio.toLocaleString("es-PY") : ""} placeholder="Sin tope" onChange={(e) => setPrecio(Number(e.target.value.replace(/\D/g, "")) || 0)} /></div>
        <div className="min-w-0"><span className={ET}>Terreno mínimo (m²)</span>
          <input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={m2} placeholder="Cualquiera" onChange={(e) => setM2(e.target.value.replace(/[^\d.,]/g, ""))} /></div>
        <div className="min-w-0 sm:col-span-2"><span className={ET}>Notas</span>
          <input className={INPUT} value={notas} maxLength={500} placeholder="Ej: con patio, cerca de la ruta" onChange={(e) => setNotas(e.target.value)} /></div>
      </div>
      <div className="flex gap-2 sm:justify-end max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
        <button type="button" onClick={onCancelar} disabled={enviando} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={enviando} className={`${BOTON_PRIMARIO} bg-[var(--brand)]`}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  );
}

export function TabClienteInmobiliaria({ clienteId }: { clienteId: string }) {
  const [d, setD] = useState<FichaInmobiliaria | null>(null);
  const [tipos, setTipos] = useState<TipoPropiedad[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const cargar = useCallback(() => apiFetch<FichaInmobiliaria>(`/api/inmobiliaria/clientes/${clienteId}`).then(setD).catch((e: Error) => setError(e.message)), [clienteId]);
  useEffect(() => { void cargar(); apiFetch<TipoPropiedad[]>("/api/inmobiliaria/tipos").then(setTipos).catch(() => {}); }, [cargar]);

  async function borrar(id: string) {
    try { await apiFetch(`/api/inmobiliaria/busquedas/${id}`, { method: "DELETE" }); void cargar(); } catch (e) { setError((e as Error).message); }
  }

  if (error && !d) return <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>;
  if (!d) return <div className="h-32 animate-pulse rounded-xl bg-slate-100" />;
  const fila = "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5";
  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <Seccion titulo="Qué busca" accion={!nueva ? <button type="button" onClick={() => setNueva(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}><Plus className="h-4 w-4" /> Agregar</button> : null}>
        {nueva ? <NuevaBusqueda clienteId={clienteId} tipos={tipos} onCancelar={() => setNueva(false)} onGuardada={() => { setNueva(false); void cargar(); }} /> : null}
        {d.busquedas.length ? d.busquedas.map((b) => (
          <div key={b.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                {b.gestion === "venta" ? "Comprar" : "Alquilar"} {b.tipo ? b.tipo.toLowerCase() : "cualquier tipo"}{b.ciudad ? ` en ${b.ciudad}` : ""}
                {b.precio_max ? ` · hasta ${gs(b.precio_max)}${b.gestion === "alquiler" ? "/mes" : ""}` : ""}{b.superficie_min ? ` · desde ${Number(b.superficie_min)} m²` : ""}
              </p>
              <button type="button" aria-label="Borrar la búsqueda" onClick={() => void borrar(b.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 max-sm:h-11 max-sm:w-11"><Trash2 className="h-4 w-4" /></button>
            </div>
            {b.notas ? <p className="mt-1 text-xs text-slate-500">{b.notas}</p> : null}
            <p className="mt-2 text-xs font-semibold text-slate-600">{b.coincidencias.length === 1 ? "1 propiedad disponible que le sirve:" : b.coincidencias.length ? `${b.coincidencias.length} propiedades disponibles que le sirven:` : "Ninguna disponible ahora."}</p>
            {b.coincidencias.length ? (
              <ul className="m-0 mt-1 list-none space-y-1 p-0 text-sm">
                {b.coincidencias.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2"><span className="min-w-0 truncate text-slate-700">{p.codigo} · {p.titulo}</span>
                    <span className="shrink-0 tabular-nums text-slate-900">{b.gestion === "venta" ? gs(p.precio_venta) : `${gs(p.precio_alquiler)}/mes`}</span></li>
                ))}
              </ul>
            ) : null}
          </div>
        )) : !nueva ? <p className="text-sm text-slate-500">No cargaste qué busca. Así te avisa cuando entre una propiedad que le sirve.</p> : null}
      </Seccion>

      {d.compradas.length ? (
        <Seccion titulo="Compró">
          <ul className="m-0 list-none divide-y divide-slate-100 rounded-xl border border-slate-200 p-0 text-sm">
            {d.compradas.map((p) => (
              <li key={p.id} className={fila}>
                <span className="min-w-0"><span className="block font-medium text-slate-800">{p.codigo} · {p.titulo}</span>
                  <span className="block text-xs text-slate-500">{p.venta} · {new Date(p.fecha).toLocaleDateString("es-PY")} · {p.cuotas > 1 ? `${p.cuotas} cuotas` : "contado"}{Number(p.entrega) ? ` · entrega ${gs(p.entrega)}` : ""}</span></span>
                <span className="text-right"><span className="block tabular-nums font-semibold text-slate-900">{gs(p.total)}</span>
                  {Number(p.saldo) ? <span className="block text-xs text-rose-700">Debe {gs(p.saldo)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      ) : null}

      {d.contratos.length ? (
        <Seccion titulo="Alquileres">
          <ul className="m-0 list-none divide-y divide-slate-100 rounded-xl border border-slate-200 p-0 text-sm">
            {d.contratos.map((c) => (
              <li key={c.id} className={fila}>
                <span className="min-w-0"><span className="block font-medium text-slate-800">{c.numero} · {c.propiedad}</span>
                  <span className="block text-xs text-slate-500">{c.inquilino_id === clienteId ? "Es el inquilino" : "Es el dueño"} · {c.estado === "vigente" ? "Vigente" : c.estado === "finalizado" ? "Terminado" : "Rescindido"}</span></span>
                <span className="text-right"><span className="block tabular-nums font-semibold text-slate-900">{gs(c.monto_actual)}/mes</span>
                  {Number(c.deuda) ? <span className="block text-xs text-rose-700">Debe {gs(c.deuda)}</span> : null}</span>
              </li>
            ))}
          </ul>
          <Link href="/inmobiliaria/alquileres" className="text-xs font-medium text-[var(--brand)] hover:underline">Ver en Alquileres</Link>
        </Seccion>
      ) : null}

      {d.como_dueno.length ? (
        <Seccion titulo="Sus propiedades (es el dueño)">
          <ul className="m-0 list-none divide-y divide-slate-100 rounded-xl border border-slate-200 p-0 text-sm">
            {d.como_dueno.map((p) => (
              <li key={p.id} className={fila}>
                <span className="min-w-0"><span className="block font-medium text-slate-800">{p.codigo} · {p.titulo}</span>
                  <span className="block text-xs text-slate-500">{nombreDe(ESTADOS, p.estado)}{p.comision_venta_pct ? ` · comisión venta ${Number(p.comision_venta_pct)} %` : ""}{p.comision_alquiler_pct ? ` · alquiler ${Number(p.comision_alquiler_pct)} %` : ""}</span></span>
                <span className="tabular-nums text-slate-900">{p.gestion !== "alquiler" ? gs(p.precio_venta) : `${gs(p.precio_alquiler)}/mes`}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      ) : null}
    </div>
  );
}
