"use client";

/** /rrhh/[id] — Ficha de una persona: datos, ausencias, vacaciones, liquidaciones e historial (receta 118). */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Award, Banknote, Briefcase, Clock, Loader2, MapPin, Plus, TrendingUp, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { usePermiso } from "@/lib/sesion/ContextoUsuario";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { EventoDatos, EventoMotivo, EventoTarjeta, LineaTiempo } from "@/components/LineaTiempo";
import { Modal } from "@/components/Modal";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { fechaCorta, gs } from "@/components/graficos/formato";
import { etiquetaMes } from "@/modules/comisiones/calculo";
import { CamposCiudadBarrio } from "@/modules/geo/CamposCiudadBarrio";
import { PIE_MODAL } from "@/modules/clientes/ui";
import { aguinaldo, antiguedad, diasDelAnio, textoAntiguedad, vacaciones } from "@/modules/rrhh/calculo";
import { PARENTESCOS, RE_CORREO, TIPOS_AUSENCIA, TIPOS_NOTA, etiquetaAusencia, type EventoRrhh, type FichaRrhh, type Legajo, type TipoAusencia } from "@/modules/rrhh/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, Cifra, INPUT, Interruptor, Tarjeta, renglonesExtracto } from "@/modules/rrhh/ui";

type Tab = "datos" | "ausencias" | "vacaciones" | "liquidaciones" | "historial";
/** Horas cada 15 min; si ya había una fuera de la grilla, se conserva. */
const HORAS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
const opcionesHora = (v: string | null | undefined): [string, string][] =>
  [["", "Sin hora"], ...[...new Set([...HORAS, ...(v ? [v.slice(0, 5)] : [])])].sort().map((h): [string, string] => [h, h])];
const DIAS: [number, string][] = [[1, "Lu"], [2, "Ma"], [3, "Mi"], [4, "Ju"], [5, "Vi"], [6, "Sá"], [7, "Do"]];

const accion = (id: string, body: object) => apiFetch(`/api/rrhh/${id}`, { method: "POST", body: JSON.stringify(body) });

type Form = Omit<Legajo, "fecha_ingreso"> & { fecha_ingreso: string; nombres: string; apellidos: string; ci: string; telefono: string; motivo_salario: string; perfil_id: string; sucursal_id: string };

function armarForm(f: FichaRrhh): Form {
  const l = f.legajo;
  return {
    nombres: f.usuario.nombres, apellidos: f.usuario.apellidos ?? "", ci: f.usuario.ci ?? "", telefono: f.usuario.telefono ?? "",
    correo: l?.correo ?? f.usuario.email ?? "", emergencia_parentesco: l?.emergencia_parentesco ?? "", fecha_nacimiento: l?.fecha_nacimiento ?? "", direccion: l?.direccion ?? "", barrio: l?.barrio ?? "", ciudad: l?.ciudad ?? "",
    emergencia_nombre: l?.emergencia_nombre ?? "", emergencia_telefono: l?.emergencia_telefono ?? "", fecha_ingreso: l?.fecha_ingreso ?? "", fecha_egreso: l?.fecha_egreso ?? "",
    tipo_salario: l?.tipo_salario ?? "mensualero", salario: Number(l?.salario ?? 0), aporta_ips: l?.aporta_ips ?? true, comisiona: l?.comisiona ?? true, area: l?.area ?? "",
    horario_dias: l?.horario_dias ?? [1, 2, 3, 4, 5, 6], horario_entrada: l?.horario_entrada?.slice(0, 5) ?? "", horario_salida: l?.horario_salida?.slice(0, 5) ?? "", horario_nota: l?.horario_nota ?? "",
    motivo_salario: "", perfil_id: f.usuario.perfil_id ?? "", sucursal_id: f.usuario.sucursal_id ?? "",
  };
}

