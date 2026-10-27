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
import { moduloOmnicanal } from "@/modules/conversaciones/module";
import { moduloGestionClientes, moduloPlanes, moduloAgenda } from "@/modules/clientes/modulos-comerciales";
import { moduloCobranzas, moduloConciliacion } from "@/modules/cobranzas/module";
import { moduloPagos } from "@/modules/compras/modulos-finanzas";
import { moduloProyectos } from "@/modules/proyectos/module";
import { moduloPresupuestos } from "@/modules/presupuestos/module";
import { moduloConfiguracion } from "@/modules/configuracion/module";
import type { PerfilSesion } from "@/modules/usuarios/permisos";
import { pantallaConFuncionVisible, type FuncionPantalla, type Funciones } from "@/modules/configuracion/funciones";

// El orden de acá es el orden dentro de cada familia del menú (igual que sistemas-propio):
// Comercial: Clientes, CRM Funnel, Presupuestos, Gestión Clientes, Planes, Agenda, Proyectos — en el menú son UN ítem
// "Comercial" (grupo, panel /comercial; todos van directo a su pantalla) · Caja: ítem propio con panel (/caja/panel) · Finanzas: Cobranzas, Conciliación, Pagos,
// Gastos empresariales (compras + gastos operativos), Reportes — en el menú son UN ítem "Finanzas" (grupo, panel /finanzas;
// Gastos con panel propio) · Operaciones: Inventario · Omnicanal: Omnicanal (panel: Conversaciones, Finalizadas, Monitoreo, Historial omnicanal) ·
// Soporte: Soporte · Configuración: Configuración (panel: Datos de la empresa, Facturación, Usuarios).
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
  moduloOmnicanal,
  moduloSoporte,
  moduloConfiguracion,
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
export const ORDEN_FAMILIAS = ["Comercial", "Caja", "Finanzas", "Operaciones", "Omnicanal", "Soporte", "Configuración", "Administración", "General"];

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
  /** receta 75: función de la empresa que hace falta (o "rubro") */
  funcion?: FuncionPantalla;
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
      for (const c of m.children) {
        out.push({ ...base, href: c.href, label: c.label, niveles: interseccion(m.roles, c.roles), permiso: c.permiso ?? m.permiso, accesoPropio: c.accesoPropio ?? m.accesoPropio, funcion: c.funcion });
      }
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

// ── Ítems agrupadores del menú ───────────────────────────────────────────────
// Varios módulos (`grupo` en su module.ts) se muestran en el menú como UN solo ítem que abre un
// panel de tarjetas, una por módulo. Los módulos siguen existiendo igual: sus pantallas, rutas,
// roles y permisos no cambian (catálogo de perfiles, guard). El panel del grupo es una página
// propia (ej. src/app/(app)/finanzas/page.tsx).

export type GrupoMenu = { id: string; label: string; href: string; icon: string; familia: string };

export const GRUPOS_MENU: GrupoMenu[] = [
  // Clientes · CRM Funnel · Presupuestos · Gestión Clientes · Planes · Agenda · Proyectos
  { id: "comercial", label: "Comercial", href: "/comercial", icon: "briefcase", familia: "Comercial" },
  // Caja · Cobranzas · Conciliación · Pagos · Gastos empresariales · Reportes
  { id: "finanzas", label: "Finanzas", href: "/finanzas", icon: "landmark", familia: "Finanzas" },
];

/** Junta los módulos de cada grupo en su ítem (en el lugar del primero del grupo). */
function agruparEnMenu(mods: Modulo[]): Modulo[] {
  const out: Modulo[] = [];
  const items = new Map<string, Modulo>();
  for (const m of mods) {
    const g = m.grupo ? GRUPOS_MENU.find((x) => x.id === m.grupo) : undefined;
    if (!g) {
      out.push(m);
      continue;
    }
    let item = items.get(g.id);
    if (!item) {
      item = { id: g.id, label: g.label, href: g.href, icon: g.icon, familia: g.familia, panel: true, children: [] };
      items.set(g.id, item);
      out.push(item);
    }
    // Hijos del ítem = todo lo que se puede abrir del módulo: su panel (si tiene) y sus
    // pantallas. Sirven para marcar "Finanzas" activo y para el buscador del menú.
    if (m.children?.length) {
      if (m.panel) item.children!.push({ label: m.label, href: m.href });
      item.children!.push(...m.children.map((c) => ({ ...c, seccion: m.label })));
    } else {
      item.children!.push({ label: m.label, href: m.href });
    }
  }
  return out;
}

