"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { formatGs, type Cliente } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;
const INPUT =
  "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";

type Contacto = { id: string; nombre: string; cargo: string | null; telefono: string | null; email: string | null; notas: string | null };
type Venta = { id: string; numero_control: string; fecha: string; total: number; tipo_venta: string; estado: string };
type Detalle = {
  cliente: Cliente;
  estado_cuenta: { saldo: number; limite_credito: number; disponible: number | null };
  ventas: Venta[];
  contactos: Contacto[];
};

type Tab = "info" | "cuenta" | "contactos";

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("info");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<Detalle>(`/api/clientes/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (loading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error || !data) return <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error ?? "No encontrado"}</p>;

  const c = data.cliente;
  const tabs: { id: Tab; label: string }[] = [
    { id: "info", label: "Información" },
    { id: "cuenta", label: "Estado de cuenta" },
    { id: "contactos", label: `Contactos (${data.contactos.length})` },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>

      <div className="mb-5 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold" style={{ backgroundColor: "var(--brand-50)", color: BRAND }}>
          {c.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">{c.nombre}</h1>
          <p className="text-sm capitalize text-slate-500">
            {c.tipo_cliente} · {c.ruc || c.documento || "sin documento"}
          </p>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
            style={tab === t.id ? { borderColor: BRAND, color: BRAND } : { borderColor: "transparent", color: "#64748b" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "info" ? <TabInfo cliente={c} onSaved={cargar} /> : null}
      {tab === "cuenta" ? <TabCuenta data={data} /> : null}
      {tab === "contactos" ? <TabContactos clienteId={c.id} contactos={data.contactos} onChange={cargar} /> : null}
    </div>
  );
}

// ── Información (editable) ──────────────────────────────────────────────────
function TabInfo({ cliente, onSaved }: { cliente: Cliente; onSaved: () => void }) {
  const [f, setF] = useState(cliente);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Cliente, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function guardar() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await apiFetch(`/api/clientes/${cliente.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nombre: f.nombre,
          tipo_cliente: f.tipo_cliente,
          razon_social: f.razon_social ?? null,
          documento: f.documento ?? null,
          ruc: f.ruc ?? null,
          telefono: f.telefono ?? null,
          email: f.email ?? null,
          direccion: f.direccion ?? null,
          ciudad: f.ciudad ?? null,
          condicion_pago: f.condicion_pago,
          limite_credito: Number(f.limite_credito) || 0,
          notas: f.notas ?? null,
        }),
      });
      setMsg("Guardado.");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre / razón social"><input className={INPUT} value={f.nombre} onChange={(e) => set("nombre", e.target.value)} /></Field>
        <Field label="Tipo">
          <Select value={f.tipo_cliente ?? "persona"} onChange={(v) => set("tipo_cliente", v)} block options={[["persona", "Persona"], ["empresa", "Empresa"]]} />
        </Field>
        <Field label="Documento"><input className={INPUT} value={f.documento ?? ""} onChange={(e) => set("documento", e.target.value)} /></Field>
        <Field label="RUC (factura)"><input className={INPUT} value={f.ruc ?? ""} onChange={(e) => set("ruc", e.target.value)} /></Field>
        <Field label="Teléfono"><input className={INPUT} value={f.telefono ?? ""} onChange={(e) => set("telefono", e.target.value)} /></Field>
        <Field label="Email"><input className={INPUT} value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Dirección"><input className={INPUT} value={f.direccion ?? ""} onChange={(e) => set("direccion", e.target.value)} /></Field>
        <Field label="Ciudad"><input className={INPUT} value={f.ciudad ?? ""} onChange={(e) => set("ciudad", e.target.value)} /></Field>
        <Field label="Condición de pago">
          <Select value={f.condicion_pago ?? "CONTADO"} onChange={(v) => set("condicion_pago", v)} block options={[["CONTADO", "Contado"], ["CREDITO", "Crédito"]]} />
        </Field>
        <Field label="Límite de crédito">
          <input className={`${INPUT} text-right tabular-nums`} inputMode="numeric" value={f.limite_credito ?? 0} onChange={(e) => set("limite_credito", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="Notas" className="mt-4">
        <textarea className={`${INPUT} resize-none`} rows={2} value={f.notas ?? ""} onChange={(e) => set("notas", e.target.value)} />
      </Field>

      <div className="mt-5 flex items-center gap-3">
        <button onClick={guardar} disabled={busy} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
        {msg ? <span className="text-xs font-medium text-emerald-600">{msg}</span> : null}
        {err ? <span className="text-xs font-medium text-rose-600">{err}</span> : null}
      </div>
    </div>
  );
}

// ── Estado de cuenta ─────────────────────────────────────────────────────────
function TabCuenta({ data }: { data: Detalle }) {
  const { saldo, limite_credito, disponible } = data.estado_cuenta;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCuenta titulo="Saldo deudor" valor={formatGs(saldo)} tono={saldo > 0 ? "warn" : "ok"} />
        <KpiCuenta titulo="Límite de crédito" valor={limite_credito > 0 ? formatGs(limite_credito) : "Sin límite"} tono="muted" />
        <KpiCuenta titulo="Disponible" valor={disponible === null ? "—" : formatGs(disponible)} tono={disponible !== null && disponible <= 0 ? "warn" : "brand"} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">Últimas ventas</div>
        {data.ventas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">Este cliente todavía no tiene ventas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2.5">N°</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Tipo</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.ventas.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{v.numero_control}</td>
                  <td className="px-4 py-2.5 text-slate-500">{new Date(v.fecha).toLocaleDateString("es-PY")}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={v.tipo_venta === "CREDITO" ? { backgroundColor: "#fff7ed", color: "#ea580c" } : { backgroundColor: "#f1f5f9", color: "#64748b" }}>
                      {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatGs(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCuenta({ titulo, valor, tono }: { titulo: string; valor: string; tono: "brand" | "ok" | "warn" | "muted" }) {
  const col = { brand: BRAND, ok: "#059669", warn: "#ea580c", muted: "#64748b" }[tono];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        <Wallet className="h-3.5 w-3.5" /> {titulo}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums" style={{ color: col }}>{valor}</div>
    </div>
  );
}

// ── Contactos ────────────────────────────────────────────────────────────────
function TabContactos({ clienteId, contactos, onChange }: { clienteId: string; contactos: Contacto[]; onChange: () => void }) {
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [busy, setBusy] = useState(false);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/clientes/${clienteId}/contactos`, {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), cargo: cargo.trim() || undefined, telefono: telefono.trim() || undefined }),
      });
      setNombre(""); setCargo(""); setTelefono("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function quitar(cid: string) {
    await apiFetch(`/api/clientes/${clienteId}/contactos?contacto_id=${cid}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="min-w-[8rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nombre</span>
          <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del contacto" />
        </div>
        <div className="min-w-[7rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Cargo</span>
          <input className={INPUT} value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ej. Compras" />
        </div>
        <div className="min-w-[7rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Teléfono</span>
          <input className={INPUT} value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </div>
        <button type="submit" disabled={busy || !nombre.trim()} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          <Plus className="h-4 w-4" /> Agregar
        </button>
      </form>

      {contactos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Sin contactos cargados.</p>
      ) : (
        <ul className="divide-y divide-slate-50 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {contactos.map((ct) => (
            <li key={ct.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{ct.nombre} {ct.cargo ? <span className="font-normal text-slate-400">· {ct.cargo}</span> : null}</div>
                <div className="text-xs text-slate-500">{ct.telefono || ct.email || "—"}</div>
              </div>
              <button onClick={() => quitar(ct.id)} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500" aria-label={`Quitar ${ct.nombre}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
