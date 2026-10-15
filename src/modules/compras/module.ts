import type { Modulo } from "@/modules/types";

/**
 * Gastos empresariales: TODO lo que sale de plata de la empresa en un solo módulo.
 *   · Resumen            gráficos del período: compras de mercadería + gastos operativos.
 *   · Gastos operativos  alquiler, servicios, sueldos, impuestos… (con o sin comprobante fiscal).
 *   · Compras / Órdenes de compra  mercadería que entra a un depósito (receta 49/50, sin cambios).
 *   · Proveedores / Pagos a proveedores  compartidos por compras y gastos (cuentas a pagar).
 *   · Recurrentes        plantillas mensuales y "Generar gastos del mes".
 * Reemplaza a los ítems sueltos "Gastos y Servicios" y "Compras": las URLs viejas siguen
 * funcionando (/gastos redirige; /compras, /compras/ordenes, /compras/pagos y /proveedores
 * son las mismas páginas, ahora con las pestañas del módulo).
 */
export const moduloGastosEmpresariales: Modulo = {
  id: "gastos-empresariales",
  label: "Gastos empresariales",
  href: "/gastos-empresariales",
  icon: "wallet-cards",
  familia: "Finanzas",
  roles: ["ADMIN"],
  children: [
    { label: "Resumen", href: "/gastos-empresariales" },
    { label: "Gastos operativos", href: "/gastos-empresariales/operativos" },
    { label: "Compras", href: "/compras" },
    { label: "Órdenes de compra", href: "/compras/ordenes" },
    { label: "Proveedores", href: "/proveedores" },
    { label: "Pagos a proveedores", href: "/compras/pagos" },
    { label: "Recurrentes", href: "/gastos-empresariales/recurrentes" },
  ],
};

/** Pestañas del módulo (mismas que el submenú). */
export const PESTANAS_GASTOS = moduloGastosEmpresariales.children!;
