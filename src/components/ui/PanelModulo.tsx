"use client";

/**
 * PanelModulo — panel de un módulo con panel propio (`panel: true` en su module.ts): encabezado +
 * una TarjetaImagen por sub-pantalla (foto + degradé de color + título + flecha). Muestra solo las
 * tarjetas que el perfil puede abrir (mismas reglas que el menú y el guard: `pantallasCatalogo`
 * + `perfilVePantalla`; las de acceso propio, además, según `acceso`). Lo usan /configuracion,
 * /inventario/panel, /omnicanal, /finanzas, /caja/panel y /gastos-empresariales/panel.
 *
 *   <PanelModulo kicker="Operaciones" titulo="Inventario" subtitulo="…" tarjetas={TARJETAS}
 *     vacio="No tenés pantallas de inventario habilitadas." />
 */
import { useEffect, useMemo, useState } from "react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { apiFetchCache } from "@/lib/api/cache-cliente";
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
  /**
   * Sub-pantalla con acceso propio (`accesoPropio` en el module.ts): si el perfil no la ve por su
   * nivel, el panel pregunta a esta URL (GET → { puede }) y muestra la tarjeta si responde que sí
   * (ej. Monitoreo para un supervisor de cola que no es ADMIN).
   */
  acceso?: string;
  /**
   * Tarjeta de un panel de grupo (ej. /finanzas → Caja): su `href` no es una pantalla (es otro
   * panel), así que se muestra si el perfil ve alguna de estas pantallas (`hrefsDeModulo`).
   */
  pantallas?: string[];
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
  kicker, titulo, subtitulo, tarjetas, vacio = "No tenés pantallas habilitadas en este módulo.", volver,
}: {
  /** link "← …" arriba del título (ej. el panel de Caja vuelve a Finanzas). */
  volver?: { href: string; label: string };
  kicker?: string;
  titulo: string;
  subtitulo?: string;
  tarjetas: TarjetaPanel[];
  vacio?: string;
}) {
  const me = useUsuario();
  // Tarjetas con acceso propio que el nivel del usuario no alcanza: se pregunta a su `acceso`.
  const aConsultar = useMemo(() => {
    if (!me) return [];
    const catalogo = pantallasCatalogo();
    return tarjetas.filter((t) => {
      const p = catalogo.find((x) => x.href === t.href);
      return !!p && !!t.acceso && !!p.accesoPropio && !perfilVePantalla(p, me.rol, me.perfil) && !!p.niveles?.length && !p.niveles.includes(me.rol);
    });
  }, [me, tarjetas]);
  const [permitidas, setPermitidas] = useState<Set<string>>(() => new Set());
  const [consultado, setConsultado] = useState(false);
  useEffect(() => {
    if (!aConsultar.length) return;
    let vivo = true;
    void Promise.all(
      aConsultar.map((t) => apiFetchCache<{ puede: boolean }>(t.acceso!).then((r) => (r.puede ? t.href : null)).catch(() => null)),
    ).then((hrefs) => {
      if (!vivo) return;
      setPermitidas(new Set(hrefs.filter((h): h is string => !!h)));
      setConsultado(true);
    });
    return () => {
      vivo = false;
    };
  }, [aConsultar]);

  const visibles = useMemo(() => {
    if (!me) return [];
    const catalogo = pantallasCatalogo();
    return tarjetas.filter((t) => {
      const ve = (href: string) => {
        const p = catalogo.find((x) => x.href === href);
        return !!p && perfilVePantalla(p, me.rol, me.perfil);
      };
      return t.pantallas ? t.pantallas.some(ve) : ve(t.href) || permitidas.has(t.href);
    });
  }, [me, tarjetas, permitidas]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina volver={volver} kicker={kicker} titulo={titulo} subtitulo={subtitulo} />

      {!me || (!visibles.length && aConsultar.length > 0 && !consultado) ? (
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
