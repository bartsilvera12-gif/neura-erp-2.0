"use client";

/**
 * Encabezado común de las pantallas de Gastos empresariales (Resumen · Compras y gastos · Órdenes
 * de compra · Proveedores · Pagos a proveedores · Recurrentes): "← Gastos empresariales" (al panel
 * de tarjetas) y el kicker del módulo. Antes llevaba una barra de pestañas con las seis pantallas
 * juntas; el dueño pidió que cada una sea una pantalla propia, como en Caja e Inventario: se entra
 * desde el panel (/gastos-empresariales/panel) o el submenú. Lo usan los layout.tsx del módulo, de
 * Compras y de Proveedores. En los formularios de pantalla completa (Nueva compra / Nueva orden)
 * y en el panel no se muestra.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";

export function PestanasGastos() {
  const pathname = usePathname() ?? "";
  if (/\/nueva$/.test(pathname) || pathname === "/gastos-empresariales/panel") return null;
  return (
    <div className="mb-3 sm:mb-4">
      <Link href="/gastos-empresariales/panel" className="-ml-1 mb-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800 max-md:min-h-11 max-md:pr-2">
        <ArrowLeft className="h-3.5 w-3.5" /> Gastos empresariales
      </Link>
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Gastos empresariales</p>
      </div>
    </div>
  );
}
