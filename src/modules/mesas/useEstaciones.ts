"use client";

/**
 * Estaciones de cocina de la empresa (receta 70), cacheadas. Las usan Categorías e Inventario › producto.
 * Con Cocina y estaciones apagada (receta 75) no se piden: lista vacía (los selectores no salen).
 */
import { useEffect, useState } from "react";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import type { Estacion } from "@/modules/mesas/tipos";
import { useFuncion } from "@/lib/sesion/ContextoUsuario";

export const URL_ESTACIONES = "/api/mesas/estaciones";
const VACIA: Estacion[] = [];

export function useEstaciones(): Estacion[] | null {
  const activa = useFuncion("cocina");
  const [lista, setLista] = useState<Estacion[] | null>(null);
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    apiFetchCache<{ estaciones: Estacion[] }>(URL_ESTACIONES)
      .then((r) => { if (vivo) setLista(r.estaciones ?? []); })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [activa]);
  return activa ? lista : VACIA;
}

export const olvidarEstaciones = () => invalidar(URL_ESTACIONES);
