"use client";

/** /crm/nuevo — alta de prospecto en página completa (el tablero usa el modal). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import type { Etapa } from "@/modules/crm/tipos";
import { ProspectoForm } from "@/modules/crm/ui/ProspectoForm";

export default function NuevoProspectoPage() {
  const router = useRouter();
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  useEffect(() => {
    apiFetchCache<Etapa[]>("/api/crm/etapas?activas=1").then(setEtapas).catch(() => {});
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/crm" className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--brand)] hover:underline sm:min-h-0">← Volver</Link>
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Nuevo</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Crear prospecto</h1>
        <p className="mt-1 text-sm text-slate-500">Registrá una nueva oportunidad en el funnel comercial.</p>
      </div>
      <ProspectoForm
        modo="nuevo"
        variant="page"
        etapas={etapas}
        onGuardado={({ tarjeta }) => router.push(tarjeta ? `/crm?p=${tarjeta.id}` : "/crm")}
        onCancel={() => router.push("/crm")}
      />
    </div>
  );
}
