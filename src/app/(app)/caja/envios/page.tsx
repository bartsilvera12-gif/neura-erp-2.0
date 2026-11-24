"use client";

/**
 * Envíos (receta 170) — tablero kanban de entregas (rubro Comercio). Columnas = estados
 * configurables; cada tarjeta es un envío que nace de una venta ("Envío a domicilio" en Nueva
 * venta). Se mueve de estado, se le asigna chofer y se editan sus datos. Refresco en vivo (polling).
 * Configuración (estados + choferes) con permiso envios_administrar.
 */
import { useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Truck, Settings2, Loader2, Plus, Pencil, Trash2, PackageOpen } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { useUsuario, tienePermiso } from "@/lib/sesion/ContextoUsuario";
import { Select } from "@/components/Select";
import { ColorPicker } from "@/components/ColorPicker";
import { Cabecera, ModalDocumento, Pestanas, BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { gs } from "@/modules/clientes/ui";
import { useEnviosTablero } from "@/modules/envios/tablero";
import {
  URL_ENVIOS, URL_ENVIOS_ESTADOS, URL_ENVIOS_CHOFERES, URL_ENVIOS_TABLERO,
  type Envio, type EnvioEstado, type EnvioChofer,
} from "@/modules/envios/tipos";

const COBRO: Record<string, { texto: string; clase: string } | undefined> = {
  pendiente: { texto: "Cobra al entregar", clase: "bg-amber-100 text-amber-800" },
  cobrado: { texto: "Cobrado", clase: "bg-emerald-100 text-emerald-700" },
};

export default function EnviosPage() {
  const me = useUsuario();
  const puedeConfig = tienePermiso(me, "envios_administrar");
  const { tablero, error, recargar } = useEnviosTablero();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [editar, setEditar] = useState<Envio | null>(null);

  const porEstado = useMemo(() => {
    const m = new Map<string, Envio[]>();
    for (const e of tablero?.envios ?? []) {
      const l = m.get(e.estado_id) ?? [];
      l.push(e);
      m.set(e.estado_id, l);
    }
    return m;
  }, [tablero]);

  const choferOpts: [string, string][] = [["", "Sin chofer"], ...(tablero?.choferes ?? []).map((c) => [c.id, c.nombre] as [string, string])];
  const estadoOpts: [string, string][] = (tablero?.estados ?? []).map((e) => [e.id, e.nombre]);

  async function accion(fn: () => Promise<unknown>, id: string) {
    setOcupado(id);
    setAviso(null);
    try {
      await fn();
      invalidar(URL_ENVIOS_TABLERO);
      await recargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const mover = (env: Envio, estado_id: string) =>
    estado_id !== env.estado_id && accion(() => apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "mover", id: env.id, estado_id }) }), env.id);
  const asignar = (env: Envio, chofer_id: string) =>
    accion(() => apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "asignar", id: env.id, chofer_id: chofer_id || null }) }), env.id);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <Cabecera kicker="Caja · Entregas" titulo="Envíos" subtitulo="Seguí cada entrega y asigná choferes" volver={{ href: "/caja/panel", label: "Caja" }}>
        {puedeConfig ? (
          <button type="button" onClick={() => setConfig(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>
            <Settings2 className="h-4 w-4" /> Configurar
          </button>
        ) : null}
      </Cabecera>

      {aviso ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p> : null}
      {error ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

      {!tablero ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {tablero.estados.map((est) => {
            const lista = porEstado.get(est.id) ?? [];
            return (
              <section key={est.id} className="flex w-[300px] shrink-0 flex-col rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70">
                <header className="flex items-center gap-2 px-3 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: est.color ?? "#94a3b8" }} />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{est.nombre}</h2>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">{lista.length}</span>
                </header>
                <ul className="flex-1 space-y-2 px-2 pb-3">
                  {lista.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">Sin envíos</li>
                  ) : lista.map((env) => (
                    <TarjetaEnvio key={env.id} env={env} estados={tablero.estados} estadoOpts={estadoOpts} choferOpts={choferOpts}
                      ocupado={ocupado === env.id} onMover={(e) => mover(env, e)} onAsignar={(c) => asignar(env, c)} onEditar={() => setEditar(env)} />
                  ))}
                </ul>
              </section>
            );
          })}
          {tablero.estados.length === 0 ? (
            <div className="flex w-full flex-col items-center gap-2 py-20 text-center text-sm text-slate-500">
              <PackageOpen className="h-8 w-8 text-slate-300" />
              No hay estados configurados.
            </div>
          ) : null}
        </div>
      )}

      {editar ? <ModalEditarEnvio env={editar} onClose={() => setEditar(null)} onGuardado={async () => { setEditar(null); invalidar(URL_ENVIOS_TABLERO); await recargar(); }} /> : null}
      {config ? <ConfigEnvios onClose={() => { setConfig(false); invalidar(URL_ENVIOS_TABLERO); void recargar(); }} /> : null}
    </div>
  );
}