/**
 * El panel (de un módulo con `panel`, o de un grupo del menú) que es exactamente esta ruta, con
 * las pantallas que agrupa; o null. El panel no es una pantalla de los perfiles: se puede abrir
 * si el perfil ve alguna de esas pantallas. El guard lo usa antes de `pantallaDeRuta`, porque
 * /inventario/panel cae bajo el prefijo de Productos (/inventario) y /caja/panel bajo Órdenes de
 * venta (/caja).
 */
export function panelDeRuta(pathname: string): { id: string; label: string; pantallas: Pantalla[] } | null {
  const catalogo = pantallasCatalogo();
  const m = TODOS.find((x) => x.panel && x.href === pathname && clienteConfig.modulos.includes(x.id));
  if (m) return { id: m.id, label: m.label, pantallas: catalogo.filter((p) => p.moduloId === m.id) };
  const g = GRUPOS_MENU.find((x) => x.href === pathname);
  if (!g) return null;
  const ids = new Set(TODOS.filter((x) => x.grupo === g.id).map((x) => x.id));
  return { id: g.id, label: g.label, pantallas: catalogo.filter((p) => ids.has(p.moduloId)) };
}

/** Las pantallas (hrefs) de un módulo, para las tarjetas de un panel de grupo. */
export function hrefsDeModulo(id: string): string[] {
  const m = TODOS.find((x) => x.id === id);
  if (!m) return [];
  return m.children?.length ? m.children.map((c) => c.href) : [m.href];
}

/**
 * ¿El perfil puede abrir esta pantalla? (nivel base + pantallas del perfil + permiso; y, si se
 * pasan, las funciones de la empresa — receta 75: Mesas / Cocina / Recetas apagadas no se ven).
 */
export function perfilVePantalla(p: Pantalla, rol: string | undefined, perfil: PerfilSesion | null | undefined, funciones?: Funciones | null): boolean {
  if (!pantallaConFuncionVisible(p.funcion, funciones)) return false;
  if (p.niveles?.length && (!rol || !p.niveles.includes(rol))) return false;
  if (!perfil) return true; // sin perfil (servidor viejo): como antes, solo por rol
  if (p.permiso && !perfil.todo && !perfil.permisos.includes(p.permiso)) return false;
  return perfil.todo || perfil.pantallas.includes(p.href);
}

/**
 * Menú del usuario: los módulos activos que deja su rol, recortados a las pantallas de su
 * perfil (un módulo con submenú queda con las sub-pantallas permitidas). Los módulos con
 * `grupo` salen juntos en el ítem de su grupo (ej. "Finanzas"), solo con lo que el perfil ve.
 */
export function modulosDelPerfil(rol: string | undefined, perfil: PerfilSesion | null | undefined, funciones?: Funciones | null): Modulo[] {
  return agruparEnMenu(modulosVisibles(rol, perfil, funciones));
}

function modulosVisibles(rol: string | undefined, perfil: PerfilSesion | null | undefined, funciones?: Funciones | null): Modulo[] {
  const base = modulosActivos(rol).map((m) =>
    // Receta 75: sub-pantallas de funciones apagadas fuera (también sin perfil cargado).
    m.children?.some((c) => c.funcion) ? { ...m, children: m.children.filter((c) => pantallaConFuncionVisible(c.funcion, funciones)) } : m,
  );
  if (!perfil) return base;
  const catalogo = pantallasCatalogo();
  const ve = (href: string) => {
    const p = catalogo.find((x) => x.href === href);
    return p ? perfilVePantalla(p, rol, perfil, funciones) : true;
  };
  return base.flatMap((m) => {
    if (m.permiso && !perfil.todo && !perfil.permisos.includes(m.permiso)) return [];
    if (m.children?.length) {
      const hijos = m.children.filter((c) => ve(c.href));
      if (!hijos.length) return [];
      return [{ ...m, href: m.panel || hijos.some((c) => c.href === m.href) ? m.href : hijos[0].href, children: hijos }];
    }
    return ve(m.href) ? [m] : [];
  });
}
