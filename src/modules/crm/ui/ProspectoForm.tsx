"use client";

/**
 * Formulario del prospecto (alta y edición), con las secciones del sistema actual:
 * Datos del prospecto · Oportunidad (servicios = planes, valor estimado, etapa inicial) ·
 * Seguimiento (próxima acción + fecha, responsable, origen, creado por).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import {
  ORIGENES, ORIGEN_LABEL, limpiarTelefono, telefonoValido,
  type Etapa, type Origen, type Prospecto, type Tarjeta,
} from "@/modules/crm/tipos";
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, LABEL, PlanSelector, SectionTitle, usePlanes, useUsuarios } from "./comun";
import { SelectorFecha } from "@/components/SelectorFecha";

type Campos = {
  empresa: string; contacto: string; email: string; telefono: string; observaciones: string;
  planIds: string[]; servicioLibre: string; valor: string; etapa: string;
  proxima_accion: string; fecha_proxima_accion: string; responsable_usuario_id: string; origen_creacion: Origen; origen_detalle: string;
};

const soloDigitos = (v: string) => v.replace(/\D/g, "");
const miles = (v: string) => (v ? Number(v).toLocaleString("es-PY") : "");

export function ProspectoForm({
  modo, prospecto, etapas, variant, onGuardado, onCancel,
}: {
  modo: "nuevo" | "editar";
  prospecto?: Prospecto | null;
  /** etapas activas (para la etapa inicial del alta) */
  etapas: Etapa[];
  variant: "modal" | "page";
  onGuardado: (r: { tarjeta?: Tarjeta; prospecto?: Prospecto }) => void;
  onCancel?: () => void;
}) {
  const me = useUsuario();
  const planes = usePlanes();
  const usuarios = useUsuarios();
  const abiertas = useMemo(() => etapas.filter((e) => !e.es_ganado && !e.es_perdido), [etapas]);

  const [f, setF] = useState<Campos>(() => ({
    empresa: prospecto?.empresa ?? "",
    contacto: prospecto?.contacto ?? "",
    email: prospecto?.email ?? "",
    telefono: prospecto?.telefono ?? "",
    observaciones: prospecto?.observaciones ?? "",
    planIds: [],
    servicioLibre: prospecto?.servicio ?? "",
    valor: prospecto ? String(Math.round(prospecto.valor_estimado || 0) || "") : "",
    etapa: "",
    proxima_accion: prospecto?.proxima_accion ?? "",
    fecha_proxima_accion: prospecto?.fecha_proxima_accion?.slice(0, 10) ?? "",
    responsable_usuario_id: prospecto?.responsable_usuario_id ?? "",
    origen_creacion: prospecto?.origen_creacion ?? "manual",
    origen_detalle: prospecto?.origen_detalle ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Campos>(k: K, v: Campos[K]) => { setError(null); setF((p) => ({ ...p, [k]: v })); };

  // Etapa inicial: la primera abierta (LEAD).
  useEffect(() => {
    if (modo === "nuevo" && !f.etapa && abiertas.length) setF((p) => ({ ...p, etapa: abiertas[0].codigo }));
  }, [modo, abiertas, f.etapa]);
  // Responsable por defecto en el alta: yo.
  useEffect(() => {
    if (modo === "nuevo" && me?.usuarioId) setF((p) => (p.responsable_usuario_id ? p : { ...p, responsable_usuario_id: me.usuarioId! }));
  }, [modo, me?.usuarioId]);
  // Servicio guardado "Plan A, Plan B" → ids de planes (al editar).
  useEffect(() => {
    if (!planes?.length || !prospecto?.servicio) return;
    const nombres = prospecto.servicio.split(",").map((s) => s.trim()).filter(Boolean);
    const ids = nombres.map((n) => planes.find((p) => p.nombre === n)?.id).filter((x): x is string => !!x);
    setF((p) => ({ ...p, planIds: ids }));
  }, [planes, prospecto?.servicio]);

  const hayPlanes = !!planes && planes.length > 0;

  function togglePlan(id: string) {
    setF((p) => {
      const planIds = p.planIds.includes(id) ? p.planIds.filter((x) => x !== id) : [...p.planIds, id];
      // Valor estimado = suma de los planes en guaraníes (se puede corregir a mano).
      const suma = planIds.reduce((s, pid) => {
        const pl = planes?.find((x) => x.id === pid);
        return s + (pl && pl.moneda !== "USD" ? pl.precio : 0);
      }, 0);
      return { ...p, planIds, valor: suma ? String(Math.round(suma)) : "" };
    });
    setError(null);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.empresa.trim()) return setError("La empresa es obligatoria.");
    if (!f.contacto.trim()) return setError("El contacto es obligatorio.");
    if (modo === "nuevo" && hayPlanes && f.planIds.length === 0) return setError("Seleccioná al menos un servicio/plan.");
    if (modo === "nuevo" && !f.etapa) return setError("Seleccioná una etapa.");
    if (f.telefono && !telefonoValido(f.telefono)) return setError("Número inválido. Usá formato local 0981100453 o internacional +595981100453.");

    // Con planes: los elegidos. Si al editar no coincide ninguno (servicio cargado a mano o un
    // plan que ya no existe), se conserva el texto guardado.
    const servicio = hayPlanes
      ? f.planIds.map((id) => planes!.find((p) => p.id === id)?.nombre).filter(Boolean).join(", ") || (modo === "editar" ? (prospecto?.servicio ?? "") : "")
      : f.servicioLibre.trim();
    const body = {
      empresa: f.empresa.trim().toUpperCase(),
      contacto: f.contacto.trim().toUpperCase(),
      email: f.email.trim(),
      telefono: f.telefono ? limpiarTelefono(f.telefono) : "",
      servicio,
      valor_estimado: Number(f.valor) || 0,
      proxima_accion: f.proxima_accion.trim(),
      fecha_proxima_accion: f.fecha_proxima_accion,
      responsable_usuario_id: f.responsable_usuario_id,
      origen_creacion: f.origen_creacion,
      origen_detalle: f.origen_detalle.trim(),
      observaciones: f.observaciones.trim(),
      ...(modo === "nuevo" ? { etapa: f.etapa } : {}),
    };
    setSaving(true);
    try {
      if (modo === "nuevo") {
        const t = await apiFetch<Tarjeta>("/api/crm", { method: "POST", body: JSON.stringify(body) });
        onGuardado({ tarjeta: t });
      } else {
        const r = await apiFetch<{ prospecto: Prospecto }>(`/api/crm/${prospecto!.id}`, { method: "PATCH", body: JSON.stringify(body) });
        onGuardado({ prospecto: r.prospecto });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const isModal = variant === "modal";
  const seccion = isModal || modo === "editar" ? "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" : "";
  const opcionesResp: [string, string][] = [["", "— Sin asignar —"], ...usuarios.map((u) => [u.id, u.nombre] as [string, string])];
  const creadoPor = modo === "nuevo" ? (me?.email ?? "Tu usuario") : prospecto?.creado_por_nombre || "—";

  return (
    <form
      onSubmit={guardar}
      className={isModal ? "flex h-full min-h-0 flex-col" : modo === "nuevo" ? "space-y-6 rounded-2xl border border-[var(--brand)]/45 bg-white p-4 shadow-sm sm:p-6" : "space-y-5"}
    >
      <div className={isModal ? "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/50 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-5" : "space-y-6"}>
        <section className={seccion}>
          <SectionTitle>Datos del prospecto</SectionTitle>
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Empresa <span className="text-rose-500">*</span></label>
              <input value={f.empresa} onChange={(e) => set("empresa", e.target.value.toUpperCase())} placeholder="Nombre de la empresa" className={`${INPUT} uppercase`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Persona de contacto <span className="text-rose-500">*</span></label>
                <input value={f.contacto} onChange={(e) => set("contacto", e.target.value.toUpperCase())} placeholder="Nombre y apellido" className={`${INPUT} uppercase`} />
              </div>
              <div>
                <label className={LABEL}>Teléfono</label>
                <input value={f.telefono} onChange={(e) => set("telefono", limpiarTelefono(e.target.value))} placeholder="0981 100 453" inputMode="tel" autoComplete="off" className={INPUT} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input type="email" value={f.email} onChange={(e) => set("email", e.target.value.toLowerCase())} placeholder="contacto@empresa.com" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Comentarios / observaciones internas</label>
              <textarea value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} rows={4} placeholder="Contexto, objeciones, acuerdos, próximos pasos… (solo equipo)" className={`${INPUT} min-h-[96px] resize-y`} />
              {modo === "editar" ? <p className="mt-1 text-xs text-slate-500">Distinto de las notas con fecha: este bloque es un campo único editable del prospecto.</p> : null}
            </div>
          </div>
        </section>

        <section className={seccion}>
          <SectionTitle>Oportunidad</SectionTitle>
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Servicios / Productos de interés {modo === "nuevo" && hayPlanes ? <span className="text-rose-500">*</span> : null}</label>
              {planes === null ? (
                <p className="py-2 text-sm text-slate-400">Cargando planes…</p>
              ) : hayPlanes ? (
                <PlanSelector planes={planes} seleccion={f.planIds} onToggle={togglePlan} />
              ) : (
                <>
                  <input value={f.servicioLibre} onChange={(e) => set("servicioLibre", e.target.value)} placeholder="Producto o servicio de interés" className={INPUT} />
                  <p className="mt-1 text-xs text-slate-500">
                    No hay planes creados.{" "}
                    <Link href="/clientes/suscripciones" className="font-medium text-[var(--brand)] hover:underline">Crear un plan →</Link>
                  </p>
                </>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Valor estimado (Gs.)</label>
                <input
                  value={miles(f.valor)}
                  onChange={(e) => set("valor", soloDigitos(e.target.value).slice(0, 15))}
                  inputMode="numeric"
                  placeholder={hayPlanes ? "Se calcula con los planes" : "0"}
                  className={`${INPUT} tabular-nums`}
                />
                {hayPlanes && f.planIds.length ? <p className="mt-1 text-xs text-slate-500">Suma de los planes seleccionados</p> : null}
              </div>
              {modo === "nuevo" ? (
                <div>
                  <label className={LABEL}>Etapa inicial</label>
                  <Select block value={f.etapa} onChange={(v) => set("etapa", v)} options={abiertas.map((e) => [e.codigo, e.nombre] as [string, string])} />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className={seccion}>
          <SectionTitle>Seguimiento</SectionTitle>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Próxima acción</label>
                <input value={f.proxima_accion} onChange={(e) => set("proxima_accion", e.target.value)} placeholder="Ej: Enviar propuesta" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Fecha próxima acción</label>
                <SelectorFecha block etiqueta="Fecha próxima acción" value={f.fecha_proxima_accion} onChange={(v) => set("fecha_proxima_accion", v)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Responsable</label>
                <Select block value={f.responsable_usuario_id} onChange={(v) => set("responsable_usuario_id", v)} options={opcionesResp} />
                {modo === "editar" ? <p className="mt-1 text-xs text-slate-500">Cambiar el responsable transfiere el lead a ese asesor.</p> : null}
              </div>
              <div>
                <label className={LABEL}>Creado por</label>
                <input readOnly value={creadoPor} className={`${INPUT} cursor-not-allowed bg-slate-50`} />
                <p className="mt-1 text-xs text-slate-500">{modo === "nuevo" ? "Se registra automáticamente con tu usuario" : "Registro inmutable del creador del lead"}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL}>Origen</label>
                <Select block value={f.origen_creacion} onChange={(v) => set("origen_creacion", v as Origen)} options={ORIGENES.map((o) => [o, ORIGEN_LABEL[o]] as [string, string])} />
              </div>
              <div>
                <label className={LABEL}>Detalle del origen</label>
                <input value={f.origen_detalle} onChange={(e) => set("origen_detalle", e.target.value)} placeholder="Ej: campaña de octubre, referido por…" className={INPUT} />
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">⚠ {error}</div>
        ) : null}

        {!isModal && modo === "editar" ? (
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className={BTN_PRIMARIO}>{saving ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        ) : null}
      </div>

      {isModal || modo === "nuevo" ? (
        <div className={isModal ? "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:[&>*]:flex-1 sm:px-6 sm:py-4" : "flex flex-wrap items-center justify-end gap-2 pt-2"}>
          {onCancel ? <button type="button" onClick={onCancel} className={BTN_SECUNDARIO}>Cancelar</button> : null}
          <button type="submit" disabled={saving} className={BTN_PRIMARIO}>
            {saving ? "Guardando…" : modo === "nuevo" ? "Guardar prospecto" : "Guardar cambios"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
