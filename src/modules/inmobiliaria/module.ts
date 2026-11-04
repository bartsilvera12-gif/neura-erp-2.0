import type { Modulo } from "@/modules/types";

// Receta 130: rubro Inmobiliaria. La pantalla depende de la función `inmobiliaria` (Rubro y funciones):
// apagada, el módulo no aparece. Ver: cualquiera con la pantalla; cargar y editar: editar_productos.
export const moduloInmobiliaria: Modulo = {
  id: "inmobiliaria",
  label: "Inmobiliaria",
  palabras: ["propiedades", "inmuebles", "casas", "terrenos", "lotes", "alquileres", "catastro", "finca", "departamentos"],
  href: "/inmobiliaria",
  icon: "building",
  familia: "Inmobiliaria",
  children: [
    { label: "Propiedades", href: "/inmobiliaria", funcion: "inmobiliaria", palabras: ["inmuebles", "casas", "lotes", "venta", "alquiler", "cuenta catastral"] },
  ],
};
