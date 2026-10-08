"use client";

/**
 * /compras/ordenes — órdenes de compra (Fase 3). Lista con búsqueda inteligente y filtro
 * por estado (por defecto las abiertas: pendientes y recibidas en parte) y proveedor, con
 * barra de cuánto llegó. El detalle muestra pedido / recibido / falta por producto y las
 * compras con que se recibió, y permite Recibir mercadería, PDF, Editar y Cancelar.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, ClipboardList, Download, Loader2, PackageCheck, Pencil, Plus, Search, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { Drawer } from "@/components/Drawer";
import { TZ_PY } from "@/lib/fecha/paraguay";
import { ESTADO_OC, type OrdenCompra } from "@/modules/compras/ordenes";
import { nombreProveedor, type ProveedorMin } from "@/modules/proveedores/tipos";
import { cargarProveedores } from "@/modules/proveedores/cache";

const TEAL = clienteConfig.color;
const POR_PAGINA = 25;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const num = (v: number) => Number(v || 0).toLocaleString("es-PY", { maximumFractionDigits: 3 });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "short", year: "numeric" });
const fechaDia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const hoy = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ_PY });

export default function OrdenesPage() {
  const [rows, setRows] = useState<OrdenCompra[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("abiertas");
  const [proveedor, setProveedor] = useState("");
  const [proveedores, setProveedores] = useState<ProveedorMin[]>([]);
  const [viendo, setViendo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // Solo para el filtro: la lista liviana compartida (sin rubros ni compras).
    void cargarProveedores().then(setProveedores);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(borrador.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => {
    let cancel = false;
    setCargando(true);
    const sp = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) sp.set("q", q);
    if (estado) sp.set("estado", estado);
    if (proveedor) sp.set("proveedor", proveedor);
    apiFetch<{ rows: OrdenCompra[]; total: number }>(`/api/ordenes-compra?${sp}`)
      .then((r) => { if (!cancel) { setRows(r.rows); setTotal(r.total); } })
      .catch(() => { if (!cancel) { setRows([]); setTotal(0); } })
      .finally(() => { if (!cancel) setCargando(false); });
    return () => { cancel = true; };
  }, [pagina, q, estado, proveedor, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Compras</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Órdenes de compra</h1>
          <p className="mt-1 text-sm text-slate-500">Lo que le pediste a cada proveedor y cuánto ya llegó.</p>
        </div>
        <Link href="/compras/ordenes/nueva" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
          <Plus className="h-4 w-4" /> Nueva orden
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, proveedor o producto…"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)]" />
          </div>
          <Select value={estado} onChange={(v) => { setEstado(v); setPagina(1); }} minWidth={190} options={[
            ["abiertas", "Abiertas (por recibir)"], ["", "Todas"], ["pendiente", "Pendientes"], ["recibida_parcial", "Recibidas en parte"], ["recibida_total", "Recibidas"], ["cancelada", "Canceladas"],
          ]} />
          <Select value={proveedor} onChange={(v) => { setProveedor(v); setPagina(1); }} minWidth={180}
            options={[["", "Todos los proveedores"], ...proveedores.map((p): [string, string] => [p.id, nombreProveedor(p)])]} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b-2 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: `${TEAL}26`, backgroundColor: `${TEAL}0d`, color: TEAL }}>
                <th className="px-5 py-3">Número</th>
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Proveedor</th>
                <th className="px-3 py-3">Llegó</th>
                <th className="px-3 py-3">Entrega</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Total estimado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando && rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">Cargando…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-700">{estado === "abiertas" && !q && !proveedor ? "No hay órdenes esperando mercadería" : "Ninguna orden coincide"}</p>
                    <Link href="/compras/ordenes/nueva" className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>
                      <Plus className="h-4 w-4" /> Nueva orden
                    </Link>
                  </td>
                </tr>
              ) : (
                rows.map((o) => {
                  const pct = o.unidades ? Math.min(100, Math.round(((o.recibidas ?? 0) / o.unidades) * 100)) : 0;
                  const atrasada = o.fecha_entrega && o.fecha_entrega < hoy() && (o.estado === "pendiente" || o.estado === "recibida_parcial");
                  return (
                    <tr key={o.id} onClick={() => setViendo(o.id)} className={`cursor-pointer transition-colors hover:bg-[var(--brand-50)] ${cargando ? "opacity-60" : ""}`}>
                      <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-800">{o.numero_oc}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{fecha(o.fecha)}</td>
                      <td className="px-3 py-3 font-semibold text-slate-800">{o.proveedor_nombre}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#10b981" : TEAL }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-slate-500">{num(o.recibidas ?? 0)} de {num(o.unidades ?? 0)}</span>
                        </div>
                      </td>
                      <td className={`px-3 py-3 text-xs ${atrasada ? "font-semibold text-rose-600" : "text-slate-600"}`}>
                        {o.fecha_entrega ? fechaDia(o.fecha_entrega) : "—"}{atrasada ? " · atrasada" : ""}
                      </td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_OC[o.estado].clase}`}>{ESTADO_OC[o.estado].texto}</span></td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-bold tabular-nums text-slate-900">{Number(o.total) ? gs(o.total) : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas} · {total} órdenes</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </section>

      {viendo ? <DetalleOrden id={viendo} onClose={() => setViendo(null)} onCambio={refrescar} /> : null}
    </div>
  );
}

function DetalleOrden({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [o, setO] = useState<OrdenCompra | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<OrdenCompra>(`/api/ordenes-compra/${id}`).then(setO).catch((e) => setError((e as Error).message));
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function cancelar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/ordenes-compra/${id}/cancelar`, { method: "POST", body: JSON.stringify({ motivo }) });
      setCancelando(false);
      cargar();
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const abierta = o?.estado === "pendiente" || o?.estado === "recibida_parcial";
  const editable = o?.estado === "pendiente" && !(o.items ?? []).some((i) => Number(i.cantidad_recibida) > 0);

  return (
    <Drawer
      titulo={o ? `Orden ${o.numero_oc}` : "Orden de compra"}
      subtitulo={o ? `${o.proveedor_nombre} · ${ESTADO_OC[o.estado].texto}` : undefined}
      onClose={onClose}
      footer={o ? (
        cancelando ? (
          <>
            <button onClick={() => setCancelando(false)} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Volver</button>
            <button onClick={cancelar} disabled={busy || !motivo.trim()} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Confirmar cancelación
            </button>
          </>
        ) : (
          <>
            <button onClick={() => descargarArchivo(`/api/ordenes-compra/${o.id}/pdf`, `orden-compra-${o.numero_oc}.pdf`).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              <Download className="h-4 w-4" /> PDF
            </button>
            {abierta ? (
              <Link href={`/compras/nueva?oc=${o.id}`} className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:brightness-95" style={{ backgroundColor: TEAL }}>
                <PackageCheck className="h-4 w-4" /> Recibir mercadería
              </Link>
            ) : null}
          </>
        )
      ) : undefined}
    >
      {!o ? (
        error ? <p className="text-sm text-rose-600">{error}</p> : <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="space-y-5">
          {o.estado === "cancelada" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold">Orden cancelada</p>
              <p className="text-xs">{o.cancelada_motivo}{o.cancelada_por ? ` · ${o.cancelada_por}` : ""}{o.cancelada_at ? ` · ${fecha(o.cancelada_at)}` : ""}</p>
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Dato l="Creada" v={`${fecha(o.fecha)}${o.usuario_nombre ? ` · ${o.usuario_nombre}` : ""}`} />
            <Dato l="Entrega esperada" v={o.fecha_entrega ? fechaDia(o.fecha_entrega) : "A coordinar"} />
            <Dato l="Condición" v={o.tipo_pago === "credito" ? `Crédito${o.plazo_dias ? ` ${o.plazo_dias} días` : ""}` : "Contado"} />
            <Dato l="Total estimado" v={Number(o.total) ? gs(o.total) : "—"} />
          </dl>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Productos</p>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
              {(o.items ?? []).map((i) => {
                const falta = Math.max(Number(i.cantidad) - Number(i.cantidad_recibida), 0);
                return (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{i.producto_nombre}</p>
                      <p className="text-[11px] text-slate-500">
                        Pedido {num(i.cantidad)} · llegaron {num(i.cantidad_recibida)}
                        {Number(i.costo_unitario) ? ` · ${gs(i.costo_unitario)} c/u` : ""}
                      </p>
                    </div>
                    {falta > 0 && o.estado !== "cancelada" ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Faltan {num(falta)}</span>
                    ) : falta === 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Completo</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          {o.compras?.length ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Recibida con</p>
              <ul className="space-y-1.5">
                {o.compras.map((c) => (
                  <li key={c.id} className={`flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm ${c.estado === "anulada" ? "opacity-50 line-through" : ""}`}>
                    <span><span className="font-mono text-xs font-semibold text-slate-800">{c.numero_control}</span> <span className="text-xs text-slate-500">· factura {c.numero_factura} · {fecha(c.fecha)}</span></span>
                    <span className="font-semibold tabular-nums text-slate-800">{gs(c.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {o.observacion ? <p className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600">{o.observacion}</p> : null}

          {!cancelando && (editable || abierta) ? (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {editable ? (
                <Link href={`/compras/ordenes/nueva?editar=${o.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  <Pencil className="h-3.5 w-3.5" /> Editar orden
                </Link>
              ) : null}
              {abierta ? (
                <button onClick={() => setCancelando(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                  <Ban className="h-3.5 w-3.5" /> Cancelar orden
                </button>
              ) : null}
            </div>
          ) : null}

          {cancelando ? (
            <div className="rounded-xl border border-rose-200 p-4">
              <p className="text-sm font-semibold text-slate-800">¿Por qué la cancelás?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {o.estado === "recibida_parcial" ? "Lo que ya llegó queda como está; lo que falta deja de esperarse." : "La orden queda cancelada y no se puede recibir."}
              </p>
              <textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500} placeholder="Ej: el proveedor no tiene stock"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100" />
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
              <span>{error}</span><button onClick={() => setError(null)} aria-label="Cerrar"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function Dato({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-slate-500">{l}</dt>
      <dd className="text-sm font-medium text-slate-800">{v}</dd>
    </div>
  );
}
