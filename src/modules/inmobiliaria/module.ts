import type { Modulo } from "@/modules/types";

// Receta 130: rubro Inmobiliaria. La pantalla depende de la función `inmobiliaria` (Rubro y funciones):
// apagada, el módulo no aparece. Ver: cualquiera con la pantalla; cargar y editar: editar_productos.
export const moduloInmobiliaria: Modulo = {
  id: "inmobiliaria",
  label: "Inmobiliaria",
  palabras: ["propiedades", "inmuebles", "casas", "terrenos", "lotes", "alquileres", "catastro", "finca", "departamentos"],
  // Un solo ítem en el menú que abre el panel con tarjetas (diseño del 2.0, como Sorteos).
  href: "/inmobiliaria/panel",
  panel: true,
  icon: "building",
  familia: "Inmobiliaria",
  children: [
    { label: "Propiedades", href: "/inmobiliaria", funcion: "inmobiliaria", palabras: ["inmuebles", "casas", "lotes", "venta", "alquiler", "cuenta catastral"] },
    // Receta 133: contratos de alquiler, cuota de cada mes y liquidación a dueños.
    { label: "Alquileres", href: "/inmobiliaria/alquileres", funcion: "inmobiliaria", palabras: ["contratos", "inquilinos", "liquidaciones", "dueños", "propietarios"] },
  ],
};
