"use client";

/**
 * Pestaña Datos: los campos genéricos del proyecto (como "Datos del proyecto" del actual):
 * cliente, descripción, prioridad, fechas, monto, responsables, bloqueo y — según el
 * estado — motivo de pausa / cancelación. Se guarda todo junto ("Guardar datos").
 * Sin permiso de edición se ve igual pero deshabilitado.
 */
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import { apiFetch } from "@/lib/api/client-fetch";
import { ClienteSelect, type ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import {
  BLOQUEO_TIPOS, BLOQUEO_TIPO_LABEL, PRIORIDADES, PRIORIDAD_LABEL, isoALocal, localAIso,
  type Detalle, type Prioridad,
} from "@/modules/proyectos/tipos";
import { INPUT, LABEL, PANEL, TituloPanel, useUsuarios } from "./comun";
import { SelectorFecha, SelectorFechaHora } from "@/components/SelectorFecha";

type Form = {
  titulo: string;
  cliente: ClienteOpcion | null;
  descripcion: string;
  prioridad: Prioridad;
  fecha_ingreso: string;
  fecha_prometida: string;
  monto_vendido: number;
  moneda: "GS" | "USD";
  responsable_comercial_id: string;
  responsable_tecnico_id: string;
  project_manager_id: string;
  bloqueado: boolean;
  bloqueo_tipo: string;
  bloqueo_motivo: string;
  bloqueo_responsable: string;
  bloqueo_proxima_accion: string;
  cancelacion_motivo: string;
  pausa_motivo: string;
};

function desde(d: Detalle): Form {
  const p = d.proyecto;
  return {
    titulo: p.titulo,
    cliente: p.cliente_id ? { id: p.cliente_id, nombre: p.cliente_nombre } : null,
    descripcion: p.descripcion ?? "",
    prioridad: p.prioridad,
    fecha_ingreso: p.fecha_ingreso ?? "",
    fecha_prometida: isoALocal(p.fecha_prometida),
    monto_vendido: Number(p.monto_vendido) || 0,
    moneda: p.moneda === "USD" ? "USD" : "GS",
    responsable_comercial_id: p.responsable_comercial_id ?? "",
    responsable_tecnico_id: p.responsable_tecnico_id ?? "",
    project_manager_id: p.project_manager_id ?? "",
    bloqueado: p.bloqueado,
    bloqueo_tipo: p.bloqueo_tipo ?? "",
    bloqueo_motivo: p.bloqueo_motivo ?? "",
    bloqueo_responsable: p.bloqueo_responsable ?? "",
    bloqueo_proxima_accion: p.bloqueo_proxima_accion ?? "",
    cancelacion_motivo: p.cancelacion_motivo ?? "",
    pausa_motivo: p.pausa_motivo ?? "",
  };
}

const firma = (f: Form) => JSON.stringify({ ...f, cliente: f.cliente?.id ?? null });

export function TabDatos({ d, onGuardado }: { d: Detalle; onGuardado: (d: Detalle) => void }) {
  const usuarios = useUsuarios();
  const [f, setF] = useState<Form>(() => desde(d));
  const [base, setBase] = useState(() => firma(desde(d)));
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = d.permisos.editar;
  const estado = d.estado;

  // Cambió el proyecto afuera (estado, archivar…): se toma lo nuevo si no hay cambios sin guardar.
  useEffect(() => {
    const nuevo = desde(d);
    setF((prev) => (firma(prev) === base ? nuevo : prev));
    setBase(firma(nuevo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const sucio = firma(f) !== base;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setOk(false); };
  const opciones = useMemo<[string, string][]>(() => {
    const op: [string, string][] = [["", "— Sin asignar —"], ...usuarios.map((u) => [u.id, u.nombre] as [string, string])];
    // Un responsable que ya no está activo igual se muestra.
    for (const [id, nombre] of [
      [d.proyecto.responsable_comercial_id, d.proyecto.comercial_nombre],
      [d.proyecto.responsable_tecnico_id, d.proyecto.tecnico_nombre],
      [d.proyecto.project_manager_id, d.proyecto.pm_nombre],
    ] as const) {
      if (id && !op.some((o) => o[0] === id)) op.push([id, nombre ?? "Usuario"]);
    }
    return op;
  }, [usuarios, d.proyecto]);

  async function guardar() {
    setError(null);
    if (!f.titulo.trim()) return setError("El título es obligatorio.");
    if (f.bloqueado && !f.bloqueo_motivo.trim()) return setError("Indicá el motivo del bloqueo.");
    if (f.fecha_prometida && !localAIso(f.fecha_prometida)) return setError("La fecha prometida no es válida.");
    setGuardando(true);
    try {
      const r = await apiFetch<Detalle>(`/api/proyectos/${d.proyecto.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          titulo: f.titulo.trim(),
          cliente_id: f.cliente?.id ?? null,
          descripcion: f.descripcion.trim() || null,
          prioridad: f.prioridad,
          ...(f.fecha_ingreso ? { fecha_ingreso: f.fecha_ingreso } : {}),
          fecha_prometida: f.fecha_prometida ? localAIso(f.fecha_prometida) : null,
          monto_vendido: f.monto_vendido || 0,
          moneda: f.moneda,
          responsable_comercial_id: f.responsable_comercial_id || null,
          responsable_tecnico_id: f.responsable_tecnico_id || null,
          project_manager_id: f.project_manager_id || null,
          bloqueado: f.bloqueado,
          ...(f.bloqueado
            ? {
                bloqueo_tipo: f.bloqueo_tipo || null,
                bloqueo_motivo: f.bloqueo_motivo.trim(),
                bloqueo_responsable: f.bloqueo_responsable.trim() || null,
                bloqueo_proxima_accion: f.bloqueo_proxima_accion.trim() || null,
              }
            : {}),
          ...(estado?.rol === "cancelado" ? { cancelacion_motivo: f.cancelacion_motivo.trim() || null } : {}),
          ...(estado?.tipo_sla === "pausado" ? { pausa_motivo: f.pausa_motivo.trim() || null } : {}),
        }),
      });
      const nuevo = desde(r);
      setF(nuevo);
      setBase(firma(nuevo));
      setOk(true);
      onGuardado(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className={`space-y-5 ${PANEL}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TituloPanel>Datos del proyecto</TituloPanel>
        {editable ? (
          <div className="flex items-center gap-2">
            {ok && !sucio ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" /> Guardado</span> : null}
            {sucio ? <button type="button" onClick={() => { setF(desde(d)); setError(null); }} className="text-xs font-medium text-slate-500 hover:text-slate-700">Descartar</button> : null}
            <button type="button" disabled={!sucio || guardando} onClick={() => void guardar()}
              className="rounded-xl bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
              {guardando ? "Guardando…" : "Guardar datos"}
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">Solo lectura: editan el comercial, el técnico, el PM o un administrador.</span>
        )}
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">{error}</div> : null}

      <fieldset disabled={!editable || guardando} className="space-y-5">
        <Bloque titulo="Cliente y descripción">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={LABEL}>Título <span className="text-rose-500">*</span></span>
              <input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} maxLength={200} className={INPUT} />
            </label>
            <div className="sm:col-span-2">
              <span className={LABEL}>Cliente asignado</span>
              <div className={editable ? "" : "pointer-events-none opacity-70"}>
                <ClienteSelect valor={f.cliente} onChange={(c) => set("cliente", c)} />
              </div>
              {!f.cliente ? (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  Este proyecto no tiene un cliente asignado: no aparece en la ficha de ningún cliente. Asigná el cliente y guardá para vincularlo.
                </p>
              ) : null}
            </div>
            <label className="block sm:col-span-2">
              <span className={LABEL}>Descripción</span>
              <textarea value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} rows={5} maxLength={8000} className={`${INPUT} min-h-[110px] resize-y leading-relaxed`} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo="Fechas, monto y prioridad">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className={LABEL}>Prioridad</span>
              <Select block value={f.prioridad} onChange={(v) => set("prioridad", v as Prioridad)} options={PRIORIDADES.map((p) => [p, PRIORIDAD_LABEL[p]] as [string, string])} disabled={!editable} />
            </div>
            <div className="block">
              <span className={LABEL}>Fecha de ingreso</span>
              <SelectorFecha block etiqueta="Fecha de ingreso" value={f.fecha_ingreso} onChange={(v) => set("fecha_ingreso", v)} />
            </div>
            <div className="block">
              <span className={LABEL}>Fecha prometida</span>
              <SelectorFechaHora block etiqueta="Fecha prometida" value={f.fecha_prometida} onChange={(v) => set("fecha_prometida", v)} />
            </div>
            <div>
              <span className={LABEL}>Monto vendido</span>
              <div className="flex gap-2">
                <MontoInput value={f.monto_vendido} onChange={(v) => set("monto_vendido", v)} decimals={f.moneda === "USD"} className={`${INPUT} tabular-nums`} />
                <Select value={f.moneda} onChange={(v) => set("moneda", v as "GS" | "USD")} options={[["GS", "Gs."], ["USD", "US$"]]} minWidth={84} disabled={!editable} />
              </div>
            </div>
          </div>
          {!f.fecha_prometida ? <p className="mt-2 text-[11.5px] text-amber-700">Sin fecha prometida: en el tablero queda &quot;A definir&quot;.</p> : null}
        </Bloque>

        <Bloque titulo="Asignación">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <span className={LABEL}>Asesor comercial</span>
              <Select block value={f.responsable_comercial_id} onChange={(v) => set("responsable_comercial_id", v)} options={opciones} disabled={!editable} />
            </div>
            <div>
              <span className={LABEL}>Técnico responsable</span>
              <Select block value={f.responsable_tecnico_id} onChange={(v) => set("responsable_tecnico_id", v)} options={opciones} disabled={!editable} />
            </div>
            <div>
              <span className={LABEL}>Project Manager</span>
              <Select block value={f.project_manager_id} onChange={(v) => set("project_manager_id", v)} options={opciones} disabled={!editable} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Al técnico y al PM nuevos les llega un aviso.</p>
        </Bloque>

        <Bloque titulo="Bloqueo">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={f.bloqueado} onChange={(e) => set("bloqueado", e.target.checked)} className="h-4 w-4 accent-rose-600" />
            El proyecto está bloqueado
          </label>
          {f.bloqueado ? (
            <div className="mt-3 grid gap-4 rounded-xl border border-rose-100 bg-rose-50/40 p-4 sm:grid-cols-2">
              <div>
                <span className={LABEL}>Tipo de bloqueo</span>
                <Select block value={f.bloqueo_tipo} onChange={(v) => set("bloqueo_tipo", v)} disabled={!editable}
                  options={[["", "— Sin especificar —"], ...BLOQUEO_TIPOS.map((b) => [b, BLOQUEO_TIPO_LABEL[b]] as [string, string])]} />
              </div>
              <label className="block">
                <span className={LABEL}>Quién lo destraba</span>
                <input value={f.bloqueo_responsable} onChange={(e) => set("bloqueo_responsable", e.target.value)} maxLength={200} placeholder="Ej.: el cliente, contabilidad, el proveedor…" className={INPUT} />
              </label>
              <label className="block sm:col-span-2">
                <span className={LABEL}>Motivo <span className="text-rose-500">*</span></span>
                <textarea value={f.bloqueo_motivo} onChange={(e) => set("bloqueo_motivo", e.target.value)} rows={2} maxLength={1000} placeholder="Qué lo tiene trabado" className={`${INPUT} resize-none`} />
              </label>
              <label className="block sm:col-span-2">
                <span className={LABEL}>Próxima acción</span>
                <input value={f.bloqueo_proxima_accion} onChange={(e) => set("bloqueo_proxima_accion", e.target.value)} maxLength={500} placeholder="Qué sigue para destrabarlo" className={INPUT} />
              </label>
            </div>
          ) : null}
        </Bloque>

        {estado?.tipo_sla === "pausado" ? (
          <Bloque titulo="Pausa">
            <label className="block">
              <span className={LABEL}>Motivo de la pausa</span>
              <textarea value={f.pausa_motivo} onChange={(e) => set("pausa_motivo", e.target.value)} rows={2} maxLength={1000} className={`${INPUT} resize-none`} />
            </label>
          </Bloque>
        ) : null}

        {estado?.rol === "cancelado" ? (
          <Bloque titulo="Cancelación">
            <label className="block">
              <span className={LABEL}>Motivo de la cancelación</span>
              <textarea value={f.cancelacion_motivo} onChange={(e) => set("cancelacion_motivo", e.target.value)} rows={2} maxLength={1000}
                placeholder="Por qué no continúa: el cliente desistió, se cayó el presupuesto, se duplicó el proyecto…" className={`${INPUT} resize-none leading-relaxed`} />
              {!f.cancelacion_motivo.trim() ? <span className="mt-1 block text-[11.5px] text-amber-700">Un proyecto cancelado sin motivo no se puede explicar tres meses después.</span> : null}
            </label>
          </Bloque>
        ) : null}
      </fieldset>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{titulo}</p>
      {children}
    </div>
  );
}
