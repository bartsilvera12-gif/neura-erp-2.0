/**
 * Datos de la empresa del lado del servidor: lectura para los encabezados de los PDF.
 * Nunca rompe un documento: si la función no está (servidor sin la receta 57) o falla,
 * devuelve null y el PDF usa el respaldo de siempre (nombre y dominio del cliente).
 */
import type { TenantDb } from "@/lib/api/tenant-db";
import type { DatosEmpresa } from "@/modules/empresa/tipos";

export async function datosEmpresa(db: TenantDb): Promise<DatosEmpresa | null> {
  try {
    const { data, error } = await db.rpc<DatosEmpresa>("datos_empresa");
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}
