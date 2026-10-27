import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Caja (POS por sucursal: apertura, venta, arqueo, cierre, crédito).
 * Ítem propio del menú lateral (familia "Caja", separado de Finanzas) con sus pantallas como
 * submenú. Las rutas no cambian (Órdenes de venta sigue en /caja), así los perfiles guardados y los
 * links siguen valiendo; /caja/panel redirige a Nueva venta (next.config.ts).
 */
export const moduloCaja: Modulo = {
  id: "caja",
  label: "Caja",
  href: "/caja/nueva",
  icon: "wallet",
  familia: "Caja",
  roles: ["ADMIN", "SUPERVISOR", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Nueva venta", href: "/caja/nueva" },
    { label: "Apertura y cierre", href: "/caja/turnos" },
    { label: "Órdenes de venta", href: "/caja" },
    { label: "Ventas a crédito", href: "/caja/credito" },
    // Receta 68: pedidos por QR de las mesas (cola + cuentas abiertas) y la pantalla de cocina.
    { label: "Pedidos de mesas", href: "/caja/mesas", permiso: "pedidos_mesas" },
    { label: "Cocina", href: "/caja/cocina", permiso: "cocina" },
  ],
};
