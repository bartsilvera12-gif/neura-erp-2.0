"use client";

/**
 * /soporte/mis-tickets — los tickets donde tenés la próxima acción, agrupados por lo
 * que hay que HACER. "En revisión" es lo que ya entregaste; "Por revisar", las
 * revisiones de QA asignadas a vos (sólo si la revisión de QA está activa).
 */
import { Suspense, useEffect, useState } from "react";
import { UserRoundCheck } from "lucide-react";
import TablaTickets, { type PestanaDef } from "@/modules/soporte/TablaTickets";
import { catalogosEnMemoria, obtenerCatalogos } from "@/modules/soporte/api";
import { Cargando, Encabezado, Pagina } from "@/modules/soporte/ui";

const CON_QA: readonly PestanaDef[] = [
  { id: "pendientes", etiqueta: "Pendientes", estados: ["pendiente"] },
  { id: "en_proceso", etiqueta: "En proceso", estados: ["en_proceso", "reabierto"] },
  { id: "falta_informacion", etiqueta: "Falta información", estados: ["falta_informacion"] },
  { id: "revision", etiqueta: "En revisión", estados: ["listo_revision"] },
  { id: "por_revisar", etiqueta: "Por revisar", estados: null, revision: true },
  { id: "resueltos", etiqueta: "Resueltos", estados: ["resuelto"] },
];
const SIN_QA = CON_QA.filter((p) => p.id !== "revision" && p.id !== "por_revisar");

export default function SoporteMisTicketsPage() {
  const [qa, setQa] = useState<boolean | null>(() => catalogosEnMemoria()?.config.qa_activo ?? null);
  useEffect(() => {
    void obtenerCatalogos()
      .then((c) => setQa(c.config.qa_activo))
      .catch(() => setQa(true));
  }, []);

  return (
    <Pagina>
      <Encabezado titulo="Mis tickets" subtitulo="Los tickets donde tenés la próxima acción" icono={UserRoundCheck} tono="violeta" />
      {qa == null ? (
        <Cargando />
      ) : (
        <Suspense fallback={<Cargando />}>
          <TablaTickets pestanas={qa ? CON_QA : SIN_QA} soloMios ocultarResponsable abrirPestanaConDatos />
        </Suspense>
      )}
    </Pagina>
  );
}
