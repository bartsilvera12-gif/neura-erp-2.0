"use client";

/** /rrhh/[id] — Ficha de una persona: datos, ausencias, vacaciones, liquidaciones e historial (receta 118). */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { EventoDatos, EventoMotivo, EventoTarjeta, LineaTiempo } from "@/components/LineaTiempo";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { fechaCorta, gs } from "@/components/graficos/formato";
import { etiquetaMes } from "@/modules/comisiones/calculo";
import { PIE_MODAL } from "@/modules/clientes/ui";
import { aguinaldo, antiguedad, diasDelAnio, textoAntiguedad, vacaciones } from "@/modules/rrhh/calculo";
import { TIPOS_AUSENCIA, TIPOS_NOTA, etiquetaAusencia, type EventoRrhh, type FichaRrhh, type Legajo, type TipoAusencia } from "@/modules/rrhh/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, Cifra, INPUT, Interruptor, renglonesExtracto } from "@/modules/rrhh/ui";

type Tab = "datos" | "ausencias" | "vacaciones" | "liquidaciones" | "historial";
const DIAS: [number, string][] = [[1, "Lu"], [2, "Ma"], [3, "Mi"], [4, "Ju"], [5, "Vi"], [6, "Sá"], [7, "Do"]];

const accion = (id: string, body: object) => apiFetch(`/api/rrhh/${id}`, { method: "POST", body: JSON.stringify(body) });

type Form = Omit<Legajo, "fecha_ingreso"> & { fecha_ingreso: string; nombres: string; apellidos: string; ci: string; telefono: string; motivo_salario: string };

function armarForm(f: FichaRrhh): Form {
  const l = f.legajo;
  return {
    nombres: f.usuario.nombres, apellidos: f.usuario.apellidos ?? "", ci: f.usuario.ci ?? "", telefono: f.usuario.telefono ?? "",
    fecha_nacimiento: l?.fecha_nacimiento ?? "", direccion: l?.direccion ?? "", barrio: l?.barrio ?? "", ciudad: l?.ciudad ?? "",
    emergencia_nombre: l?.emergencia_nombre ?? "", emergencia_telefono: l?.emergencia_telefono ?? "", fecha_ingreso: l?.fecha_ingreso ?? "", fecha_egreso: l?.fecha_egreso ?? "",
    tipo_salario: l?.tipo_salario ?? "mensualero", salario: Number(l?.salario ?? 0), aporta_ips: l?.aporta_ips ?? true, comisiona: l?.comisiona ?? true, area: l?.area ?? "",
    horario_dias: l?.horario_dias ?? [1, 2, 3, 4, 5, 6], horario_entrada: l?.horario_entrada?.slice(0, 5) ?? "", horario_salida: l?.horario_salida?.slice(0, 5) ?? "", horario_nota: l?.horario_nota ?? "",
    motivo_salario: "",
  };
}

