/**
 * Ciudades y barrios de Paraguay (INE, códigos geográficos CNPV 2022).
 *   GET /api/geo              → todas las ciudades (distritos)
 *   GET /api/geo?ciudad=0000  → los barrios y localidades de esa ciudad
 * src/modules/geo/paraguay.json sale de los Excel del INE: nombres sin mayúsculas sostenidas, Ñ
 * dañadas corregidas, abreviaturas COM INDIG y ASENT. escritas enteras y sin repetidos.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import datos from "@/modules/geo/paraguay.json";

type Fila = { c: string; n: string; d: string; b: string[] };
const FILAS = datos as Fila[];

export const GET = withTenant(async (_ctx, req) => {
  const ciudad = new URL(req.url).searchParams.get("ciudad");
  if (ciudad) return ok(FILAS.find((f) => f.c === ciudad)?.b ?? []);
  return ok(FILAS.map((f) => ({ codigo: f.c, nombre: f.n, departamento: f.d })));
});
