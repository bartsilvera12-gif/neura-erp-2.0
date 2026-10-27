"use client";

/**
 * Modal para crear o editar un cliente (mismo diseño que el del sistema actual: franja de
 * color, encabezado grande y bloques en tarjetas sobre fondo gris). Bloques: Datos (persona o empresa,
 * nombre, razón social, RUC o CI, categoría), Contacto (persona de contacto si es empresa)
 * y Condiciones (contado / crédito con plazo y límite). Obligatorios: nombre, RUC o CI (de ahí salen los datos para facturar) y teléfono. El
 * RUC o CI no se puede repetir. El resto de la ficha se completa en la pestaña Información.
 * MarcoCliente / Bloque / ET los usa también la vista de solo lectura (ClienteDatosModal).
 */
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import type { Categoria } from "@/modules/clientes/esquema";
import type { Cliente } from "@/modules/caja/lib";
import { normalizarRuc, validarRuc } from "@/modules/empresa/tipos";
import { AyudaRuc, claseRuc, rucConError } from "@/modules/clientes/AyudaRuc";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
export const ET = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";
const OPC = <span className="font-normal text-slate-400">(opcional)</span>;

export type ClienteFicha = Cliente & {
  plazo_dias?: number | null; notas?: string | null; activo?: boolean; categoria_id?: string | null; nombre_contacto?: string | null;
  telefono_secundario?: string | null; email_secundario?: string | null;
  ruc?: string | null;
};

