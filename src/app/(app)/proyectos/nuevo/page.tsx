"use client";

/** /proyectos/nuevo[?cliente=<id>] — alta de proyecto en página completa (el tablero y la ficha del cliente usan el modal). */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api/client-fetch";
import type { ClienteOpcion } from "@/modules/agenda/ui/components/ClienteSelect";
import { ProyectoForm } from "@/modules/proyectos/ui/ProyectoForm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Nuevo() {
  const router = useRouter();
  const sp = useSearchParams();
  const clienteId = sp.get("cliente");
  const [cliente, setCliente] = useState<ClienteOpcion | null | undefined>(clienteId && UUID_RE.test(clienteId) ? undefined : null);

  useEffect(() => {
    if (cliente !== undefined || !clienteId) return;
    apiFetch<{ cliente?: { id: string; nombre: string } }>(`/api/clientes/${clienteId}`)
      .then((r) => setCliente(r.cliente ? { id: r.cliente.id, nombre: r.cliente.nombre } : null))
      .catch(() => setCliente(null));
  }, [cliente, clienteId]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/proyectos" className="text-sm font-medium text-[var(--brand)] hover:underline">← Volver</Link>
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_var(--brand-100)]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">Nuevo</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Crear proyecto</h1>
        <p className="mt-1 text-sm text-slate-500">Entra en el estado inicial del tablero.</p>
      </div>
      {cliente === undefined ? (
        <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
      ) : (
        <ProyectoForm variant="page" clienteInicial={cliente} onCreado={(t) => router.push(`/proyectos/${t.id}`)} onCancel={() => router.push("/proyectos")} />
      )}
    </div>
  );
}

export default function NuevoProyectoPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-400">Cargando…</p>}>
      <Nuevo />
    </Suspense>
  );
}
