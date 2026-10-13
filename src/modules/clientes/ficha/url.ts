/**
 * URL con la que la ficha pide sus datos de entrada (cliente + resumen + suscripciones con
 * su facturación, todo en UNA llamada). La usan la ficha y el prefetch de la lista (hover
 * sobre una fila): tiene que ser la misma para que el cache en memoria la encuentre.
 */
export const urlFicha = (id: string) => `/api/clientes/${encodeURIComponent(id)}?con=suscripciones`;
