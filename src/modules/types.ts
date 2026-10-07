/** Contrato de un módulo del ERP. Cada módulo se describe con esto. */
export type Modulo = {
  /** id estable, igual que el nombre de la carpeta en src/modules/ */
  id: string;
  /** nombre visible en el menú */
  label: string;
  /** ruta base del módulo */
  href: string;
  /** ícono (nombre de lucide-react) para el sidebar y el dashboard */
  icon?: string;
  /** familia del menú (agrupamiento visual del sidebar), ej. "Finanzas", "Comercial" */
  familia?: string;
  /** badge a la derecha del ítem (ej. "Nuevo") — estilo 21st.dev */
  badge?: string;
  /** roles que pueden verlo (vacío = todos los autenticados) */
  roles?: string[];
  /** sub-pantallas del módulo, para navegar directo desde el sidebar */
  children?: { label: string; href: string }[];
};

/** Config por cliente: lo ÚNICO que cambia entre clones (lo escribe setup.mjs). */
export type ClienteConfig = {
  nombre: string;
  dominio: string;
  color: string;
  /** ids de los módulos activos para este cliente */
  modulos: string[];
};
