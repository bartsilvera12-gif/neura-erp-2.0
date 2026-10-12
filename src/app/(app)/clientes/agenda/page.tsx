/**
 * /clientes/agenda — módulo Agenda (portado del sistema actual): calendario Día / Semana /
 * Mes / Listado con citas, reuniones y las capacitaciones que se agendan desde la
 * Tipificación del cliente. `?cita=<id>` abre esa cita (avisos de la campanita).
 */
import { Suspense } from "react";
import AgendaClient from "@/modules/agenda/ui/AgendaClient";

export default function AgendaPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-400">Cargando agenda…</p>}>
      <AgendaClient />
    </Suspense>
  );
}
