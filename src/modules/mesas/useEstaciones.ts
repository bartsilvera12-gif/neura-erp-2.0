"use client";

/** Estaciones de cocina de la empresa (receta 70), cacheadas. Las usan Categorías e Inventario › producto. */
import { useEffect, useState } from "react";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import type { Estacion } from "@/modules/mesas/tipos";

export const URL_ESTACIONES = "/api/mesas/estaciones";

export function useEstaciones(): Estacion[] | null {
  const [lista, setLista] = useState<Estacion[] | null>(null);
  useEffect(() => {
    let vivo = true;
    apiFetchCache<{ estaciones: Estacion[] }>(URL_ESTACIONES)
      .then((r) => { if (vivo) setLista(r.estaciones ?? []); })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, []);
  return lista;
}

export const olvidarEstaciones = () => invalidar(URL_ESTACIONES);
