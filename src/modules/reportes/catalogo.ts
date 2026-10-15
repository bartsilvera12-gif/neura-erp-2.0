import { Boxes, CalendarRange, HandCoins, Landmark, Lock, PackageMinus, PackageX, ShoppingCart, Truck, Wallet, type LucideIcon } from "lucide-react";

/**
 * Catálogo de reportes: alimenta la pantalla /reportes (tarjetas agrupadas por sección).
 * Para sumar un reporte: agregar una entrada acá y su página en src/app/(app)/reportes/<x>.
 * `roles`: quién lo ve (sin roles = solo ADMIN). SUPERVISOR entra solo al cierre de caja
 * (de su sucursal); el resto es información financiera de toda la empresa → ADMIN.
 */
export type Reporte = {
  href: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  icono: LucideIcon;
  seccion: "Finanzas" | "Ventas y caja" | "Inventario";
  roles?: string[];
};

export const SECCIONES: Reporte["seccion"][] = ["Finanzas", "Ventas y caja", "Inventario"];

export const REPORTES: Reporte[] = [
  {
    href: "/reportes/estado-cuenta",
    titulo: "Estado de cuenta",
    subtitulo: "Resultado de la empresa",
    descripcion: "Ventas, costo de lo vendido, margen, gastos por categoría, pérdidas y resultado. IVA, cuentas a cobrar y a pagar, flujo de caja y evolución mensual.",
    icono: Landmark,
    seccion: "Finanzas",
  },
  {
    href: "/reportes/cuentas-cobrar",
    titulo: "Cuentas por cobrar",
    subtitulo: "Quién te debe y desde cuándo",
    descripcion: "Por cliente y vencimiento, antigüedad (al día, 1–30, 31–60, 61–90, +90), ventas a crédito, cuotas y facturas al contado, y lo que espera aprobación en Conciliación.",
    icono: HandCoins,
    seccion: "Finanzas",
  },
  {
    href: "/reportes/cuentas-pagar",
    titulo: "Cuentas por pagar",
    subtitulo: "A quién le debés y cuándo vence",
    descripcion: "Compras y gastos a crédito por proveedor y vencimiento, antigüedad, lo vencido y el calendario de pagos de las próximas semanas, en guaraníes y dólares.",
    icono: Wallet,
    seccion: "Finanzas",
  },
  {
    href: "/reportes/proveedores",
    titulo: "Proveedores",
    subtitulo: "Con quién más se compra",
    descripcion: "Ranking de compras por proveedor, deuda y última compra. Entrá a cada uno: productos asociados, los que más le comprás, historial, evolución y pagos.",
    icono: Truck,
    seccion: "Finanzas",
  },
  {
    href: "/reportes/cajas",
    titulo: "Cierre de caja por día",
    subtitulo: "Arqueo de todas las cajas",
    descripcion: "Un renglón por día con lo vendido por forma de pago y las diferencias. Entrá al día para ver cada turno de cada caja con todos sus datos y bajar el PDF.",
    icono: Lock,
    seccion: "Ventas y caja",
    roles: ["ADMIN", "SUPERVISOR"],
  },
  {
    href: "/reportes/ventas-mensuales",
    titulo: "Ventas por mes",
    subtitulo: "Tendencia e interanual",
    descripcion: "Ventas totales de 12 o 24 meses por sucursal, contado vs crédito, forma de pago y categoría, comparadas con el mismo mes del año anterior.",
    icono: CalendarRange,
    seccion: "Ventas y caja",
  },
  {
    href: "/reportes/ventas",
    titulo: "Ventas del período",
    subtitulo: "Ventas, ganancia e IVA",
    descripcion: "Cuánto se vendió y se ganó, ticket promedio, IVA a declarar, cobros por medio de pago, ventas por cajero, productos y categorías más vendidos.",
    icono: ShoppingCart,
    seccion: "Ventas y caja",
  },
  {
    href: "/reportes/productos-vendidos",
    titulo: "Productos vendidos",
    subtitulo: "Cuánto se vendió de cada uno",
    descripcion: "Unidades, total, precio promedio, ganancia y margen por producto (resumido) o cada venta con cliente y cajero (detallado). Muestra también lo que no se vendió.",
    icono: Boxes,
    seccion: "Ventas y caja",
  },
  {
    href: "/reportes/perdidas",
    titulo: "Pérdidas de producto",
    subtitulo: "Vencimiento, rotura, devolución",
    descripcion: "Bajas por motivo, producto, categoría, depósito y mes, valorizadas al costo, con su impacto sobre las ventas, el inventario y el estado de cuenta.",
    icono: PackageX,
    seccion: "Inventario",
  },
  {
    href: "/reportes/stock-minimo",
    titulo: "Stock mínimo",
    subtitulo: "Productos por reponer",
    descripcion: "Productos cuyo stock quedó por debajo del mínimo definido, con lo vendido en 30 días y el costo de reponer. Lista de reposición en PDF y Excel.",
    icono: PackageMinus,
    seccion: "Inventario",
  },
];

/** Reportes que ve un rol. */
export const reportesPara = (rol: string | null | undefined) =>
  REPORTES.filter((r) => (r.roles ?? ["ADMIN"]).includes(rol ?? ""));

