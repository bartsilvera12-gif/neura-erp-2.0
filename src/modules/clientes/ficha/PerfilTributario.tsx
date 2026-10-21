"use client";

/**
 * Perfil tributario del cliente (portado de sistemas-propio): solo aparece si la empresa
 * activó "gestión tributaria de clientes" en Configuración › Facturación. Datos para
 * cumplimiento y honorarios profesionales; no reemplaza la identificación comercial.
 *   · Lectura en una tarjeta como las demás de la pestaña Información; "Editar" abre el modal.
 *   · La clave tributaria se manda al servidor, que la cifra; nunca vuelve: solo "configurada".
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Landmark, Loader2, Pencil, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetch } from "@/lib/api/client-fetch";
import MontoInput from "@/components/ui/MontoInput";
import { TEAL } from "@/modules/clientes/ui";
import type { PerfilTributario as Perfil, PerfilTributarioLectura } from "@/modules/facturacion/tipos";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)] disabled:bg-slate-50";
const LABEL = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";
const gs = (n: number | null | undefined) => (n != null && Number(n) > 0 ? `Gs. ${Math.round(Number(n)).toLocaleString("es-PY")}` : null);

type Form = {
  perfil_activo: boolean; dv: string; razon_social_fiscal: string; clave: string; limpiar_clave: boolean;
  dia: string; honorario_mensual: number; honorario_anual: number; notas: string; obligaciones: string[]; otro: string;
};
const deFicha = (p: Perfil | null): Form => ({
  perfil_activo: p?.perfil_activo ?? false, dv: p?.dv ?? "", razon_social_fiscal: p?.razon_social_fiscal ?? "", clave: "", limpiar_clave: false,
  dia: p?.dia_vencimiento_tributario ? String(p.dia_vencimiento_tributario) : "", honorario_mensual: Number(p?.honorario_mensual ?? 0),
  honorario_anual: Number(p?.honorario_anual ?? 0), notas: p?.notas_tributarias ?? "", obligaciones: p?.obligaciones ?? [], otro: p?.obligacion_otro_detalle ?? "",
});

export function PerfilTributario({ clienteId, tipoCliente }: { clienteId: string; tipoCliente?: string | null }) {
  const url = `/api/clientes/${clienteId}/perfil-tributario`;
  const [d, setD] = useState<PerfilTributarioLectura | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<Form>(deFicha(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const cargar = useCallback(() => {
    apiFetch<PerfilTributarioLectura>(url).then(setD).catch(() => setD(null));
  }, [url]);
  useEffect(cargar, [cargar]);

  if (!d?.gestion_tributaria_clientes) return null;
  const p = d.perfil;
  const nombreObl = (slug: string) => d.catalogo.find((c) => c.slug === slug)?.nombre ?? slug;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => ({ ...x, [k]: v })); setError(null); };

  function abrir() { setF(deFicha(p)); setError(null); setAbierto(true); }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const dia = f.dia.trim() ? Number(f.dia) : null;
    if (f.perfil_activo && dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) { setError("Indicá un día del 1 al 31, o dejá vacío el día de vencimiento tributario."); return; }
    if (f.perfil_activo && f.obligaciones.includes("otro") && !f.otro.trim()) { setError('Indicá el detalle cuando seleccionás la obligación "Otro".'); return; }
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        perfil_activo: f.perfil_activo, dv: f.dv || null, razon_social_fiscal: f.razon_social_fiscal || null,
        dia_vencimiento_tributario: dia, honorario_mensual: f.honorario_mensual || null, honorario_anual: f.honorario_anual || null,
        notas_tributarias: f.notas || null, obligaciones: f.obligaciones, obligacion_otro_detalle: f.otro || null,
      };
      if (f.limpiar_clave) body.clave_tributaria = null;
      else if (f.clave.trim()) body.clave_tributaria = f.clave;
      setD(await apiFetch<PerfilTributarioLectura>(url, { method: "PUT", body: JSON.stringify(body) }));
      setAbierto(false);
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const activo = !!p?.perfil_activo;
  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#3F8E91]"><Landmark className="h-3.5 w-3.5" /></span>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Perfil tributario</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${activo ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{activo ? "Activo" : "Sin perfil"}</span>
          </div>
          <div className="flex items-center gap-2 max-sm:w-full">
            {ok ? <span className="text-xs font-medium text-emerald-600">Guardado</span> : null}
            {d.puede_editar ? (
              <button type="button" onClick={abrir} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:flex-1 sm:min-h-0">
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            ) : null}
          </div>
        </div>
        {activo && p ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:px-5 sm:py-4 lg:grid-cols-4">
            <Dato label="Obligaciones" ancho>{p.obligaciones.length ? p.obligaciones.map((o) => (o === "otro" && p.obligacion_otro_detalle ? `Otro: ${p.obligacion_otro_detalle}` : nombreObl(o))).join(" · ") : null}</Dato>
            <Dato label="DV">{p.dv}</Dato>
            <Dato label="Día de vencimiento">{p.dia_vencimiento_tributario ? `Día ${p.dia_vencimiento_tributario} de cada mes` : null}</Dato>
            <Dato label="Razón social fiscal" ancho>{p.razon_social_fiscal}</Dato>
            <Dato label="Honorario mensual">{gs(p.honorario_mensual)}</Dato>
            <Dato label="Honorario anual">{gs(p.honorario_anual)}</Dato>
            <Dato label="Clave tributaria">{p.clave_tributaria_configurada ? <span className="inline-flex items-center gap-1 text-emerald-700"><KeyRound className="h-3.5 w-3.5" /> Configurada</span> : null}</Dato>
            <Dato label="Notas internas" ancho>{p.notas_tributarias}</Dato>
          </dl>
        ) : (
          <p className="px-4 py-3.5 text-sm text-slate-500 sm:px-5">Opcional. Datos para cumplimiento y honorarios profesionales; no sustituye la identificación comercial del cliente.</p>
        )}
      </section>

      {abierto ? (
        <CapaModal onClose={busy ? undefined : () => setAbierto(false)} fondo="bg-slate-900/55 backdrop-blur-sm">
          <form onSubmit={guardar} role="dialog" aria-modal="true" aria-labelledby="perfil-trib-titulo"
            className={`flex w-full max-w-2xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}>
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">Perfil tributario</p>
                <h2 id="perfil-trib-titulo" className="mt-0.5 text-lg font-semibold text-slate-900">Datos tributarios del cliente</h2>
              </div>
              <button type="button" onClick={() => setAbierto(false)} disabled={busy} aria-label="Cerrar" className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm hover:text-[var(--brand)] disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <button type="button" role="switch" aria-checked={f.perfil_activo} onClick={() => set("perfil_activo", !f.perfil_activo)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left">
                <span className="text-sm font-medium text-slate-800">Este cliente tiene perfil tributario</span>
                <span aria-hidden className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${f.perfil_activo ? "bg-[var(--brand)]" : "bg-slate-300"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${f.perfil_activo ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </span>
              </button>

              {f.perfil_activo ? (
                <>
                  {tipoCliente === "empresa" ? (
                    <p className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      El <strong>RUC</strong> principal del cliente se registra en <strong>Identificación</strong>; acá podés complementar <strong>dígito verificador</strong> y <strong>razón social fiscal</strong> si difieren del nombre comercial.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block"><span className={LABEL}>DV (opcional)</span>
                      <input value={f.dv} onChange={(e) => set("dv", e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="Si aplica, separado del RUC" className={INPUT} autoComplete="off" />
                    </label>
                    <label className="block"><span className={LABEL}>Razón social fiscal (opcional)</span>
                      <input value={f.razon_social_fiscal} onChange={(e) => set("razon_social_fiscal", e.target.value)} maxLength={160} placeholder="Si difiere de la razón social comercial" className={`${INPUT} uppercase`} />
                    </label>
                    <label className="block"><span className={LABEL}>Clave / contraseña tributaria</span>
                      <input type="password" value={f.clave} onChange={(e) => { set("clave", e.target.value); set("limpiar_clave", false); }} autoComplete="new-password" disabled={f.limpiar_clave}
                        placeholder={p?.clave_tributaria_configurada ? "•••••••• (vacío = no cambiar)" : "Se guarda cifrada en el servidor"} className={INPUT} />
                      {p?.clave_tributaria_configurada ? (
                        <span className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={f.limpiar_clave} onChange={(e) => { set("limpiar_clave", e.target.checked); if (e.target.checked) set("clave", ""); }} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                          Eliminar clave almacenada
                        </span>
                      ) : null}
                    </label>
                    <label className="block"><span className={LABEL}>Día de vencimiento tributario</span>
                      <input value={f.dia} onChange={(e) => set("dia", e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="Ej. 7" className={INPUT} />
                      <span className="mt-1 block text-[11px] text-slate-500">Día del mes en que vence habitualmente la obligación tributaria.</span>
                    </label>
                    <label className="block"><span className={LABEL}>Honorario mensual (Gs.)</span>
                      <MontoInput value={f.honorario_mensual || ""} onChange={(n) => set("honorario_mensual", Number(n) || 0)} decimals={false} className={`${INPUT} text-right tabular-nums`} />
                    </label>
                    <label className="block"><span className={LABEL}>Honorario anual (Gs.)</span>
                      <MontoInput value={f.honorario_anual || ""} onChange={(n) => set("honorario_anual", Number(n) || 0)} decimals={false} className={`${INPUT} text-right tabular-nums`} />
                    </label>
                  </div>
                  <div>
                    <span className={LABEL}>Obligaciones</span>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {d.catalogo.map((c) => (
                        <label key={c.slug} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-50 sm:min-h-9">
                          <input type="checkbox" checked={f.obligaciones.includes(c.slug)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]"
                            onChange={(e) => set("obligaciones", e.target.checked ? [...f.obligaciones, c.slug] : f.obligaciones.filter((x) => x !== c.slug))} />
                          {c.nombre}
                        </label>
                      ))}
                    </div>
                  </div>
                  {f.obligaciones.includes("otro") ? (
                    <label className="block"><span className={LABEL}>Detalle para &quot;Otro&quot;</span>
                      <input value={f.otro} onChange={(e) => set("otro", e.target.value)} maxLength={300} placeholder="Especificá la obligación u otra referencia" className={INPUT} />
                    </label>
                  ) : null}
                  <label className="block"><span className={LABEL}>Notas internas tributarias</span>
                    <textarea value={f.notas} onChange={(e) => set("notas", e.target.value)} rows={3} maxLength={2000} placeholder="Solo equipo interno; no se exponen en listados." className={`${INPUT} min-h-[72px] resize-y`} />
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-500">Opcional. Datos para cumplimiento y honorarios profesionales; no sustituye la identificación comercial del cliente.</p>
              )}
              {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
              <button type="button" onClick={() => setAbierto(false)} disabled={busy} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-10">Cancelar</button>
              <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-50 sm:min-h-10" style={{ backgroundColor: TEAL }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
              </button>
            </div>
          </form>
        </CapaModal>
      ) : null}
    </>
  );
}

function Dato({ label, children, ancho = false }: { label: string; children: React.ReactNode; ancho?: boolean }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${vacio ? "text-slate-300" : "font-medium text-slate-800"}`}>{vacio ? "—" : children}</dd>
    </div>
  );
}
