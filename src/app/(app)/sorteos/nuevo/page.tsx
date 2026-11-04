"use client";

/** /sorteos/nuevo — Alta de un sorteo (queda en borrador hasta activarlo). */
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { FormSorteo } from "@/modules/sorteos/FormSorteo";

export default function NuevoSorteoPage() {
  return (
    <div className="space-y-4">
      <EncabezadoPagina titulo="Nuevo sorteo" subtitulo="Queda en borrador: lo revisás y lo activás desde su ficha." volver={{ href: "/sorteos", label: "Sorteos" }} />
      <FormSorteo />
    </div>
  );
}
