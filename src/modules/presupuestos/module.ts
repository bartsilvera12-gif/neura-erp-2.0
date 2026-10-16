import type { Modulo } from "@/modules/types";

/**
 * Presupuestos: cotizar a un cliente o prospecto, descargar el PDF para mandarlo, marcar a
 * mano enviado / aceptado / rechazado y convertirlo en venta en la Caja. Familia Comercial, después de
 * Clientes y CRM.
 */
export const moduloPresupuestos: Modulo = {
  id: "presupuestos",
  label: "Presupuestos",
  href: "/presupuestos",
  icon: "file-signature",
  familia: "Comercial",
  roles: ["ADMIN", "SUPERVISOR", "VENDEDOR", "CAJERO"],
};
