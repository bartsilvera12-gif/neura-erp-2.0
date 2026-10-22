import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Caja (POS por sucursal: apertura, venta, arqueo, cierre, crédito).
 * Va dentro del ítem "Finanzas" del menú (grupo "finanzas" → /finanzas) y tiene su propio
 * panel de tarjetas (/caja/panel). Las sub-pantallas no se mueven (Órdenes de venta sigue en
 * /caja), así los perfiles guardados y los links siguen valiendo.
 */
export const moduloCaja: Modulo = {
  id: "caja",
  label: "Caja",
  href: "/caja/panel",
  panel: true,
  grupo: "finanzas",
  icon: "wallet",
  familia: "Finanzas",
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