function Datos({ ficha, onGuardado }: { ficha: FichaRrhh; onGuardado: () => void }) {
  const [f, setF] = useState<Form>(() => armarForm(ficha));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const puedeAcceso = usePermiso("administrar_usuarios");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setListo(false); };
  const cambiaSalario = !!ficha.legajo && Number(ficha.legajo.salario) !== f.salario;
  const texto = (k: "nombres" | "apellidos" | "ci" | "telefono" | "direccion" | "emergencia_nombre" | "emergencia_telefono" | "area" | "horario_nota") => (
    <input className={INPUT} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
  );

  async function guardar() {
    setBusy(true);
    setError(null);
    const { perfil_id, sucursal_id, ...sinAcceso } = f;
    const cambio = perfil_id !== (ficha.usuario.perfil_id ?? "") || sucursal_id !== (ficha.usuario.sucursal_id ?? "");
    const acceso = cambio ? { perfil_id, sucursal_id: sucursal_id || null } : undefined;
    try {
      await apiFetch(`/api/rrhh/${ficha.usuario.id}`, { method: "PUT", body: JSON.stringify({ ...sinAcceso, acceso }) });
      setListo(true);
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const grilla = "grid gap-3 sm:grid-cols-2";
  const correoMal = !!f.correo?.trim() && !RE_CORREO.test(f.correo.trim());
  const faltaCorreo = !RE_CORREO.test(f.correo?.trim() ?? "");
  const hayCambios = JSON.stringify(f) !== JSON.stringify(armarForm(ficha));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Tarjeta icono={<UserRound className="h-4 w-4" />} titulo="Datos personales" detalle="Quién es y cómo ubicarlo.">
          <div className={grilla}>
            <Campo label="Nombres *">{texto("nombres")}</Campo>
            <Campo label="Apellidos">{texto("apellidos")}</Campo>
            <Campo label="Número de CI">{texto("ci")}</Campo>
            <Campo label="Fecha de nacimiento"><SelectorFecha block value={f.fecha_nacimiento ?? ""} onChange={(v) => set("fecha_nacimiento", v)} max={hoyPY()} /></Campo>
            <Campo label="Número de contacto">{texto("telefono")}</Campo>
            <Campo label="Correo *" ayuda={correoMal ? undefined : "Para contactarlo. No cambia el correo con el que entra al sistema."}>
              <input type="email" inputMode="email" autoComplete="off" aria-invalid={correoMal} className={`${INPUT} ${correoMal ? "border-rose-400 focus:border-rose-400 focus:ring-rose-100" : ""}`} value={f.correo ?? ""} onChange={(e) => set("correo", e.target.value)} placeholder="nombre@correo.com" />
              {correoMal ? <p className="mt-1 text-[11px] font-medium text-rose-600">Tiene que tener @. Por ejemplo: nombre@correo.com</p> : null}
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta icono={<MapPin className="h-4 w-4" />} titulo="Dirección y emergencia" detalle="Dónde vive y a quién llamar si pasa algo.">
          <div className={grilla}>
            <Campo label="Dirección" className="sm:col-span-2">{texto("direccion")}</Campo>
            <CamposCiudadBarrio ciudad={f.ciudad ?? ""} barrio={f.barrio ?? ""} onCiudad={(v) => set("ciudad", v)} onBarrio={(v) => set("barrio", v)} claseInput={INPUT} Campo={Campo} />
            <p className="m-0 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-700 sm:col-span-2">¿A quién llamamos en una emergencia?</p>
            <Campo label="Nombre del contacto" className="sm:col-span-2"><input className={INPUT} value={f.emergencia_nombre ?? ""} onChange={(e) => set("emergencia_nombre", e.target.value)} placeholder="Ej: Rosa Benítez" /></Campo>
            <Campo label="Parentesco"><Select block value={f.emergencia_parentesco ?? ""} onChange={(v) => set("emergencia_parentesco", v)} etiqueta="Parentesco" options={[["", "Elegí el parentesco"], ...PARENTESCOS.map((x): [string, string] => [x, x])]} /></Campo>
            <Campo label="Teléfono del contacto"><input type="tel" inputMode="tel" className={INPUT} value={f.emergencia_telefono ?? ""} onChange={(e) => set("emergencia_telefono", e.target.value)} placeholder="Ej: 0981 123 456" /></Campo>
          </div>
        </Tarjeta>

        <Tarjeta icono={<Briefcase className="h-4 w-4" />} titulo="Trabajo" detalle="De la fecha de ingreso salen la antigüedad, las vacaciones y el aguinaldo.">
          <div className={grilla}>
            <Campo label="Fecha de ingreso *"><SelectorFecha block value={f.fecha_ingreso} onChange={(v) => set("fecha_ingreso", v)} /></Campo>
            <Campo label="Fecha de salida" ayuda="Solo si dejó de trabajar."><SelectorFecha block value={f.fecha_egreso ?? ""} onChange={(v) => set("fecha_egreso", v)} /></Campo>
            <Campo label="Área de trabajo" className="sm:col-span-2">{texto("area")}</Campo>
            <Campo label="Perfil" ayuda={ficha.usuario.es_yo ? "Tu propio perfil lo cambia otro administrador." : "Define qué puede hacer en el sistema."}>
              <Select block value={f.perfil_id} onChange={(v) => set("perfil_id", v)} etiqueta="Perfil" disabled={ficha.usuario.es_yo || !puedeAcceso} options={ficha.perfiles.map((p): [string, string] => [p.id, p.nombre])} />
            </Campo>
            <Campo label="Sucursal">
              <Select block value={f.sucursal_id} onChange={(v) => set("sucursal_id", v)} etiqueta="Sucursal" disabled={!puedeAcceso}
                options={[["", "Sin sucursal fija (usa la principal)"], ...ficha.sucursales.map((s): [string, string] => [s.id, s.nombre + (s.es_principal ? " (principal)" : "")])]} />
            </Campo>
          </div>
        </Tarjeta>

        <Tarjeta icono={<Banknote className="h-4 w-4" />} titulo="Salario" detalle="Cada cambio queda en el historial.">
          <div className={grilla}>
            <Campo label="Cómo cobra"><Select block value={f.tipo_salario} onChange={(v) => set("tipo_salario", v as Form["tipo_salario"])} options={[["mensualero", "Mensualero"], ["jornalero", "Jornalero"]]} etiqueta="Cómo cobra" /></Campo>
            <Campo label={f.tipo_salario === "jornalero" ? "Jornal por día (Gs.)" : "Salario mensual (Gs.)"}><CampoMonto valor={f.salario} onChange={(n) => set("salario", n)} /></Campo>
            {cambiaSalario ? <Campo label="Motivo del cambio *" ayuda="Queda en el historial." className="sm:col-span-2"><input className={INPUT} value={f.motivo_salario} onChange={(e) => set("motivo_salario", e.target.value)} placeholder="Ej: aumento anual, ascenso" /></Campo> : null}
            <Interruptor valor={f.aporta_ips} onChange={(v) => set("aporta_ips", v)} label="Aporta IPS" ayuda="Le descuenta el 9 %." />
            <Interruptor valor={f.comisiona} onChange={(v) => set("comisiona", v)} label="Comisiona" ayuda="Apagado, sale de Comisiones." />
          </div>
        </Tarjeta>

        <Tarjeta icono={<Clock className="h-4 w-4" />} titulo="Horario de trabajo" detalle="Los días que trabaja y a qué hora entra y sale." className="xl:col-span-2">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
            <Campo label="Días">
              <div className="flex flex-wrap gap-1.5">
                {DIAS.map(([n, l]) => {
                  const on = f.horario_dias.includes(n);
                  return <button key={n} type="button" aria-pressed={on} onClick={() => set("horario_dias", on ? f.horario_dias.filter((x) => x !== n) : [...f.horario_dias, n].sort())}
                    className={`h-11 w-11 rounded-xl border text-sm font-semibold transition-colors ${on ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-slate-200 bg-white text-slate-600"}`}>{l}</button>;
                })}
              </div>
            </Campo>
            <div className="grid flex-1 gap-3 sm:grid-cols-[140px_140px_1fr]">
              <Campo label="Entrada"><Select block etiqueta="Entrada" value={f.horario_entrada ?? ""} onChange={(v) => set("horario_entrada", v)} options={opcionesHora(f.horario_entrada)} /></Campo>
              <Campo label="Salida"><Select block etiqueta="Salida" value={f.horario_salida ?? ""} onChange={(v) => set("horario_salida", v)} options={opcionesHora(f.horario_salida)} /></Campo>
              <Campo label="Nota">{texto("horario_nota")}</Campo>
            </div>
          </div>
        </Tarjeta>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="flex items-center justify-end gap-3 max-sm:flex-col max-sm:items-stretch">
        {faltaCorreo ? <span className="text-sm text-rose-600 max-sm:text-center">Para guardar falta el correo, con su @.</span> : listo ? <span className="text-sm font-medium text-emerald-700 max-sm:text-center">Guardado</span> : null}
        <button type="button" onClick={() => void guardar()} disabled={busy || faltaCorreo || (!hayCambios && !!ficha.legajo)} className={`${BOTON_PRIMARIO} sm:min-w-40`}>
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
  const anio = hoyPY().slice(0, 4);
  const delAnio = ficha.ausencias.filter((a) => !a.anulada_at && a.fecha.startsWith(anio));
  const diasDe = (l: typeof delAnio) => l.reduce((s, a) => s + Number(a.dias), 0);

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra label={`Días en ${anio}`} valor={diasDe(delAnio)} />
        <Cifra label="Descuentan" valor={diasDe(delAnio.filter((a) => a.descuenta))} sub="Días" />
        <Cifra label="No descuentan" valor={diasDe(delAnio.filter((a) => !a.descuenta))} sub="Días" />
      </div>
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
  const aumentos = ficha.historial.filter((e) => e.accion === "salario");
  const alta = ficha.historial.find((e) => e.accion === "legajo_creado");
  const evolucion = [
    ...aumentos.map((e) => ({ id: e.id, fecha: e.created_at, monto: Number(e.detalle.despues), antes: Number(e.detalle.antes) })),
    ...(alta ? [{ id: alta.id, fecha: alta.created_at, monto: Number(alta.detalle.salario), antes: 0 }] : []),
  ];
  const hitos = ficha.historial.filter((e) => e.accion === "nota").length;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-slate-500">Todo lo que pasó con esta persona, de lo más nuevo a lo más viejo.</p>
        <button type="button" className={BOTON_PRIMARIO} onClick={() => setNueva(true)}><Plus className="h-4 w-4" /> Agregar al historial</button>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {ficha.historial.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Todavía no hay nada registrado.</p> : <LineaTiempo eventos={ficha.historial} clave={(e) => e.id} fecha={(e) => e.created_at} render={(e) => <Evento e={e} />} />}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-3">
          <Tarjeta icono={<TrendingUp className="h-4 w-4" />} titulo="Evolución del salario">
            {evolucion.length === 0 ? <p className="text-sm text-slate-400">Se arma cuando cargues su salario.</p> : (
              <ol className="m-0 list-none space-y-2.5 p-0">
                {evolucion.map((x, i) => (
                  <li key={x.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-500">{fechaCorta(new Date(x.fecha).toLocaleDateString("sv-SE", { timeZone: "America/Asuncion" }))}</span>
                    <span className={`tabular-nums ${i === 0 ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {gs(x.monto)}{x.antes > 0 && x.monto !== x.antes ? <span className={x.monto > x.antes ? " text-emerald-700" : " text-rose-700"}> {x.monto > x.antes ? "+" : ""}{(((x.monto - x.antes) / x.antes) * 100).toLocaleString("es-PY", { maximumFractionDigits: 1 })} %</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Tarjeta>
          <Tarjeta icono={<Award className="h-4 w-4" />} titulo="En resumen">
            <dl className="m-0 space-y-2 text-sm">
              {([["Cambios de salario", aumentos.length], ["Ascensos y otros hitos", hitos], ["Ausencias", ficha.ausencias.filter((a) => !a.anulada_at).length], ["Vacaciones", ficha.vacaciones.filter((v) => !v.anulada_at).length]] as [string, number][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="m-0 font-semibold tabular-nums text-slate-900">{v}</dd></div>
              ))}
            </dl>
          </Tarjeta>
        </aside>
      </div>
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
    <div className="space-y-4 pb-10">
      <Link href={volver.href} className="-ml-1 inline-flex min-h-9 w-fit items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 no-underline transition-colors hover:text-slate-800 max-md:min-h-11 max-md:pr-2">
        <ArrowLeft className="h-3.5 w-3.5" /> {volver.label}
      </Link>
      <div className="overflow-hidden rounded-2xl border border-[var(--brand)]/40 bg-white shadow-sm">
        <div className="flex items-center gap-3 bg-gradient-to-br from-white via-white to-[var(--brand-50)] px-4 py-4 sm:gap-4 sm:px-6 sm:py-5">
          <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-lg font-semibold text-white">{ficha.usuario.nombre.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("")}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--brand)] max-sm:hidden">RR HH</p>
            <h1 className="mt-0.5 text-xl font-semibold leading-tight tracking-tight text-slate-900 [overflow-wrap:anywhere] sm:text-2xl">{ficha.usuario.nombre}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span><span className="font-medium text-slate-400">Código:</span> N.º {ficha.usuario.codigo}</span>
              {ficha.usuario.ci ? <span><span className="font-medium text-slate-400">CI:</span> {ficha.usuario.ci}</span> : null}
              {ficha.usuario.telefono ? <span>{ficha.usuario.telefono}</span> : null}
              {!ficha.usuario.activo ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Inactivo</span>
                : l?.fecha_egreso ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Salió el {fechaCorta(l.fecha_egreso)}</span>
                : l ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">Activo</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Falta cargar sus datos</span>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 md:grid-cols-3 xl:grid-cols-6">
          {([
            ["Perfil", ficha.usuario.perfil ?? "—", ""],
            ["Sucursal", ficha.usuario.sucursal ?? "Sin sucursal fija", ""],
            ["Área", l?.area ?? "—", ""],
            [l?.tipo_salario === "jornalero" ? "Jornal" : "Salario", l ? gs(l.salario) : "—", l ? (l.tipo_salario === "jornalero" ? "Por día" : "Por mes") : ""],
            ["Antigüedad", l ? textoAntiguedad(antiguedad(l.fecha_ingreso, corte)) : "—", l ? `Desde ${fechaCorta(l.fecha_ingreso)}` : ""],
            ["Aguinaldo acumulado", ag ? gs(ag.total) : "—", ag ? [ag.meses_cerrados ? `Cerrado: ${ag.meses_cerrados} ${ag.meses_cerrados === 1 ? "mes" : "meses"}` : "", ag.meses_estimados ? `Estimado: ${ag.meses_estimados} ${ag.meses_estimados === 1 ? "mes" : "meses"}` : ""].filter(Boolean).join(" · ") : ""],
          ] as [string, string, string][]).map(([k, v, sub]) => (
            <div key={k} className="min-w-0 bg-[#fcfdfd] px-3 py-3 sm:px-5 sm:py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{k}</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">{v}</p>
              {sub ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</p> : null}
            </div>
          ))}
        </div>
        <ScrollHorizontal role="tablist" className="border-t border-slate-100" claseFila="gap-0" dependencias={[tab]}>
          {tabs.map(([t, label]) => {
            const bloqueada = !l && t !== "datos" && t !== "historial";
            return (
              <button key={t} type="button" role="tab" aria-selected={tab === t} disabled={bloqueada} title={bloqueada ? "Primero guardá sus datos" : undefined} onClick={() => setTab(t)}
                className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-5 ${tab === t ? "border-[var(--brand)] text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{label}</button>
            );
          })}
        </ScrollHorizontal>
      </div>
      {!l ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Completá el <b>correo</b> y la <b>fecha de ingreso</b>, y tocá <b>Guardar</b>: ahí se prenden Ausencias, Vacaciones y Liquidaciones.</p> : null}

      {tab === "datos" ? <Datos key={l ? "con" : "sin"} ficha={ficha} onGuardado={cargar} /> : null}
      {tab === "ausencias" && l ? <Ausencias ficha={ficha} onCambio={cargar} /> : null}
      {tab === "vacaciones" && l ? <Vacaciones ficha={ficha} corte={corte} onCambio={cargar} /> : null}
      {tab === "liquidaciones" && l ? <Liquidaciones ficha={ficha} /> : null}
      {tab === "historial" ? <Historial ficha={ficha} onCambio={cargar} /> : null}
    </div>
  );
}
