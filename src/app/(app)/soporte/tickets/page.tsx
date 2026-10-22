"use client";

/** /soporte/tickets — listado de tickets. No hay alta directa: "Cargar ticket" lleva a Gestión de clientes (Tipificación). */
import Link from "next/link";
import { Suspense } from "react";
import { ListChecks, Plus } from "lucide-react";
import { PESTANAS_TICKETS } from "@/modules/soporte/dominio";
import TablaTickets from "@/modules/soporte/TablaTickets";
import { Cargando, Encabezado, Pagina, claseBoton } from "@/modules/soporte/ui";

export default function SoporteTicketsPage() {
  return (
    <Pagina>
      <Encabezado
        volver={{ href: "/soporte/panel", label: "Soporte" }}
        titulo="Tickets"
        subtitulo="Listado de tickets de soporte"
        icono={ListChecks}
        tono="celeste"
        acciones={
          <Link href="/clientes/gestion" className={claseBoton("primario")} title="Los tickets se cargan desde la tipificación del cliente">
            <Plus className="h-4 w-4" aria-hidden /> Cargar ticket
          </Link>
        }
      />
      <Suspense fallback={<Cargando />}>
        <TablaTickets pestanas={PESTANAS_TICKETS} />
      </Suspense>
    </Pagina>
  );
}
