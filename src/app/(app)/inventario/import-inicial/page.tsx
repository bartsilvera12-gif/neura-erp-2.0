"use client";

/** /inventario/import-inicial — Importación inicial del catálogo (portado de Ferretería República). */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { clienteConfig } from "@/cliente.config";
import { ImportInicialWizard } from "@/modules/inventario/ImportInicialWizard";

const TEAL = clienteConfig.color;

export default function ImportInicialPage() {
  return (
    <div className="space-y-6 pb-10">
      <div>
        <Link href="/inventario" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" /> Inventario
        </Link>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TEAL, boxShadow: `0 0 0 3px ${TEAL}2e` }} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Operaciones · Inventario</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Importación inicial de productos</h1>
        <p className="mt-1 text-sm text-slate-500">Combina los tres reportes en un único catálogo, sin duplicados.</p>
      </div>
      <ImportInicialWizard />
    </div>
  );
}
