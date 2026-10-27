/**
 * Funciones de una empresa (receta 75) del lado del servidor, con cache en memoria (~15 s).
 * La leen withTenant (corta las APIs de funciones apagadas) y /api/me (menú y guard).
 * Sin fila en empresa_funciones = Comercio (todo apagado; Pedidos de mostrador prendida, receta 77). guardar → invalidarFunciones().
 */
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { SIN_FUNCIONES, type Funciones } from "@/modules/configuracion/funciones";

const TTL_MS = 15_000;
type Entrada = { hasta: number; promesa: Promise<Funciones> };
const g = globalThis as typeof globalThis & { __erpFunciones?: Map<string, Entrada> };
const cache: Map<string, Entrada> = (g.__erpFunciones ??= new Map<string, Entrada>());

async function consultar(empresaId: string, schema: string): Promise<Funciones> {
  const { data, error } = await systemClient(schema)
    .from("empresa_funciones")
    .select("mesas, cocina, recetas, pedidos, funciones_ocultas")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return SIN_FUNCIONES;
  const f = data as { mesas: boolean; cocina: boolean; recetas: boolean; pedidos?: boolean | null; funciones_ocultas: boolean };
  // Receta 77: sin la columna (schema viejo) o null → prendida.
  return { mesas: !!f.mesas, cocina: !!f.cocina && !!f.mesas, recetas: !!f.recetas, pedidos: f.pedidos !== false, ocultas: !!f.funciones_ocultas };
}

export async function funcionesDeEmpresa(empresaId: string): Promise<Funciones> {
  const schema = tenantSchema();
  const clave = `${schema}|${empresaId}`;
  const ahora = Date.now();
  const hit = cache.get(clave);
  if (hit && hit.hasta > ahora) return hit.promesa;
  const promesa = consultar(empresaId, schema);
  const entrada = { hasta: ahora + TTL_MS, promesa };
  cache.set(clave, entrada);
  promesa.catch(() => {
    if (cache.get(clave) === entrada) cache.delete(clave);
  });
  return promesa;
}

export function invalidarFunciones(empresaId?: string): void {
  const prefijo = `${tenantSchema()}|`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefijo) && (!empresaId || k === `${prefijo}${empresaId}`)) cache.delete(k);
}
