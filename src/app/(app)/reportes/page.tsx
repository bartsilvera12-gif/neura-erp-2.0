"use client";

/**
 * /reportes — Panel de reportes: tarjetas agrupadas por sección (Finanzas, Ventas y caja,
 * Inventario). Salen del catálogo (src/modules/reportes/catalogo.ts) filtradas por los
 * permisos del perfil: "ver reportes financieros" ve todo; "ver cierres de caja", el cierre.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { reportesPara, SECCIONES } from "@/modules/reportes/catalogo";
import { EncabezadoReporte } from "@/modules/reportes/ui";

export default function ReportesPage() {
  const me = useUsuario();
  const visibles = reportesPara((p) => tienePermiso(me, p));

  return (
    <div className="space-y-8 pb-10">
      <EncabezadoReporte kicker="Análisis" titulo="Reportes" subtitulo="Todos los números de la empresa en un solo lugar: elegí un reporte para ver el detalle, filtrarlo y bajarlo en Excel o PDF." volver={null} />

      {!me ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No tenés reportes habilitados.</p>
      ) : (
        SECCIONES.map((sec) => {
          const items = visibles.filter((r) => r.seccion === sec);
          if (!items.length) return null;
          return (
            <section key={sec} className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{sec}</h2>
              <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {items.map(({ href, titulo, subtitulo, descripcion, icono: Icono }) => (
                  <li key={href}>
                    <Link href={href}
                      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)]">
                          <Icono className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-slate-900">{titulo}</h3>
                          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{subtitulo}</p>
                        </div>
                      </div>
                      <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-500">{descripcion}</p>
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand)]">
                        Ver reporte <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
