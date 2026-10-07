"use client";

/**
 * /reportes — Panel de reportes (portado del hub de Ferretería República): una tarjeta por
 * reporte con ícono, título, subtítulo, descripción y "Ver reporte →". Los reportes salen
 * del catálogo (src/modules/reportes/catalogo.ts), igual que el menú lateral.
 */
import Link from "next/link";
import { clienteConfig } from "@/cliente.config";
import { REPORTES } from "@/modules/reportes/catalogo";

const TEAL = clienteConfig.color;

export default function ReportesPage() {
  return (
    <div className="space-y-6 pb-10">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Análisis</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Reportes</h1>
        <p className="mt-1 text-sm text-slate-500">Panel de análisis y reportería operativa</p>
      </div>

      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTES.map(({ href, titulo, subtitulo, descripcion, icono: Icono }) => (
          <li key={href}>
            <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[var(--brand)] hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "var(--brand-50)", color: TEAL }}>
                  <Icono className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-slate-900">{titulo}</h2>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{subtitulo}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">{descripcion}</p>
              <div className="mt-auto pt-5">
                <Link href={href} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95" style={{ backgroundColor: TEAL }}>
                  Ver reporte <span aria-hidden>→</span>
                </Link>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
