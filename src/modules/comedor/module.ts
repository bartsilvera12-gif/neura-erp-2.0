import type { Modulo } from "@/modules/types";

// Receta 161: Comedor empresarial. Todas las pantallas dependen de la función `comedor`
// (Rubro y funciones, que solo prende Neura por SQL): apagada, el módulo no aparece.
// Fase 1: Funcionarios (padrón) y Configuración (empresa contratante y subsidio). Las tarjetas
// de Menú semanal, Retiro, Cantina y Liquidación se suman en las fases siguientes.
export const moduloComedor: Modulo = {
  id: "comedor",
  label: "Comedor",
  palabras: ["comedor", "funcionarios", "almuerzo", "menu", "cantina", "retiro", "subsidio", "liquidacion", "padron"],
  href: "/comedor/panel",
  panel: true,
  icon: "utensils",
  familia: "Comedor",
  children: [
    { label: "Funcionarios", href: "/comedor/funcionarios", funcion: "comedor", permiso: "comedor_administrar", palabras: ["padron", "empleados", "ci", "importar", "excel", "saldo"] },
    { label: "Menú semanal", href: "/comedor/menu", funcion: "comedor", permiso: "comedor_administrar", palabras: ["menu", "almuerzo", "opciones", "reservas", "enlace", "link", "semana", "platos"] },
    { label: "Retiro", href: "/comedor/retiro", funcion: "comedor", permiso: "comedor_recepcion", palabras: ["retiro", "entrega", "marca", "asistencia", "terminal", "kiosco", "ci", "huella", "subsidio"] },
    { label: "Configuración del comedor", href: "/comedor/configuracion", funcion: "comedor", permiso: "comedor_administrar", palabras: ["empresa", "contratante", "subsidio", "cierre"] },
  ],
};
