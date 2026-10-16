"use client";

/**
 * /conversaciones — bandeja omnicanal a todo el alto (cabecera 3.5rem / 4rem en lg + el padding del
 * main). Toda la lógica vive en src/modules/conversaciones.
 */
import { Suspense } from "react";
import { Bandeja } from "@/modules/conversaciones/Bandeja";

export default function ConversacionesPage() {
  return (
    <div className="h-[calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] min-h-[420px] sm:h-[calc(100dvh-6.25rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-7rem-env(safe-area-inset-bottom))]">
      {/* Bandeja lee ?c= con useSearchParams (necesita un límite de Suspense). */}
      <Suspense fallback={null}>
        <Bandeja />
      </Suspense>
    </div>
  );
}
