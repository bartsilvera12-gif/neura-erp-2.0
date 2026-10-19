import type { Modulo } from "@/modules/types";

/**
 * Gastos empresariales: TODO lo que sale de plata de la empresa en un solo módulo.
 *   · Resumen            gráficos del período: compras de mercadería + gastos operativos.
 *   · Compras y gastos   UNA lista (receta 59): compras de mercadería, gastos (alquiler, servicios,
 *                        sueldos…, con o sin comprobante fiscal) y compras mixtas; el tipo se
 *                        elige por línea en "Nueva compra". Incluye los gastos cargados antes.
 *   · Órdenes de compra  mercadería que entra a un depósito (receta 49/50).
 *   · Proveedores / Pagos a proveedores  compartidos por compras y gastos (cuentas a pagar).
 *   · Recurrentes        plantillas mensuales y "Generar gastos del mes".
 * Las URLs viejas siguen funcionando: /gastos y /gastos-empresariales/operativos redirigen a la
 * lista con el filtro de gastos y /compras con el de mercadería; /compras/nueva, /compras/ordenes,
 * /compras/pagos y /proveedores son las mismas páginas, con las pestañas del módulo.
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
    { label: "Compras y gastos", href: "/gastos-empresariales/compras-gastos" },
    { label: "Órdenes de compra", href: "/compras/ordenes" },
    { label: "Proveedores", href: "/proveedores" },
    { label: "Pagos a proveedores", href: "/compras/pagos" },
    { label: "Recurrentes", href: "/gastos-empresariales/recurrentes" },
  ],
};

/** Pestañas del módulo (mismas que el submenú). */
export const PESTANAS_GASTOS = moduloGastosEmpresariales.children!;
