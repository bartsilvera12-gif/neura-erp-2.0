"use client";

/**
 * /conversaciones — bandeja omnicanal a todo el alto (cabecera de 4rem + el padding del
 * main). Toda la lógica vive en src/modules/conversaciones.
 */
import { Suspense } from "react";
import { Bandeja } from "@/modules/conversaciones/Bandeja";

export default function ConversacionesPage() {
  return (
    <div className="h-[calc(100dvh-7rem)] min-h-[480px]">
      {/* Bandeja lee ?c= con useSearchParams (necesita un límite de Suspense). */}
      <Suspense fallback={null}>
        <Bandeja />
      </Suspense>
    </div>
  );
}
