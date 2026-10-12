/**
 * /proyectos — tablero de Proyectos (Kanban / Lista por estado). `?p=<id>` abre ese proyecto.
 */
import { Suspense } from "react";
import ProyectosClient from "@/modules/proyectos/ui/ProyectosClient";

export default function ProyectosPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-400">Cargando proyectos…</p>}>
      <ProyectosClient />
    </Suspense>
  );
}
