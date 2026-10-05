/** Respuestas de API con una forma consistente: { ok, data } | { ok:false, error }. */
import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}
export function created<T>(data: T) {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}
export function noContent() {
  return new NextResponse(null, { status: 204 });
}
export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: { message, code } }, { status });
}

export const ERR = {
  unauth: () => fail("No autenticado", 401, "no_session"),
  forbidden: () => fail("Sin permiso", 403, "forbidden"),
  notFound: (what = "recurso") => fail(`${what} no encontrado`, 404, "not_found"),
  invalid: (detail: string) => fail(detail, 422, "invalid_input"),
  server: () => fail("Error interno", 500, "server_error"),
};
