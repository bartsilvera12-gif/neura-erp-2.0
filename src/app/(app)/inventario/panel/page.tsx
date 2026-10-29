"use client";

/**
 * /inventario/panel — Panel de Inventario (el ítem "Inventario" del menú abre acá): una tarjeta con
 * foto por sub-pantalla (PanelModulo → TarjetaImagen). Las rutas de las pantallas no cambian
 * (Productos sigue en /inventario). Se muestran solo las que el perfil puede abrir; Depósitos es
 * solo ADMIN (sale del `roles` del module.ts). Fotos y créditos: public/inventario/ y
 * docs/creditos-imagenes-demo.md (sección "Panel de Inventario").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/inventario", titulo: "Productos", imagen: "/inventario/productos-gondola.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 35%" },
  // Receta 72. FALTA FOTO PROPIA (cocina / ingredientes): por ahora reusa la del canasto de Compras.
  { href: "/inventario/recetas", titulo: "Recetas", imagen: "/inventario/recetas-chef-tabla-picado.webp", color: "24 60% 26%", posicion: "50% 55%" },
  // Receta 97. FALTA FOTO PROPIA (envasado / producción): por ahora reusa la de cajas de Categorías.
  { href: "/inventario/produccion", titulo: "Producción", imagen: "/inventario/categorias-cajas.webp", color: "268 38% 28%", posicion: "35% 60%" },
  { href: "/inventario/movimientos", titulo: "Movimientos", imagen: "/inventario/movimientos-escaner.webp", color: "214 42% 26%", posicion: "55% 45%" },
  { href: "/inventario/traslados", titulo: "Traslados", imagen: "/inventario/traslados-autoelevador.webp", color: "26 55% 24%", posicion: "45% 60%" },
  { href: "/inventario/ajustes", titulo: "Ajustes y pérdidas", imagen: "/inventario/ajustes-cajas-danadas.webp", color: "352 42% 27%", posicion: "30% 42%" },
  { href: "/inventario/vencimientos", titulo: "Vencimientos", imagen: "/inventario/vencimientos-fecha.webp", color: "150 38% 22%", posicion: "65% 45%" },
  { href: "/inventario/categorias", titulo: "Categorías", imagen: "/inventario/categorias-cajas.webp", color: "258 28% 30%", posicion: "50% 30%" },
  { href: "/inventario/depositos", titulo: "Depósitos", imagen: "/inventario/depositos-racks.webp", color: "205 32% 21%", posicion: "50% 40%" },
];

export default function PanelInventarioPage() {
  return (
    <PanelModulo
      kicker="Operaciones"
      titulo="Inventario"
      subtitulo="Productos, stock por depósito y los documentos que lo mueven."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de inventario habilitadas."
    />
  );
}
