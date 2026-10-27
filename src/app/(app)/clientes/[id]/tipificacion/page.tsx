"use client";

/**
 * /clientes/[id]/tipificacion — respaldo para enlaces directos (desde un ticket: #tip-<id>, la
 * Agenda o un aviso). Usa el MISMO panel que el modal de Gestión del Cliente / la ficha: se
 * tipifica acá mismo y el historial se actualiza en el lugar (sin recargar ni salir).
 * Lo habitual es tipificar desde el modal, sin venir a esta página.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { guardadoAlInstante } from "@/lib/api/cache-cliente";
import { PanelTipificacion } from "@/modules/tipificacion/PanelTipificacion";
import { urlHistorial } from "@/modules/tipificacion/datos";
import type { HistorialTipificaciones } from "@/modules/tipificacion/dominio";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function TipificacionPage() {
  const params = useParams();
  const me = useUsuario();
  const id = (params?.id as string | undefined) ?? "";
  const [resaltar, setResaltar] = useState<string | null>(null);
  const [nombre] = useState(() => guardadoAlInstante<HistorialTipificaciones>(urlHistorial(id))?.cliente.nombre ?? "");

  // Llegada desde un ticket o la Agenda (#tip-<id>): se resalta en el historial.
  useEffect(() => {
    const m = window.location.hash.match(/^#tip-([0-9a-f-]{36})$/i);
    if (m) setResaltar(m[1]);
  }, []);

  if (!UUID_RE.test(id)) {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold text-slate-800">Cliente no encontrado</h1>
        <Link href="/clientes/gestion" className="mt-3 inline-block text-sm font-medium text-[var(--brand)] underline">← Gestión de clientes</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400" aria-label="Migas">
          <Link href={`/clientes/gestion?cliente=${encodeURIComponent(id)}`} className="hover:text-slate-600 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">Gestión de clientes</Link>
          <span aria-hidden>›</span>
          <Link href={`/clientes/${id}`} className="hover:text-slate-600 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">{nombre || "Cliente"}</Link>
          <span aria-hidden>›</span>
          <span className="font-medium text-slate-600">Tipificación</span>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/clientes/tipificaciones" className="inline-flex min-h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:min-h-11">
            Todas las tipificaciones
          </Link>
          {me?.rol === "ADMIN" ? (
            <Link href="/clientes/tipificaciones?vista=catalogo" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm hover:border-[var(--brand)] hover:text-[var(--brand)] max-sm:min-h-11">
              <Settings2 className="h-3.5 w-3.5" /> Catálogo
            </Link>
          ) : null}
        </div>
      </div>
      <PanelTipificacion key={`${id}-${resaltar ?? ""}`} clienteId={id} clienteNombre={nombre} modo="pagina" resaltar={resaltar} />
    </div>
  );
}
