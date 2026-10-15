import type { Modulo } from "@/modules/types";

/** Manifiesto del módulo Caja (POS por sucursal: apertura, venta, arqueo, cierre, crédito). */
export const moduloCaja: Modulo = {
  id: "caja",
  label: "Caja",
  href: "/caja",
  icon: "wallet",
  familia: "Finanzas",
  roles: ["ADMIN", "SUPERVISOR", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Nueva venta", href: "/caja/nueva" },
    { label: "Apertura y cierre", href: "/caja/turnos" },
    { label: "Órdenes de venta", href: "/caja" },
    { label: "Ventas a crédito", href: "/caja/credito" },
  ],
};
