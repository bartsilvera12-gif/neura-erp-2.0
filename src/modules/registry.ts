/**
 * Registro de módulos. Acá se listan TODOS los módulos que existen en el esqueleto;
 * `modulosActivos()` devuelve solo los encendidos para este cliente (cliente.config).
 * Para sumar un módulo nuevo: crear src/modules/<x>/module.ts e importarlo acá.
 */
import type { Modulo } from "@/modules/types";
import { clienteConfig } from "@/cliente.config";
import { moduloClientes } from "@/modules/clientes/module";
import { moduloCaja } from "@/modules/caja/module";
import { moduloInventario } from "@/modules/inventario/module";
import { moduloReportes } from "@/modules/reportes/module";
import { moduloGastosEmpresariales } from "@/modules/compras/module";
import { moduloSoporte } from "@/modules/soporte/module";
import { moduloCrm } from "@/modules/crm/module";
import { moduloConversaciones } from "@/modules/conversaciones/module";
import { moduloFinalizadas, moduloMonitoreo, moduloHistorialOmnicanal } from "@/modules/conversaciones/modulos-omnicanal";
import { moduloGestionClientes, moduloPlanes, moduloAgenda } from "@/modules/clientes/modulos-comerciales";
import { moduloCobranzas, moduloConciliacion } from "@/modules/cobranzas/module";
import { moduloPagos } from "@/modules/compras/modulos-finanzas";
import { moduloProyectos } from "@/modules/proyectos/module";
import { moduloPresupuestos } from "@/modules/presupuestos/module";
import { moduloUsuarios } from "@/modules/usuarios/module";
import type { PerfilSesion } from "@/modules/usuarios/permisos";

// El orden de acá es el orden dentro de cada familia del menú (igual que sistemas-propio):
// Comercial: Clientes, CRM Funnel, Presupuestos, Gestión Clientes, Planes, Agenda, Proyectos · Finanzas: Caja, Cobranzas, Conciliación, Pagos,
// Gastos empresariales (compras + gastos operativos), Reportes · Operaciones: Inventario · Omnicanal: Conversaciones, Finalizadas, Monitoreo, Historial omnicanal ·
// Soporte: Soporte.
const TODOS: Modulo[] = [
  moduloClientes,
  moduloCrm,
  moduloPresupuestos,
  moduloGestionClientes,
  moduloPlanes,
  moduloAgenda,
  moduloProyectos,
  moduloCaja,
  moduloCobranzas,
  moduloConciliacion,
  moduloPagos,
  moduloGastosEmpresariales,
  moduloReportes,
  moduloInventario,
  moduloConversaciones,
  moduloFinalizadas,
  moduloMonitoreo,
  moduloHistorialOmnicanal,
  moduloSoporte,
  moduloUsuarios,
  // moduloFacturacion,
  // moduloChat,
  // ...
];

export function modulosActivos(rol?: string): Modulo[] {
  return TODOS.filter(
    (m) =>
      clienteConfig.modulos.includes(m.id) &&
      (!m.roles || !rol || m.roles.includes(rol)),
  ).map((m) =>
    // Sub-pantallas con roles (ej. Clientes › Tipificaciones, sólo ADMIN).
    m.children?.some((c) => c.roles)
      ? { ...m, children: m.children.filter((c) => !c.roles || (!!rol && c.roles.includes(rol))) }
      : m,
  );
}

export function moduloEstaActivo(id: string): boolean {
  return clienteConfig.modulos.includes(id);
}

// ── Perfiles: pantallas ──────────────────────────────────────────────────────
// Una PANTALLA es un ítem del menú: cada sub-pantalla de un módulo con submenú, o el módulo
// entero si no tiene. Se identifica por su href (es lo que guarda perfil_pantallas).

/** Orden de las familias del menú (y del editor de perfiles). */
export const ORDEN_FAMILIAS = ["Comercial", "Finanzas", "Operaciones", "Omnicanal", "Soporte", "Configuración", "Administración", "General"];

export type Pantalla = {
  href: string;
  label: string;
  moduloId: string;
  moduloLabel: string;
  familia: string;
  icon?: string;
  /** niveles base que pueden usarla (vacío = todos) — sale de `roles` del módulo / sub-pantalla */
  niveles?: string[];
  /** permiso que además hace falta (ej. Usuarios → administrar_usuarios) */
  permiso?: string;
  accesoPropio?: boolean;
};

function interseccion(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length) return b?.length ? b : undefined;
  if (!b?.length) return a;
  return a.filter((x) => b.includes(x));
}

/** Todas las pantallas de los módulos activos de este cliente, en el orden del menú. */
export function pantallasCatalogo(): Pantalla[] {
  const activos = TODOS.filter((m) => clienteConfig.modulos.includes(m.id));
  const out: Pantalla[] = [];
  for (const m of activos) {
    const base = { moduloId: m.id, moduloLabel: m.label, familia: m.familia ?? "General", icon: m.icon, permiso: m.permiso, accesoPropio: m.accesoPropio };
    if (m.children?.length) {
      for (const c of m.children) out.push({ ...base, href: c.href, label: c.label, niveles: interseccion(m.roles, c.roles) });
    } else {
      out.push({ ...base, href: m.href, label: m.label, niveles: m.roles?.length ? m.roles : undefined });
    }
  }
  return out;
}

/** La pantalla a la que pertenece una ruta (el href que es su prefijo más largo), o null. */
export function pantallaDeRuta(pathname: string, catalogo: Pantalla[] = pantallasCatalogo()): Pantalla | null {
  let mejor: Pantalla | null = null;
  for (const p of catalogo) {
    if (pathname === p.href || pathname.startsWith(`${p.href}/`)) {
      if (!mejor || p.href.length > mejor.href.length) mejor = p;
    }
  }
  return mejor;
}

/** ¿El perfil puede abrir esta pantalla? (nivel base + pantallas del perfil + permiso) */
export function perfilVePantalla(p: Pantalla, rol: string | undefined, perfil: PerfilSesion | null | undefined): boolean {
  if (p.niveles?.length && (!rol || !p.niveles.includes(rol))) return false;
  if (!perfil) return true; // sin perfil (servidor viejo): como antes, solo por rol
  if (p.permiso && !perfil.todo && !perfil.permisos.includes(p.permiso)) return false;
  return perfil.todo || perfil.pantallas.includes(p.href);
}

/**
 * Menú del usuario: los módulos activos que deja su rol, recortados a las pantallas de su
 * perfil (un módulo con submenú queda con las sub-pantallas permitidas).
 */
export function modulosDelPerfil(rol: string | undefined, perfil: PerfilSesion | null | undefined): Modulo[] {
  const base = modulosActivos(rol);
  if (!perfil) return base;
  const catalogo = pantallasCatalogo();
  const ve = (href: string) => {
    const p = catalogo.find((x) => x.href === href);
    return p ? perfilVePantalla(p, rol, perfil) : true;
  };
  return base.flatMap((m) => {
    if (m.permiso && !perfil.todo && !perfil.permisos.includes(m.permiso)) return [];
    if (m.children?.length) {
      const hijos = m.children.filter((c) => ve(c.href));
      if (!hijos.length) return [];
      return [{ ...m, href: hijos.some((c) => c.href === m.href) ? m.href : hijos[0].href, children: hijos }];
    }
    return ve(m.href) ? [m] : [];
  });
}
