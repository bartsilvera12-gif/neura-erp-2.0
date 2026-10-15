import type { ClienteConfig } from "@/modules/types";

/**
 * Config de ESTE cliente. Es lo único personalizado del clon (lo escribe setup.mjs a
 * partir del formulario). Ningún otro archivo del código conoce al cliente.
 */
export const clienteConfig: ClienteConfig = {
  nombre: "Empresa Demo",
  dominio: "demo.neura.com.py",
  color: "#3F8E91",
  modulos: ["caja", "inventario", "compras", "clientes", "crm", "presupuestos", "gestion-clientes", "planes", "agenda", "proyectos", "cobranzas", "conciliacion", "pagos", "gastos", "conversaciones", "conversaciones-finalizadas", "monitoreo", "historial-omnicanal", "soporte", "reportes"], // ids de módulos activos
};
