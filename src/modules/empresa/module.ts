import type { Modulo } from "@/modules/types";

/**
 * Configuración › Datos de la empresa: identificación fiscal (razón social, nombre de
 * fantasía, RUC, actividad) y contacto que salen en el encabezado de todos los documentos.
 * Nivel ADMIN con el permiso "Configuración del sistema" (el Administrador lo tiene siempre).
 */
export const moduloEmpresa: Modulo = {
  id: "empresa",
  label: "Datos de la empresa",
  href: "/configuracion/empresa",
  icon: "building",
  familia: "Configuración",
  roles: ["ADMIN"],
  permiso: "configuracion",
};
