"use client";

/**
 * Modal para crear o editar un cliente (mismo diseño que el del sistema actual: franja de
 * color, encabezado grande y bloques en tarjetas sobre fondo gris). Bloques: Datos (persona o empresa,
 * nombre, razón social, RUC o CI, categoría), Contacto (persona de contacto si es empresa)
 * y Condiciones (contado / crédito con plazo y límite). Solo el nombre es obligatorio. El
 * RUC o CI no se puede repetir. El resto de la ficha se completa en la pestaña Información.
 */
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import type { Categoria } from "@/modules/clientes/esquema";
import MontoInput from "@/components/ui/MontoInput";
import type { Cliente } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
const ET = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";
const OPC = <span className="font-normal text-slate-400">(opcional)</span>;

export type ClienteFicha = Cliente & { plazo_dias?: number | null; notas?: string | null; activo?: boolean; categoria_id?: string | null; nombre_contacto?: string | null };

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
    condicion_pago: (cliente?.condicion_pago === "CREDITO" ? "CREDITO" : "CONTADO") as "CONTADO" | "CREDITO",
    plazo_dias: cliente?.plazo_dias ? String(cliente.plazo_dias) : "30",
    limite_credito: Number(cliente?.limite_credito ?? 0),
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
    setBusy(true);
    setError(null);
    try {
      const doc = f.documento.trim();
      const esRuc = /^\d{3,}-\d$/.test(doc);
      const body = JSON.stringify({
        tipo_cliente: f.tipo_cliente,
        nombre: f.nombre.trim(),
        razon_social: f.razon_social.trim() || null,
        documento: doc || null,
        // El RUC (con dígito verificador) también queda como RUC para facturar.
        ruc: esRuc ? doc : editando ? undefined : null,
        categoria_id: f.categoria_id || null,
        nombre_contacto: empresa ? f.nombre_contacto.trim() || null : undefined,
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
    <CapaModal onClose={onClose} fondo="bg-slate-900/55 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cli-form-titulo"
        className={`relative flex w-full max-w-4xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}
        style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[#4FAEB2]/5 px-6 pb-5 pt-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">{editando ? "Editar" : "Nuevo"}</p>
            </div>
            <h2 id="cli-form-titulo" className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">
              {editando ? cliente!.nombre : "Crear cliente"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {editando ? "Actualizá los datos principales. El resto del perfil está en la pestaña Información." : "Registrá un cliente. Solo el nombre es obligatorio; el resto del perfil lo podés completar después."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]">
            <X className="h-4 w-4" />
          </button>
        </div>

      <form id="cli-form" onSubmit={guardar} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/50 px-6 py-5">
        <Bloque titulo="Datos">
          <Segmentado valor={f.tipo_cliente} onChange={(v) => set("tipo_cliente", v as "persona" | "empresa")} opciones={[["persona", "Persona"], ["empresa", "Empresa"]]} />
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ET}>{empresa ? "Nombre o nombre comercial *" : "Nombre y apellido *"}</span>
            <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={200} placeholder={empresa ? "Ej: Kiosco El Sol" : "Ej: María González"} className={INPUT} />
          </label>
            <label className="block">
              <span className={ET}>{empresa ? "RUC" : "RUC o CI"} {OPC}</span>
              <input value={f.documento} onChange={(e) => set("documento", e.target.value)} maxLength={30} placeholder={empresa ? "Ej: 80011222-7" : "Ej: 3456789 o 3456789-0"} className={`${INPUT} font-mono`} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {empresa ? (
              <label className="block">
                <span className={ET}>Razón social {OPC}</span>
                <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} maxLength={200} placeholder="Ej: El Sol S.R.L." className={INPUT} />
              </label>
            ) : null}
          {categorias.length > 0 ? (
            <label className="block">
              <span className={ET}>Categoría {OPC}</span>
              <Select value={f.categoria_id} onChange={(v) => set("categoria_id", v)} block
                options={[["", "— Ninguna —"], ...categorias.map((c) => [c.id, c.nombre] as [string, string])]} />
            </label>
          ) : null}
          </div>
        </Bloque>

        <Bloque titulo="Contacto">
          <div className="grid gap-4 sm:grid-cols-2">
            {empresa ? (
              <label className="block sm:col-span-2">
                <span className={ET}>Persona de contacto {OPC}</span>
                <input value={f.nombre_contacto} onChange={(e) => set("nombre_contacto", e.target.value)} maxLength={200} placeholder="Ej: Juan Pérez, encargado de compras" className={INPUT} />
              </label>
            ) : null}
            <label className="block">
              <span className={ET}>Teléfono {OPC}</span>
              <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} placeholder="Ej: 0981 123 456" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Email {OPC}</span>
              <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} placeholder="cliente@correo.com" className={INPUT} />
            </label>
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

        <Bloque titulo="Cómo te paga">
          <Segmentado valor={f.condicion_pago} onChange={(v) => set("condicion_pago", v as "CONTADO" | "CREDITO")} opciones={[["CONTADO", "Contado"], ["CREDITO", "A crédito (cuenta corriente)"]]} />
          {f.condicion_pago === "CREDITO" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={ET}>Plazo para pagar</span>
                <div className="flex items-center gap-2">
                  <input inputMode="numeric" value={f.plazo_dias} onChange={(e) => set("plazo_dias", e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} w-20 text-right tabular-nums`} />
                  <span className="text-sm text-slate-500">días</span>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {["15", "30", "60"].map((d) => (
                    <button key={d} type="button" onClick={() => set("plazo_dias", d)} className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${f.plazo_dias === d ? "bg-[var(--brand-50)] text-[var(--brand)]" : "text-slate-500 hover:bg-slate-100"}`}>{d}</button>
                  ))}
                </div>
              </label>
              <label className="block">
                <span className={ET}>Límite de crédito {OPC}</span>
                <MontoInput value={f.limite_credito || ""} onChange={(v) => set("limite_credito", v)} decimals={false} placeholder="Sin límite" className={`${INPUT} text-right tabular-nums`} />
                <span className="mt-1 block text-[11px] text-slate-400">La caja no deja vender a crédito por encima de esto.</span>
              </label>
            </div>
          ) : null}
        </Bloque>

        {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      </form>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2]">Cancelar</button>
          <button type="submit" form="cli-form" disabled={busy || !f.nombre.trim()} className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none" style={busy || !f.nombre.trim() ? undefined : { backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : editando ? "Guardar cambios" : "Guardar cliente"}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
    <div className="flex w-fit overflow-hidden rounded-xl border border-slate-200 shadow-sm">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-5 py-2.5 text-sm font-semibold transition-colors ${valor === v ? "text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          style={valor === v ? { backgroundColor: BRAND } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
