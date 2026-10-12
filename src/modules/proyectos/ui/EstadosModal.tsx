"use client";

/**
 * "Configurar estados" (ADMIN): las columnas del tablero. Los códigos son fijos; se edita
 * nombre, color, orden, tipo de SLA, objetivo en horas laborales, rol, estado inicial y
 * si está activo. Un estado con proyectos no se puede desactivar (lo valida la API).
 * Arriba, los parámetros de seguimiento (proyecto_config) que usan Tareas del equipo y los
 * dashboards: WIP por técnico, "vence pronto" (días) y "sin movimiento" (horas laborales).
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Settings2 } from "lucide-react";
import { ColorPicker } from "@/components/ColorPicker";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import {
  CONFIG_DEFECTO, ROLES_ESTADO, ROL_LABEL, TIPOS_SLA, TIPO_SLA_LABEL, type Estado, type ProyectoConfig, type RolEstado, type TipoSla,
} from "@/modules/proyectos/tipos";
import { BTN_PRIMARIO, BTN_SECUNDARIO, ModalChico } from "./comun";

type Fila = Required<Estado> & { cantidad: number };

const PARAMETROS: [keyof ProyectoConfig, string, string, number, number, string][] = [
  ["wip_por_tecnico", "WIP por técnico", "proyectos a la vez", 1, 50, "Proyectos en estados que cuentan SLA que un técnico lleva a la vez. Por encima queda “sobre el límite”."],
  ["vence_pronto_dias", "Vence pronto", "días antes", 1, 60, "Cuántos días antes de la fecha prometida un proyecto pasa a “vence pronto”."],
  ["sin_movimiento_horas", "Sin movimiento", "h laborales", 1, 500, "Horas laborales sin actividad (en un estado que cuenta SLA) para marcarlo “sin movimiento”."],
];

export function EstadosModal({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [estados, setEstados] = useState<Fila[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Record<keyof ProyectoConfig, string> | null>(null);
  const [cfgOriginal, setCfgOriginal] = useState<ProyectoConfig | null>(null);

  useEffect(() => {
    apiFetch<Fila[]>("/api/proyectos/estados").then(setEstados).catch((e) => setError((e as Error).message));
    apiFetch<ProyectoConfig>("/api/proyectos/config")
      .catch(() => CONFIG_DEFECTO)
      .then((c) => {
        setCfgOriginal(c);
        setCfg({ wip_por_tecnico: String(c.wip_por_tecnico), vence_pronto_dias: String(c.vence_pronto_dias), sin_movimiento_horas: String(c.sin_movimiento_horas) });
      });
  }, []);

  const cfgNum = cfg ? {
    wip_por_tecnico: Number(cfg.wip_por_tecnico),
    vence_pronto_dias: Number(cfg.vence_pronto_dias),
    sin_movimiento_horas: Number(cfg.sin_movimiento_horas),
  } : null;
  const fuera = (v: number, min: number, max: number) => !Number.isInteger(v) || v < min || v > max;
  const cfgInvalida = !!cfgNum && (fuera(cfgNum.wip_por_tecnico, 1, 50) || fuera(cfgNum.vence_pronto_dias, 1, 60) || fuera(cfgNum.sin_movimiento_horas, 1, 500));
  const cfgCambio = !!cfgNum && !!cfgOriginal && (Object.keys(cfgNum) as (keyof ProyectoConfig)[]).some((k) => cfgNum[k] !== cfgOriginal[k]);

  const set = (i: number, patch: Partial<Fila>) => setEstados((p) => p && p.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const setInicial = (i: number) => setEstados((p) => p && p.map((e, j) => ({ ...e, es_inicial: j === i })));
  const mover = (i: number, d: -1 | 1) =>
    setEstados((p) => {
      if (!p) return p;
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const n = [...p];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function guardar() {
    if (!estados) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/proyectos/estados", {
        method: "PUT",
        body: JSON.stringify({
          estados: estados.map((e, i) => ({
            id: e.id,
            nombre: e.nombre.trim(),
            color: e.color,
            orden: i + 1,
            tipo_sla: e.tipo_sla,
            sla_horas_objetivo: e.tipo_sla === "interno" && e.sla_horas_objetivo ? Number(e.sla_horas_objetivo) : null,
            rol: e.rol,
            es_inicial: e.es_inicial,
            activo: e.activo,
          })),
        }),
      });
      if (cfgCambio && cfgNum) await apiFetch("/api/proyectos/config", { method: "PUT", body: JSON.stringify(cfgNum) });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <ModalChico
      titulo="Estados de proyectos"
      subtitulo="Columnas del tablero. Podés cambiar el nombre, el color, el orden, el SLA y ocultar las que no uses. Los códigos son fijos."
      icono={<Settings2 className="h-[18px] w-[18px]" />}
      ancho="max-w-5xl"
      onClose={onClose}
      pie={
        <>
          {error ? <p className="mr-auto max-w-xl text-xs text-rose-700">{error}</p> : null}
          <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={busy || !estados || estados.some((e) => !e.nombre.trim()) || cfgInvalida} className={BTN_PRIMARIO}>
            {busy ? "Guardando…" : "Guardar estados"}
          </button>
        </>
      }
    >
      {!estados ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          {cfg ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-white px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Seguimiento</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">Lo usan Tareas del equipo y los dashboards.</p>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
                {PARAMETROS.map(([k, label, unidad, min, max, ayuda]) => (
                  <label key={k} className="block">
                    <span className="text-xs font-medium text-slate-600">{label}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <input type="number" min={min} max={max} step={1} value={cfg[k]} onChange={(ev) => setCfg((p) => p && { ...p, [k]: ev.target.value })}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20" />
                      <span className="text-xs text-slate-500">{unidad}</span>
                    </span>
                    <span className="mt-1 block text-[10.5px] leading-snug text-slate-400">{ayuda}</span>
                  </label>
                ))}
              </div>
              {cfgInvalida ? <p className="mt-2 text-xs text-rose-600">Revisá los valores: WIP de 1 a 50, vence pronto de 1 a 60 días y sin movimiento de 1 a 500 horas (números enteros).</p> : null}
            </div>
          ) : null}
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-500">
            <strong className="text-slate-600">Tipo de SLA:</strong> solo los estados <em>Interno</em> cuentan horas laborales contra su objetivo (≥ 75% = en riesgo, más del 100% = vencido).
            Espera del cliente, Pausado y Final no cuentan. Los de rol Entregado / Cancelado tienen que ser Final.
          </p>
          <ul className="space-y-2">
            {estados.map((e, i) => (
              <li key={e.id} className={`rounded-xl border border-slate-200 border-l-4 bg-white px-3 py-2.5 ${e.activo ? "" : "opacity-60"}`} style={{ borderLeftColor: e.color }}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => mover(i, 1)} disabled={i === estados.length - 1} aria-label="Bajar" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </div>
                  <span className="w-28 shrink-0 truncate font-mono text-[11px] text-slate-400" title={e.codigo}>{e.codigo}</span>
                  <input value={e.nombre} onChange={(ev) => set(i, { nombre: ev.target.value })} maxLength={60} aria-label="Nombre"
                    className="min-w-36 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20" />
                  <div className="w-36 shrink-0"><ColorPicker value={e.color} onChange={(c) => set(i, { color: c })} block /></div>
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-slate-500">{e.cantidad} proy.</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                  <div className="w-48">
                    <Select block value={e.tipo_sla} onChange={(v) => set(i, { tipo_sla: v as TipoSla })} options={TIPOS_SLA.map((t) => [t, TIPO_SLA_LABEL[t]] as [string, string])} className="[&>button]:py-1.5 [&>button]:text-xs" />
                  </div>
                  <label className={`flex items-center gap-1.5 text-xs text-slate-600 ${e.tipo_sla === "interno" ? "" : "pointer-events-none opacity-40"}`}>
                    Objetivo
                    <input type="number" min={0} max={10000} step={1} value={e.sla_horas_objetivo ?? ""} placeholder="—"
                      onChange={(ev) => set(i, { sla_horas_objetivo: ev.target.value === "" ? null : Number(ev.target.value) })}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:border-[var(--brand)]" />
                    h laborales
                  </label>
                  <div className="w-44">
                    <Select block value={e.rol} onChange={(v) => set(i, { rol: v as RolEstado })} options={ROLES_ESTADO.map((r) => [r, `Rol: ${ROL_LABEL[r]}`] as [string, string])} className="[&>button]:py-1.5 [&>button]:text-xs" />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="radio" name="estado-inicial" checked={e.es_inicial} onChange={() => setInicial(i)} className="accent-[var(--brand)]" />
                    Inicial
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={e.activo} onChange={(ev) => set(i, { activo: ev.target.checked })} className="accent-[var(--brand)]" />
                    Activo
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </ModalChico>
  );
}
