import type { FuncionPantalla } from "@/modules/configuracion/funciones";

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
  children?: {
    label: string;
    href: string;
    /** roles que ven esta sub-pantalla (vacío = todos) */
    roles?: string[];
    /** permiso propio de esta sub-pantalla (si no, el del módulo) */
    permiso?: string;
    /** como `accesoPropio` del módulo, pero solo para esta sub-pantalla (ej. Omnicanal › Monitoreo) */
    accesoPropio?: boolean;
    /**
     * Receta 75: la sub-pantalla es de una función que la empresa puede apagar (Mesas, Cocina,
     * Recetas) o es la pantalla Rubro y funciones ("rubro": se oculta si Neura la ocultó).
     * Apagada → no sale en el menú ni en los paneles, y el guard no deja entrar por URL.
     */
    funcion?: FuncionPantalla;
    /**
     * Solo en los ítems agrupadores del menú (ver `grupo`): el módulo del que viene esta
     * pantalla (ej. "Gastos empresariales" para "Resumen"), para el buscador del menú.
     */
    seccion?: string;
  }[];
  /**
   * El ítem del menú abre su propio panel (`href`, con tarjetas de las sub-pantallas) y las
   * sub-pantallas NO se despliegan en el menú. Igual cuentan como pantallas de los perfiles.
   */
  panel?: boolean;
  /**
   * El módulo NO va suelto en el menú: se junta con los demás del mismo grupo en un solo ítem
   * con panel propio (`GRUPOS_MENU` en registry.ts; ej. "finanzas" → Finanzas, /finanzas).
   * Sigue existiendo igual para el catálogo de pantallas, los perfiles y el guard.
   */
  grupo?: string;
  /** permiso del perfil que además hace falta para verlo (ej. "administrar_usuarios") */
  permiso?: string;
  /**
   * La pantalla decide sola quién entra además del perfil (ej. Monitoreo: también los
   * supervisores de una cola). El menú la muestra según el perfil, pero entrar por URL no
   * corta con "Sin acceso".
   */
  accesoPropio?: boolean;
};

/** Config por cliente: lo ÚNICO que cambia entre clones (lo escribe setup.mjs). */
export type ClienteConfig = {
  nombre: string;
  dominio: string;
  color: string;
  /** ids de los módulos activos para este cliente */
  modulos: string[];
};
