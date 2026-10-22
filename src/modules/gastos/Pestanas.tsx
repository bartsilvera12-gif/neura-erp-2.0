"use client";

/**
 * Pestañas de Gastos empresariales (Resumen · Gastos operativos · Compras · Órdenes de compra ·
 * Proveedores · Pagos a proveedores · Recurrentes). Las comparten las páginas del módulo y las
 * de Compras/Proveedores (por sus layout.tsx). Activa = la ruta más larga que coincide. En los
 * formularios de pantalla completa (Nueva compra / Nueva orden) ni en el panel del módulo
 * (/gastos-empresariales/panel) no se muestran. Arriba lleva "← Gastos empresariales" (al panel).
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { ScrollHorizontal } from "@/components/ScrollHorizontal";
import { PESTANAS_GASTOS } from "@/modules/compras/module";

export function PestanasGastos() {
  const pathname = usePathname() ?? "";
  if (/\/nueva$/.test(pathname) || pathname === "/gastos-empresariales/panel") return null;
  const coincide = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const activa = PESTANAS_GASTOS.filter((t) => coincide(t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <div className="mb-4 sm:mb-6">
      <Link href="/gastos-empresariales/panel" className="-ml-1 mb-1.5 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" /> Gastos empresariales
      </Link>
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Finanzas · Gastos empresariales</p>
      </div>
      {/* Responsive: scroll horizontal interno con desvanecido en el borde; la activa a la vista. */}
      <nav aria-label="Secciones de Gastos empresariales" className="mt-2">
        <ScrollHorizontal dependencias={[activa]} claseFila="gap-0">
        <ul className="flex min-w-full gap-1 border-b border-slate-200">
          {PESTANAS_GASTOS.map((t) => {
            const on = t.href === activa;
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={on ? "page" : undefined}
                  className={`relative flex min-h-11 items-center whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors ${on ? "text-[#3F8E91]" : "text-slate-500 hover:text-slate-800"}`}>
                  {t.label}
                  <span aria-hidden className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-all ${on ? "bg-[#4FAEB2]" : "bg-transparent"}`} />
                </Link>
              </li>
            );
          })}
        </ul>
        </ScrollHorizontal>
      </nav>
    </div>
  );
}
