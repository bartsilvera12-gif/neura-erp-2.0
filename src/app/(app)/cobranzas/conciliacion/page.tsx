"use client";

/**
 * /cobranzas/conciliacion — Conciliación bancaria (maker-checker, portado del sistema actual).
 * Las transferencias se registran como PENDIENTES (no bajan la deuda); un administrador las
 * aprueba (nace el cobro real), las rechaza (con motivo) o, ya aprobadas, las anula (la
 * deuda vuelve). Pestañas por estado con contador, mes (Paraguay), rango de fechas, plan y
 * búsqueda. "Cargar extracto" cruza un Excel/CSV del banco contra las aprobadas (solo
 * verificación, no modifica nada). Sin contabilidad: el 2.0 no tiene asientos.
 */
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, FileSpreadsheet, Loader2, Paperclip, Plus, Search, X } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { hoyPY, TZ_PY } from "@/lib/fecha/paraguay";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { Select } from "@/components/Select";
import { RegistrarTransferencia } from "@/modules/cobranzas/RegistrarTransferencia";
import {
  ESTADO_COBRO, fechaCorta, gs, ROLES_REGISTRAR,
  type Banco, type CobroPendiente, type EstadoCobroPendiente, type ListaConciliacion,
} from "@/modules/cobranzas/tipos";
import type { ReporteConciliacion } from "@/lib/cobranzas/extracto";

const TABS: { key: EstadoCobroPendiente | ""; label: string }[] = [
  { key: "pendiente", label: "Pendiente" },
  { key: "aprobado", label: "Aprobado" },
  { key: "rechazado", label: "Rechazado" },
  { key: "anulado", label: "Anulado" },
  { key: "", label: "Todas" },
];
const CONTROL = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-600 outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-PY", { timeZone: TZ_PY, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmt = (v: number | string) => Math.round(Number(v) || 0).toLocaleString("es-PY");

function mesesRecientes(): { value: string; label: string }[] {
  const [y, m] = hoyPY().split("-").map(Number);
  const out = [{ value: "", label: "Todos los meses" }];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("es-PY", { month: "long", year: "numeric", timeZone: "UTC" });
    out.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}
function finDeMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export default function ConciliacionPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-sm text-slate-400">Cargando…</div>}>
      <Conciliacion />
    </Suspense>
  );
}

