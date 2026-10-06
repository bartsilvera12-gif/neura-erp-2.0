/** Contrato de un módulo del ERP. Cada módulo se describe con esto. */
export type Modulo = {
  /** id estable, igual que el nombre de la carpeta en src/modules/ */
  id: string;
  /** nombre visible en el menú */
  label: string;
  /** ruta base del módulo */
  href: string;
  /** roles que pueden verlo (vacío = todos los autenticados) */
  roles?: string[];
};

/** Config por cliente: lo ÚNICO que cambia entre clones (lo escribe setup.mjs). */
export type ClienteConfig = {
  nombre: string;
  dominio: string;
  color: string;
  /** ids de los módulos activos para este cliente */
  modulos: string[];
};
