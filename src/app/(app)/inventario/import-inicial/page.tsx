"use client";

/** /inventario/import-inicial — Importación inicial del catálogo (portado de Ferretería República). */
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ImportInicialWizard } from "@/modules/inventario/ImportInicialWizard";

export default function ImportInicialPage() {
  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <EncabezadoPagina
        volver={{ href: "/inventario", label: "Inventario" }}
        kicker="Operaciones · Inventario"
        titulo="Importación inicial de productos"
        subtitulo="Combina los tres reportes en un único catálogo, sin duplicados."
      />
      <ImportInicialWizard />
    </div>
  );
}
