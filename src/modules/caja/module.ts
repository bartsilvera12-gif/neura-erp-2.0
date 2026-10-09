import type { Modulo } from "@/modules/types";

/** Manifiesto del módulo Caja (POS: apertura, venta, arqueo, cierre). */
export const moduloCaja: Modulo = {
  id: "caja",
  label: "Caja",
  href: "/caja",
  icon: "wallet",
  familia: "Finanzas",
  roles: ["ADMIN", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Nueva venta", href: "/caja/nueva" },
    { label: "Órdenes de venta", href: "/caja" },
  ],
};
