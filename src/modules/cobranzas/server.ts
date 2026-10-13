/** Cobranzas — lado servidor (detrás de withTenant). Solo servidor. */
import { fail } from "@/lib/api/responses";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (s: unknown): s is string => typeof s === "string" && RE_UUID.test(s);

/** El id que va después de `segmento` en la URL (…/conciliacion/<id>/aprobar). */
export function idTras(req: Request, segmento: string): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf(segmento) + 1];
  return esUuid(id) ? id : null;
}

/** Error de una función de base → respuesta: duplicado = 409, el resto 400 con su mensaje. */
export function falloRpc(error: { message: string; code?: string }) {
  const msg = error.message.replace(/^.*?ERROR:\s*/, "");
  return fail(msg, error.code === "23505" ? 409 : 400, error.code === "23505" ? "duplicado" : undefined);
}

/** 1° del mes en curso en Paraguay (YYYY-MM-01). */
export function periodoActualPY(): string {
  return `${new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" }).slice(0, 7)}-01`;
}