function Conciliacion() {
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const puedeRegistrar = !!me && ROLES_REGISTRAR.includes(me.rol);
  const puedeExtracto = esAdmin || me?.rol === "SUPERVISOR";
  const destacado = useSearchParams().get("cobro");

  const [estado, setEstado] = useState<EstadoCobroPendiente | "">("pendiente");
  const meses = useMemo(mesesRecientes, []);
  // Desde un aviso de la campanita: todos los meses, para que la transferencia se vea.
  const [mes, setMes] = useState(destacado ? "" : hoyPY().slice(0, 7));
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [borrador, setBorrador] = useState("");
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [lista, setLista] = useState<ListaConciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [registrando, setRegistrando] = useState(false);
  const [rechazando, setRechazando] = useState<CobroPendiente | null>(null);
  const [anulando, setAnulando] = useState<CobroPendiente | null>(null);
  const [bancosOpen, setBancosOpen] = useState(false);
  const [aprobarAnim, setAprobarAnim] = useState<null | "loading" | "done">(null);
  const [aprobandoId, setAprobandoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [analizando, setAnalizando] = useState(false);
  const [reporte, setReporte] = useState<ReporteConciliacion | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(borrador.trim()), 300);
    return () => clearTimeout(t);
  }, [borrador]);

  // Rango efectivo: el mes elegido acotado por desde/hasta.
  const rango = useMemo(() => {
    let d = mes ? `${mes}-01` : "";
    let h = mes ? finDeMes(mes) : "";
    if (desde && (!d || desde > d)) d = desde;
    if (hasta && (!h || hasta < h)) h = hasta;
    return { desde: d, hasta: h };
  }, [mes, desde, hasta]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const sp = new URLSearchParams();
    if (estado) sp.set("estado", estado);
    if (rango.desde) sp.set("desde", rango.desde);
    if (rango.hasta) sp.set("hasta", rango.hasta);
    if (q) sp.set("q", q);
    apiFetch<ListaConciliacion>(`/api/cobranzas/conciliacion?${sp}`)
      .then((r) => { if (vivo) { setLista(r); setError(null); } })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [estado, rango, q, recarga]);
  const refrescar = useCallback(() => setRecarga((k) => k + 1), []);

  // Llegó desde la campanita: llevar la fila a la vista.
  useEffect(() => {
    if (!destacado || !lista) return;
    document.getElementById(`cobro-${destacado}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [destacado, lista]);

  const planes = useMemo(() => [...new Set((lista?.cobros ?? []).map((c) => c.plan ?? "General"))].sort((a, b) => a.localeCompare(b, "es")), [lista]);
  const cobros = useMemo(() => (lista?.cobros ?? []).filter((c) => !plan || (c.plan ?? "General") === plan), [lista, plan]);

  async function aprobar(c: CobroPendiente) {
    setError(null); setOkMsg(null);
    setAprobandoId(c.id);
    setAprobarAnim("loading");
    try {
      const r = await apiFetch<{ numero_recibo: string; saldo_restante: number }>(`/api/cobranzas/conciliacion/${c.id}/aprobar`, { method: "POST", body: "{}" });
      setOkMsg(`Aprobada: se registró el cobro ${r.numero_recibo} a ${c.numero_factura} (${c.cliente_nombre}). Saldo de la factura: ${gs(r.saldo_restante)}.`);
      setAprobarAnim("done");
      window.setTimeout(() => setAprobarAnim(null), 1100);
      refrescar();
    } catch (e) {
      setAprobarAnim(null);
      setError((e as Error).message);
    } finally {
      setAprobandoId(null);
    }
  }

  async function verComprobante(c: CobroPendiente) {
    const w = window.open("", "_blank");
    try {
      const r = await apiFetch<{ url: string }>(`/api/cobranzas/conciliacion/${c.id}/comprobante`);
      if (w) w.location.href = r.url;
      else window.open(r.url, "_blank", "noopener");
    } catch (e) {
      w?.close();
      setError((e as Error).message || "No se pudo abrir el comprobante.");
    }
  }

  async function analizarExtracto(f: File) {
    setAnalizando(true); setError(null); setOkMsg(null); setReporte(null);
    try {
      const buf = await f.arrayBuffer();
      if (!buf.byteLength) throw new Error("El archivo llegó vacío. Si está en la nube (OneDrive/Drive), descargalo primero.");
      const fd = new FormData();
      fd.append("file", new File([buf], f.name || "extracto.xlsx", { type: f.type || "application/octet-stream" }));
      if (mes) fd.append("mes", mes);
      setReporte(await apiForm<ReporteConciliacion>("/api/cobranzas/conciliacion/extracto", fd));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalizando(false);
      // Recién ahora se limpia el input (antes anula los bytes del archivo): permite re-subir el mismo.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const conteo = (k: EstadoCobroPendiente | "") => (lista ? lista.conteos[k || "todas"] : null);

  return (
    <div className="w-full min-w-0 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Cobranzas</p>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Conciliación bancaria</h1>
          <p className="mt-1 text-sm text-slate-500">Transferencias de clientes: se registran, un administrador las aprueba y recién ahí baja la deuda.</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/cobranzas" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
            <ArrowLeft className="h-4 w-4" /> Seguimiento
          </Link>
          {esAdmin ? (
            <button onClick={() => setBancosOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:border-[#4FAEB2]/60 hover:text-[#3F8E91]">
              <Building2 className="h-4 w-4" /> Bancos
            </button>
          ) : null}
          {puedeExtracto ? (
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void analizarExtracto(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={analizando} title="Subí el extracto del banco (Excel o CSV) y verificá las aprobadas contra el banco"
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#4FAEB2] bg-white px-3.5 py-2 text-sm font-semibold text-[#3F8E91] shadow-sm transition-colors hover:bg-[#4FAEB2]/10 disabled:opacity-60">
                {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                {analizando ? "Analizando…" : "Cargar extracto (Excel o CSV)"}
              </button>
            </>
          ) : null}
          {puedeRegistrar ? (
            <button onClick={() => setRegistrando(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#4FAEB2] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3F8E91]">
              <Plus className="h-4 w-4" /> Registrar transferencia
            </button>
          ) : null}
        </div>
      </div>

      {analizando ? (
        <div className="flex items-center gap-3 rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/5 p-3 text-sm text-[#3F8E91]">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#4FAEB2]" />
          Leyendo el extracto y cruzando contra las transferencias aprobadas{mes ? ` de ${meses.find((m) => m.value === mes)?.label ?? mes}` : ""}…
        </div>
      ) : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {okMsg ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{okMsg}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.key || "todas"} onClick={() => setEstado(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${estado === t.key ? "bg-[#4FAEB2] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {t.label}
            {conteo(t.key) != null ? <span className={`tabular-nums text-xs ${estado === t.key ? "text-white/80" : "text-slate-400"}`}>({conteo(t.key)})</span> : null}
          </button>
        ))}
        <div className="relative ml-1 w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" value={borrador} onChange={(e) => setBorrador(e.target.value)} placeholder="Buscar cliente, banco, titular, N° op, factura o monto…"
            aria-label="Buscar transferencias" className={`${CONTROL} w-full pl-8 placeholder:text-slate-400`} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde (fecha de transferencia)" className={CONTROL} />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta (fecha de transferencia)" className={CONTROL} />
          </label>
          {planes.length > 1 ? (
            <Select value={plan} onChange={setPlan} options={[["", "Todos los planes"], ...planes.map((p): [string, string] => [p, p])]} minWidth={160} />
          ) : null}
          <Select value={mes} onChange={setMes} options={meses.map((m): [string, string] => [m.value, m.label])} minWidth={170} />
          {desde || hasta || plan ? (
            <button onClick={() => { setDesde(""); setHasta(""); setPlan(""); }} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700">Limpiar</button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Fecha</th>
              <th className="px-3 py-2.5 text-left">Factura</th>
              <th className="px-3 py-2.5 text-left">Cliente</th>
              <th className="px-3 py-2.5 text-left">Banco origen</th>
              <th className="px-3 py-2.5 text-left">N° operación</th>
              <th className="px-3 py-2.5 text-right">Monto</th>
              <th className="px-3 py-2.5 text-center">Estado</th>
              <th className="px-3 py-2.5 text-left">Quién cargó</th>
              <th className="px-3 py-2.5 text-left">Aprobó / Rechazó / Anuló</th>
              <th className="px-3 py-2.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando && !lista ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : cobros.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">{q ? "Sin resultados para la búsqueda." : `Sin transferencias${mes ? " en el mes seleccionado" : ""}.`}</td></tr>
            ) : cobros.map((c) => {
              const e = ESTADO_COBRO[c.estado];
              return (
                <tr key={c.id} id={`cobro-${c.id}`} className={`border-b last:border-0 hover:bg-slate-50/60 ${destacado === c.id ? "bg-[#4FAEB2]/[0.07] ring-2 ring-inset ring-[#4FAEB2]/40" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fechaCorta(c.fecha)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.numero_factura}
                    {c.grupo_id ? <span className="ml-1 rounded bg-slate-100 px-1 py-px font-sans text-[9px] font-semibold uppercase text-slate-500" title="Una transferencia aplicada a varias facturas">múltiple</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="block max-w-[200px] truncate" title={c.cliente_nombre}>{c.cliente_nombre}</span>
                    <span className="text-[10px] text-slate-400">{[c.plan, c.categoria].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-2">
                    {c.banco_origen}
                    <span className="block text-[10px] text-slate-400">{c.titular}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.numero_operacion}
                    {c.referencia_generada ? <span className="block font-sans text-[10px] text-[#3F8E91]">generada</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{fmt(c.monto)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e.cls}`}>{e.label}</span>
                    {c.estado === "rechazado" && c.motivo_rechazo ? <span className="mt-0.5 block text-[10px] italic text-slate-400">{c.motivo_rechazo}</span> : null}
                    {c.estado === "anulado" && c.motivo_anulacion ? <span className="mt-0.5 block text-[10px] italic text-slate-400">{c.motivo_anulacion}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {c.creado_por_nombre ? <span className="text-slate-700">{c.creado_por_nombre}</span> : <span className="text-slate-300">—</span>}
                    <span className="block text-[10px] text-slate-400">{fechaHora(c.created_at)}</span>
                  </td>
                  <td className="px-3 py-2">
                    {c.estado === "aprobado" && c.aprobado_por_nombre ? (
                      <div>
                        <span className="text-slate-700">{c.aprobado_por_nombre}</span>
                        {c.aprobado_at ? <span className="block text-[10px] text-slate-400">{fechaHora(c.aprobado_at)}</span> : null}
                      </div>
                    ) : c.estado === "rechazado" && c.rechazado_por_nombre ? (
                      <div>
                        <span className="text-slate-700">Rechazó: {c.rechazado_por_nombre}</span>
                        {c.rechazado_at ? <span className="block text-[10px] text-slate-400">{fechaHora(c.rechazado_at)}</span> : null}
                      </div>
                    ) : c.estado === "anulado" && (c.anulado_por_nombre || c.anulado_at) ? (
                      <div>
                        <span className="text-slate-700">Anuló: {c.anulado_por_nombre ?? "—"}</span>
                        {c.anulado_at ? <span className="block text-[10px] text-slate-400">{fechaHora(c.anulado_at)}</span> : null}
                      </div>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5 text-xs">
                      {c.comprobante_path ? (
                        <button onClick={() => void verComprobante(c)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[#3F8E91] hover:bg-slate-100">
                          <Paperclip className="h-3.5 w-3.5" /> Ver
                        </button>
                      ) : null}
                      {c.estado === "pendiente" && esAdmin ? (
                        <>
                          <button onClick={() => void aprobar(c)} disabled={!!aprobandoId} className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Aprobar</button>
                          <button onClick={() => setRechazando(c)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">Rechazar</button>
                        </>
                      ) : null}
                      {c.estado === "aprobado" && esAdmin ? (
                        <button onClick={() => setAnulando(c)} title="Anular la aprobación (anula el cobro y la deuda de la factura vuelve)"
                          className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">Anular</button>
                      ) : null}
                      {c.estado === "pendiente" && !esAdmin ? <span className="text-[10px] text-slate-400">Espera aprobación</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {cobros.length > 0 ? (
            <tfoot>
              <tr className="border-t bg-slate-50/60 text-xs text-slate-500">
                <td colSpan={5} className="px-3 py-2">{cobros.length} transferencia(s){cargando ? " · actualizando…" : ""}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{fmt(cobros.reduce((a, c) => a + Number(c.monto), 0))}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {registrando ? (
        <RegistrarTransferencia onClose={() => setRegistrando(false)}
          onHecho={(msg) => { setRegistrando(false); setOkMsg(msg); setError(null); setEstado("pendiente"); refrescar(); }} />
      ) : null}

      {rechazando ? (
        <ModalMotivo titulo="Rechazar transferencia" boton="Rechazar" tono="rose" cobro={rechazando}
          ayuda="La deuda de la factura no cambia (nunca se tocó). Queda registrado quién la rechazó y por qué."
          placeholder="Ej: no figura en el extracto / monto incorrecto…"
          url={`/api/cobranzas/conciliacion/${rechazando.id}/rechazar`}
          onClose={() => setRechazando(null)}
          onHecho={() => { setRechazando(null); setOkMsg("Transferencia rechazada."); refrescar(); }} />
      ) : null}
      {anulando ? (
        <ModalMotivo titulo="Anular transferencia aprobada" boton="Anular y revertir" tono="red" cobro={anulando}
          ayuda="Anula el cobro que se registró al aprobarla: el saldo de la factura vuelve. Queda auditado."
          placeholder="Ej: aprobación duplicada / el banco la devolvió…"
          url={`/api/cobranzas/conciliacion/${anulando.id}/anular`}
          onClose={() => setAnulando(null)}
          onHecho={() => { setAnulando(null); setOkMsg("Transferencia anulada: se anuló el cobro y el saldo de la factura volvió."); refrescar(); }} />
      ) : null}
      {bancosOpen ? <ModalBancos onClose={() => setBancosOpen(false)} /> : null}
      {reporte ? <ModalReporte reporte={reporte} mesLabel={meses.find((m) => m.value === reporte.mes)?.label ?? null} onClose={() => setReporte(null)} /> : null}

      {aprobarAnim ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25">
          <div className="cb-aprob-card flex w-44 flex-col items-center gap-3 rounded-2xl bg-white px-6 py-7 shadow-xl">
            {aprobarAnim === "loading" ? (
              <span className="cb-spinner" />
            ) : (
              <svg viewBox="0 0 56 56" className="cb-check" aria-hidden>
                <circle className="cb-check-circle" cx="28" cy="28" r="26" />
                <path className="cb-check-mark" d="M16 29 l8 8 l16 -17" />
              </svg>
            )}
            <p className="text-sm font-semibold text-slate-700">{aprobarAnim === "loading" ? "Aprobando…" : "¡Aprobado!"}</p>
          </div>
          <style>{`
            .cb-aprob-card { animation: cbPop .18s ease-out; }
            @keyframes cbPop { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }
            .cb-spinner { display:block; width:56px; height:56px; border-radius:9999px; border:5px solid rgba(79,174,178,.22); border-top-color:#4FAEB2; animation: cbSpin .7s linear infinite; }
            @keyframes cbSpin { to { transform: rotate(360deg) } }
            .cb-check { width:56px; height:56px; }
            .cb-check-circle { fill:#22c55e; transform-box: fill-box; transform-origin: center; animation: cbPunch .45s cubic-bezier(.65,0,.45,1); }
            .cb-check-mark { fill:none; stroke:#fff; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:46; stroke-dashoffset:46; animation: cbDraw .4s .14s ease-out forwards; }
            @keyframes cbPunch { 0%{transform:scale(.5)} 60%{transform:scale(1.12)} 100%{transform:scale(1)} }
            @keyframes cbDraw { to { stroke-dashoffset:0 } }
            @media (prefers-reduced-motion: reduce) { .cb-aprob-card, .cb-spinner, .cb-check-circle, .cb-check-mark { animation: none; stroke-dashoffset: 0; } }
          `}</style>
        </div>
      ) : null}
    </div>
  );
}

function ModalMotivo({ titulo, boton, tono, cobro, ayuda, placeholder, url, onClose, onHecho }: {
  titulo: string; boton: string; tono: "rose" | "red"; cobro: CobroPendiente; ayuda: string; placeholder: string; url: string;
  onClose: () => void; onHecho: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function enviar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(url, { method: "POST", body: JSON.stringify({ motivo: motivo.trim() }) });
      onHecho();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CapaModal onClose={busy ? undefined : onClose} z="z-[120]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-md ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{titulo}</h3>
            <p className="text-xs text-slate-500">{ayuda}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-400">Cliente</dt><dd className="col-span-2 font-medium text-slate-800">{cobro.cliente_nombre}</dd>
            <dt className="text-slate-400">Cargó el pago</dt><dd className="col-span-2 text-slate-700">{cobro.creado_por_nombre ?? "—"}</dd>
            <dt className="text-slate-400">Factura</dt><dd className="col-span-2 font-mono text-xs text-slate-700">{cobro.numero_factura}</dd>
            <dt className="text-slate-400">Banco / Titular</dt><dd className="col-span-2 text-slate-700">{cobro.banco_origen} · {cobro.titular}</dd>
            <dt className="text-slate-400">N° operación</dt><dd className="col-span-2 font-mono text-xs text-slate-700">{cobro.numero_operacion}</dd>
            <dt className="text-slate-400">Monto</dt><dd className="col-span-2 text-base font-semibold tabular-nums text-slate-900">{gs(cobro.monto)}</dd>
          </dl>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Motivo <span className="text-red-500">*</span></label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} autoFocus maxLength={500} placeholder={placeholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-300" />
          </div>
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t p-4">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button onClick={() => void enviar()} disabled={busy || !motivo.trim()}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${tono === "red" ? "bg-red-600 hover:bg-red-700" : "bg-rose-600 hover:bg-rose-700"}`}>
            {busy ? "Procesando…" : boton}
          </button>
        </div>
      </div>
    </CapaModal>
  );
}

function ModalBancos({ onClose }: { onClose: () => void }) {
  const [bancos, setBancos] = useState<Banco[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [sinRef, setSinRef] = useState(false);
  const [prefijo, setPrefijo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<{ bancos: Banco[] }>("/api/cobranzas/bancos?todos=1").then((r) => setBancos(r.bancos)).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(b: Banco, patch: Partial<Banco>) {
    setError(null);
    setBancos((xs) => xs?.map((x) => (x.id === b.id ? { ...x, ...patch } : x)) ?? null);
    try {
      await apiFetch(`/api/cobranzas/bancos/${b.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      invalidar("/api/cobranzas/bancos");
    } catch (e) {
      setError((e as Error).message);
      cargar();
    }
  }
  async function agregar() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/cobranzas/bancos", { method: "POST", body: JSON.stringify({ nombre: nombre.trim(), sin_referencia: sinRef, prefijo: sinRef ? prefijo.trim() || null : null }) });
      invalidar("/api/cobranzas/bancos");
      setNombre(""); setSinRef(false); setPrefijo("");
      cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={onClose} z="z-[120]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-lg ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Bancos</h3>
            <p className="text-xs text-slate-500">Banco de origen de las transferencias. «Sin referencia»: el banco no emite N° de operación y se genera uno (PREFIJO-AAMMDD-HHMMSS-XX).</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? <p className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
          {!bancos ? (
            <p className="text-sm text-slate-400">Cargando…</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {bancos.map((b) => (
                <li key={b.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${b.activo ? "" : "opacity-50"}`}>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{b.nombre}</span>
                  <label className="flex items-center gap-1 text-[11px] text-slate-500" title="No emite N° de operación: se genera una referencia">
                    <input type="checkbox" checked={b.sin_referencia} onChange={(e) => void cambiar(b, { sin_referencia: e.target.checked })} className="h-3.5 w-3.5 accent-[#4FAEB2]" />
                    Sin referencia
                  </label>
                  {b.sin_referencia ? (
                    <input defaultValue={b.prefijo ?? ""} maxLength={6} placeholder="SR" aria-label={`Prefijo de ${b.nombre}`}
                      onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== (b.prefijo ?? "")) void cambiar(b, { prefijo: v || null }); }}
                      className="w-14 rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] uppercase outline-none focus:ring-2 focus:ring-[#4FAEB2]/30" />
                  ) : null}
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input type="checkbox" checked={b.activo} onChange={(e) => void cambiar(b, { activo: e.target.checked })} className="h-3.5 w-3.5 accent-[#4FAEB2]" />
                    Activo
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 border-t p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nuevo banco…" maxLength={60} className={`${CONTROL} min-w-0 flex-1`} />
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input type="checkbox" checked={sinRef} onChange={(e) => setSinRef(e.target.checked)} className="h-3.5 w-3.5 accent-[#4FAEB2]" /> Sin referencia
            </label>
            {sinRef ? <input value={prefijo} onChange={(e) => setPrefijo(e.target.value.toUpperCase())} maxLength={6} placeholder="Prefijo" className={`${CONTROL} w-20 font-mono uppercase`} /> : null}
            <button onClick={() => void agregar()} disabled={busy || nombre.trim().length < 2} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {busy ? "Agregando…" : "Agregar"}
            </button>
          </div>
        </div>
      </div>
    </CapaModal>
  );
}

function ModalReporte({ reporte, mesLabel, onClose }: { reporte: ReporteConciliacion; mesLabel: string | null; onClose: () => void }) {
  const r = reporte.resumen;
  return (
    <CapaModal onClose={onClose} z="z-[120]">
      <div onClick={(e) => e.stopPropagation()} className={`flex w-full max-w-3xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} style={{ animation: "rb-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900">Conciliación del extracto</h3>
            <p className="truncate text-xs text-slate-500">{reporte.archivo}{mesLabel ? ` · ${mesLabel}` : " · todos los meses"} · {r.creditos_extracto} crédito(s) en el extracto</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "Aprobadas", v: r.aprobados, cls: "text-slate-900" },
              { l: "Conciliadas", v: r.conciliados, cls: "text-emerald-700" },
              { l: "Sin respaldo", v: r.sin_extracto, cls: "text-red-700" },
              { l: "No registradas", v: r.sin_registrar, cls: "text-amber-700" },
            ].map((c) => (
              <div key={c.l} className="rounded-xl border border-slate-200 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.l}</p>
                <p className={`text-2xl font-semibold tabular-nums ${c.cls}`}>{c.v}</p>
              </div>
            ))}
          </div>

          {r.sin_extracto === 0 && r.difieren === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Todas las transferencias aprobadas tienen respaldo en el extracto.</div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{r.sin_extracto} aprobada(s) sin respaldo y {r.difieren} con monto distinto. Revisá abajo.</div>
          )}

          {reporte.aprobados_sin_extracto.length > 0 ? (
            <section>
              <h4 className="mb-1.5 text-sm font-semibold text-red-700">Aprobadas sin respaldo en el extracto · {fmt(r.monto_sin_extracto)}</h4>
              <div className="overflow-hidden rounded-lg border border-red-100">
                {reporte.aprobados_sin_extracto.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 border-b border-red-50 px-3 py-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{a.cliente_nombre ?? a.titular ?? "—"}</p>
                      <p className="text-[11px] text-slate-500">{fechaCorta(a.fecha)} · {a.banco_origen ?? "—"} · Op {a.numero_operacion ?? "—"}{a.numero_factura ? ` · ${a.numero_factura}` : ""}{a.agrupadas && a.agrupadas > 1 ? ` · ${a.agrupadas} cobros agrupados` : ""}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-red-700">{fmt(a.monto)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {reporte.montos_difieren.length > 0 ? (
            <section>
              <h4 className="mb-1.5 text-sm font-semibold text-amber-700">Montos que no coinciden</h4>
              <div className="overflow-hidden rounded-lg border border-amber-100">
                {reporte.montos_difieren.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-amber-50 px-3 py-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{p.aprobado.cliente_nombre ?? p.aprobado.titular ?? "—"}</p>
                      <p className="text-[11px] text-slate-500">Op {p.aprobado.numero_operacion ?? "—"} · {fechaCorta(p.aprobado.fecha)}</p>
                    </div>
                    <span className="shrink-0 text-right text-[13px] tabular-nums">
                      <span className="text-slate-700">Sistema: {fmt(p.aprobado.monto)}</span>
                      <span className="block text-amber-700">Banco: {fmt(p.credito.monto)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {reporte.extracto_sin_registrar.length > 0 ? (
            <section>
              <h4 className="mb-1.5 text-sm font-semibold text-amber-700">Ingresos del extracto no registrados en el sistema · {fmt(r.monto_sin_registrar)}</h4>
              <div className="overflow-hidden rounded-lg border border-amber-100">
                {reporte.extracto_sin_registrar.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 border-b border-amber-50 px-3 py-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{c.descripcion ?? "Ingreso"}</p>
                      <p className="text-[11px] text-slate-500">{fechaCorta(c.fecha)} · Ref {c.referencia ?? "—"}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-amber-700">{fmt(c.monto)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {reporte.conciliados.length > 0 ? (
            <p className="text-xs text-emerald-700">{reporte.conciliados.length} transferencia(s) conciliada(s) por {fmt(r.monto_conciliado)}.</p>
          ) : null}
          <p className="text-[11px] text-slate-400">El extracto se leyó directo del Excel/CSV y no modifica nada: es una verificación. Revisá los casos marcados.</p>
        </div>
      </div>
    </CapaModal>
  );
}
