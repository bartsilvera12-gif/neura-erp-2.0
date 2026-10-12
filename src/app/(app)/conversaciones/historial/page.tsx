"use client";

/** /conversaciones/historial — historial omnicanal de un contacto (todas sus conversaciones). */
import { Suspense } from "react";
import { Historial } from "@/modules/conversaciones/Historial";

export default function HistorialPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-slate-400">Cargando historial…</p>}>
      <Historial />
    </Suspense>
  );
}