function TarjetaEnvio({ env, estados, estadoOpts, choferOpts, ocupado, onMover, onAsignar, onEditar }: {
  env: Envio; estados: EnvioEstado[]; estadoOpts: [string, string][]; choferOpts: [string, string][];
  ocupado: boolean; onMover: (estadoId: string) => void; onAsignar: (choferId: string) => void; onEditar: () => void;
}) {
  const cobro = COBRO[env.cobro_estado];
  return (
    <li className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition ${ocupado ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{env.cliente_nombre || "Consumidor final"}</p>
          {env.numero ? <p className="text-[11px] text-slate-400">#{env.numero}</p> : null}
        </div>
        <button type="button" onClick={onEditar} aria-label="Editar envío" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {env.direccion ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="min-w-0">{env.direccion}{env.referencia ? <span className="text-slate-400"> · {env.referencia}</span> : null}</span></p>
      ) : <p className="mt-1.5 text-xs text-amber-600">Sin dirección</p>}
      {env.telefono ? <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />{env.telefono}</p> : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums text-slate-900">{gs(env.total)}</span>
        {cobro ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cobro.clase}`}>{cobro.texto}</span> : null}
      </div>
      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <Select value={env.chofer_id ?? ""} onChange={onAsignar} options={choferOpts} chico block etiqueta="Chofer" />
        </div>
        <Select value={env.estado_id} onChange={onMover} options={estadoOpts} chico block etiqueta="Mover a estado" />
      </div>
    </li>
  );
}

function ModalEditarEnvio({ env, onClose, onGuardado }: { env: Envio; onClose: () => void; onGuardado: () => void }) {
  const [direccion, setDireccion] = useState(env.direccion ?? "");
  const [referencia, setReferencia] = useState(env.referencia ?? "");
  const [telefono, setTelefono] = useState(env.telefono ?? "");
  const [notas, setNotas] = useState(env.notas ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(URL_ENVIOS, { method: "POST", body: JSON.stringify({ accion: "editar", id: env.id, direccion, referencia, telefono, notas }) });
      onGuardado();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo="Datos del envío" subtitulo={env.cliente_nombre ?? undefined} ancho="max-w-md" onClose={busy ? undefined : onClose}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
        </button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Dirección</span><input value={direccion} onChange={(e) => setDireccion(e.target.value)} maxLength={300} className={INPUT} /></label>
        <label className="block"><span className={ET}>Referencia <span className="font-normal text-slate-400">(entre calles, color de casa…)</span></span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={200} className={INPUT} /></label>
        <label className="block"><span className={ET}>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} className={INPUT} /></label>
        <label className="block"><span className={ET}>Notas</span><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} className={`${INPUT} resize-none`} /></label>
      </div>
    </ModalDocumento>
  );
}

// ─────────────────────────────── Configuración ───────────────────────────────
function ConfigEnvios({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"estados" | "choferes">("estados");
  return (
    <ModalDocumento titulo="Configurar envíos" ancho="max-w-2xl" onClose={onClose}
      footer={<button type="button" onClick={onClose} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Listo</button>}>
      <div className="mb-3">
        <Pestanas valor={tab} onChange={(v) => setTab(v as "estados" | "choferes")} opciones={[{ id: "estados", label: "Estados" }, { id: "choferes", label: "Choferes" }]} />
      </div>
      {tab === "estados" ? <ConfigEstados /> : <ConfigChoferes />}
    </ModalDocumento>
  );
}

function ConfigEstados() {
  const [estados, setEstados] = useState<EnvioEstado[] | null>(null);
  const [edit, setEdit] = useState<EnvioEstado | "nuevo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    try { setEstados((await apiFetch<{ estados: EnvioEstado[] }>(URL_ENVIOS_ESTADOS)).estados); }
    catch (e) { setError((e as Error).message); }
  };
  useMountEffect(cargar);
  const ordenSugerido = Math.max(0, ...(estados ?? []).map((e) => e.orden)) + 1;

  return (
    <div className="space-y-2">
      {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      <p className="text-[11px] text-slate-500">Las columnas del tablero. El estado inicial es donde cae cada venta; los finales marcan la hora de entrega.</p>
      {estados === null ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-slate-400" /> : estados.map((e) => (
        <button key={e.id} type="button" onClick={() => setEdit(e)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-slate-300">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: e.color ?? "#94a3b8" }} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{e.nombre}</span>
          {e.es_inicial ? <Etiqueta tono="sky">Inicial</Etiqueta> : null}
          {e.es_final ? <Etiqueta tono="emerald">Final</Etiqueta> : null}
          {!e.activo ? <Etiqueta tono="slate">Inactivo</Etiqueta> : null}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      ))}
      <button type="button" onClick={() => setEdit("nuevo")} className={`${BOTON_SECUNDARIO} w-full`}><Plus className="h-4 w-4" /> Nuevo estado</button>
      {edit ? <EditarEstado estado={edit === "nuevo" ? null : edit} ordenSugerido={ordenSugerido} onClose={() => setEdit(null)} onGuardado={() => { setEdit(null); void cargar(); }} /> : null}
    </div>
  );
}

function EditarEstado({ estado, ordenSugerido, onClose, onGuardado }: { estado: EnvioEstado | null; ordenSugerido: number; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(estado?.nombre ?? "");
  const [color, setColor] = useState(estado?.color ?? "#64748b");
  const [orden, setOrden] = useState(String(estado?.orden ?? ordenSugerido));
  const [esInicial, setEsInicial] = useState(estado?.es_inicial ?? false);
  const [esFinal, setEsFinal] = useState(estado?.es_final ?? false);
  const [activo, setActivo] = useState(estado?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true); setError(null);
    try {
      await apiFetch(URL_ENVIOS_ESTADOS, { method: "POST", body: JSON.stringify({ id: estado?.id, nombre, color, orden: Number(orden) || 0, es_inicial: esInicial, es_final: esFinal, activo }) });
      onGuardado();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function eliminar() {
    setBusy(true); setError(null);
    try { await apiFetch(`${URL_ENVIOS_ESTADOS}?id=${estado!.id}`, { method: "DELETE" }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo={estado ? "Editar estado" : "Nuevo estado"} ancho="max-w-md" z="z-[130]" onClose={busy ? undefined : onClose}
      footer={<>
        {estado && !estado.usado ? <button type="button" onClick={() => void eliminar()} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button> : null}
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy || !nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} className={INPUT} placeholder="Ej. En camino" /></label>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <label className="block"><span className={ET}>Color</span><ColorPicker value={color} onChange={setColor} block /></label>
          <label className="block"><span className={ET}>Orden</span><input inputMode="numeric" value={orden} onChange={(e) => setOrden(e.target.value.replace(/\D/g, ""))} className={`${INPUT} text-right tabular-nums`} /></label>
        </div>
        <Toggle on={esInicial} onChange={(v) => { setEsInicial(v); if (v) setEsFinal(false); }} texto="Estado inicial" detalle="Donde cae cada venta nueva (solo uno)." />
        <Toggle on={esFinal} onChange={(v) => { setEsFinal(v); if (v) setEsInicial(false); }} texto="Estado final" detalle="Marca la hora de entrega (ej. Entregado, Cancelado)." />
        <Toggle on={activo} onChange={setActivo} texto="Activo" detalle="Los inactivos no aparecen como columna." />
      </div>
    </ModalDocumento>
  );
}

function ConfigChoferes() {
  const [choferes, setChoferes] = useState<EnvioChofer[] | null>(null);
  const [edit, setEdit] = useState<EnvioChofer | "nuevo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = async () => {
    try { setChoferes((await apiFetch<{ choferes: EnvioChofer[] }>(URL_ENVIOS_CHOFERES)).choferes); }
    catch (e) { setError((e as Error).message); }
  };
  useMountEffect(cargar);

  return (
    <div className="space-y-2">
      {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      {choferes === null ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-slate-400" /> : choferes.map((c) => (
        <button key={c.id} type="button" onClick={() => setEdit(c)} className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-slate-300">
          <Truck className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate"><span className="text-sm font-medium text-slate-800">{c.nombre}</span>{c.telefono ? <span className="ml-2 text-xs text-slate-400">{c.telefono}</span> : null}</span>
          {!c.activo ? <Etiqueta tono="slate">Inactivo</Etiqueta> : null}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      ))}
      <button type="button" onClick={() => setEdit("nuevo")} className={`${BOTON_SECUNDARIO} w-full`}><Plus className="h-4 w-4" /> Nuevo chofer</button>
      {edit ? <EditarChofer chofer={edit === "nuevo" ? null : edit} onClose={() => setEdit(null)} onGuardado={() => { setEdit(null); void cargar(); }} /> : null}
    </div>
  );
}

function EditarChofer({ chofer, onClose, onGuardado }: { chofer: EnvioChofer | null; onClose: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(chofer?.nombre ?? "");
  const [telefono, setTelefono] = useState(chofer?.telefono ?? "");
  const [documento, setDocumento] = useState(chofer?.documento ?? "");
  const [activo, setActivo] = useState(chofer?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true); setError(null);
    try { await apiFetch(URL_ENVIOS_CHOFERES, { method: "POST", body: JSON.stringify({ id: chofer?.id, nombre, telefono, documento, activo }) }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function eliminar() {
    setBusy(true); setError(null);
    try { await apiFetch(`${URL_ENVIOS_CHOFERES}?id=${chofer!.id}`, { method: "DELETE" }); onGuardado(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <ModalDocumento titulo={chofer ? "Editar chofer" : "Nuevo chofer"} ancho="max-w-md" z="z-[130]" onClose={busy ? undefined : onClose}
      footer={<>
        {chofer && !chofer.usado ? <button type="button" onClick={() => void eliminar()} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button> : null}
        <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" onClick={() => void guardar()} disabled={busy || !nombre.trim()} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} className={INPUT} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ET}>Teléfono</span><input value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} className={INPUT} /></label>
          <label className="block"><span className={ET}>CI / Documento</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={40} className={INPUT} /></label>
        </div>
        <Toggle on={activo} onChange={setActivo} texto="Activo" detalle="Los inactivos no se pueden asignar." />
      </div>
    </ModalDocumento>
  );
}

// ─────────────────────────────── Helpers UI ───────────────────────────────
function Etiqueta({ tono, children }: { tono: "sky" | "emerald" | "slate"; children: React.ReactNode }) {
  const c = { sky: "bg-sky-100 text-sky-700", emerald: "bg-emerald-100 text-emerald-700", slate: "bg-slate-100 text-slate-500" }[tono];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c}`}>{children}</span>;
}

function Toggle({ on, onChange, texto, detalle }: { on: boolean; onChange: (v: boolean) => void; texto: string; detalle?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{texto}</span>
        {detalle ? <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{detalle}</span> : null}
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-[var(--brand)]" : "bg-slate-300"}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

// Carga al montar (una vez).
function useMountEffect(fn: () => void) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fn(); }, []);
}
