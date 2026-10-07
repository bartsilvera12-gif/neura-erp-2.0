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

const TODOS: Modulo[] = [
  moduloCaja,
  moduloInventario,
  moduloClientes,
  // moduloFacturacion,
  // moduloChat,
  // ...
];

export function modulosActivos(rol?: string): Modulo[] {
  return TODOS.filter(
    (m) =>
      clienteConfig.modulos.includes(m.id) &&
      (!m.roles || !rol || m.roles.includes(rol)),
  );
}

export function moduloEstaActivo(id: string): boolean {
  return clienteConfig.modulos.includes(id);
}
