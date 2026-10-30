"use client";

/**
 * /reportes/rg90 — Registro de comprobantes (RG 90/2021, recetas 100 y 102): el archivo para importar
 * en Marangatu. Se elige el mes y a qué impuestos se imputan los comprobantes (IVA, IRE, IRP-RSP):
 *   · "Faltan datos": comprobantes que Marangatu rechazaría (sin RUC, sin timbrado, número mal
 *     escrito…), con el link para corregirlos. No van al archivo hasta corregirlos.
 *   · "Ventas" y "Compras y gastos": los que están bien y van en el archivo.
 *   · "No se registran": electrónicas / virtuales (Marangatu ya las tiene), anuladas, recibos, sin
 *     comprobante. Las facturas sin número fiscal se avisan: hay que cargarlas a mano en Marangatu.
 * "Descargar para Marangatu" baja el ZIP con el nombre y el formato de la SET.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Info, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { descargarArchivo } from "@/lib/api/client-blob";
import { hoyPY } from "@/lib/fecha/paraguay";
import { Select } from "@/components/Select";
import { TablaTarjetas, type ColumnaTabla } from "@/components/TablaResponsive";
import { EncabezadoReporte, FilaKpis, Kpi } from "@/modules/reportes/ui";
import { clienteConfig } from "@/cliente.config";
import { esVenta, filasParaArchivo, imputacionFila, MAX_FILAS, type FilaRg90, type Imputacion, type Rg90 } from "@/modules/reportes/rg90";

const TEAL = clienteConfig.color;
const gs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CLAVE_IMP = "rg90:imputacion";

/** Los últimos 13 meses (el anterior primero: es el que se presenta). */
function opcionesMes(): [string, string][] {
  const [a, m] = hoyPY().split("-").map(Number);
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return [v, `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}${i === 0 ? " (en curso)" : ""}`.replace(/^./, (c) => c.toUpperCase())];
  });
}

const hrefDoc = (f: { origen: string; id: string }) =>
  f.origen === "gasto" ? `/gastos-empresariales/operativos?ver=${f.id}`
    : f.origen === "venta" ? "/configuracion/facturacion"
    : f.origen === "nota_credito" ? `/caja/notas-credito?ver=${f.id}`
    : `/compras?ver=${f.id}`;

