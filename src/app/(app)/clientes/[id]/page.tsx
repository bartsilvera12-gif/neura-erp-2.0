"use client";

/**
 * /clientes/[id] — ficha del cliente (Fase 1). Arriba: total comprado, compras y ticket
 * promedio, deuda (y vencido) y crédito disponible. Pestañas: Resumen (datos y crédito),
 * Compras (sus ventas), Contactos y Notas. Editar abre el panel lateral; también se puede
 * desactivar (no se borra: tiene historial).
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Ban, CheckCircle2, Loader2, Mail, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { clienteConfig } from "@/cliente.config";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { ClienteForm, type ClienteFicha } from "@/modules/clientes/ClienteForm";

const BRAND = clienteConfig.color;
const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

type Contacto = { id: string; nombre: string; cargo: string | null; telefono: string | null; email: string | null; notas: string | null };
type Venta = { id: string; numero_control: string; fecha: string; total: number; tipo_venta: string; estado: string };
type Resumen = { total_comprado: number; compras: number; ultima_compra: string | null; deuda: number; vencido: number; ticket_promedio: number };
type Detalle = {
  cliente: ClienteFicha;
  estado_cuenta: { saldo: number; limite_credito: number; disponible: number | null };
  ventas: Venta[];
  contactos: Contacto[];
  resumen: Resumen | null;
};
type Tab = "resumen" | "compras" | "contactos" | "notas";

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("resumen");
  const [editando, setEditando] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await apiFetch<Detalle>(`/api/clientes/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function cambiarEstado() {
    if (!data) return;
    setCambiando(true);
    try {
      await apiFetch(`/api/clientes/${id}`, { method: "PATCH", body: JSON.stringify({ activo: data.cliente.activo === false }) });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCambiando(false);
    }
  }

  if (loading) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>;
  if (error && !data) return <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>;
  if (!data) return null;

  const c = data.cliente;
  const r = data.resumen;
  const credito = c.condicion_pago === "CREDITO";
  const { limite_credito, disponible } = data.estado_cuenta;
  const tabs: { id: Tab; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "compras", label: `Compras (${r?.compras ?? data.ventas.length})` },
    { id: "contactos", label: `Contactos (${data.contactos.length})` },
    { id: "notas", label: "Notas" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <Link href="/clientes" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Clientes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold" style={{ backgroundColor: `${BRAND}1a`, color: BRAND }}>
            {c.nombre.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">
              {c.nombre}
              {c.activo === false ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 align-middle text-xs font-semibold text-slate-500">Inactivo</span> : null}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {c.tipo_cliente === "empresa" ? "Empresa" : "Persona"}
              {c.razon_social ? ` · ${c.razon_social}` : ""}
              {c.documento ? <> · <span className="font-mono">{c.documento}</span></> : " · sin documento"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={cambiarEstado} disabled={cambiando} className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${c.activo === false ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {c.activo === false ? <><CheckCircle2 className="h-4 w-4" /> Activar</> : <><Ban className="h-4 w-4" /> Desactivar</>}
          </button>
          <button onClick={() => setEditando(true)} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95" style={{ backgroundColor: BRAND }}>
            <Pencil className="h-4 w-4" /> Editar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Total comprado" valor={gs(r?.total_comprado ?? 0)} sub={r?.ultima_compra ? `última ${fecha(r.ultima_compra)}` : "todavía no compró"} />
        <Kpi titulo="Compras" valor={String(r?.compras ?? 0)} sub={r?.compras ? `ticket promedio ${gs(r.ticket_promedio)}` : undefined} />
        <Kpi titulo="Deuda" valor={gs(r?.deuda ?? 0)} sub={(r?.vencido ?? 0) > 0 ? `vencido ${gs(r!.vencido)}` : (r?.deuda ?? 0) > 0 ? "al día" : "no debe nada"} tono={(r?.vencido ?? 0) > 0 ? "rojo" : undefined} />
        <Kpi titulo="Crédito disponible" valor={!credito ? "Contado" : limite_credito > 0 ? gs(disponible ?? 0) : "Sin límite"}
          sub={credito ? (limite_credito > 0 ? `de ${gs(limite_credito)}` : `${c.plazo_dias ?? 30} días de plazo`) : "no compra a crédito"} />
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors"
            style={tab === t.id ? { borderColor: BRAND, color: BRAND } : { borderColor: "transparent", color: "#64748b" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "resumen" ? <TabResumen c={c} /> : null}
      {tab === "compras" ? <TabCompras ventas={data.ventas} /> : null}
      {tab === "contactos" ? <TabContactos clienteId={c.id} contactos={data.contactos} onChange={cargar} /> : null}
      {tab === "notas" ? <TabNotas clienteId={c.id} notas={c.notas ?? ""} onSaved={cargar} /> : null}

      {editando ? <ClienteForm cliente={c} onClose={() => setEditando(false)} onSaved={() => { setEditando(false); void cargar(); }} /> : null}
    </div>
  );
}

function Kpi({ titulo, valor, sub, tono }: { titulo: string; valor: string; sub?: string; tono?: "rojo" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${tono === "rojo" ? "text-rose-600" : "text-slate-500"}`}>{titulo}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tono === "rojo" ? "text-rose-600" : "text-slate-900"}`}>{valor}</p>
      {sub ? <p className={`text-[11px] ${tono === "rojo" ? "font-semibold text-rose-600" : "text-slate-400"}`}>{sub}</p> : null}
    </div>
  );
}

function TabResumen({ c }: { c: ClienteFicha }) {
  const filas: [React.ReactNode, string, string | null | undefined][] = [
    [<Phone key="t" className="h-4 w-4" />, "Teléfono", c.telefono],
    [<Mail key="e" className="h-4 w-4" />, "Email", c.email],
    [<MapPin key="d" className="h-4 w-4" />, "Dirección", [c.direccion, c.ciudad].filter(Boolean).join(", ") || null],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Contacto</p>
        <ul className="space-y-3">
          {filas.map(([icono, l, v]) => (
            <li key={l} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 text-slate-400">{icono}</span>
              <span>
                <span className="block text-[11px] text-slate-500">{l}</span>
                <span className={v ? "font-medium text-slate-800" : "text-slate-400"}>{v || "Sin cargar"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cómo te paga</p>
        {c.condicion_pago === "CREDITO" ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Condición</dt><dd className="font-semibold text-amber-700">A crédito</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Plazo</dt><dd className="font-medium text-slate-800">{c.plazo_dias ?? 30} días</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Límite de crédito</dt><dd className="font-medium text-slate-800">{Number(c.limite_credito) > 0 ? gs(Number(c.limite_credito)) : "Sin límite"}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-600">Al contado. Si querés venderle a cuenta corriente, tocá <strong className="font-semibold">Editar</strong> y elegí "A crédito".</p>
        )}
      </section>
    </div>
  );
}

function TabCompras({ ventas }: { ventas: Venta[] }) {
  if (!ventas.length) return <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">Este cliente todavía no compró.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${BRAND}26`, backgroundColor: `${BRAND}0d`, color: BRAND }}>
            <th className="px-4 py-3">Número</th>
            <th className="px-4 py-3">Fecha</th>
            <th className="px-4 py-3">Condición</th>
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ventas.map((v) => {
            const anulada = v.estado === "anulada";
            return (
              <tr key={v.id} className={anulada ? "opacity-50" : ""}>
                <td className={`px-4 py-2.5 font-mono text-xs font-semibold text-slate-800 ${anulada ? "line-through" : ""}`}>{v.numero_control}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{fecha(v.fecha)}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.tipo_venta === "CREDITO" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}
                  </span>
                  {anulada ? <span className="ml-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">Anulada</span> : null}
                </td>
                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900 ${anulada ? "line-through" : ""}`}>{gs(v.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ventas.length >= 50 ? <p className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-400">Se muestran las últimas 50 compras.</p> : null}
    </div>
  );
}

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
        <label className="min-w-[8rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nombre</span>
          <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan, el encargado" />
        </label>
        <label className="min-w-[7rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Cargo</span>
          <input className={INPUT} value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ej: Compras" />
        </label>
        <label className="min-w-[7rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Teléfono</span>
          <input className={INPUT} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej: 0981 000 000" />
        </label>
        <button type="submit" disabled={busy || !nombre.trim()} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          <Plus className="h-4 w-4" /> Agregar
        </button>
      </form>
      {contactos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">Sin contactos cargados. Sirve para empresas: con quién hablar para cobrar o tomar pedidos.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
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

function TabNotas({ clienteId, notas, onSaved }: { clienteId: string; notas: string; onSaved: () => void }) {
  const [texto, setTexto] = useState(notas);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const cambio = texto.trim() !== notas.trim();

  async function guardar() {
    setBusy(true);
    setOk(false);
    try {
      await apiFetch(`/api/clientes/${clienteId}`, { method: "PATCH", body: JSON.stringify({ notas: texto.trim() || null }) });
      setOk(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-2 text-sm text-slate-600">Lo que conviene recordar de este cliente: horarios, preferencias, acuerdos.</p>
      <textarea value={texto} onChange={(e) => { setTexto(e.target.value); setOk(false); }} rows={6} maxLength={1000}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && cambio) void guardar(); }}
        placeholder="Ej: paga los viernes; prefiere que lo llamen después de las 14 h." className={INPUT} />
      <div className="mt-3 flex items-center justify-end gap-3">
        {ok && !cambio ? <span className="text-xs font-medium text-emerald-600">Guardado</span> : <span className="text-[11px] text-slate-400">Ctrl + Enter para guardar</span>}
        <button onClick={guardar} disabled={busy || !cambio} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: BRAND }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar notas
        </button>
      </div>
    </div>
  );
}
