/**
 * TarjetaImagen — tarjeta alta con foto de fondo a sangre (adaptada de "card-21" / DestinationCard
 * de 21st.dev). La usan los paneles de módulo (p. ej. /configuracion).
 *
 *   <TarjetaImagen imagen="/configuracion/empresa.webp" titulo="Datos de la empresa"
 *     datos={<>RUC 80012345-0 ✓</>} href="/configuracion/empresa" colorTema="182 39% 28%" />
 *
 * - `colorTema` es un HSL sin `hsl()` ("h s% l%"): tiñe el degradé de abajo, el botón y el brillo
 *   (glow) de la sombra. Elegir colores oscuros (L ≤ ~35 %) para que el texto blanco se lea.
 * - Hover: la foto hace un zoom suave y la tarjeta se agranda apenas (solo desde md, nunca en
 *   celular); con `prefers-reduced-motion` no hay zoom ni escala.
 * - Toda la tarjeta es un solo link (`next/link`) con anillo de foco visible.
 */
import Image from "next/image";
import Link from "next/link";
import { useId, type CSSProperties, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";

export type TarjetaImagenProps = {
  /** URL local de la foto (en /public). */
  imagen: string;
  titulo: string;
  /** Chip chico arriba a la izquierda (sigla o rótulo corto). Opcional. */
  etiqueta?: ReactNode;
  /** Línea de datos debajo del título (texto o chips). */
  datos?: ReactNode;
  href: string;
  /** HSL sin envolver: "182 39% 28%". */
  colorTema: string;
  /** Texto del botón. */
  accion?: string;
  /** Nombre accesible del link (por defecto: el título). La línea de datos queda como descripción. */
  ariaLabel?: string;
  /** Encuadre de la foto (object-position), p. ej. "50% 70%". */
  posicionImagen?: string;
  className?: string;
};

export function TarjetaImagen({
  imagen, titulo, etiqueta, datos, href, colorTema, accion = "Entrar", ariaLabel, posicionImagen, className = "",
}: TarjetaImagenProps) {
  const estilo = { "--tema": colorTema } as CSSProperties;
  const idDatos = useId();
  return (
    <div className={`group h-full ${className}`} style={estilo}>
      <Link
        href={href}
        aria-label={ariaLabel ?? titulo}
        aria-describedby={datos ? idDatos : undefined}
        className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-[hsl(var(--tema))] shadow-[0_8px_24px_-12px_hsl(var(--tema)/0.55)] outline-none transition-[transform,box-shadow] duration-500 ease-out hover:shadow-[0_14px_32px_-12px_hsl(var(--tema)/0.6)] focus-visible:ring-4 focus-visible:ring-[hsl(var(--tema)/0.55)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f8fa] md:group-hover:scale-[1.02] motion-reduce:transition-shadow motion-reduce:md:group-hover:scale-100"
      >
        <Image
          src={imagen}
          alt=""
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          style={posicionImagen ? { objectPosition: posicionImagen } : undefined}
        />
        {/* Degradé del color de la tarjeta desde abajo + un velo oscuro suave. Paradas en px (no en %):
            el texto ocupa siempre la misma altura abajo, así se lee igual en la tarjeta baja del
            celular que en la alta del escritorio (con las fotos de /configuracion el título da ≥ 4.3:1 en el renglón más claro). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, hsl(var(--tema) / 0.96), hsl(var(--tema) / 0.88) 70px, hsl(var(--tema) / 0.55) 125px, hsl(var(--tema) / 0.15) 165px, transparent 200px), linear-gradient(to top, rgb(0 0 0 / 0.25), transparent 170px)",
          }}
        />

        {etiqueta && (
          <span className="absolute top-3 left-3 inline-flex items-center rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase ring-1 ring-white/20 backdrop-blur-md">
            {etiqueta}
          </span>
        )}

        <div className="relative mt-auto flex items-end gap-3 p-4 text-white">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-tight [text-shadow:0_1px_10px_rgb(0_0_0/0.35)]">{titulo}</h2>
            {/* Alto fijo (2 renglones de chips): los títulos quedan alineados entre tarjetas. */}
            {datos && <div id={idDatos} className="mt-1.5 h-[46px] overflow-hidden text-xs font-medium text-white/90">{datos}</div>}
          </div>
          {/* Acción: un botón redondo chico con la flecha (el texto queda para lectores de pantalla) */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 backdrop-blur-md transition-colors duration-300 group-hover:bg-white/30" title={accion}>
            <span className="sr-only">{accion}</span>
            <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
          </span>
        </div>
      </Link>
    </div>
  );
}

/** Chip translúcido para la línea de datos de una TarjetaImagen. */
export function ChipTarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-sm ${className}`}>
      {children}
    </span>
  );
}
