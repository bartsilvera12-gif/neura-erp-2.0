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

export type FuncionId = "mesas" | "cocina" | "recetas" | "pedidos";
/** `funcion` de una sub-pantalla: una función, o "rubro" (la pantalla Rubro y funciones: se oculta si Neura la ocultó). */
export type FuncionPantalla = FuncionId | "rubro";
export type Rubro = "comercio" | "gastronomia" | "personalizado";

export type Funciones = {
  mesas: boolean;
  cocina: boolean;
  recetas: boolean;
  /** Receta 77: Pedidos de mostrador. */
  pedidos: boolean;
  /** Neura ocultó la sección Rubro y funciones (solo por SQL). */
  ocultas: boolean;
};

/** Lo que devuelve funciones_empresa() (GET /api/configuracion/funciones). */
export type FuncionesEmpresa = Funciones & {
  rubro: Rubro;
  puede_editar: boolean;
  cuentas_abiertas: number | null;
  pedidos_sin_cerrar: number | null;
  productos_recetas: number | null;
};

export const SIN_FUNCIONES: Funciones = { mesas: false, cocina: false, recetas: false, pedidos: true, ocultas: false };

export const URL_FUNCIONES = "/api/configuracion/funciones";
export const MSJ_FUNCION_INACTIVA = "Esta función no está activa en tu empresa";

export function rubroDe(f: Pick<Funciones, "mesas" | "cocina" | "recetas">): Rubro {
  if (!f.mesas && !f.cocina && !f.recetas) return "comercio";
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
};

/** Función que exige una ruta de /api (null = ninguna). La pública /api/publico/mesas se chequea aparte. */
export function funcionDeRutaApi(pathname: string): FuncionId | null {
  const en = (pre: string) => pathname === pre || pathname.startsWith(`${pre}/`);
  if (en("/api/mesas/estaciones")) return "cocina";
  if (en("/api/mesas")) return "mesas";
  if (en("/api/inventario/recetas")) return "recetas";
  if (en("/api/pedidos-mostrador")) return "pedidos";
  return null;
}