function Datos({ ficha, onGuardado }: { ficha: FichaRrhh; onGuardado: () => void }) {
  const [f, setF] = useState<Form>(() => armarForm(ficha));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setListo(false); };
  const cambiaSalario = !!ficha.legajo && Number(ficha.legajo.salario) !== f.salario;
  const texto = (k: "nombres" | "apellidos" | "ci" | "telefono" | "direccion" | "barrio" | "ciudad" | "emergencia_nombre" | "emergencia_telefono" | "area" | "horario_nota") => (
    <input className={INPUT} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
  );

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/rrhh/${ficha.usuario.id}`, { method: "PUT", body: JSON.stringify(f) });
      setListo(true);
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const seccion = "rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5";
  const titulo = "mb-3 text-sm font-semibold text-slate-900";
  const grilla = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className="space-y-4">
      <section className={seccion}>
        <h3 className={titulo}>Datos personales</h3>
        <div className={grilla}>
          <Campo label="Nombres *">{texto("nombres")}</Campo>
          <Campo label="Apellidos">{texto("apellidos")}</Campo>
          <Campo label="Número de CI">{texto("ci")}</Campo>
          <Campo label="Fecha de nacimiento"><SelectorFecha block value={f.fecha_nacimiento ?? ""} onChange={(v) => set("fecha_nacimiento", v)} max={hoyPY()} /></Campo>
          <Campo label="Número de contacto">{texto("telefono")}</Campo>
          <Campo label="Correo" ayuda="Es su usuario para entrar: se cambia desde su cuenta."><input className={`${INPUT} bg-slate-50 text-slate-500`} value={ficha.usuario.email ?? ""} readOnly /></Campo>
          <Campo label="Dirección">{texto("direccion")}</Campo>
          <Campo label="Barrio">{texto("barrio")}</Campo>
          <Campo label="Ciudad">{texto("ciudad")}</Campo>
          <Campo label="Contacto de emergencia: nombre">{texto("emergencia_nombre")}</Campo>
          <Campo label="Contacto de emergencia: teléfono">{texto("emergencia_telefono")}</Campo>
        </div>
      </section>

      <section className={seccion}>
        <h3 className={titulo}>Trabajo</h3>
        <div className={grilla}>
          <Campo label="Fecha de ingreso *" ayuda="De acá salen la antigüedad, las vacaciones y el aguinaldo."><SelectorFecha block value={f.fecha_ingreso} onChange={(v) => set("fecha_ingreso", v)} /></Campo>
          <Campo label="Fecha de salida" ayuda="Solo si dejó de trabajar."><SelectorFecha block value={f.fecha_egreso ?? ""} onChange={(v) => set("fecha_egreso", v)} /></Campo>
          <Campo label="Área de trabajo">{texto("area")}</Campo>
          <Campo label="Perfil" ayuda="Se cambia en Configuración › Usuarios."><input className={`${INPUT} bg-slate-50 text-slate-500`} value={ficha.usuario.perfil ?? "—"} readOnly /></Campo>
          <Campo label="Sucursal" ayuda="Se cambia en Configuración › Usuarios."><input className={`${INPUT} bg-slate-50 text-slate-500`} value={ficha.usuario.sucursal ?? "Todas"} readOnly /></Campo>
        </div>
      </section>

      <section className={seccion}>
        <h3 className={titulo}>Salario</h3>
        <div className={grilla}>
          <Campo label="Cómo cobra"><Select block value={f.tipo_salario} onChange={(v) => set("tipo_salario", v as Form["tipo_salario"])} options={[["mensualero", "Mensualero"], ["jornalero", "Jornalero"]]} etiqueta="Cómo cobra" /></Campo>
          <Campo label={f.tipo_salario === "jornalero" ? "Jornal por día (Gs.)" : "Salario mensual (Gs.)"}><CampoMonto valor={f.salario} onChange={(n) => set("salario", n)} /></Campo>
          {cambiaSalario ? <Campo label="Motivo del cambio *" ayuda="Queda en el historial."><input className={INPUT} value={f.motivo_salario} onChange={(e) => set("motivo_salario", e.target.value)} placeholder="Ej: aumento anual, ascenso" /></Campo> : null}
          <Interruptor valor={f.aporta_ips} onChange={(v) => set("aporta_ips", v)} label="Aporta IPS" />
          <Interruptor valor={f.comisiona} onChange={(v) => set("comisiona", v)} label="Comisiona" ayuda="Si está apagado, sale de Comisiones." />
        </div>
      </section>

      <section className={seccion}>
        <h3 className={titulo}>Horario de trabajo</h3>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DIAS.map(([n, l]) => {
            const on = f.horario_dias.includes(n);
            return <button key={n} type="button" aria-pressed={on} onClick={() => set("horario_dias", on ? f.horario_dias.filter((x) => x !== n) : [...f.horario_dias, n].sort())}
              className={`h-11 w-11 rounded-xl border text-sm font-semibold transition-colors ${on ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-200 bg-white text-slate-600"}`}>{l}</button>;
          })}
        </div>
        <div className={grilla}>
          <Campo label="Entrada"><input type="time" className={INPUT} value={f.horario_entrada ?? ""} onChange={(e) => set("horario_entrada", e.target.value)} /></Campo>
          <Campo label="Salida"><input type="time" className={INPUT} value={f.horario_salida ?? ""} onChange={(e) => set("horario_salida", e.target.value)} /></Campo>
          <Campo label="Nota" ayuda="Ej: sábados hasta las 12, turno cortado.">{texto("horario_nota")}</Campo>
        </div>
      </section>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="flex items-center justify-end gap-3">
        {listo ? <span className="text-sm font-medium text-emerald-700">Guardado</span> : null}
        <button type="button" onClick={() => void guardar()} disabled={busy} className={`${BOTON_PRIMARIO} max-sm:w-full`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  );
}

