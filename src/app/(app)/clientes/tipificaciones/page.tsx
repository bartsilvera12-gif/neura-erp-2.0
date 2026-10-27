"use client";

/**
 * /clientes/tipificaciones — Tipificaciones.
 *   · Registro (por defecto): TODAS las tipificaciones con búsqueda, filtros en la URL y el
 *     detalle en un modal; "Nueva tipificación" abre el formulario encima (sin navegar).
 *   · Catálogo (?vista=catalogo): Estados → Sub-estados y su acción (lo edita un ADMIN).
 */
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListChecks, Plus, Settings2 } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { RegistroTipificaciones } from "@/modules/tipificacion/RegistroTipificaciones";
import { CatalogoTipificaciones } from "@/modules/tipificacion/Catalogo";

export default function TipificacionesPage() {
  return (
    <Suspense fallback={null}>
      <Tipificaciones />
    </Suspense>
  );
}

function Tipificaciones() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const vista = sp.get("vista") === "catalogo" ? "catalogo" : "registro";
  const [nueva, setNueva] = useState(false);

  // Cada pestaña recuerda sus propios filtros: al cambiar se vuelve a la URL limpia de la otra.
  const irA = (v: "registro" | "catalogo") => router.replace(v === "catalogo" ? `${pathname}?vista=catalogo` : pathname, { scroll: false });

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        volver={{ href: "/clientes/gestion", label: "Gestión de clientes" }}
        volverDiscreto
        kicker="Gestión de clientes"
        titulo="Tipificaciones"
        subtitulo={vista === "catalogo" ? "Catálogo de estados y sub-estados" : "Todas las gestiones registradas con los clientes"}
        acciones={vista === "registro" ? (
          <button type="button" onClick={() => setNueva(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 max-sm:min-h-11">
            <Plus className="h-4 w-4" /> Nueva tipificación
          </button>
        ) : undefined}
      />

      <div role="tablist" aria-label="Vistas" className="inline-flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm max-sm:flex max-sm:w-full">
        {([["registro", "Registro", ListChecks], ["catalogo", "Catálogo", Settings2]] as const).map(([k, l, Icono]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => irA(k)}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition max-sm:min-h-11 max-sm:flex-1 ${vista === k ? "bg-[var(--brand-50)] text-[var(--brand)]" : "text-slate-500 hover:text-slate-700"}`}>
            <Icono className="h-4 w-4" aria-hidden /> {l}
          </button>
        ))}
      </div>

      {vista === "registro" ? (
        <RegistroTipificaciones nuevaAbierta={nueva} onNuevaCerrada={() => setNueva(false)} />
      ) : (
        <CatalogoTipificaciones />
      )}
    </div>
  );
}
