import type { Modulo } from "@/modules/types";

/**
 * Configuración › Facturación: modo de facturación (sin factura fiscal / SIFEN / autoimpresor),
 * impresión por defecto, numeración, condiciones de pago y la gestión tributaria de clientes.
 * Desde ahí se abre Facturación electrónica (SIFEN). Sin submenú. Solo nivel ADMIN con
 * "Configuración del sistema" (el Administrador lo tiene siempre).
 */
export const moduloFacturacion: Modulo = {
  id: "facturacion",
  label: "Facturación",
  href: "/configuracion/facturacion",
  icon: "receipt-text",
  familia: "Configuración",
  roles: ["ADMIN"],
  permiso: "configuracion",
};