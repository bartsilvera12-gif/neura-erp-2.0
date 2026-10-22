"use client";

/**
 * /configuracion — Panel de Configuración: una tarjeta con foto por sub-módulo (TarjetaImagen),
 * solo con el título y la flecha. Se muestran solo las que el perfil puede abrir (mismas reglas
 * que el menú y el guard).
 */
import { useMemo } from "react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { pantallasCatalogo, perfilVePantalla } from "@/modules/registry";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { TarjetaImagen } from "@/components/ui/tarjeta-imagen";
import { clienteConfig } from "@/cliente.config";

/** "#3F8E91" → "182 39% 28%": el color de la marca, oscurecido lo justo para texto blanco. */
function hslDeMarca(hex: string, maxL = 28): string {
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

const TARJETAS: { href: string; titulo: string; imagen: string; color: string; posicion?: string }[] = [
  { href: "/configuracion/empresa", titulo: "Datos de la empresa", imagen: "/configuracion/empresa.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 40%" },
  { href: "/configuracion/facturacion", titulo: "Facturación", imagen: "/configuracion/facturacion.webp", color: "222 47% 27%", posicion: "45% 50%" },
  { href: "/configuracion/usuarios", titulo: "Usuarios", imagen: "/configuracion/usuarios.webp", color: "28 62% 24%", posicion: "40% 40%" },
];

export default function ConfiguracionPage() {
  const me = useUsuario();
  const visibles = useMemo(() => {
    if (!me) return [];
    const catalogo = pantallasCatalogo();
    return TARJETAS.filter((t) => {
      const p = catalogo.find((x) => x.href === t.href);
      return !!p && perfilVePantalla(p, me.rol, me.perfil);
    });
  }, [me]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina kicker="Ajustes" titulo="Configuración" subtitulo="Elegí qué querés configurar." />

      {!me ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-slate-200/80" />)}
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No tenés configuraciones habilitadas.</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
