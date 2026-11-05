import type { Modulo } from "@/modules/types";

// Receta 150: rubro Gimnasio / academia. Todas las pantallas dependen de la función `gimnasio`
// (Rubro y funciones): apagada, el módulo no aparece. Recepción y Clases: gimnasio_recepcion
// (Supervisor, Cajero y Vendedor al prenderla); Comisiones: gimnasio_administrar.
export const moduloGimnasio: Modulo = {
  id: "gimnasio",
  label: "Asistencia",
  palabras: ["asistencia", "clases", "turnos", "alumnos", "natacion", "artes marciales", "academia", "recepcion", "socios"],
  href: "/gimnasio/panel",
  panel: true,
  icon: "dumbbell",
  familia: "Asistencia",
  children: [
    { label: "Recepción", href: "/gimnasio", funcion: "gimnasio", permiso: "gimnasio_recepcion", palabras: ["asistencia", "entrada", "llegada", "check in", "hoy"] },
    { label: "Clases", href: "/gimnasio/clases", funcion: "gimnasio", permiso: "gimnasio_recepcion", palabras: ["horarios", "cupo", "profesores", "turnos"] },
    { label: "Comisiones de profesores", href: "/gimnasio/comisiones", funcion: "gimnasio", permiso: "gimnasio_administrar", palabras: ["profesores", "instructores", "pago por clase"] },
  ],
};