export default function Rg90Page() {
  const meses = useMemo(opcionesMes, []);
  const [mes, setMes] = useState(meses[1][0]);
  const [imp, setImp] = useState<Imputacion>({ iva: true, ire: true, irp: false });
  const [d, setD] = useState<Rg90 | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<number | null>(null);
  const [verExcluidos, setVerExcluidos] = useState(false);

  // Lo que liquida la empresa se recuerda en este equipo.
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(CLAVE_IMP) ?? "null"); if (v && typeof v.iva === "boolean") setImp(v); } catch { /* sin storage */ }
  }, []);
  const cambiarImp = (k: keyof Imputacion) => setImp((p) => {
    const n = { ...p, [k]: !p[k] };
    try { localStorage.setItem(CLAVE_IMP, JSON.stringify(n)); } catch { /* sin storage */ }
    return n;
  });

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    apiFetch<Rg90>(`/api/reportes/rg90?mes=${mes}`)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [mes]);

  const listas = d ? filasParaArchivo(d, imp) : [];
  const conProblemas = (d?.filas ?? []).filter((f) => f.problemas.length);
  const sinImputacion = (d?.filas ?? []).filter((f) => !f.problemas.length && !imputacionFila(f, imp).ok);
  const ventas = listas.filter(esVenta);
  const compras = listas.filter((f) => !esVenta(f));
  const aMano = (d?.excluidos ?? []).filter((x) => x.manual);
  const partes = Math.max(1, Math.ceil(listas.length / MAX_FILAS));
  const ningunImpuesto = !imp.iva && !imp.ire && !imp.irp;

  async function bajar(parte: number) {
    setBajando(parte);
    setError(null);
    try {
      const q = new URLSearchParams({ mes, iva: imp.iva ? "1" : "0", ire: imp.ire ? "1" : "0", irp: imp.irp ? "1" : "0", parte: String(parte) });
      await descargarArchivo(`/api/reportes/rg90/archivo?${q}`, `registro-comprobantes-${mes}.zip`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBajando(null);
    }
  }

  const columnasDe = (quien: string): ColumnaTabla<FilaRg90>[] => [
    { key: "prov", titulo: quien, movil: "titulo", celda: (f) => f.proveedor ?? "—" },
    { key: "total", titulo: "Total", movil: "valor", claseTh: "text-right", claseTd: "whitespace-nowrap text-right font-semibold tabular-nums", celda: (f) => gs(f.total) },
    { key: "comp", titulo: "Comprobante", movil: "subtitulo", claseTd: "whitespace-nowrap", celda: (f) => <>{f.tipo_comprobante} {f.numero}</> },
    { key: "fecha", titulo: "Fecha", movil: "dato", claseTd: "tabular-nums", celda: (f) => dia(f.fecha) },
    { key: "ruc", titulo: "RUC", movil: "dato", claseTd: "whitespace-nowrap tabular-nums", celda: (f) => f.ruc ?? "—" },
    { key: "timb", titulo: "Timbrado", movil: "detalle", celda: (f) => f.timbrado || "—" },
    { key: "iva", titulo: "Gravado 10 % / 5 % / exento", movil: "detalle", claseTd: "whitespace-nowrap tabular-nums text-xs text-slate-500",
      celda: (f) => `${gs(f.gravado_10)} / ${gs(f.gravado_5)} / ${gs(f.exento)}` },
    { key: "cond", titulo: "Cond.", movil: "detalle", celda: (f) => (f.condicion === 2 ? "Crédito" : "Contado") },
    { key: "doc", titulo: "En el ERP", movil: "detalle", celda: (f) => (f.origen === "venta"
      ? <span className="font-mono text-xs text-slate-500">{f.documento}</span>
      : <Link href={hrefDoc(f)} className="font-mono text-xs text-[var(--brand)] hover:underline">{f.documento}</Link>) },
  ];

  const CHIP = (on: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition [@media(pointer:coarse)]:min-h-11 ${on ? "border-[color-mix(in_srgb,var(--brand)_38%,white)] bg-[var(--brand-50)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-500"}`;

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoReporte kicker="Reportes · Impuestos" titulo="Registro de comprobantes (RG 90)"
        subtitulo="El archivo para importar en Marangatu: las ventas, compras y gastos del mes con comprobante, en el formato de la SET.">
        {partes > 1 ? null : (
          <button type="button" onClick={() => void bajar(1)} disabled={!listas.length || ningunImpuesto || bajando !== null}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            {bajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar para Marangatu
          </button>
        )}
      </EncabezadoReporte>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:flex-wrap sm:items-end sm:gap-5 sm:p-4">
        {/* div y no label: un <label> con el botón del Select adentro le repite el click (abre y cierra). */}
        <div className="min-w-0 sm:w-56">
          <span className="mb-1 block text-xs font-medium text-slate-600">Mes</span>
          <Select block value={mes} onChange={setMes} options={meses} etiqueta="Mes" />
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-slate-600">Los comprobantes se imputan a</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => cambiarImp("iva")} aria-pressed={imp.iva} className={CHIP(imp.iva)}>IVA</button>
            <button type="button" onClick={() => cambiarImp("ire")} aria-pressed={imp.ire} className={CHIP(imp.ire)}>IRE</button>
            <button type="button" onClick={() => cambiarImp("irp")} aria-pressed={imp.irp} className={CHIP(imp.irp)}>IRP-RSP</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 sm:max-w-xs">En las compras, el IVA se imputa solo si tienen IVA crédito. Lo que liquida tu empresa queda guardado en este equipo.</p>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {ningunImpuesto ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Elegí al menos un impuesto: Marangatu pide que cada comprobante se impute a alguno.</p> : null}

      {cargando && !d ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : d ? (
        <>
          <FilaKpis n={3}>
            <Kpi label="Van en el archivo" valor={String(listas.length)} hint={`${ventas.length} de ventas · ${compras.length} de compras`} tono="bueno" />
            <Kpi label="Faltan datos" valor={String(conProblemas.length + sinImputacion.length)} hint={conProblemas.length ? "corregilos para que entren" : "todo completo"} tono={conProblemas.length ? "alerta" : undefined} />
            <Kpi label="No se registran" valor={String(d.excluidos.length)} hint="electrónicas, anuladas, recibos, sin comprobante" />
          </FilaKpis>

          {aMano.length ? (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{aMano.length === 1 ? "1 comprobante de venta no tiene" : `${aMano.length} comprobantes de venta no tienen`} número fiscal (se emitieron antes de activar el autoimpresor): no entran al archivo, cargalos a mano en Marangatu. Están en “No se registran”.</span>
            </p>
          ) : null}

          {partes > 1 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3.5">
              <span className="text-sm text-slate-600">Son {listas.length} comprobantes: Marangatu acepta hasta {MAX_FILAS.toLocaleString("es-PY")} por archivo.</span>
              {Array.from({ length: partes }, (_, i) => (
                <button key={i} type="button" onClick={() => void bajar(i + 1)} disabled={bajando !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" style={{ backgroundColor: TEAL }}>
                  {bajando === i + 1 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Parte {i + 1}
                </button>
              ))}
            </div>
          ) : null}

          {conProblemas.length ? (
            <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white">
              <h2 className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" /> Faltan datos · {conProblemas.length} (no van al archivo hasta corregirlos)
              </h2>
              <ul className="divide-y divide-slate-100">
                {conProblemas.map((f) => (
                  <li key={f.origen + f.id}>
                    <Link href={hrefDoc(f)} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{f.proveedor ?? "Sin proveedor"} · {f.tipo_comprobante} {f.numero}</span>
                        <span className="block text-xs text-amber-800">{f.problemas.join(" · ")}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-slate-900">{gs(f.total)}</span>
                        <span className="block font-mono text-[11px] text-[var(--brand)]">{f.documento} · corregir</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {([
            ["Ventas", ventas, "Cliente", "No hay facturas ni notas de crédito con número fiscal en este mes."],
            ["Compras y gastos", compras, "Proveedor", "No hay compras con comprobante listas en este mes."],
          ] as const).map(([titulo, filas, quien, vacio]) => (
            <section key={titulo} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <h2 className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {titulo} · {filas.length} en el archivo · {gs(filas.reduce((a, f) => a + f.total, 0))}
              </h2>
              <TablaTarjetas filas={filas} columnas={columnasDe(quien)} claveFila={(f) => f.origen + f.id} minAncho={1050}
                vacio={<p className="px-4 py-10 text-center text-sm text-slate-400">{vacio}</p>} />
            </section>
          ))}

          {d.excluidos.length ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <button type="button" onClick={() => setVerExcluidos((v) => !v)} aria-expanded={verExcluidos}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-600 [@media(pointer:coarse)]:min-h-11">
                No se registran · {d.excluidos.length}
                <ChevronDown className={`h-4 w-4 transition-transform ${verExcluidos ? "rotate-180" : ""}`} />
              </button>
              {verExcluidos ? (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {d.excluidos.map((x) => (
                    <li key={x.origen + x.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-700">{x.proveedor ?? "Sin proveedor"}{x.tipo_comprobante ? ` · ${x.tipo_comprobante}` : ""}</span>
                        <span className="block text-xs text-slate-400">{x.motivo}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-slate-500">{gs(x.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
            <p className="flex items-center gap-2 font-semibold text-slate-800"><Info className="h-4 w-4" /> Cómo subirlo a Marangatu</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Tocá <b>Descargar para Marangatu</b>: baja un ZIP con el nombre que pide la SET ({`<RUC>_REG_MMAAAA_…`}). No lo descomprimas.</li>
              <li>En Marangatu entrá a <b>Registro de comprobantes</b> › <b>Importar</b> (obligación 955, registro mensual) y subí el ZIP.</li>
              <li>Revisá lo importado y <b>confirmá la presentación</b> del mes.</li>
            </ol>
            <p className="text-xs text-slate-500">
              Las facturas electrónicas no van: Marangatu ya las tiene. Las notas de crédito salen con la factura que corrigen; las anuladas no se registran.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
