/** Ficha del contacto cacheada en memoria por conversación (aparte, para no forzar la descarga del panel). */
import type { Ficha } from "@/modules/conversaciones/api";

export const cacheFicha = new Map<string, Ficha>();
export const olvidarFicha = (convId: string) => cacheFicha.delete(convId);
