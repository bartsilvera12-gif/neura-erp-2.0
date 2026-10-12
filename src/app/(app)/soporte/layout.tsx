"use client";

/**
 * Puerta del módulo Soporte: envuelve TODAS las rutas de /soporte (cubre la URL
 * escrita a mano y el refresh de cualquier subpágina). Entra ADMIN o quien tenga
 * usuarios.usa_soporte. Cada API vuelve a comprobarlo por su cuenta.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { apiSoporte, precargarModulo } from "@/modules/soporte/api";

type Estado = "cargando" | "ok" | "denegado";

export default function SoporteLayout({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    apiSoporte<{ dashboard: boolean }>("/api/soporte/acceso")
      .then(() => {
        if (!vivo) return;
        setEstado("ok");
        precargarModulo();
      })
      .catch((e: Error) => {
        if (!vivo) return;
        setMensaje(e.message);
        setEstado("denegado");
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (estado === "cargando") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200" style={{ borderTopColor: "#4FAEB2" }} />
      </div>
    );
  }

  if (estado === "denegado") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500">
          <ShieldAlert className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Acceso denegado</h1>
        <p className="mt-1.5 text-sm text-slate-500">{mensaje || "No tenés habilitado el módulo Soporte. Pedíselo a un administrador."}</p>
        <Link href="/" className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[radial-gradient(1200px_500px_at_0%_-10%,rgba(79,174,178,0.12),transparent_60%),radial-gradient(900px_420px_at_100%_0%,rgba(14,165,233,0.08),transparent_55%)] bg-slate-50/70">
      {children}
    </div>
  );
}
