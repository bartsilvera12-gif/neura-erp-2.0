/** Ayudantes de servidor del rubro Gimnasio (receta 150): errores de la base y la deuda que frena la entrada. */
import { NextResponse } from "next/server";
import { falloInmo } from "@/modules/inmobiliaria/server";

export { idDe } from "@/modules/inmobiliaria/server";

/**
 * Error de una función gim_* → respuesta. Si la base frenó la entrada por deuda vencida
 * (hint "moroso:<monto>"), devuelve 409 con code "moroso" para que la pantalla ofrezca forzarla.
 */
export function falloGim(error: { message: string; code?: string; hint?: string }, porDefecto = "No se pudo completar la operación") {
  const m = /^moroso:(\d+(?:\.\d+)?)$/.exec(error.hint ?? "");
  if (m) {
    return NextResponse.json(
      { ok: false, error: { message: (error.message ?? "").replace(/^.*?ERROR:\s*/, ""), code: "moroso", monto: Number(m[1]) } },
      { status: 409 },
    );
  }
  return falloInmo(error, porDefecto);
}