export function ClienteForm({ cliente, onClose, onSaved }: { cliente?: ClienteFicha | null; onClose: () => void; onSaved: (id: string) => void }) {
  const editando = !!cliente;
  const [f, setF] = useState({
    tipo_cliente: (cliente?.tipo_cliente ?? "persona") as "persona" | "empresa",
    nombre: cliente?.nombre ?? "",
    razon_social: cliente?.razon_social ?? "",
    documento: cliente?.documento ?? "",
    telefono: cliente?.telefono ?? "",
    email: cliente?.email ?? "",
    direccion: cliente?.direccion ?? "",
    ciudad: cliente?.ciudad ?? "",
    categoria_id: cliente?.categoria_id ?? "",
    nombre_contacto: cliente?.nombre_contacto ?? "",
    telefono_secundario: cliente?.telefono_secundario ?? "",
    email_secundario: cliente?.email_secundario ?? "",
    condicion_pago: (cliente?.condicion_pago === "CREDITO" ? "CREDITO" : "CONTADO") as "CONTADO" | "CREDITO",
    plazo_dias: cliente?.plazo_dias ? String(cliente.plazo_dias) : "30",
    limite_credito: Number(cliente?.limite_credito ?? 0),
    // Datos para facturación (como en sistemas-propio)
    ruc: cliente?.ruc ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const empresa = f.tipo_cliente === "empresa";
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  useEffect(() => {
    apiFetchCache<Categoria[]>("/api/clientes/categorias").then(setCategorias).catch(() => {});
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim()) return;
    // El RUC o CI es obligatorio: de ahí salen los datos para facturar.
    if (!f.documento.trim()) { setError(empresa ? "Cargá el RUC de la empresa: se usa para facturar." : "Cargá el RUC o la CI del cliente: se usa para facturar."); return; }
    if (!f.telefono.trim()) { setError("Cargá un teléfono del cliente."); return; }
    // Sin RUC válido no hay factura (84): el de Datos para facturación tiene que dar el dígito verificador.
    if (rucConError(f.ruc)) { const v = validarRuc(f.ruc); setError(`RUC de facturación: ${"mensaje" in v ? v.mensaje : "no es válido"}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const doc = f.documento.trim();
      // Solo un RUC con dígito verificador correcto pasa a "Datos para facturación".
      const esRuc = validarRuc(doc).estado === "ok";
      const body = JSON.stringify({
        tipo_cliente: f.tipo_cliente,
        nombre: f.nombre.trim(),
        razon_social: f.razon_social.trim() || null,
        documento: doc || null,
        // RUC para factura: el que se cargó en "Datos para facturación"; si está vacío y el
        // documento es un RUC (con dígito verificador), se usa ese.
        ruc: f.ruc.trim() ? normalizarRuc(f.ruc) : esRuc ? normalizarRuc(doc) : null,
        categoria_id: f.categoria_id || null,
        nombre_contacto: empresa ? f.nombre_contacto.trim() || null : undefined,
        // Empresa: teléfono y email de la persona de contacto (los principales son de la empresa).
        telefono_secundario: empresa ? f.telefono_secundario.trim() || null : undefined,
        email_secundario: empresa ? f.email_secundario.trim() || null : undefined,
        telefono: f.telefono.trim() || null,
        email: f.email.trim() || null,
        direccion: f.direccion.trim() || null,
        ciudad: f.ciudad.trim() || null,
        condicion_pago: f.condicion_pago,
        plazo_dias: f.condicion_pago === "CREDITO" ? Number(f.plazo_dias) || null : null,
        limite_credito: f.condicion_pago === "CREDITO" ? f.limite_credito || 0 : 0,
      });
      const r = editando
        ? await apiFetch<{ id: string }>(`/api/clientes/${cliente!.id}`, { method: "PATCH", body })
        : await apiFetch<{ id: string }>("/api/clientes", { method: "POST", body });
      onSaved(r?.id ?? cliente?.id ?? "");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <MarcoCliente
      onClose={onClose}
      kicker={editando ? "Editar" : "Nuevo"}
      titulo={editando ? cliente!.nombre : "Crear cliente"}
      subtitulo={editando ? "Actualizá los datos del cliente y guardá los cambios." : "Registrá un cliente. El nombre, el RUC o CI y el teléfono son obligatorios; el resto lo podés completar después."}
      pie={
        <>
          <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
          <button type="submit" form="cli-form" disabled={busy || !f.nombre.trim() || !f.documento.trim() || !f.telefono.trim()} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none" style={busy || !f.nombre.trim() || !f.documento.trim() || !f.telefono.trim() ? undefined : { backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : editando ? "Guardar cambios" : "Guardar cliente"}
          </button>
        </>
      }
    >
      <form id="cli-form" onSubmit={guardar} className={CUERPO}>
        <Bloque titulo="Datos">
          <Segmentado valor={f.tipo_cliente} onChange={(v) => set("tipo_cliente", v as "persona" | "empresa")} opciones={[["persona", "Persona"], ["empresa", "Empresa"]]} />
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ET}>{empresa ? "Nombre o nombre comercial *" : "Nombre y apellido *"}</span>
            <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={200} placeholder={empresa ? "Ej: Kiosco El Sol" : "Ej: María González"} className={INPUT} />
          </label>
            <label className="block">
              <span className={ET}>{empresa ? "RUC *" : "RUC o CI *"}</span>
              <input value={f.documento} onChange={(e) => set("documento", e.target.value)} maxLength={30} placeholder={empresa ? "Ej: 80011222-9" : "Ej: 3456789 o 3456789-5"} className={`${INPUT} font-mono`} />
              {empresa || f.documento.includes("-") ? <AyudaRuc valor={f.documento} aviso onUsar={(r) => set("documento", r)} /> : null}
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
          {categorias.length > 0 ? (
            <label className="block">
              <span className={ET}>Categoría {OPC}</span>
              <Select value={f.categoria_id} onChange={(v) => set("categoria_id", v)} block etiqueta="Categoría"
                options={[["", "— Ninguna —"], ...categorias.map((c) => [c.id, c.nombre] as [string, string])]} />
            </label>
          ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={ET}>Teléfono *</span>
              <input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} placeholder={empresa ? "Ej: 021 600 000" : "Ej: 0981 123 456"} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Email {OPC}</span>
              <input type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} placeholder={empresa ? "ventas@empresa.com.py" : "cliente@correo.com"} className={INPUT} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo="Datos para facturación">
          <p className="-mt-1 text-xs text-slate-500">
            Lo que sale en el documento tributario (SIFEN). Si lo dejás vacío, se factura con el nombre y el documento del cliente.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={ET}>{empresa ? "Razón social" : "Nombre para factura"} {OPC}</span>
              <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} maxLength={200}
                placeholder={empresa ? "Razón social legal (como en el RUC)" : "Nombre como figura en el documento"} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>RUC {OPC}</span>
              <input value={f.ruc} onChange={(e) => set("ruc", e.target.value)} onBlur={() => f.ruc.trim() && set("ruc", normalizarRuc(f.ruc))}
                maxLength={40} placeholder="80012345-0" aria-invalid={rucConError(f.ruc)} className={`${INPUT} font-mono ${claseRuc(f.ruc)}`} />
              <AyudaRuc valor={f.ruc} onUsar={(r) => { set("ruc", r); setError(null); }} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo={empresa ? "Contacto y dirección" : "Dirección"}>
          <div className="grid gap-4 sm:grid-cols-2">
            {empresa ? (
              <>
                <label className="block sm:col-span-2">
                  <span className={ET}>Persona de contacto {OPC}</span>
                  <input value={f.nombre_contacto} onChange={(e) => set("nombre_contacto", e.target.value)} maxLength={200} placeholder="Ej: Juan Pérez, encargado de compras" className={INPUT} />
                </label>
                <label className="block">
                  <span className={ET}>Teléfono del contacto {OPC}</span>
                  <input type="tel" inputMode="tel" value={f.telefono_secundario} onChange={(e) => set("telefono_secundario", e.target.value)} maxLength={40} placeholder="Ej: 0981 123 456" className={INPUT} />
                </label>
                <label className="block">
                  <span className={ET}>Email del contacto {OPC}</span>
                  <input type="email" inputMode="email" value={f.email_secundario} onChange={(e) => set("email_secundario", e.target.value)} maxLength={120} placeholder="juan@empresa.com.py" className={INPUT} />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className={ET}>Dirección {OPC}</span>
              <input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} maxLength={200} className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Ciudad {OPC}</span>
              <input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} maxLength={80} placeholder="Ej: Luque" className={INPUT} />
            </label>
          </div>
        </Bloque>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>
    </MarcoCliente>
  );
}

/** Cuerpo scrolleable del marco (fondo gris con los bloques en tarjetas). */
export const CUERPO = "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/50 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-5";
export const BTN_SECUNDARIO = "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50";

/**
 * Marco del modal de cliente (lo comparten el formulario y la vista de datos): panel con
 * franja de color, encabezado grande (rótulo, nombre, bajada y ✕), el cuerpo (children, que
 * debe usar CUERPO) y el pie fijo con las acciones. En celular, CapaModal lo pasa a hoja.
 */
export function MarcoCliente({ onClose, kicker, titulo, subtitulo, extra, pie, children }: {
  onClose?: () => void; kicker: string; titulo: string; subtitulo?: React.ReactNode; extra?: React.ReactNode;
  pie: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <CapaModal onClose={onClose} fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cli-form-titulo"
        className={`relative flex w-full max-w-4xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[#4FAEB2]/5 px-4 pb-4 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">{kicker}</p>
            </div>
            <h2 id="cli-form-titulo" className="mt-1 truncate text-xl font-semibold sm:text-2xl tracking-tight text-slate-900">{titulo}</h2>
            {subtitulo ? <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">{subtitulo}</p> : null}
            {extra}
          </div>
          <button type="button" onClick={onClose} disabled={!onClose} aria-label="Cerrar"
            className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {children}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:px-6 sm:py-4 max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center">
          {pie}
        </div>
      </div>
    </CapaModal>
  );
}

export function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="block h-5 w-1 rounded-full" style={{ backgroundColor: BRAND }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Segmentado({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    // En celular ocupa todo el ancho y las opciones se reparten (los textos largos no se salen).
    <div className="flex w-full overflow-hidden rounded-xl border border-slate-200 shadow-sm sm:w-fit">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`min-h-11 flex-1 px-3 py-2 text-sm font-semibold leading-tight transition-colors sm:flex-none sm:px-5 sm:py-2.5 ${valor === v ? "text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          style={valor === v ? { backgroundColor: BRAND } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
