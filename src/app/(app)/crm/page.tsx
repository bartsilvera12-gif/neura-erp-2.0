/**
 * /crm — CRM Funnel (Kanban / Lista de prospectos). `?p=<id>` abre ese prospecto.
 */
import { Suspense } from "react";
import CrmClient from "@/modules/crm/ui/CrmClient";

export default function CrmPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-400">Cargando CRM…</p>}>
      <CrmClient />
    </Suspense>
  );
}
