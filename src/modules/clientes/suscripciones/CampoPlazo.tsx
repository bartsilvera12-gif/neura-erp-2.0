"use client";

import { useState } from "react";
import { Select } from "@/components/Select";

type Opcion = "indefinido" | "anio" | "otro";

const opcionDe = (meses: number | null): Opcion => (meses == null ? "indefinido" : meses === 12 ? "anio" : "otro");

/** "Indefinido" · "1 año" · "2 años" · "6 meses". */
export function textoPlazo(meses: number | null | undefined): string {
  if (meses == null) return "Indefinido";
  if (meses % 12 === 0) return meses === 12 ? "1 año" : `${meses / 12} años`;
  return meses === 1 ? "1 mes" : `${meses} meses`;
}

/**
 * Plazo de un plan o una suscripción: indefinido, un año o los meses que se carguen.
 * `value`: meses (null = indefinido). Mientras "Otro" está vacío, `value` es 0: quien lo usa lo valida.
 * Va con div y no label: un <label> le repite el click al botón del Select (abre y cierra).
 */
export function CampoPlazo({ value, onChange, claseInput, claseEtiqueta, etiqueta = "Plazo" }: {
  value: number | null;
  onChange: (meses: number | null) => void;
  claseInput: string;
  claseEtiqueta: string;
  etiqueta?: string;
}) {
  // Elegir "Otro" tiene que mantenerse aunque el número sea justo 12.
  const [opcion, setOpcion] = useState<Opcion>(opcionDe(value));
  return (
    <div className="min-w-0">
      <span className={claseEtiqueta}>{etiqueta}</span>
      <Select block value={opcion} etiqueta={etiqueta}
        onChange={(v) => {
          const o = v as Opcion;
          setOpcion(o);
          onChange(o === "indefinido" ? null : o === "anio" ? 12 : value && value !== 12 ? value : 0);
        }}
        options={[["indefinido", "Indefinido"], ["anio", "1 año"], ["otro", "Otro plazo…"]]} />
      {opcion === "otro" ? (
        <span className="relative mt-2 block">
          <input autoFocus inputMode="numeric" aria-label="Cantidad de meses" value={value || ""} placeholder="Cantidad"
            onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 0)}
            className={`${claseInput} pr-16 tabular-nums`} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">meses</span>
        </span>
      ) : null}
    </div>
  );
}
