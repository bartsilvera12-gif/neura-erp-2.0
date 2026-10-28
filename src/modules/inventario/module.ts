import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Inventario (productos, stock por depósito y sus documentos).
 * Todo cambio de stock nace de un documento: compra, venta, traslado, ajuste o pérdida.
 *
 * El ítem del menú abre /inventario/panel (tarjetas con foto, una por sub-pantalla). Las
 * sub-pantallas no se mueven (Productos sigue en /inventario), así los perfiles guardados y
 * los links siguen valiendo.
 */
export const moduloInventario: Modulo = {
  id: "inventario",
  label: "Inventario",
  href: "/inventario/panel",
  panel: true,
  icon: "package",
  familia: "Operaciones",
  roles: ["ADMIN", "CAJERO", "VENDEDOR"],
  children: [
    { label: "Productos", href: "/inventario", palabras: ["stock", "existencias", "articulos", "mercaderia", "precios"] },
    // Receta 72: recetas de los platos (Menú) y preparaciones. Muestra costos → "ver costos".
    { label: "Recetas", href: "/inventario/recetas", permiso: "ver_costos", funcion: "recetas" },
    { label: "Movimientos", href: "/inventario/movimientos", palabras: ["kardex", "stock"] },
    { label: "Traslados", href: "/inventario/traslados" },
    { label: "Ajustes y pérdidas", href: "/inventario/ajustes", palabras: ["merma", "inventario fisico", "conteo", "stock"] },
    // Lotes con vencimiento (perecibles). Siempre visible: sin productos con lotes muestra
    // cómo activarlos.
    { label: "Vencimientos", href: "/inventario/vencimientos" },
    { label: "Categorías", href: "/inventario/categorias" },
    // Sucursales y depósitos (configuración): solo ADMIN.
    { label: "Depósitos", href: "/inventario/depositos", roles: ["ADMIN"], palabras: ["sucursales", "locales", "almacen"] },
  ],
  // Solo para el buscador del menú.
  atajos: [
    { label: "Nuevo ajuste o pérdida", href: "/inventario/ajustes/nuevo" },
    { label: "Nuevo traslado", href: "/inventario/traslados/nuevo" },
    { label: "Importación inicial de productos", href: "/inventario/import-inicial" },
  ],
};
