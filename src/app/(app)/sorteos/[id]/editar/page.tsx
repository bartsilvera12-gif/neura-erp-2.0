"use client";

/** /sorteos/<id>/editar — Edición de un sorteo. */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { FormSorteo } from "@/modules/sorteos/FormSorteo";
import type { Sorteo } from "@/modules/sorteos/tipos";

export default function EditarSorteoPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Sorteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Sorteo>(`/api/sorteos/${id}`).then(setS).catch((e: Error) => setError(e.message));
  }, [id]);
  return (
    <div className="space-y-4">
      <EncabezadoPagina titulo={s ? `Editar: ${s.nombre}` : "Editar sorteo"} volver={{ href: `/sorteos/${id}`, label: "Sorteo" }} />
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!s && !error ? <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {s ? <FormSorteo inicial={s} /> : null}
    </div>
  );
}
