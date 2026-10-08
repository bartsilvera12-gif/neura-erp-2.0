"use client";

/**
 * Panel lateral para crear o editar un cliente. Bloques: Datos (persona o empresa,
 * nombre, razón social, RUC o CI), Contacto y Condiciones (contado / crédito con plazo y
 * límite). Solo el nombre es obligatorio. El RUC o CI no se puede repetir.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { Drawer } from "@/components/Drawer";
import MontoInput from "@/components/ui/MontoInput";
import type { Cliente } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const ET = "mb-1 block text-xs font-medium text-slate-600";
const OPC = <span className="font-normal text-slate-400">(opcional)</span>;

export type ClienteFicha = Cliente & { plazo_dias?: number | null; notas?: string | null; activo?: boolean };

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
    condicion_pago: (cliente?.condicion_pago === "CREDITO" ? "CREDITO" : "CONTADO") as "CONTADO" | "CREDITO",
    plazo_dias: cliente?.plazo_dias ? String(cliente.plazo_dias) : "30",
    limite_credito: Number(cliente?.limite_credito ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const empresa = f.tipo_cliente === "empresa";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const doc = f.documento.trim();
      const body = JSON.stringify({
        tipo_cliente: f.tipo_cliente,
        nombre: f.nombre.trim(),
        razon_social: f.razon_social.trim() || null,
        documento: doc || null,
        // El RUC (con dígito verificador) también queda como RUC para facturar.
        ruc: /^\d{3,}-\d$/.test(doc) ? doc : null,
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
    <Drawer
      titulo={editando ? "Editar cliente" : "Nuevo cliente"}
      subtitulo={editando ? cliente!.nombre : "Solo el nombre es obligatorio"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="submit" form="cli-form" disabled={busy || !f.nombre.trim()} className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? "Guardando…" : editando ? "Guardar cambios" : "Crear cliente"}
          </button>
        </>
      }
    >
      <form id="cli-form" onSubmit={guardar} className="space-y-7">
        <Bloque titulo="Datos">
          <Segmentado valor={f.tipo_cliente} onChange={(v) => set("tipo_cliente", v as "persona" | "empresa")} opciones={[["persona", "Persona"], ["empresa", "Empresa"]]} />
          <label className="block">
            <span className={ET}>{empresa ? "Nombre o nombre comercial *" : "Nombre y apellido *"}</span>
            <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={200} placeholder={empresa ? "Ej: Kiosco El Sol" : "Ej: María González"} className={INPUT} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {empresa ? (
              <label className="block">
                <span className={ET}>Razón social {OPC}</span>
                <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} maxLength={200} placeholder="Ej: El Sol S.R.L." className={INPUT} />
              </label>
            ) : null}
            <label className={`block ${empresa ? "" : "col-span-2 sm:col-span-1"}`}>
              <span className={ET}>{empresa ? "RUC" : "RUC o CI"} {OPC}</span>
              <input value={f.documento} onChange={(e) => set("documento", e.target.value)} maxLength={30} placeholder={empresa ? "Ej: 80011222-7" : "Ej: 3456789 o 3456789-0"} className={`${INPUT} font-mono`} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo="Contacto">
          <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
    </Drawer>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
        <span className="block h-4 w-1 rounded-full" style={{ backgroundColor: BRAND }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{titulo}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Segmentado({ valor, onChange, opciones }: { valor: string; onChange: (v: string) => void; opciones: [string, string][] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {opciones.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${valor === v ? "bg-white shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          style={valor === v ? { color: BRAND } : undefined}>
          {l}
        </button>
      ))}
    </div>
  );
}
