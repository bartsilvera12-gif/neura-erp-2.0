/**
 * TenantDb — envoltorio de acceso a datos atado a UNA empresa.
 *
 * Es el corazón del "seguro por diseño": aunque la ruta use service-role (que saltea
 * RLS), este envoltorio **inyecta empresa_id en cada operación**:
 *   - lecturas: agrega `.eq("empresa_id", empresaId)` automáticamente
 *   - inserts:  setea `empresa_id` en cada fila
 *   - updates/deletes: acota por `.eq("empresa_id", empresaId)`
 *
 * Así, olvidarse del filtro deja de ser posible: no hay forma de tocar datos de otra
 * empresa desde una ruta. Para los (pocos) casos que de verdad necesitan cruzar
 * empresas, existe `unsafeRaw()` — explícito, revisado y fácil de encontrar en un lint.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export class TenantDb {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly empresaId: string,
  ) {}

  /** SELECT acotado a la empresa. */
  select(table: string, columns = "*") {
    return this.sb.from(table).select(columns).eq("empresa_id", this.empresaId);
  }

  /** INSERT con empresa_id seteado en cada fila. */
  insert<T extends Record<string, unknown>>(table: string, rows: T | T[]) {
    const withEmpresa = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      ...r,
      empresa_id: this.empresaId,
    }));
    return this.sb.from(table).insert(withEmpresa).select();
  }

  /** UPDATE acotado a la empresa (no puede tocar otra). */
  update(table: string, patch: Record<string, unknown>) {
    return this.sb.from(table).update(patch).eq("empresa_id", this.empresaId);
  }

  /** DELETE acotado a la empresa. */
  delete(table: string) {
    return this.sb.from(table).delete().eq("empresa_id", this.empresaId);
  }

  /**
   * Escotilla de escape: cliente crudo SIN el filtro de empresa. Úsese sólo en casos
   * revisados y documentados (ej. catálogos globales). Nombre feo a propósito para que
   * salte en revisión de código y en el lint.
   */
  unsafeRaw(): SupabaseClient {
    return this.sb;
  }
}
