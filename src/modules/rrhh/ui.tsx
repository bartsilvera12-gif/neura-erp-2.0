"use client";

/** Piezas chicas de las pantallas de RR HH. */
import type { ReactNode } from "react";
import { gs } from "@/components/graficos/formato";
import type { ResultadoLiquidacion } from "@/modules/rrhh/calculo";

export const INPUT = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 sm:min-h-10";
export const BOTON = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50 sm:min-h-9";
export const BOTON_PRIMARIO = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 sm:min-h-9";

/** Tarjeta de formulario con ícono, como Datos de la empresa. */
export function Tarjeta({ icono, titulo, detalle, children, className = "" }: { icono: ReactNode; titulo: string; detalle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5 ${className}`}>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]">{icono}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          {detalle ? <p className="mt-0.5 text-xs text-slate-500">{detalle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Campo({ label, children, ayuda, className = "" }: { label: string; children: ReactNode; ayuda?: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {ayuda ? <p className="mt-1 text-[11px] text-slate-500">{ayuda}</p> : null}
    </div>
  );
}

export function Interruptor({ valor, onChange, label, ayuda }: { valor: boolean; onChange: (v: boolean) => void; label: string; ayuda?: string }) {
  return (
    <button type="button" role="switch" aria-checked={valor} onClick={() => onChange(!valor)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-left">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {ayuda ? <span className="block text-[11px] text-slate-500">{ayuda}</span> : null}
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${valor ? "bg-[var(--brand)]" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function Cifra({ label, valor, sub }: { label: string; valor: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900">{valor}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

/** Monto con separador de miles mientras se escribe. */
export function CampoMonto({ valor, onChange, id }: { valor: number; onChange: (n: number) => void; id?: string }) {
  return (
    <input id={id} inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={valor ? valor.toLocaleString("es-PY") : ""} placeholder="0"
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} />
  );
}

/** Los renglones del extracto, de arriba a abajo. */
export function renglonesExtracto(r: ResultadoLiquidacion): { label: string; monto: number; signo: "+" | "-"; total?: boolean; info?: boolean }[] {
  const jornalero = r.tipo_salario === "jornalero";
  const filas: { label: string; monto: number; signo: "+" | "-"; total?: boolean; info?: boolean }[] = [
    { label: jornalero ? `Jornales: ${r.dias_pagados} días × ${gs(r.salario)}` : `Salario: ${r.dias_pagados} de 30 días`, monto: r.salario_base, signo: "+" },
  ];
  if (r.descuento_ausencias) filas.push({ label: `Ausencias: ${r.dias_ausencia} ${r.dias_ausencia === 1 ? "día" : "días"}`, monto: r.descuento_ausencias, signo: "-" });
  if (r.comision) filas.push({ label: "Comisión del mes", monto: r.comision, signo: "+" });
  for (const a of r.ajustes.filter((x) => x.tipo === "extra" && x.imponible)) filas.push({ label: a.concepto, monto: a.monto, signo: "+" });
  filas.push({ label: "Imponible", monto: r.imponible, signo: "+", total: true });
  if (r.ips_trabajador) filas.push({ label: "IPS del trabajador (9 %)", monto: r.ips_trabajador, signo: "-" });
  for (const a of r.ajustes.filter((x) => x.tipo === "extra" && !x.imponible)) filas.push({ label: `${a.concepto} (no aporta IPS)`, monto: a.monto, signo: "+" });
  for (const a of r.ajustes.filter((x) => x.tipo === "descuento")) filas.push({ label: a.concepto, monto: a.monto, signo: "-" });
  filas.push({ label: "Neto a cobrar", monto: r.neto, signo: "+", total: true });
  if (r.ips_empresa) filas.push({ label: "IPS de la empresa (16,5 %), no sale del salario", monto: r.ips_empresa, signo: "+", info: true });
  return filas;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Hoja A4 del extracto, para imprimir o guardar como PDF. */
export function htmlExtracto(d: { periodo: string; nombre: string; ci: string | null; sucursal: string | null; area: string | null; antiguedad: string; vacaciones: number; aguinaldo: number; estado: string; resultado: ResultadoLiquidacion }) {
  const filas = renglonesExtracto(d.resultado).map((f) =>
    `<tr class="${f.total ? "t" : f.info ? "i" : ""}"><td>${esc(f.label)}</td><td class="n">${f.signo === "-" ? "− " : ""}${esc(gs(f.monto))}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Extracto ${esc(d.nombre)}</title><style>
  @page{size:A4;margin:18mm}body{font:13px/1.45 system-ui,sans-serif;color:#0f172a}h1{font-size:18px;margin:0}.s{color:#475569;margin:2px 0 16px}
  .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:16px}.g b{font-weight:600}table{width:100%;border-collapse:collapse}td{padding:7px 0;border-bottom:1px solid #e2e8f0}
  .n{text-align:right;font-variant-numeric:tabular-nums}.t td{font-weight:700;border-top:1.5px solid #0f172a}.i td{color:#64748b;font-size:12px}.p{margin-top:16px;color:#64748b;font-size:11px}
  .f{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:64px}.f div{border-top:1px solid #0f172a;padding-top:6px;text-align:center}</style></head><body>
  <h1>Extracto de liquidación</h1><p class="s">${esc(d.periodo)}${d.estado === "cerrada" ? "" : " · Borrador"}</p>
  <div class="g"><span><b>Nombre:</b> ${esc(d.nombre)}</span><span><b>CI:</b> ${esc(d.ci ?? "—")}</span><span><b>Sucursal:</b> ${esc(d.sucursal ?? "—")}</span><span><b>Área:</b> ${esc(d.area ?? "—")}</span>
  <span><b>Antigüedad:</b> ${esc(d.antiguedad)}</span><span><b>Vacaciones disponibles:</b> ${d.vacaciones} días</span><span><b>Aguinaldo acumulado:</b> ${esc(gs(d.aguinaldo))}</span></div>
  <table>${filas}</table><p class="p">Documento de trabajo para revisar con el asesor.</p>
  <div class="f"><div>Firma del trabajador</div><div>Firma de la empresa</div></div></body></html>`;
}
