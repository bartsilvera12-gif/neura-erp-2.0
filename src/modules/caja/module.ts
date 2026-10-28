import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Caja (POS por sucursal: apertura, venta, arqueo, cierre, crédito).
 * Ítem propio del menú lateral (familia "Caja", separado de Finanzas) que abre su panel de
 * tarjetas con foto (/caja/panel). Las rutas no cambian (Órdenes de venta sigue en /caja), así los
 * perfiles guardados y los links siguen valiendo.
 */
export const moduloCaja: Modulo = {
  id: "caja",
  label: "Caja",
  href: "/caja/panel",
  panel: true,
  icon: "wallet",
  familia: "Caja",
  roles: ["ADMIN", "SUPERVISOR", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Nueva venta", href: "/caja/nueva", palabras: ["vender", "facturar", "punto de venta", "pos"] },
    { label: "Apertura y cierre", href: "/caja/turnos", palabras: ["arqueo", "turno", "abrir caja", "cerrar caja"] },
    { label: "Órdenes de venta", href: "/caja", palabras: ["ventas", "facturas emitidas", "anular venta"] },
    // Receta 68: pedidos por QR de las mesas (cola + cuentas abiertas) y la pantalla de cocina.
    // Receta 75: se apagan con Rubro y funciones (Mesas y QR / Cocina y estaciones).
    { label: "Pedidos de mesas", href: "/caja/mesas", permiso: "pedidos_mesas", funcion: "mesas" },
    { label: "Cocina", href: "/caja/cocina", permiso: "cocina", funcion: "cocina" },
    // Receta 77: pedidos de mostrador (el vendedor arma y envía a caja; la caja cobra en Nueva venta).
    { label: "Pedidos", href: "/caja/pedidos", permiso: "pedidos_mostrador", funcion: "pedidos" },
  ],
};
