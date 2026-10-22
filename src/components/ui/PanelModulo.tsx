"use client";

/**
 * PanelModulo — panel de un módulo con panel propio (`panel: true` en su module.ts): encabezado +
 * una TarjetaImagen por sub-pantalla (foto + degradé de color + título + flecha). Muestra solo las
 * tarjetas que el perfil puede abrir (mismas reglas que el menú y el guard: `pantallasCatalogo`
 * + `perfilVePantalla`). Lo usan /configuracion e /inventario/panel.
 *
 *   <PanelModulo kicker="Operaciones" titulo="Inventario" subtitulo="…" tarjetas={TARJETAS}
 *     vacio="No tenés pantallas de inventario habilitadas." />
 */
import { useMemo } from "react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { pantallasCatalogo, perfilVePantalla } from "@/modules/registry";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { TarjetaImagen } from "@/components/ui/tarjeta-imagen";

export type TarjetaPanel = {
  /** href de la sub-pantalla (el mismo del `children` del módulo: así se filtra por perfil). */
  href: string;
  titulo: string;
  /** foto en /public (WEBP ~1000-1200 px). */
  imagen: string;
  /** HSL sin envolver ("182 39% 28%"), oscuro (L ≤ ~30 %) para que el texto blanco se lea. */
  color: string;
  /** encuadre de la foto (object-position), p. ej. "50% 60%". */
  posicion?: string;
};

/** "#3F8E91" → "182 39% 28%": el color de la marca, oscurecido lo justo para texto blanco. */
export function hslDeMarca(hex: string, maxL = 28): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "182 39% 28%";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60 + 360) % 360;
  return `${h} ${Math.round(s * 100)}% ${Math.min(Math.round(l * 100), maxL)}%`;
}

const GRILLA = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function PanelModulo({
  kicker, titulo, subtitulo, tarjetas, vacio = "No tenés pantallas habilitadas en este módulo.",
}: {
  kicker?: string;
  titulo: string;
  subtitulo?: string;
  tarjetas: TarjetaPanel[];
  vacio?: string;
}) {
  const me = useUsuario();
  const visibles = useMemo(() => {
    if (!me) return [];
    const catalogo = pantallasCatalogo();
    return tarjetas.filter((t) => {
      const p = catalogo.find((x) => x.href === t.href);
      return !!p && perfilVePantalla(p, me.rol, me.perfil);
    });
  }, [me, tarjetas]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina kicker={kicker} titulo={titulo} subtitulo={subtitulo} />

      {!me ? (
        <div className={GRILLA} aria-busy="true">
          {tarjetas.slice(0, 3).map((t) => <div key={t.href} className="h-[150px] animate-pulse rounded-2xl bg-slate-200/80" />)}
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">{vacio}</p>
      ) : (
        <ul className={`m-0 list-none p-0 ${GRILLA}`}>
          {visibles.map((t) => (
            <li key={t.href} className="h-[150px]">
              <TarjetaImagen imagen={t.imagen} titulo={t.titulo} href={t.href} colorTema={t.color} posicionImagen={t.posicion} accion="Entrar" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
