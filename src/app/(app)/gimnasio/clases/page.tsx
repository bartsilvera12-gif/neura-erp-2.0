"use client";

/**
 * /gimnasio/clases — Clases del gimnasio (receta 150): nombre, profesor, días y hora, duración,
 * cupo y precio de la clase suelta. Cada semana aparecen solas en la Recepción y en la Agenda.
 * "Precios y reglas": precio de la clase suelta por defecto, IVA y si se frena la entrada con deuda.
 * Crear y cambiar es de gimnasio_administrar; el resto solo mira.
 */
import { useCallback, useEffect, useState } from "react";
import { Clock, Dumbbell, Loader2, Plus, Settings2, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento } from "@/modules/inventario/ui";
import { Interruptor } from "@/modules/facturacion/ui";
import { DIAS, gs, type Clase, type ConfigGim } from "@/modules/gimnasio/tipos";

const diasTexto = (d: number[]) => (d.length === 7 ? "Todos los días" : d.map((n) => DIAS.find((x) => x[0] === n)?.[1]).join(", "));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "")));

function FormClase({ clase, onCerrar, onHecho }: { clase: Clase | null; onCerrar: () => void; onHecho: () => void }) {
  const [nombre, setNombre] = useState(clase?.nombre ?? "");
  const [profe, setProfe] = useState(clase?.profesor_id ?? "");
  const [profes, setProfes] = useState<[string, string][]>([]);
  const [dias, setDias] = useState<number[]>(clase?.dias ?? []);
  const [h, setH] = useState(clase?.hora ?? "18:00");
  const [dur, setDur] = useState(String(clase?.duracion_min ?? 60));
  const [cupo, setCupo] = useState(clase?.cupo ? String(clase.cupo) : "");
  const [precio, setPrecio] = useState(clase?.precio_suelta != null ? String(clase.precio_suelta) : "");
  const [lugar, setLugar] = useState(clase?.ubicacion ?? "");
  const [activa, setActiva] = useState(clase?.activa ?? true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    apiFetch<{ responsables: { id: string; nombre: string | null }[] }>("/api/agenda/options")
      .then((r) => setProfes(r.responsables.map((u) => [u.id, u.nombre ?? "Sin nombre"]))).catch(() => setProfes([]));
  }, []);
  const tocarDia = (n: number) => setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort()));
  async function guardar() {
    setOcupado(true); setError(null);
    try {
      await apiFetch("/api/gimnasio/clases", { method: "POST", body: JSON.stringify({
        id: clase?.id, nombre: nombre.trim(), profesor_id: profe || null, dias, hora: h, duracion_min: Number(dur) || 60,
        cupo: num(cupo), precio_suelta: num(precio), ubicacion: lugar.trim() || null, activa,
      }) });
      onHecho(); onCerrar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <ModalDocumento titulo={clase ? "Cambiar clase" : "Nueva clase"} subtitulo="Se repite cada semana en los días elegidos." ancho="max-w-lg" onClose={onCerrar}
      footer={<>
        <button type="button" onClick={onCerrar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" disabled={ocupado} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11 max-sm:flex-1`}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-3">
        <label className="block"><span className={ET}>Nombre *</span><input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Ej. Natación nivel 1, Karate infantil, Spinning" className={INPUT} /></label>
        <div><span className={ET}>Profesor</span><Select value={profe} onChange={setProfe} options={[["", "Sin profesor"], ...profes]} etiqueta="Profesor" block /></div>
        <div>
          <span className={ET}>Días *</span>
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Días de la clase">
            {DIAS.map(([n, corto, largo]) => {
              const sel = dias.includes(n);
              return (
                <button key={n} type="button" aria-pressed={sel} aria-label={largo} onClick={() => tocarDia(n)}
                  className={`min-h-11 rounded-lg border text-xs font-semibold transition sm:min-h-10 ${sel ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{corto}</button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ET}>Hora *</span><input type="time" value={h} onChange={(e) => setH(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className={ET}>Duración (min) *</span><input type="number" min={5} max={600} step={5} value={dur} onChange={(e) => setDur(e.target.value)} className={INPUT} /></label>
          <label className="block"><span className={ET}>Cupo</span><input type="number" min={1} max={1000} value={cupo} onChange={(e) => setCupo(e.target.value)} placeholder="Sin límite" className={INPUT} /></label>
          <label className="block"><span className={ET}>Clase suelta (Gs.)</span><input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d]/g, ""))} placeholder="El de reglas" className={INPUT} /></label>
        </div>
        <label className="block"><span className={ET}>Lugar</span><input value={lugar} onChange={(e) => setLugar(e.target.value)} maxLength={120} placeholder="Ej. Pileta, Sala 2, Tatami" className={INPUT} /></label>
        {clase ? <Interruptor activo={activa} onChange={setActiva} etiqueta="Clase activa" descripcion="Apagada no aparece más en la Recepción ni en la Agenda (lo ya hecho queda)." /> : null}
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </div>
    </ModalDocumento>
  );
}

function FormReglas({ cfg, onCerrar, onHecho }: { cfg: ConfigGim; onCerrar: () => void; onHecho: (c: ConfigGim) => void }) {
  const [precio, setPrecio] = useState(String(cfg.precio_clase_suelta || ""));
  const [iva, setIva] = useState<string>(cfg.tipo_iva);
  const [bloquear, setBloquear] = useState(cfg.bloquear_morosos);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    setOcupado(true); setError(null);
    try {
      onHecho(await apiFetch<ConfigGim>("/api/gimnasio/config", { method: "PUT", body: JSON.stringify({ precio_clase_suelta: num(precio) ?? 0, tipo_iva: iva, bloquear_morosos: bloquear }) }));
      onCerrar();
    } catch (e) { setError((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <ModalDocumento titulo="Precios y reglas" ancho="max-w-lg" onClose={onCerrar}
      footer={<>
        <button type="button" onClick={onCerrar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
        <button type="button" disabled={ocupado} onClick={() => void guardar()} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11 max-sm:flex-1`}>{ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar</button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={ET}>Clase suelta (Gs.)</span><input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className={INPUT} /></label>
          <div><span className={ET}>IVA</span><Select value={iva} onChange={setIva} options={[["10%", "10 %"], ["5%", "5 %"], ["exenta", "Exenta"]]} etiqueta="IVA" block /></div>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">Se cobra cuando un alumno sin membresía (o que ya usó las clases del mes) culmina una clase: queda como deuda y se cobra en la caja con Cobrar. Cada clase puede tener su propio precio. En 0 no se cobra.</p>
        <Interruptor activo={bloquear} onChange={setBloquear} etiqueta="Frenar la entrada a quien debe"
          descripcion="Con una cuota o clase vencida sin pagar, no se puede marcar su llegada. Quien tenga el permiso puede dejarlo entrar con un motivo." />
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </div>
    </ModalDocumento>
  );
}

export default function ClasesGimnasio() {
  const [clases, setClases] = useState<Clase[] | null>(null);
  const [cfg, setCfg] = useState<ConfigGim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<Clase | null | undefined>(undefined);
  const [reglas, setReglas] = useState(false);
  const puede = usePermiso("gimnasio_administrar");
  const cargar = useCallback(() => {
    apiFetch<Clase[]>("/api/gimnasio/clases").then((c) => { setClases(c); setError(null); }).catch((e: Error) => setError(e.message));
    apiFetch<ConfigGim>("/api/gimnasio/config").then(setCfg).catch(() => setCfg(null));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina kicker="Gimnasio" titulo="Clases" subtitulo="Cada clase se repite todas las semanas en sus días y aparece sola en la Recepción y en la Agenda." volver={{ href: "/gimnasio", label: "Recepción" }}
        acciones={puede ? (
          <div className="grid grid-cols-2 gap-2 max-sm:w-full sm:flex">
            <button type="button" disabled={!cfg} onClick={() => setReglas(true)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}><Settings2 className="h-4 w-4" /> Precios y reglas</button>
            <button type="button" onClick={() => setAbierta(null)} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11`}><Plus className="h-4 w-4" /> Nueva clase</button>
          </div>
        ) : undefined} />

      {cfg ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
          <span>Clase suelta: <span className="font-semibold text-slate-800">{cfg.precio_clase_suelta ? gs(cfg.precio_clase_suelta) : "no se cobra"}</span></span>
          <span>Con deuda vencida: <span className="font-semibold text-slate-800">{cfg.bloquear_morosos ? "no entra" : "entra igual"}</span></span>
        </p>
      ) : null}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!clases && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {clases ? (clases.length ? (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {clases.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={!puede} onClick={() => setAbierta(c)}
                className={`flex h-full w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left transition enabled:hover:border-[var(--brand)] enabled:hover:shadow-md ${c.activa ? "" : "opacity-60"}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-[15px] font-semibold text-slate-900">{c.nombre}</span>
                  {!c.activa ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Apagada</span> : null}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-slate-700"><Clock className="h-4 w-4 text-slate-400" /> {diasTexto(c.dias)} · {c.hora} ({c.duracion_min} min)</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <span>{c.profesor ?? "Sin profesor"}</span>
                  <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.cupo ? `${c.cupo} lugares` : "Sin límite"}</span>
                  {c.precio_suelta != null ? <span>Suelta {gs(c.precio_suelta)}</span> : null}
                  {c.ubicacion ? <span>{c.ubicacion}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]"><Dumbbell className="h-6 w-6" /></span>
          <p className="text-sm font-semibold text-slate-800">Todavía no hay clases</p>
          <p className="max-w-sm text-sm text-slate-500">Creá cada clase con sus días, hora, profesor y cupo. Por ejemplo: Natación nivel 1, lunes y miércoles a las 18:00, 15 lugares.</p>
        </div>
      )) : null}
      {abierta !== undefined ? <FormClase key={abierta?.id ?? "nueva"} clase={abierta} onCerrar={() => setAbierta(undefined)} onHecho={cargar} /> : null}
      {reglas && cfg ? <FormReglas cfg={cfg} onCerrar={() => setReglas(false)} onHecho={setCfg} /> : null}
    </div>
  );
}
