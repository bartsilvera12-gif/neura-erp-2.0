import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Inventario (productos, stock por depósito y sus documentos).
 * Todo cambio de stock nace de un documento: compra, venta, traslado, ajuste o pérdida.
 */
export const moduloInventario: Modulo = {
  id: "inventario",
  label: "Inventario",
  href: "/inventario",
  icon: "package",
  familia: "Operaciones",
  roles: ["ADMIN", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Productos", href: "/inventario" },
    { label: "Movimientos", href: "/inventario/movimientos" },
    { label: "Traslados", href: "/inventario/traslados" },
    { label: "Ajustes y pérdidas", href: "/inventario/ajustes" },
    // Lotes con vencimiento (perecibles). Siempre visible: sin productos con lotes muestra
    // cómo activarlos.
    { label: "Vencimientos", href: "/inventario/vencimientos" },
    { label: "Categorías", href: "/inventario/categorias" },
    // Sucursales y depósitos (configuración): solo ADMIN.
    { label: "Depósitos", href: "/inventario/depositos", roles: ["ADMIN"] },
  ],
};
