"use client";

/**
 * /reportes — Panel de reportes: una tarjeta con foto por reporte (TarjetaImagen, misma grilla que
 * PanelModulo), agrupadas por sección (Finanzas, Ventas y caja, Inventario) con un título chico
 * encima de cada grilla. Salen del catálogo (src/modules/reportes/catalogo.ts) filtradas por los
 * permisos del perfil: "ver reportes financieros" ve todo; "ver cierres de caja", el cierre.
 * Fotos y créditos: public/reportes/ y docs/creditos-imagenes-demo.md (sección "Panel Reportes").
 */
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { reportesPara, SECCIONES } from "@/modules/reportes/catalogo";
import { EncabezadoReporte } from "@/modules/reportes/ui";
import { TarjetaImagen } from "@/components/ui/tarjeta-imagen";
import { GRILLA_PANEL } from "@/components/ui/PanelModulo";

/** Foto, color de tema (HSL oscuro, L ≤ ~30 %) y encuadre de cada reporte, por href. */
const FOTOS: Record<string, { imagen: string; color: string; posicion?: string }> = {
  "/reportes/estado-cuenta": { imagen: "/reportes/estado-cuenta-informes-dueno.webp", color: "214 40% 22%", posicion: "50% 45%" },
  "/reportes/cuentas-cobrar": { imagen: "/reportes/cuentas-cobrar-deudas-laptop-dueno.webp", color: "152 34% 22%", posicion: "45% 40%" },
  "/reportes/cuentas-pagar": { imagen: "/reportes/cuentas-pagar-facturas-calculadora-dueno.webp", color: "8 40% 26%", posicion: "50% 45%" },
  "/reportes/proveedores": { imagen: "/reportes/proveedores-descarga-camion-dueno.webp", color: "200 38% 22%", posicion: "50% 45%" },
  "/reportes/cajas": { imagen: "/reportes/cierre-caja-cajon-abierto.webp", color: "258 28% 28%", posicion: "50% 66%" },
  "/reportes/ventas-mensuales": { imagen: "/reportes/ventas-mes-grafico-calendario.webp", color: "190 42% 22%", posicion: "30% 95%" },
  "/reportes/ventas": { imagen: "/reportes/ventas-periodo-cobro-mostrador.webp", color: "168 36% 21%", posicion: "40% 62%" },
  "/reportes/formas-pago": { imagen: "/reportes/formas-pago-tarjeta-lector.webp", color: "232 32% 28%", posicion: "40% 35%" },
  "/reportes/productos-vendidos": { imagen: "/reportes/productos-vendidos-canasta-verduras.webp", color: "96 30% 22%", posicion: "50% 30%" },
  "/reportes/perdidas": { imagen: "/reportes/perdidas-caja-danada.webp", color: "16 48% 24%", posicion: "40% 30%" },
  "/reportes/stock-minimo": { imagen: "/reportes/stock-minimo-estante-vacio.webp", color: "36 44% 22%", posicion: "50% 60%" },
};
const FOTO_GENERICA = { imagen: "/finanzas/reportes-graficos-pantalla.webp", color: "196 45% 20%", posicion: "40% 30%" };

export default function ReportesPage() {
  const me = useUsuario();
  const visibles = reportesPara((p) => tienePermiso(me, p));

  return (
    <div className="space-y-6 pb-10 sm:space-y-8">
      <EncabezadoReporte kicker="Análisis" titulo="Reportes" subtitulo="Todos los números de la empresa en un solo lugar: elegí un reporte para ver el detalle, filtrarlo y bajarlo en Excel o PDF." volver={{ href: "/finanzas", label: "Finanzas" }} />

      {!me ? (
        <div className={GRILLA_PANEL} aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-slate-200/80" />)}</div>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No tenés reportes habilitados.</p>
      ) : (
        SECCIONES.map((sec) => {
          const items = visibles.filter((r) => r.seccion === sec);
          if (!items.length) return null;
          const idTitulo = `reportes-${sec.toLowerCase().replace(/\s+/g, "-")}`;
          return (
            <section key={sec} aria-labelledby={idTitulo} className="space-y-3">
              <h2 id={idTitulo} className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{sec}</h2>
              <ul className={`m-0 list-none p-0 ${GRILLA_PANEL}`}>
                {items.map(({ href, titulo, descripcion }) => {
                  const f = FOTOS[href] ?? FOTO_GENERICA;
                  return (
                    <li key={href} className="h-[150px]" title={descripcion}>
                      <TarjetaImagen imagen={f.imagen} titulo={titulo} href={href} colorTema={f.color} posicionImagen={f.posicion} accion="Ver reporte" />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
