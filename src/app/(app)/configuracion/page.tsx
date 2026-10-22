"use client";

/**
 * /configuracion — Panel de Configuración: una tarjeta con foto por sub-módulo (TarjetaImagen).
 * Se muestran solo las que el perfil puede abrir (mismas reglas que el menú y el guard).
 * Cada tarjeta trae un resumen en vivo (empresa, facturación, usuarios): se pide en paralelo y
 * sin bloquear; mientras llega, o si falla, se ve el subtítulo genérico.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { pantallasCatalogo, perfilVePantalla } from "@/modules/registry";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { ChipTarjeta, TarjetaImagen } from "@/components/ui/tarjeta-imagen";
import { apiFetchSWR } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { normalizarRuc, validarRuc, type DatosEmpresa } from "@/modules/empresa/tipos";
import type { ConfigFacturacion } from "@/modules/facturacion/tipos";
import { URL_USUARIOS, type DatosUsuarios } from "@/modules/usuarios/ui/comun";

const URL_EMPRESA = "/api/configuracion/empresa";
const URL_FACTURACION = "/api/configuracion/facturacion";

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

type Clave = "empresa" | "facturacion" | "usuarios";

const TARJETAS: { clave: Clave; href: string; titulo: string; etiqueta: string; subtitulo: string; imagen: string; color: string; posicion?: string }[] = [
  {
    clave: "empresa",
    href: "/configuracion/empresa",
    titulo: "Datos de la empresa",
    etiqueta: "Identificación",
    subtitulo: "Razón social, RUC, contacto y logo de los documentos",
    imagen: "/configuracion/empresa.webp",
    color: hslDeMarca(clienteConfig.color),
    posicion: "50% 40%",
  },
  {
    clave: "facturacion",
    href: "/configuracion/facturacion",
    titulo: "Facturación",
    etiqueta: "Documentos",
    subtitulo: "Modo, numeración, impresión y SIFEN",
    imagen: "/configuracion/facturacion.webp",
    color: "222 47% 27%", // azul petróleo / índigo
    posicion: "45% 50%",
  },
  {
    clave: "usuarios",
    href: "/configuracion/usuarios",
    titulo: "Usuarios",
    etiqueta: "Accesos",
    subtitulo: "Quién entra al sistema y con qué perfil",
    imagen: "/configuracion/usuarios.webp",
    color: "28 62% 24%", // ámbar oscuro
    posicion: "40% 40%",
  },
];

const MODO: Record<ConfigFacturacion["modo"], string> = {
  sin_factura_fiscal: "Sin factura fiscal",
  sifen: "SIFEN",
  autoimpresor: "Autoimpresor",
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function resumenEmpresa(d: DatosEmpresa): ReactNode {
  const nombre = d.nombre_fantasia?.trim() || d.razon_social?.trim() || d.nombre;
  const ruc = d.ruc ? normalizarRuc(d.ruc) : "";
  const rucOk = !!ruc && validarRuc(ruc).estado === "ok";
  return (
    <div className="flex flex-wrap gap-1.5">
      <ChipTarjeta>{nombre}</ChipTarjeta>
      <ChipTarjeta>{!ruc ? "Falta el RUC" : rucOk ? `RUC ${ruc} ✓` : `RUC ${ruc} · revisar`}</ChipTarjeta>
    </div>
  );
}

function resumenFacturacion(d: ConfigFacturacion): ReactNode {
  const s = d.sifen;
  const verSifen = d.modo === "sifen" || s?.configurada;
  return (
    <div className="flex flex-wrap gap-1.5">
      <ChipTarjeta>{MODO[d.modo] ?? d.modo}</ChipTarjeta>
      {verSifen && (
        <ChipTarjeta>
          {!s?.configurada ? "SIFEN sin configurar" : `SIFEN ${s.completa ? "listo" : "incompleto"} · ${s.ambiente === "produccion" ? "Producción" : "Test"}`}
        </ChipTarjeta>
      )}
      {d.proximo_numero && <ChipTarjeta>Próxima: {d.proximo_numero}</ChipTarjeta>}
    </div>
  );
}

function resumenUsuarios(d: DatosUsuarios): ReactNode {
  const activos = d.usuarios.filter((u) => u.activo && !u.pendiente).length;
  const pendientes = d.usuarios.filter((u) => u.activo && u.pendiente).length;
  return (
    <div className="flex flex-wrap gap-1.5">
      <ChipTarjeta>{plural(activos, "usuario activo", "usuarios activos")}</ChipTarjeta>
      <ChipTarjeta>{plural(d.perfiles.length, "perfil", "perfiles")}</ChipTarjeta>
      {pendientes > 0 && <ChipTarjeta>{plural(pendientes, "invitación pendiente", "invitaciones pendientes")}</ChipTarjeta>}
    </div>
  );
}

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

  const [resumen, setResumen] = useState<Partial<Record<Clave, ReactNode>>>({});
  const claves = visibles.map((t) => t.clave).join(",");

  // Un pedido por tarjeta visible, en paralelo; cada uno pinta lo suyo cuando llega.
  useEffect(() => {
    if (!claves) return;
    const ctrl = new AbortController();
    const poner = (k: Clave, v: ReactNode) => !ctrl.signal.aborted && setResumen((r) => ({ ...r, [k]: v }));
    const pedidos: Record<Clave, () => Promise<unknown>> = {
      empresa: () => apiFetchSWR<DatosEmpresa>(URL_EMPRESA, (d) => poner("empresa", resumenEmpresa(d)), { signal: ctrl.signal, maxEdadMs: 30_000 }),
      facturacion: () => apiFetchSWR<ConfigFacturacion>(URL_FACTURACION, (d) => poner("facturacion", resumenFacturacion(d)), { signal: ctrl.signal, maxEdadMs: 30_000 }),
      usuarios: () => apiFetchSWR<DatosUsuarios>(URL_USUARIOS, (d) => poner("usuarios", resumenUsuarios(d)), { signal: ctrl.signal, maxEdadMs: 30_000 }),
    };
    for (const k of claves.split(",") as Clave[]) {
      pedidos[k]().catch(() => { /* sin datos: queda el subtítulo genérico */ });
    }
    return () => ctrl.abort();
  }, [claves]);

  return (
    <div className="space-y-6 pb-10">
      <EncabezadoPagina kicker="Ajustes" titulo="Configuración" subtitulo="Elegí qué querés configurar." />

      {!me ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-[190px] animate-pulse rounded-2xl bg-slate-200/80" />)}
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No tenés configuraciones habilitadas.</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibles.map((t) => (
            <li key={t.href} className="h-[190px]">
              <TarjetaImagen
                imagen={t.imagen}
                titulo={t.titulo}
                etiqueta={t.etiqueta}
                href={t.href}
                colorTema={t.color}
                posicionImagen={t.posicion}
                datos={resumen[t.clave] ?? <p className="line-clamp-2">{t.subtitulo}</p>}
                accion="Entrar"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
