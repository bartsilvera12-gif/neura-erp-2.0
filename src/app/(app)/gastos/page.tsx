"use client";

/**
 * /gastos — Gastos y Servicios (igual que el sistema actual): documentos que no afectan
 * inventario (servicios, alquiler, honorarios, etc.) con sus datos fiscales.
 * Contadores por estado, filtros Desde / Hasta (por defecto el mes en curso) / Todas las
 * fechas / estado / búsqueda, y la lista NÚMERO · PROVEEDOR · COMPROBANTE · FECHA · TOTAL ·
 * ESTADO · ACCIONES. Borrador → abrir y confirmar / eliminar; confirmado → anular con motivo.
 * A crédito nace la deuda en Compras › Pagos a proveedores; al contado en efectivo sale de
 * la caja. ?ver=<id> abre el detalle (lo usan los enlaces desde Pagos a proveedores).
 * Sin contabilidad (el 2.0 no tiene asientos): la "cuenta contable" del actual es la categoría.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Eye, Paperclip, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { FormGasto } from "@/modules/gastos/FormGasto";
import { ConfirmarAccionGasto, DetalleGasto } from "@/modules/gastos/DetalleGasto";
import { ESTADO_GASTO, fechaCorta, gs, nombreMedioGasto, type FilaGasto, type ListaGastos } from "@/modules/gastos/tipos";

const POR_PAGINA = 50;
const INPUT = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const primeroDelMes = () => `${hoyPY().slice(0, 8)}01`;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GastosServicios />
    </Suspense>
  );
}

function GastosServicios() {
  const router = useRouter();
  const sp = useSearchParams();
  const ver = sp.get("ver");
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [desde, setDesde] = useState(primeroDelMes);
  const [hasta, setHasta] = useState(hoyPY);
  const [estado, setEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<ListaGastos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [accion, setAccion] = useState<{ modo: "anular" | "eliminar"; gasto: { id: string; numero: string | null } } | null>(null);

  useEffect(() => { if (ver && /^[0-9a-f-]{36}$/i.test(ver)) setDetalle(ver); }, [ver]);
  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);
  useEffect(() => { setPagina(1); }, [q, desde, hasta, estado]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    if (q) p.set("q", q);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (estado) p.set("estado", estado);
    apiFetch<ListaGastos>(`/api/gastos?${p}`)
      .then((r) => { if (vivo) { setDatos(r); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [q, desde, hasta, estado, pagina, recarga]);

  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);
  const cerrarDetalle = () => {
    setDetalle(null);
    if (ver) router.replace("/gastos", { scroll: false });
  };

  const r = datos?.resumen;
  const filas = datos?.rows ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Gastos y Servicios</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Gastos y Servicios</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Documentos que no afectan inventario (servicios, alquiler, honorarios, etc.) con datos fiscales.</p>
        </div>
        <button onClick={() => setForm({ id: null })} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
          <Plus className="h-4 w-4" /> Nuevo gasto o servicio
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Total", v: r?.total, e: "" },
          { l: "Borradores", v: r?.borrador, e: "borrador" },
          { l: "Confirmados", v: r?.confirmado, e: "confirmado" },
          { l: "Anulados", v: r?.anulado, e: "anulado" },
        ].map((k) => (
          <button key={k.l} onClick={() => setEstado(k.e)}
            className={`rounded-xl border px-4 py-3 text-left transition ${estado === k.e ? "border-[#4FAEB2] bg-[#4FAEB2]/5 ring-2 ring-[#4FAEB2]/15" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}>
            <p className="text-xs text-slate-400">{k.l}</p>
            <p className="text-lg font-bold tabular-nums text-slate-800">{k.v ?? "—"}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar por número, proveedor, comprobante…" className={`${INPUT} w-full pl-9`} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={INPUT} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={INPUT} />
        </label>
        {desde || hasta ? (
          <button onClick={() => { setDesde(""); setHasta(""); }} className="text-xs font-semibold text-[#3F8E91] underline-offset-2 hover:underline">Todas las fechas</button>
        ) : (
          <button onClick={() => { setDesde(primeroDelMes()); setHasta(hoyPY()); }} className="text-xs font-semibold text-[#3F8E91] underline-offset-2 hover:underline">Este mes</button>
        )}
        <Select value={estado} onChange={setEstado} minWidth={180}
          options={[["", "Todos los estados"], ["borrador", "Borradores"], ["confirmado", "Confirmados"], ["anulado", "Anulados"]]} />
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">Número</th>
              <th className="px-3 py-2.5 text-left">Proveedor</th>
              <th className="px-3 py-2.5 text-left">Comprobante</th>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-right">Total</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-4 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && !datos ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">No hay gastos o servicios que coincidan.</td></tr>
            ) : filas.map((g) => (
              <Fila key={g.id} g={g} cargando={cargando}
                onVer={() => setDetalle(g.id)}
                onEditar={() => setForm({ id: g.id })}
                onEliminar={() => setAccion({ modo: "eliminar", gasto: { id: g.id, numero: g.numero } })}
                onAnular={() => setAccion({ modo: "anular", gasto: { id: g.id, numero: g.numero } })} />
            ))}
          </tbody>
          {filas.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-100 bg-slate-50/80">
                <td colSpan={4} className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">Total confirmado de la vista</p>
                  <p className="text-[10px] text-slate-500">{total} {total === 1 ? "documento" : "documentos"} · sin borradores ni anulados</p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{gs(datos?.total_monto)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
        {total > POR_PAGINA ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            <span>Página {pagina} de {totalPaginas}</span>
            <div className="flex gap-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Anterior</button>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Siguiente</button>
            </div>
          </div>
        ) : null}
      </div>

      {form ? <FormGasto gastoId={form.id} onClose={() => setForm(null)} onHecho={refrescar} /> : null}
      {detalle ? (
        <DetalleGasto id={detalle} onClose={cerrarDetalle} onCambio={refrescar}
          onEditar={(id) => { cerrarDetalle(); setForm({ id }); }}
          onEliminar={(gasto) => setAccion({ modo: "eliminar", gasto })}
          onAnular={(gasto) => setAccion({ modo: "anular", gasto })} />
      ) : null}
      {accion ? (
        <ConfirmarAccionGasto modo={accion.modo} gasto={accion.gasto} onClose={() => setAccion(null)}
          onHecho={() => { if (accion.modo === "eliminar") cerrarDetalle(); refrescar(); }} />
      ) : null}
    </div>
  );
}

function Fila({ g, cargando, onVer, onEditar, onEliminar, onAnular }: {
  g: FilaGasto; cargando: boolean; onVer: () => void; onEditar: () => void; onEliminar: () => void; onAnular: () => void;
}) {
  const est = ESTADO_GASTO[g.estado];
  const condicion = g.tipo_pago === "credito"
    ? g.cxp ? (Number(g.cxp.saldo) > 0 ? `Crédito · saldo ${gs(g.cxp.saldo)}` : "Crédito · pagado") : `Crédito${g.fecha_vencimiento ? ` · vence ${fechaCorta(g.fecha_vencimiento)}` : ""}`
    : g.tipo_pago === "contado" ? `Contado · ${nombreMedioGasto(g.medio_pago)}` : null;
  return (
    <tr className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${g.estado === "anulado" ? "opacity-60" : ""} ${cargando ? "opacity-70" : ""}`}>
      <td className="px-4 py-2 text-xs">
        <button onClick={onVer} className="font-mono font-semibold text-slate-700 hover:text-[#3F8E91]">{g.numero ?? "—"}</button>
        {g.tiene_comprobante ? <Paperclip className="ml-1 inline h-3 w-3 text-slate-400" aria-label="Con comprobante adjunto" /> : null}
      </td>
      <td className="px-3 py-2">
        <p className="text-slate-800">{g.proveedor_nombre ?? <span className="italic text-slate-400">Sin proveedor</span>}</p>
        {g.categorias || g.descripcion ? <p className="max-w-[18rem] truncate text-[11px] text-slate-400">{[g.categorias, g.descripcion].filter(Boolean).join(" · ")}</p> : null}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {[g.tipo_comprobante, g.numero_comprobante].filter(Boolean).join(" ") || "—"}
        {condicion ? <span className="block text-[11px] text-slate-400">{condicion}</span> : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fechaCorta(g.fecha)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{gs(g.total)}</td>
      <td className="px-3 py-2 text-center">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${est.c}`}>{est.t}</span>
        {g.estado === "anulado" && g.anulado_motivo ? <span className="mt-0.5 block max-w-[10rem] truncate text-[10px] text-rose-500" title={g.anulado_motivo}>{g.anulado_motivo}</span> : null}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1.5 text-xs">
          {g.estado === "borrador" ? (
            <>
              <button onClick={onEditar} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700"><Pencil className="h-3 w-3" /> Abrir y confirmar</button>
              <button onClick={onEliminar} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50"><Trash2 className="h-3 w-3" /> Eliminar</button>
            </>
          ) : (
            <>
              <button onClick={onVer} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"><Eye className="h-3 w-3" /> Ver</button>
              {g.estado === "confirmado" ? (
                <button onClick={onAnular} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-rose-600 hover:bg-rose-50"><Ban className="h-3 w-3" /> Anular</button>
              ) : null}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
