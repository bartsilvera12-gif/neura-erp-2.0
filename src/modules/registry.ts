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
import { moduloCompras } from "@/modules/compras/module";
import { moduloSoporte } from "@/modules/soporte/module";
import { moduloCrm } from "@/modules/crm/module";
import { moduloConversaciones } from "@/modules/conversaciones/module";
import { moduloFinalizadas, moduloMonitoreo, moduloHistorialOmnicanal } from "@/modules/conversaciones/modulos-omnicanal";
import { moduloGestionClientes, moduloPlanes, moduloAgenda } from "@/modules/clientes/modulos-comerciales";
import { moduloCobranzas, moduloConciliacion } from "@/modules/cobranzas/module";
import { moduloPagos, moduloGastos } from "@/modules/compras/modulos-finanzas";
import { moduloProyectos } from "@/modules/proyectos/module";
import { moduloPresupuestos } from "@/modules/presupuestos/module";

// El orden de acá es el orden dentro de cada familia del menú (igual que sistemas-propio):
// Comercial: Clientes, CRM Funnel, Presupuestos, Gestión Clientes, Planes, Agenda, Proyectos · Finanzas: Caja, Cobranzas, Conciliación, Pagos, Gastos y Servicios,
// Compras, Reportes · Operaciones: Inventario · Omnicanal: Conversaciones, Finalizadas, Monitoreo, Historial omnicanal ·
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
  moduloGastos,
  moduloCompras,
  moduloReportes,
  moduloInventario,
  moduloConversaciones,
  moduloFinalizadas,
  moduloMonitoreo,
  moduloHistorialOmnicanal,
  moduloSoporte,
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
