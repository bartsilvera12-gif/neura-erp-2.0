"use client";

/**
 * Configuración › Mesas y QR › Estaciones de cocina (receta 70). ADMIN + "Configuración del sistema".
 *   · ABM de estaciones (nombre, ícono, color, orden, activa). Eliminar solo si nunca tuvo
 *     comandas; si no, desactivarla.
 *   · Qué va a cada una: se asigna por categoría (Inventario › Categorías) con excepción por
 *     producto (Inventario › producto). Lo que no tiene estación va a "Cocina general".
 *   · Enlace de la pantalla de cada estación (/caja/cocina?estacion=<id>) para el equipo de la estación.
 *   · Estación fija por usuario: entra directo a esa pantalla y no la puede cambiar.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Loader2, Pencil, Trash2, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { ColorPicker } from "@/components/ColorPicker";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { olvidarEstaciones } from "@/modules/mesas/useEstaciones";
import { nombreEstacion, type Estacion } from "@/modules/mesas/tipos";

const COLOR = clienteConfig.color;
const URL_CONFIG = "/api/mesas/estaciones/config";
const ICONOS = ["🔥", "🍕", "🍺", "🍔", "🍟", "🥗", "🍳", "🥩", "🍣", "🍝", "🍰", "☕", "🍹", "🍷", "🥤", "🍦"];

type EstacionConfig = Estacion & { categorias: string[]; productos: number; usada: boolean };
type UsuarioCocina = { id: string; nombre: string; perfil: string | null; estacion_id: string | null };
type Config = { estaciones: EstacionConfig[]; usuarios: UsuarioCocina[] };

export function EstacionesConfig({ nueva, onNuevaCerrada }: { nueva: boolean; onNuevaCerrada: () => void }) {
  const [datos, setDatos] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      setDatos(await apiFetch<Config>(URL_CONFIG));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  const refrescar = () => { olvidarEstaciones(); void cargar(); };

  const [editar, setEditar] = useState<EstacionConfig | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [guardandoUsuario, setGuardandoUsuario] = useState<string | null>(null);
  const estaciones = datos?.estaciones ?? [];
  const linkPantalla = (id: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/caja/cocina?estacion=${id}`;

  async function copiar(id: string) {
    try { await navigator.clipboard.writeText(linkPantalla(id)); setCopiado(id); setTimeout(() => setCopiado(null), 1500); } catch { /* sin portapapeles */ }
  }

  async function fijarUsuario(u: UsuarioCocina, estacionId: string) {
    setGuardandoUsuario(u.id);
    setAviso(null);
    try {
      await apiFetch("/api/mesas/estaciones/usuario", { method: "POST", body: JSON.stringify({ usuario_id: u.id, estacion_id: estacionId || null }) });
      setDatos((d) => d && { ...d, usuarios: d.usuarios.map((x) => (x.id === u.id ? { ...x, estacion_id: estacionId || null } : x)) });
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setGuardandoUsuario(null);
    }
  }

  const opcionesUsuario: [string, string][] = [["", "Elige en la pantalla"], ...estaciones.filter((e) => e.activa).map((e): [string, string] => [e.id, nombreEstacion(e)])];

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Al aceptar un pedido, se divide en una <strong className="font-semibold text-slate-700">comanda por estación</strong> y cada estación ve solo su parte.
        Qué va a cada una se elige en <Link href="/inventario/categorias" className="font-semibold text-[var(--brand)] hover:underline">Inventario › Categorías</Link> (y,
        como excepción, en cada producto). Lo que no tiene estación va a <strong className="font-semibold text-slate-700">Cocina general</strong>.
      </p>
      {aviso ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{aviso}</p> : null}
      {error && !datos ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {!datos ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {estaciones.map((e) => (
            <li key={e.id} className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm ${e.activa ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ backgroundColor: `${e.color ?? "#94a3b8"}22`, boxShadow: `inset 0 0 0 1.5px ${e.color ?? "#94a3b8"}55` }}>
                  {e.icono ?? <span className="h-3 w-3 rounded-full" style={{ backgroundColor: e.color ?? "#94a3b8" }} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{e.nombre}</p>
                  <p className="text-xs text-slate-500">
                    Orden {e.orden}{!e.activa ? <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactiva</span> : null}
                  </p>
                </div>
                <button type="button" onClick={() => setEditar(e)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`Editar ${e.nombre}`}><Pencil className="h-4 w-4" /></button>
              </div>
              <p className="mt-3 text-xs text-slate-600">
                {e.categorias.length ? <>Categorías: <span className="font-medium text-slate-800">{e.categorias.join(", ")}</span></> : <span className="text-slate-400">Sin categorías asignadas</span>}
                {e.productos ? <span className="text-slate-500"> · {e.productos} producto{e.productos === 1 ? "" : "s"} como excepción</span> : null}
              </p>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                <a href={`/caja/cocina?estacion=${e.id}`} target="_blank" rel="noopener noreferrer" className={`${BOTON_SECUNDARIO} min-h-11 flex-1 no-underline lg:min-h-0`}>
                  <ExternalLink className="h-4 w-4" aria-hidden /> Abrir pantalla
                </a>
                <button type="button" onClick={() => void copiar(e.id)} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`} title="Copiar el enlace de la pantalla de esta estación">
                  <Copy className="h-4 w-4" aria-hidden /> {copiado === e.id ? "Copiado" : "Enlace"}
                </button>
              </div>
            </li>
          ))}
          <li className="flex flex-col rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
            <p className="text-base font-semibold text-slate-700">Cocina general</p>
            <p className="mt-1 text-xs text-slate-500">Los productos sin estación (ni en su categoría ni en el producto). Se ven en la pantalla de cocina con el filtro “General”.</p>
            <div className="mt-auto pt-3">
              <a href="/caja/cocina?estacion=general" target="_blank" rel="noopener noreferrer" className={`${BOTON_SECUNDARIO} min-h-11 w-full no-underline lg:min-h-0`}>
                <ExternalLink className="h-4 w-4" aria-hidden /> Abrir pantalla
              </a>
            </div>
          </li>
        </ul>
      )}

      {datos ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-800">Estación fija por usuario</h2>
            <p className="text-xs text-slate-500">Quien tiene una estación fija entra directo a esa pantalla y no la puede cambiar (ni marcar comandas de otra estación).</p>
          </div>
          {datos.usuarios.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-slate-400">Ningún usuario tiene el permiso “Pantalla de cocina”. Se da en Configuración › Usuarios.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {datos.usuarios.map((u) => (
                <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{u.nombre}</p>
                    {u.perfil ? <p className="truncate text-xs text-slate-500">{u.perfil}</p> : null}
                  </div>
                  <div className="flex items-center gap-2 sm:w-64">
                    {guardandoUsuario === u.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" /> : null}
                    <Select block chico etiqueta={`Estación de ${u.nombre}`} value={u.estacion_id ?? ""} onChange={(v) => void fijarUsuario(u, v)}
                      disabled={guardandoUsuario === u.id}
                      options={u.estacion_id && !opcionesUsuario.some(([id]) => id === u.estacion_id)
                        ? [...opcionesUsuario, [u.estacion_id, `${nombreEstacion(estaciones.find((e) => e.id === u.estacion_id) ?? { icono: null, nombre: "Estación" })} (inactiva)`]]
                        : opcionesUsuario} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
        <strong className="font-semibold text-slate-700">Impresora de comandas (80 mm):</strong> en la pantalla de cada estación está “Imprimir al llegar”.
        Para que imprima sin preguntar, abrí el navegador de esa estación en modo kiosco, por ejemplo <code className="rounded bg-white px-1 py-0.5 text-[11px]">chrome --kiosk --kiosk-printing &lt;enlace de la pantalla&gt;</code>, con la térmica como impresora predeterminada.
      </p>

      {editar || nueva ? (
        <EditarEstacion
          estacion={editar}
          ordenSugerido={Math.max(0, ...estaciones.map((e) => e.orden)) + 1}
          onClose={() => { setEditar(null); onNuevaCerrada(); }}
          onGuardada={() => { setEditar(null); onNuevaCerrada(); refrescar(); }}
        />
      ) : null}
    </div>
  );
}

function EditarEstacion({ estacion, ordenSugerido, onClose, onGuardada }: {
  estacion: EstacionConfig | null; ordenSugerido: number; onClose: () => void; onGuardada: () => void;
}) {
  const [f, setF] = useState({
    nombre: estacion?.nombre ?? "",
    icono: estacion?.icono ?? "",
    color: estacion?.color ?? "#3b82f6",
    orden: String(estacion?.orden ?? ordenSugerido),
    activa: estacion?.activa ?? true,
  });
  const [busy, setBusy] = useState<"" | "guardar" | "eliminar">("");
  const [error, setError] = useState<string | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !f.nombre.trim()) return;
    setBusy("guardar");
    setError(null);
    try {
      await apiFetch("/api/mesas/estaciones", {
        method: "POST",
        body: JSON.stringify({ id: estacion?.id ?? null, nombre: f.nombre.trim(), icono: f.icono || null, color: f.color || null, orden: Number(f.orden) || 0, activa: f.activa }),
      });
      onGuardada();
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }
  async function eliminar() {
    if (!estacion || busy) return;
    setBusy("eliminar");
    setError(null);
    try {
      await apiFetch(`/api/mesas/estaciones/${estacion.id}`, { method: "DELETE" });
      onGuardada();
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
      setConfirmarBorrar(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <form onSubmit={guardar} className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{estacion ? `Editar ${estacion.nombre}` : "Nueva estación"}</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={!!busy} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className={ET}>Nombre *</span>
            <input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={40} placeholder="Ej.: Plancha, Pizzería, Barra" className={INPUT} />
          </label>
          <div>
            <span className={ET}>Ícono <span className="font-normal text-slate-400">(opcional)</span></span>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
              <button type="button" onClick={() => setF({ ...f, icono: "" })} aria-pressed={!f.icono}
                className={`grid h-11 place-items-center rounded-lg border text-[11px] font-semibold text-slate-500 ${!f.icono ? "border-[var(--brand)] bg-[var(--brand-50)]" : "border-slate-200"}`}>Sin</button>
              {ICONOS.map((i) => (
                <button key={i} type="button" onClick={() => setF({ ...f, icono: i })} aria-pressed={f.icono === i} aria-label={`Ícono ${i}`}
                  className={`grid h-11 place-items-center rounded-lg border text-xl transition ${f.icono === i ? "border-[var(--brand)] bg-[var(--brand-50)]" : "border-slate-200 hover:bg-slate-50"}`}>{i}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <div>
              <span className={ET}>Color</span>
              <ColorPicker value={f.color} onChange={(c) => setF({ ...f, color: c })} block />
            </div>
            <label className="block">
              <span className={ET}>Orden</span>
              <input value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" className={INPUT} />
            </label>
          </div>
          <button type="button" role="switch" aria-checked={f.activa} onClick={() => setF({ ...f, activa: !f.activa })}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">Activa</span>
              <span className="block text-[11px] text-slate-400">Inactiva: sus productos van a Cocina general en los pedidos nuevos.</span>
            </span>
            <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: f.activa ? COLOR : "#cbd5e1" }}>
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: f.activa ? 18 : 2 }} />
            </span>
          </button>
          {estacion ? (
            estacion.usada ? (
              <p className="text-xs text-slate-500">Ya tuvo comandas: no se puede eliminar (desactivala si no se usa más).</p>
            ) : confirmarBorrar ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                <p>¿Eliminar {estacion.nombre}? Sus categorías y productos quedan sin estación.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmarBorrar(false)} className={`${BOTON_SECUNDARIO} flex-1`}>No</button>
                  <button type="button" onClick={() => void eliminar()} disabled={!!busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white">
                    {busy === "eliminar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmarBorrar(true)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-rose-600 lg:min-h-0">
                <Trash2 className="h-4 w-4" aria-hidden /> Eliminar estación
              </button>
            )
          ) : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={!!busy} className={`${BOTON_SECUNDARIO} flex-1`}>Cancelar</button>
          <button type="submit" disabled={!!busy || !f.nombre.trim()} className={`${BOTON_PRIMARIO} flex-1`} style={{ backgroundColor: COLOR }}>
            {busy === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
        </div>
      </form>
    </CapaModal>
  );
}
