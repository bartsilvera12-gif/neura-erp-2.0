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
    { label: "Órdenes de venta", href: "/caja" },
    { label: "Nueva venta", href: "/caja/nueva" },
    { label: "Arqueo / Cierre", href: "/caja/cierre" },
    { label: "Cierres de caja", href: "/caja/cierres" },
  ],
};
