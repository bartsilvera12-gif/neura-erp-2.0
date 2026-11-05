/**
 * Rubro y funciones de la empresa (receta 75). Compartido cliente/servidor.
 *
 * Todo lo gastronómico se puede apagar por empresa: Mesas y QR, Cocina y estaciones (requiere
 * Mesas) y Recetas e ingredientes. Sin configurar = Comercio (todo apagado).
 * Receta 77: Pedidos de mostrador (el vendedor arma, la caja cobra), independiente del rubro:
 * prendida en Comercio (y sin configurar), apagada por el preset Gastronomía.
 *   · Menú / paneles / guard: las sub-pantallas con `funcion` en su module.ts se ocultan.
 *   · APIs: withTenant corta con 403 las rutas de `funcionDeRutaApi`.
 */

export type FuncionId = "mesas" | "cocina" | "recetas" | "pedidos" | "sorteos" | "inmobiliaria";
/** `funcion` de una sub-pantalla: una función, o "rubro" (la pantalla Rubro y funciones: se oculta si Neura la ocultó). */
export type FuncionPantalla = FuncionId | "rubro";
export type Rubro = "comercio" | "gastronomia" | "sorteos" | "inmobiliaria" | "personalizado";

export type Funciones = {
  mesas: boolean;
  cocina: boolean;
  recetas: boolean;
  /** Receta 77: Pedidos de mostrador. */
  pedidos: boolean;
  /** Receta 123: Sorteos (rifas): venta por combos, vendedores, premios y sorteo verificable. */
  sorteos: boolean;
  /** Receta 130: Inmobiliaria: propiedades (venta y alquiler), dueños y documentación. */
  inmobiliaria: boolean;
  /** Neura ocultó la sección Rubro y funciones (solo por SQL). */
  ocultas: boolean;
  /** Receta 138: módulos apagados por el rubro o a mano (vacío = todos). */
  modulos_apagados: ModuloRubroId[];
};

/** Receta 138: módulos que se prenden/apagan por empresa. Soporte y Configuración no se apagan. */
export type ModuloRubroId = "comercial" | "caja" | "finanzas" | "gastos" | "inventario" | "reportes" | "omnicanal" | "rrhh" | "cuotas";

export const MODULOS_RUBRO: { id: ModuloRubroId; label: string; descripcion: string; modulos: string[]; pantallas?: string[] }[] = [
  { id: "comercial", label: "Comercial", descripcion: "Clientes, CRM, presupuestos, comisiones de vendedores, planes y agenda.", modulos: ["clientes", "crm", "presupuestos", "gestion-clientes", "comisiones", "planes", "agenda"], pantallas: ["/configuracion/comisiones"] },
  { id: "caja", label: "Caja", descripcion: "Ventas, apertura y cierre, órdenes de venta y notas de crédito.", modulos: ["caja"] },
  { id: "finanzas", label: "Finanzas", descripcion: "Cobranzas, conciliación y pagos.", modulos: ["cobranzas", "conciliacion", "pagos"] },
  { id: "gastos", label: "Gastos empresariales", descripcion: "Compras y gastos, órdenes de compra, proveedores y recurrentes.", modulos: ["gastos-empresariales"] },
  { id: "inventario", label: "Inventario", descripcion: "Productos, stock, movimientos, traslados y depósitos.", modulos: ["inventario"] },
  { id: "reportes", label: "Reportes", descripcion: "Todos los reportes.", modulos: ["reportes"] },
  { id: "omnicanal", label: "Omnicanal", descripcion: "Conversaciones y canales de WhatsApp.", modulos: ["conversaciones"] },
  { id: "rrhh", label: "RR HH", descripcion: "Personal y liquidaciones de sueldo.", modulos: ["rrhh"] },
  { id: "cuotas", label: "Planes de cuotas y mora", descripcion: "Configuración › Planes de cuotas y mora.", modulos: [], pantallas: ["/configuracion/cuotas"] },
];