/** Pide el motivo y anula. */
function ModalAnular({ titulo, onClose, onConfirmar }: { titulo: string; onClose: () => void; onConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal titulo={titulo} onClose={busy ? () => {} : onClose}>
      <div className="space-y-4">
        <Campo label="Motivo *"><textarea autoFocus rows={3} className={INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className={PIE_MODAL}>
          <button type="button" className={BOTON} onClick={onClose} disabled={busy}>Volver</button>
          <button type="button" className={BOTON_PRIMARIO} disabled={busy || motivo.trim().length < 3} onClick={() => { setBusy(true); onConfirmar(motivo).catch((e: Error) => { setError(e.message); setBusy(false); }); }}>Anular</button>
        </div>
      </div>
    </Modal>
  );
}

function Ausencias({ ficha, onCambio }: { ficha: FichaRrhh; onCambio: () => void }) {
  const id = ficha.usuario.id;
  const [nueva, setNueva] = useState(false);
  const [anular, setAnular] = useState<string | null>(null);
  const [fecha, setFecha] = useState(hoyPY());
  const [dias, setDias] = useState("1");
  const [tipo, setTipo] = useState<TipoAusencia>("injustificada");
  const [descuenta, setDescuenta] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jornalero = ficha.legajo?.tipo_salario === "jornalero";
  const salario = Number(ficha.legajo?.salario ?? 0);
  const n = Number(dias.replace(",", ".")) || 0;

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await accion(id, { accion: "ausencia", fecha, dias: n, tipo, descuenta, motivo });
      setNueva(false);
      setMotivo("");
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => setNueva(true)}><Plus className="h-4 w-4" /> Registrar ausencia</button></div>
      {ficha.ausencias.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No tiene ausencias registradas.</p> : null}
      <ul className="space-y-2">
        {ficha.ausencias.map((a) => (
          <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 ${a.anulada_at ? "opacity-60" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{fechaCorta(a.fecha)} · {Number(a.dias)} {Number(a.dias) === 1 ? "día" : "días"} · {etiquetaAusencia(a.tipo)}</p>
              <p className="text-xs text-slate-500">
                {a.anulada_at ? `Anulada: ${a.anulada_motivo}` : a.descuenta ? (jornalero ? "No se paga ese día" : `Descuenta ${gs((salario / 30) * Number(a.dias))}`) : "No descuenta"}
                {a.motivo ? ` · ${a.motivo}` : ""}
              </p>
            </div>
            {a.anulada_at ? null : <button type="button" className={BOTON} onClick={() => setAnular(a.id)}>Anular</button>}
          </li>
        ))}
      </ul>

      {nueva ? (
        <Modal titulo="Registrar ausencia" onClose={busy ? () => {} : () => setNueva(false)}>
          <div className="space-y-3">
            <Campo label="Fecha"><SelectorFecha block value={fecha} onChange={setFecha} /></Campo>
            <Campo label="Días" ayuda="Medio día: 0,5. Si abarca dos meses, cargá una por mes."><input inputMode="decimal" className={INPUT} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>
            <Campo label="Tipo"><Select block value={tipo} etiqueta="Tipo" options={TIPOS_AUSENCIA.map((t) => [t.id, t.label])} onChange={(v) => { setTipo(v as TipoAusencia); setDescuenta(TIPOS_AUSENCIA.find((t) => t.id === v)!.descuenta); }} /></Campo>
            <Interruptor valor={descuenta} onChange={setDescuenta} label="Descuenta del salario" ayuda={descuenta && !jornalero && n > 0 ? `Va a descontar ${gs((salario / 30) * n)}` : undefined} />
            <Campo label="Motivo"><input className={INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className={PIE_MODAL}>
              <button type="button" className={BOTON} onClick={() => setNueva(false)} disabled={busy}>Cancelar</button>
              <button type="button" className={BOTON_PRIMARIO} onClick={() => void guardar()} disabled={busy || n <= 0 || !fecha}>Guardar</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {anular ? <ModalAnular titulo="Anular ausencia" onClose={() => setAnular(null)} onConfirmar={async (m) => { await accion(id, { accion: "anular_ausencia", id: anular, motivo: m }); setAnular(null); onCambio(); }} /> : null}
    </div>
  );
}

function Vacaciones({ ficha, corte, onCambio }: { ficha: FichaRrhh; corte: string; onCambio: () => void }) {
  const id = ficha.usuario.id;
  const [nueva, setNueva] = useState(false);
  const [anular, setAnular] = useState<string | null>(null);
  const [desde, setDesde] = useState(hoyPY());
  const [hasta, setHasta] = useState(hoyPY());
  const [dias, setDias] = useState("");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tomados = ficha.vacaciones.filter((v) => !v.anulada_at).reduce((s, v) => s + Number(v.dias), 0);
  const v = vacaciones(ficha.legajo!.fecha_ingreso, corte, tomados);
  const { anios } = antiguedad(ficha.legajo!.fecha_ingreso, corte);
  const n = Number(dias.replace(",", ".")) || 0;

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await accion(id, { accion: "vacacion", desde, hasta, dias: n, nota });
      setNueva(false);
      setDias("");
      setNota("");
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra label="Disponibles" valor={`${v.saldo} días`} />
        <Cifra label="Generados" valor={`${v.generados} días`} sub={`${anios} ${anios === 1 ? "año" : "años"} completos`} />
        <Cifra label="Tomados" valor={`${v.tomados} días`} />
        <Cifra label="Próximos" valor={`${v.proximos_dias} días`} sub={`el ${fechaCorta(v.proxima)}`} />
      </div>
      <p className="text-xs text-slate-500">Días hábiles por año trabajado: {diasDelAnio(1)} hasta 5 años, {diasDelAnio(6)} hasta 10 años y {diasDelAnio(11)} después.</p>
      <div className="flex justify-end"><button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => setNueva(true)}><Plus className="h-4 w-4" /> Cargar vacaciones</button></div>
      {ficha.vacaciones.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No tiene vacaciones cargadas.</p> : null}
      <ul className="space-y-2">
        {ficha.vacaciones.map((x) => (
          <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 ${x.anulada_at ? "opacity-60" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{fechaCorta(x.desde)} al {fechaCorta(x.hasta)} · {Number(x.dias)} días</p>
              {x.anulada_at ? <p className="text-xs text-slate-500">Anuladas: {x.anulada_motivo}</p> : x.nota ? <p className="text-xs text-slate-500">{x.nota}</p> : null}
            </div>
            {x.anulada_at ? null : <button type="button" className={BOTON} onClick={() => setAnular(x.id)}>Anular</button>}
          </li>
        ))}
      </ul>
      {nueva ? (
        <Modal titulo="Cargar vacaciones" onClose={busy ? () => {} : () => setNueva(false)}>
          <div className="space-y-3">
            <Campo label="Desde"><SelectorFecha block value={desde} onChange={setDesde} /></Campo>
            <Campo label="Hasta"><SelectorFecha block value={hasta} onChange={setHasta} min={desde} /></Campo>
            <Campo label="Días hábiles" ayuda={n > v.saldo ? `Solo tiene ${v.saldo} disponibles: se puede cargar igual si es un adelanto.` : undefined}><input inputMode="decimal" className={INPUT} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>
            <Campo label="Nota"><input className={INPUT} value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className={PIE_MODAL}>
              <button type="button" className={BOTON} onClick={() => setNueva(false)} disabled={busy}>Cancelar</button>
              <button type="button" className={BOTON_PRIMARIO} onClick={() => void guardar()} disabled={busy || n <= 0 || !desde || !hasta}>Guardar</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {anular ? <ModalAnular titulo="Anular vacaciones" onClose={() => setAnular(null)} onConfirmar={async (m) => { await accion(id, { accion: "anular_vacacion", id: anular, motivo: m }); setAnular(null); onCambio(); }} /> : null}
    </div>
  );
}

function Liquidaciones({ ficha }: { ficha: FichaRrhh }) {
  const cerradas = ficha.liquidaciones.filter((l) => l.estado === "cerrada" && l.resultado);
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Link href="/rrhh/liquidaciones" className={`${BOTON} max-sm:w-full`}>Ir a las liquidaciones del mes</Link></div>
      {cerradas.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Todavía no tiene liquidaciones cerradas.</p> : null}
      <ul className="space-y-2">
        {cerradas.map((l) => (
          <li key={l.periodo} className="rounded-xl border border-slate-200 bg-white">
            <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left" aria-expanded={abierta === l.periodo} onClick={() => setAbierta(abierta === l.periodo ? null : l.periodo)}>
              <span className="text-sm font-medium capitalize text-slate-900">{etiquetaMes(l.periodo)}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{gs(l.neto)}</span>
            </button>
            {abierta === l.periodo ? (
              <dl className="border-t border-slate-100 p-3 text-sm">
                {renglonesExtracto(l.resultado!).map((r, i) => (
                  <div key={i} className={`flex justify-between gap-3 py-1 ${r.total ? "font-semibold text-slate-900" : r.info ? "text-xs text-slate-500" : "text-slate-600"}`}>
                    <dt className="min-w-0">{r.label}</dt><dd className="shrink-0 tabular-nums">{r.signo === "-" ? "− " : ""}{gs(r.monto)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CAMPOS_USUARIO: Record<string, string> = { nombre: "Nombre", ci: "CI", telefono: "Teléfono", perfil: "Perfil", sucursal: "Sucursal", activo: "Activo" };
const NOTA: Record<string, string> = Object.fromEntries(TIPOS_NOTA);
const META: Record<string, { label: string; color: string }> = {
  legajo_creado: { label: "Datos cargados", color: "bg-emerald-100 text-emerald-700" },
  salario: { label: "Cambio de salario", color: "bg-violet-100 text-violet-700" },
  actualizado: { label: "Datos actualizados", color: "bg-sky-100 text-sky-700" },
  ausencia: { label: "Ausencia", color: "bg-amber-100 text-amber-700" },
  ausencia_anulada: { label: "Ausencia anulada", color: "bg-slate-200 text-slate-700" },
  vacaciones: { label: "Vacaciones", color: "bg-teal-100 text-teal-700" },
  vacaciones_anuladas: { label: "Vacaciones anuladas", color: "bg-slate-200 text-slate-700" },
  liquidacion_cerrada: { label: "Liquidación cerrada", color: "bg-emerald-100 text-emerald-700" },
  liquidacion_reabierta: { label: "Liquidación reabierta", color: "bg-amber-100 text-amber-700" },
  usuario_creado: { label: "Alta como usuario", color: "bg-emerald-100 text-emerald-700" },
  usuario_vinculado: { label: "Alta como usuario", color: "bg-emerald-100 text-emerald-700" },
  usuario_editado: { label: "Cambio de usuario", color: "bg-sky-100 text-sky-700" },
  usuario_activado: { label: "Usuario activado", color: "bg-emerald-100 text-emerald-700" },
  usuario_desactivado: { label: "Usuario desactivado", color: "bg-slate-200 text-slate-700" },
};

const valorCambio = (v: unknown) => (v == null || v === "" ? "—" : v === "true" || v === true ? "Sí" : v === "false" || v === false ? "No" : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fechaCorta(String(v)) : String(v));

function Evento({ e }: { e: EventoRrhh }) {
  const d = e.detalle as Record<string, never>;
  const meta = e.accion === "nota" ? { label: NOTA[d.tipo] ?? "Nota", color: d.tipo === "llamada_atencion" ? "bg-rose-100 text-rose-700" : "bg-violet-100 text-violet-700" } : META[e.accion] ?? { label: e.accion, color: "bg-slate-100 text-slate-600" };
  const cambios: { campo: string; antes: unknown; despues: unknown }[] =
    e.accion === "actualizado" ? d.cambios ?? []
    : e.accion === "usuario_editado" ? Object.entries(e.detalle).filter(([k, v]) => CAMPOS_USUARIO[k] && Array.isArray(v)).map(([k, v]) => ({ campo: CAMPOS_USUARIO[k], antes: (v as unknown[])[0], despues: (v as unknown[])[1] }))
    : [];
  const antes = Number(d.antes);
  const despues = Number(d.despues);
  return (
    <EventoTarjeta etiqueta={meta.label} color={meta.color} fecha={e.created_at}>
      {e.accion === "salario" ? (
        <p className="mt-2 text-sm text-slate-800">
          {gs(antes)} → <b>{gs(despues)}</b>{antes > 0 && despues !== antes ? <span className={despues > antes ? " text-emerald-700" : " text-rose-700"}> ({despues > antes ? "+" : ""}{(((despues - antes) / antes) * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %)</span> : null}
        </p>
      ) : null}
      {e.accion === "legajo_creado" ? <p className="mt-2 text-sm text-slate-800">Ingreso {fechaCorta(d.fecha_ingreso)} · {d.tipo_salario === "jornalero" ? "Jornalero" : "Mensualero"} · {gs(d.salario)}</p> : null}
      {e.accion === "ausencia" || e.accion === "ausencia_anulada" ? <p className="mt-2 text-sm text-slate-800">{fechaCorta(d.fecha)} · {Number(d.dias)} {Number(d.dias) === 1 ? "día" : "días"}{d.tipo ? ` · ${etiquetaAusencia(d.tipo)}` : ""}{d.descuenta ? " · Descuenta" : ""}</p> : null}
      {e.accion === "vacaciones" || e.accion === "vacaciones_anuladas" ? <p className="mt-2 text-sm text-slate-800">{fechaCorta(d.desde)} al {fechaCorta(d.hasta)} · {Number(d.dias)} días</p> : null}
      {e.accion === "liquidacion_cerrada" ? <p className="mt-2 text-sm capitalize text-slate-800">{etiquetaMes(d.periodo)} · Neto {gs(d.neto)}</p> : null}
      {e.accion === "liquidacion_reabierta" ? <p className="mt-2 text-sm capitalize text-slate-800">{etiquetaMes(d.periodo)}</p> : null}
      {e.accion === "nota" ? <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{d.texto}</p> : null}
      <EventoDatos filas={[["Por", e.actor]]} />
      {cambios.length > 0 ? (
        <div className="mt-2.5 overflow-hidden rounded-lg border border-slate-100">
          <div className="grid grid-cols-3 gap-2 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><span>Campo</span><span>Antes</span><span>Después</span></div>
          {cambios.map((c, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 border-t border-slate-100 px-2.5 py-1.5 text-xs">
              <span className="font-medium text-slate-700">{c.campo}</span><span className="text-rose-600 line-through">{valorCambio(c.antes)}</span><span className="text-emerald-700">{valorCambio(c.despues)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {d.motivo ? <EventoMotivo>{d.motivo}</EventoMotivo> : null}
    </EventoTarjeta>
  );
}

function Historial({ ficha, onCambio }: { ficha: FichaRrhh; onCambio: () => void }) {
  const [nueva, setNueva] = useState(false);
  const [tipo, setTipo] = useState("ascenso");
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      await accion(ficha.usuario.id, { accion: "nota", tipo, texto });
      setNueva(false);
      setTexto("");
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex justify-end"><button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => setNueva(true)}><Plus className="h-4 w-4" /> Agregar al historial</button></div>
      {ficha.historial.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Todavía no hay nada registrado.</p> : <LineaTiempo eventos={ficha.historial} clave={(e) => e.id} fecha={(e) => e.created_at} render={(e) => <Evento e={e} />} />}
      {nueva ? (
        <Modal titulo="Agregar al historial" onClose={busy ? () => {} : () => setNueva(false)}>
          <div className="space-y-3">
            <Campo label="Tipo"><Select block value={tipo} onChange={setTipo} options={TIPOS_NOTA} etiqueta="Tipo" /></Campo>
            <Campo label="Qué pasó *"><textarea autoFocus rows={3} className={INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            <div className={PIE_MODAL}>
              <button type="button" className={BOTON} onClick={() => setNueva(false)} disabled={busy}>Cancelar</button>
              <button type="button" className={BOTON_PRIMARIO} onClick={() => void guardar()} disabled={busy || texto.trim().length < 3}>Guardar</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default function PaginaFicha() {
  const { id } = useParams<{ id: string }>();
  const [ficha, setFicha] = useState<FichaRrhh | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("datos");

  const cargar = useCallback(() => {
    apiFetch<FichaRrhh>(`/api/rrhh/${id}`).then(setFicha).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const volver = { href: "/rrhh", label: "Personal" };
  if (error) return <div className="space-y-4"><EncabezadoPagina titulo="Ficha" volver={volver} /><p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p></div>;
  if (!ficha) return <p className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></p>;

  const l = ficha.legajo;
  const hoy = hoyPY();
  const corte = l?.fecha_egreso && l.fecha_egreso < hoy ? l.fecha_egreso : hoy;
  const tomados = ficha.vacaciones.filter((v) => !v.anulada_at).reduce((s, v) => s + Number(v.dias), 0);
  const ag = l ? aguinaldo({ mes: corte.slice(0, 7), tipo_salario: l.tipo_salario, salario: Number(l.salario), fecha_ingreso: l.fecha_ingreso, fecha_egreso: l.fecha_egreso,
    cerradas: ficha.liquidaciones.filter((q) => q.estado === "cerrada").map((q) => ({ periodo: q.periodo, imponible: Number(q.imponible) })) }) : null;
  const tabs: [Tab, string][] = [["datos", "Datos"], ["ausencias", "Ausencias"], ["vacaciones", "Vacaciones"], ["liquidaciones", "Liquidaciones"], ["historial", "Historial"]];

  return (
    <div className="space-y-4">
      <EncabezadoPagina kicker="RR HH" titulo={ficha.usuario.nombre} subtitulo={[ficha.usuario.perfil, ficha.usuario.sucursal, l?.area].filter(Boolean).join(" · ")} volver={volver} />
      {l && ag ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra label={l.tipo_salario === "jornalero" ? "Jornal" : "Salario"} valor={gs(l.salario)} sub={l.tipo_salario === "jornalero" ? "Por día" : "Mensual"} />
          <Cifra label="Antigüedad" valor={textoAntiguedad(antiguedad(l.fecha_ingreso, corte))} sub={`Desde ${fechaCorta(l.fecha_ingreso)}`} />
          <Cifra label="Vacaciones" valor={`${vacaciones(l.fecha_ingreso, corte, tomados).saldo} días`} sub="Disponibles" />
          <Cifra label="Aguinaldo acumulado" valor={gs(ag.total)} sub={[ag.meses_cerrados ? `Cerrado: ${ag.meses_cerrados} ${ag.meses_cerrados === 1 ? "mes" : "meses"}` : "", ag.meses_estimados ? `Estimado: ${ag.meses_estimados} ${ag.meses_estimados === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(" · ") || "Sin meses cerrados"} />
        </div>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Cargá sus datos para poder registrar ausencias y vacaciones y liquidarle el mes.</p>
      )}

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist">
        {tabs.map(([t, label]) => {
          const bloqueada = !l && t !== "datos" && t !== "historial";
          return (
            <button key={t} type="button" role="tab" aria-selected={tab === t} disabled={bloqueada} onClick={() => setTab(t)}
              className={`min-h-11 shrink-0 rounded-xl px-3.5 text-sm font-semibold transition-colors disabled:opacity-40 sm:min-h-9 ${tab === t ? "bg-[var(--brand)] text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>
          );
        })}
      </div>

      {tab === "datos" ? <Datos key={l ? "con" : "sin"} ficha={ficha} onGuardado={cargar} /> : null}
      {tab === "ausencias" && l ? <Ausencias ficha={ficha} onCambio={cargar} /> : null}
      {tab === "vacaciones" && l ? <Vacaciones ficha={ficha} corte={corte} onCambio={cargar} /> : null}
      {tab === "liquidaciones" && l ? <Liquidaciones ficha={ficha} /> : null}
      {tab === "historial" ? <Historial ficha={ficha} onCambio={cargar} /> : null}
    </div>
  );
}
