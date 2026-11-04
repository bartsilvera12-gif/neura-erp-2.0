/**
 * Lectura automática del comprobante de transferencia (rubro Sorteos, receta 125). Solo servidor.
 *
 * Usa Claude (visión + salida estructurada) cuando el servidor tiene ANTHROPIC_API_KEY. Sin la clave, o
 * si la lectura falla, devuelve null y la compra queda "Por revisar" para que la confirme una persona.
 * La lectura NO decide nada: la base (sorteo_bot_comprobante) compara monto, fecha, cuenta y número de
 * operación con la compra y el sorteo.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const esquemaLectura = z.object({
  es_comprobante: z.boolean().describe("true solo si la imagen es un comprobante de transferencia, depósito o pago bancario"),
  monto: z.number().nullable().describe("Monto transferido, en guaraníes, sin separadores (ej. 25000)"),
  moneda: z.string().nullable(),
  fecha: z.string().nullable().describe("Fecha de la operación en formato AAAA-MM-DD"),
  referencia: z.string().nullable().describe("Número de operación, transacción, comprobante o referencia"),
  banco_origen: z.string().nullable(),
  titular_origen: z.string().nullable(),
  cuenta_destino: z.string().nullable().describe("Cuenta o alias de destino, tal como aparece (puede estar enmascarada)"),
  titular_destino: z.string().nullable(),
  documento_destino: z.string().nullable().describe("RUC o cédula del destinatario, si aparece"),
  banco_destino: z.string().nullable(),
});
export type LecturaComprobante = z.infer<typeof esquemaLectura>;

const MIMES = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp", "image/gif": "image/gif" } as const;

const INSTRUCCIONES =
  "Sos el lector de comprobantes de pago de una empresa de sorteos de Paraguay. Leé el archivo adjunto y " +
  "devolvé los datos de la transferencia. Los montos están en guaraníes: en Paraguay el punto separa miles " +
  "(\"25.000\" son veinticinco mil). Copiá el número de operación exactamente como figura. Si un dato no " +
  "aparece o no se lee con claridad, devolvelo como null: no lo inventes. Si el archivo no es un " +
  "comprobante de pago (una foto cualquiera, una captura de chat, etc.), poné es_comprobante en false.";

export const lectorConfigurado = () => !!process.env.ANTHROPIC_API_KEY?.trim();

let cliente: Anthropic | null = null;

export async function leerComprobante(datos: Buffer, mime: string): Promise<LecturaComprobante | null> {
  if (!lectorConfigurado()) return null;
  const esPdf = mime === "application/pdf";
  const imagen = MIMES[mime as keyof typeof MIMES];
  if (!esPdf && !imagen) return null;
  cliente ??= new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const archivo: Anthropic.Beta.BetaContentBlockParam = esPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: imagen, data: datos.toString("base64") } };
  try {
    const r = await cliente.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(esquemaLectura) },
      messages: [{ role: "user", content: [archivo, { type: "text", text: INSTRUCCIONES }] }],
    });
    if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") {
      console.warn("[sorteos/lector] sin lectura:", r.stop_reason);
      return null;
    }
    const texto = r.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!texto) return null;
    const p = esquemaLectura.safeParse(JSON.parse(texto));
    return p.success ? p.data : null;
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error("[sorteos/lector]", e.status, e.message);
    else console.error("[sorteos/lector]", (e as Error).message);
    return null;
  }
}