/** Preset de cada rubro: qué módulos quedan apagados. */
export const MODULOS_APAGADOS_RUBRO: Record<Exclude<Rubro, "personalizado">, ModuloRubroId[]> = {
  comercio: [],
  gastronomia: [],
  sorteos: ["comercial", "inventario", "cuotas"],
  inmobiliaria: ["inventario"],
};

/** ¿El módulo del menú (id de module.ts) está apagado? */
export function moduloApagado(moduloId: string, f: Funciones | null | undefined): boolean {
  const ap = f?.modulos_apagados;
  if (!ap?.length) return false;
  return MODULOS_RUBRO.some((m) => ap.includes(m.id) && m.modulos.includes(moduloId));
}

/** ¿La pantalla está apagada (por su módulo o por ella misma)? */
export function pantallaApagada(moduloId: string, href: string, f: Funciones | null | undefined): boolean {
  const ap = f?.modulos_apagados;
  if (!ap?.length) return false;
  return MODULOS_RUBRO.some((m) => ap.includes(m.id) && (m.modulos.includes(moduloId) || !!m.pantallas?.includes(href)));
}

/** Lo que devuelve funciones_empresa() (GET /api/configuracion/funciones). */
export type FuncionesEmpresa = Funciones & {
  rubro: Rubro;
  puede_editar: boolean;
  cuentas_abiertas: number | null;
  pedidos_sin_cerrar: number | null;
  productos_recetas: number | null;
};

export const SIN_FUNCIONES: Funciones = { mesas: false, cocina: false, recetas: false, pedidos: true, sorteos: false, inmobiliaria: false, ocultas: false, modulos_apagados: [] };

export const URL_FUNCIONES = "/api/configuracion/funciones";
export const MSJ_FUNCION_INACTIVA = "Esta función no está activa en tu empresa";

export function rubroDe(f: Pick<Funciones, "mesas" | "cocina" | "recetas"> & { sorteos?: boolean; inmobiliaria?: boolean }): Rubro {
  const sinGastro = !f.mesas && !f.cocina && !f.recetas;
  if (f.inmobiliaria && !f.sorteos && sinGastro) return "inmobiliaria";
  if (f.sorteos && !f.inmobiliaria && sinGastro) return "sorteos";
  if (f.mesas && f.cocina && f.recetas) return "gastronomia";
  return "personalizado";
}

/** ¿Está activa? (cocina exige también mesas). Sin datos (`undefined`) → no se filtra nada. */
export function funcionActiva(f: Funciones | null | undefined, id: FuncionId): boolean {
  if (!f) return true;
  if (id === "cocina") return f.cocina && f.mesas;
  return f[id];
}

/** ¿Se ve una pantalla con esta `funcion`? */
export function pantallaConFuncionVisible(funcion: FuncionPantalla | undefined, f: Funciones | null | undefined): boolean {
  if (!funcion || !f) return true;
  if (funcion === "rubro") return !f.ocultas;
  return funcionActiva(f, funcion);
}

export const NOMBRE_FUNCION: Record<FuncionId, string> = {
  mesas: "Mesas y QR",
  cocina: "Cocina y estaciones",
  recetas: "Recetas e ingredientes",
  pedidos: "Pedidos de mostrador",
  sorteos: "Sorteos",
  inmobiliaria: "Inmobiliaria",
};

/** Función que exige una ruta de /api (null = ninguna). La pública /api/publico/mesas se chequea aparte. */
export function funcionDeRutaApi(pathname: string): FuncionId | null {
  const en = (pre: string) => pathname === pre || pathname.startsWith(`${pre}/`);
  if (en("/api/mesas/estaciones")) return "cocina";
  if (en("/api/mesas")) return "mesas";
  if (en("/api/inventario/recetas")) return "recetas";
  if (en("/api/inventario/produccion")) return "recetas";
  if (en("/api/pedidos-mostrador")) return "pedidos";
  if (en("/api/sorteos")) return "sorteos";
  if (en("/api/inmobiliaria")) return "inmobiliaria";
  return null;
}
