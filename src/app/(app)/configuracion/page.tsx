"use client";

/**
 * /configuracion — Panel de Configuración: una tarjeta por sub-módulo (como Reportes).
 * Se muestran solo las que el perfil puede abrir (mismas reglas que el menú y el guard).
 */
import Link from "next/link";
import { ArrowRight, Building2, ReceiptText, UserCog, type LucideIcon } from "lucide-react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { pantallasCatalogo, perfilVePantalla } from "@/modules/registry";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";

const TARJETAS: { href: string; titulo: string; subtitulo: string; descripcion: string; icono: LucideIcon }[] = [
  {
    href: "/configuracion/empresa",
    titulo: "Datos de la empresa",
    subtitulo: "Identificación y logo",
    descripcion: "Razón social, RUC, actividad, dirección y contacto, y el logo que sale en presupuestos, recibos, remisiones y reportes.",
    icono: Building2,
  },
  {
    href: "/configuracion/facturacion",
    titulo: "Facturación",
    subtitulo: "Documentos y SIFEN",
    descripcion: "Modo de facturación, tipo de impresión, numeración, condiciones de pago, perfil tributario de clientes y facturación electrónica (SIFEN).",
    icono: ReceiptText,
  },
  {
    href: "/configuracion/usuarios",
    titulo: "Usuarios",
    subtitulo: "Accesos y perfiles",
    descripcion: "Quién entra al sistema, su sucursal y su perfil, y qué pantallas y permisos tiene cada perfil.",
    icono: UserCog,
  },
];

export default function ConfiguracionPage() {
  const me = useUsuario();
  const catalogo = pantallasCatalogo();
  const visibles = me
    ? TARJETAS.filter((t) => {
        const p = catalogo.find((x) => x.href === t.href);
        return !!p && perfilVePantalla(p, me.rol, me.perfil);
      })
    : [];

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina kicker="Ajustes" titulo="Configuración" subtitulo="Elegí qué querés configurar." />

      {!me ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No tenés configuraciones habilitadas.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {visibles.map(({ href, titulo, subtitulo, descripcion, icono: Icono }) => (
            <li key={href}>
              <Link href={href}
                className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)]">
                    <Icono className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-900">{titulo}</h2>
                    <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{subtitulo}</p>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-500">{descripcion}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand)] sm:mt-4">
                  Entrar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
