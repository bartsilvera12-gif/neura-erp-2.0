"use client";

/**
 * /clientes/[id] — ficha del cliente (copia del sistema actual, con datos genéricos).
 * Encabezado: avatar, nombre, código CL-…, estado, "Cliente desde", Dar de baja / Reactivar
 * y Eliminar (administrador); acciones Nueva suscripción (próximamente), Venta al contado y
 * Registrar pago; franja de datos (origen, categoría, condición, suscripción, moneda,
 * vendedor, creado por). Pestañas: Información (edición), Estado de cuenta, Compras,
 * Contactos, Actividad (historial automático) y Notas.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { CuentaCorriente } from "@/modules/clientes/CuentaCorriente";
import { RegistrarCobro } from "@/modules/clientes/RegistrarCobro";
import type { Contacto, Detalle, Venta } from "@/modules/clientes/ficha/tipos";
import { TabInformacion } from "@/modules/clientes/ficha/TabInformacion";
import { TabActividad } from "@/modules/clientes/ficha/TabActividad";
import { TabNotas } from "@/modules/clientes/ficha/TabNotas";
import { ModalEliminar, PanelBaja } from "@/modules/clientes/ficha/Modales";
import { Avatar, BadgeEstado, CategoriaChip, CodigoChip, TEAL, codigoCliente, estadoDe, fechaCorta, gs } from "@/modules/clientes/ui";

const INPUT = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]";
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });

type Tab = "informacion" | "estado_cuenta" | "compras" | "contactos" | "actividad" | "notas";

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const [data, setData] = useState<Detalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("informacion");
  const [cobrando, setCobrando] = useState(false);
  const [recargaCuenta, setRecargaCuenta] = useState(0);
  const [recargaHist, setRecargaHist] = useState(0);
  const [bajando, setBajando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [notasCount, setNotasCount] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const d = await apiFetch<Detalle>(`/api/clientes/${id}`);
      setData(d);
      setNotasCount(d.notas_count ?? 0);
      setRecargaHist((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function cambiarActivo(activo: boolean) {
    setCambiando(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCambiando(false);
    }
  }

  if (loading) return <FichaSkeleton />;
  if (error && !data) {
    return (
      <div className="space-y-4">
        <Link href="/clientes" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">← Clientes</Link>
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  const c = data.cliente;
  const r = data.resumen;
  const estado = estadoDe(c);
  const credito = c.condicion_pago === "CREDITO";
  const { limite_credito, disponible } = data.estado_cuenta;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "informacion", label: "Información" },
    { id: "estado_cuenta", label: "Estado de cuenta" },
    { id: "compras", label: "Compras", badge: r?.compras ?? data.ventas.length },
    { id: "contactos", label: "Contactos", badge: data.contactos.length },
    { id: "actividad", label: "Actividad" },
    { id: "notas", label: "Notas", badge: notasCount },
  ];
  const datos: { label: string; value: React.ReactNode }[] = [
    { label: "Origen", value: c.origen ?? "MANUAL" },
    { label: "Categoría", value: c.categoria_nombre ? <CategoriaChip nombre={c.categoria_nombre} color={c.categoria_color} /> : "—" },
    { label: "Condición", value: credito ? `Crédito${c.plazo_dias ? ` ${c.plazo_dias} días` : ""}` : "Contado" },
    { label: "Suscripción activa", value: "—" },
    { label: "Moneda", value: c.moneda_preferida ?? "GS" },
    { label: "Vendedor", value: c.vendedor_nombre || <span className="text-slate-400">Sin asignar</span> },
    { label: "Creado por", value: c.creado_por_nombre || "—" },
  ];

  return (
    <div className="max-w-7xl space-y-6 pb-10">
      <Link href="/clientes" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-600">← Clientes</Link>

      {/* Panel resumen */}
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: `${TEAL}73` }}>
        <div className="px-6 py-5" style={{ backgroundImage: `linear-gradient(to bottom right, #fff, #fff, ${TEAL}14)` }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar nombre={c.nombre} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TEAL }} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Cliente</p>
                </div>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{c.nombre}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CodigoChip codigo={codigoCliente(c)} fondo="bg-white" />
                  {c.ruc || (c.tipo_cliente === "empresa" && c.documento) ? (
                    <span className="text-[11px] text-slate-500"><span className="font-medium text-slate-400">RUC:</span> {c.ruc || c.documento}</span>
                  ) : c.documento ? (
                    <span className="text-[11px] text-slate-500"><span className="font-medium text-slate-400">CI:</span> {c.documento}</span>
                  ) : null}
                  <BadgeEstado estado={estado} />
                  <span className="text-[11px] text-slate-500">
                    Cliente desde <span className="font-medium text-slate-700">{fechaCorta(c.creado_at)}</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {estado === "activo" ? (
                esAdmin ? (
                  <button type="button" onClick={() => { setBajando(true); setEliminando(false); }}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-100">
                    Dar de baja
                  </button>
                ) : (
                  <button type="button" onClick={() => void cambiarActivo(false)} disabled={cambiando}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">
                    Desactivar
                  </button>
                )
              ) : (
                <button type="button" onClick={() => void cambiarActivo(true)} disabled={cambiando}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 disabled:opacity-50">
                  {cambiando ? "Reactivando…" : "Reactivar"}
                </button>
              )}
              {esAdmin ? (
                <button type="button" onClick={() => setEliminando(true)} title="Eliminar cliente"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 shadow-sm transition-colors hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200/70 pt-4">
            <span title="Próximamente">
              <button type="button" disabled aria-disabled
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white opacity-50 shadow-sm"
                style={{ backgroundColor: TEAL }}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Nueva suscripción
              </button>
            </span>
            <Link href="/caja/nueva"
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:brightness-95"
              style={{ borderColor: `${TEAL}4d`, backgroundColor: `${TEAL}14`, color: TEAL }}>
              Venta al contado
            </Link>
            <button type="button" onClick={() => setCobrando(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
              Registrar pago
            </button>
          </div>
        </div>

        {/* Datos rápidos */}
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/40 sm:grid-cols-4 xl:grid-cols-7">
          {datos.map((d) => (
            <div key={d.label} className="px-5 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{d.label}</p>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">{d.value}</div>
            </div>
          ))}
        </div>
      </div>

      {bajando ? (
        <PanelBaja clienteId={c.id} onCancel={() => setBajando(false)} onHecho={() => router.push("/clientes?baja_ok=1")} />
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}

      {/* Pestañas */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-5 py-3.5 text-sm font-medium transition-colors ${tab === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
              {t.label}
              {t.badge ? <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{t.badge}</span> : null}
            </button>
          ))}
        </div>
        <div className="min-h-[220px] p-6">
          {tab === "informacion" ? <TabInformacion cliente={c} esAdmin={esAdmin} onGuardado={() => void cargar()} /> : null}
          {tab === "estado_cuenta" ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi titulo="Total comprado" valor={gs(r?.total_comprado ?? 0)} sub={r?.ultima_compra ? `última ${fecha(r.ultima_compra)}` : "todavía no compró"} />
                  <Kpi titulo="Compras" valor={String(r?.compras ?? 0)} sub={r?.compras ? `ticket promedio ${gs(r.ticket_promedio)}` : undefined} />
                  <Kpi titulo="Debe" valor={gs(r?.deuda ?? 0)}
                    sub={[(r?.vencido ?? 0) > 0 ? `vencido ${gs(r!.vencido)}` : (r?.deuda ?? 0) > 0 ? "al día" : "no debe nada", (r?.saldo_favor ?? 0) > 0 ? `a favor ${gs(r!.saldo_favor!)}` : null].filter(Boolean).join(" · ")}
                    tono={(r?.vencido ?? 0) > 0 ? "rojo" : undefined} />
                  <Kpi titulo="Crédito disponible" valor={!credito ? "Contado" : limite_credito > 0 ? gs(disponible ?? 0) : "Sin límite"}
                    sub={credito ? (limite_credito > 0 ? `de ${gs(limite_credito)}` : `${c.plazo_dias ?? 30} días de plazo`) : "no compra a crédito"} />
                </div>
                <BotonPdf clienteId={c.id} />
              </div>
              <CuentaCorriente clienteId={c.id} recarga={recargaCuenta} onCambio={() => void cargar()} />
            </div>
          ) : null}
          {tab === "compras" ? <TabCompras ventas={data.ventas} /> : null}
          {tab === "contactos" ? <TabContactos clienteId={c.id} contactos={data.contactos} onChange={() => void cargar()} /> : null}
          {tab === "actividad" ? <TabActividad clienteId={c.id} recarga={recargaHist} /> : null}
          {tab === "notas" ? <TabNotas clienteId={c.id} notaAnterior={c.notas} onCambio={setNotasCount} /> : null}
        </div>
      </div>

      {cobrando ? (
        <RegistrarCobro clienteId={c.id} clienteNombre={c.razon_social || c.nombre} onClose={() => setCobrando(false)}
          onHecho={() => { void cargar(); setRecargaCuenta((k) => k + 1); setTab("estado_cuenta"); }} />
      ) : null}
      {eliminando ? (
        <ModalEliminar clienteId={c.id} onClose={() => setEliminando(false)} onEliminado={() => router.push("/clientes")}
          onDarDeBaja={estado === "activo" ? () => { setEliminando(false); setBajando(true); } : undefined} />
      ) : null}
    </div>
  );
}

function BotonPdf({ clienteId }: { clienteId: string }) {
  const [bajando, setBajando] = useState(false);
  return (
    <button type="button" disabled={bajando}
      onClick={async () => { setBajando(true); try { await descargarArchivo(`/api/clientes/${clienteId}/estado-cuenta/pdf`, "estado-cuenta.pdf"); } catch { /* best-effort */ } finally { setBajando(false); } }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Estado de cuenta PDF
    </button>
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

function TabCompras({ ventas }: { ventas: Venta[] }) {
  if (!ventas.length) return <p className="py-10 text-center text-sm italic text-slate-400">Este cliente todavía no compró.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/80">
          <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-4 py-2">Número</th>
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Condición</th>
            <th className="px-4 py-2 text-right">Total</th>
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
  const [error, setError] = useState<string | null>(null);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${clienteId}/contactos`, {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), cargo: cargo.trim() || undefined, telefono: telefono.trim() || undefined }),
      });
      setNombre(""); setCargo(""); setTelefono("");
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function quitar(cid: string) {
    try {
      await apiFetch(`/api/clientes/${clienteId}/contactos?contacto_id=${cid}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
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
        <button type="submit" disabled={busy || !nombre.trim()} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Agregar
        </button>
      </form>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {contactos.length === 0 ? (
        <p className="py-6 text-center text-sm italic text-slate-400">Sin contactos cargados. Sirve para empresas: con quién hablar para cobrar o tomar pedidos.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {contactos.map((ct) => (
            <li key={ct.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{ct.nombre} {ct.cargo ? <span className="font-normal text-slate-400">· {ct.cargo}</span> : null}</div>
                <div className="text-xs text-slate-500">{ct.telefono || ct.email || "—"}</div>
              </div>
              <button type="button" onClick={() => void quitar(ct.id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" /> Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FichaSkeleton() {
  const bar = "animate-pulse rounded-md bg-slate-200/90";
  return (
    <div className="max-w-7xl space-y-6">
      <div className={`h-3 w-28 ${bar}`} aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-40 animate-pulse bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200" aria-hidden />
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 sm:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2 px-5 py-3">
              <div className={`h-2.5 w-16 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex gap-2 border-b border-slate-100 px-3 py-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={`h-8 max-w-[7rem] flex-1 ${bar}`} />)}
        </div>
        <div className="space-y-3 p-6">
          <div className={`h-4 w-full max-w-md ${bar}`} />
          <div className={`h-4 w-full max-w-sm ${bar}`} />
          <div className={`h-32 w-full ${bar}`} />
        </div>
      </div>
    </div>
  );
}
