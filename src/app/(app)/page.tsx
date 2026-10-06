"use client";

import Link from "next/link";
import { modulosActivos } from "@/modules/registry";
import { clienteConfig } from "@/cliente.config";

export default function Dashboard() {
  const modulos = modulosActivos();
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Hola 👋</h1>
      <p className="mt-1 text-sm text-slate-500">{clienteConfig.nombre}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {modulos.map((m) => (
          <Link
            key={m.id}
            href={m.href}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#3F8E91]"
          >
            <div className="text-sm font-semibold text-slate-800">{m.label}</div>
            <div className="mt-1 text-xs text-slate-400">Abrir →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
