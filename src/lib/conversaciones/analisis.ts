/**
 * Análisis de conversaciones (receta 174). Solo servidor (service_role).
 *
 * Lee los chats que atendieron PERSONAS en un período (desde la bandeja o desde el celular), los
 * anonimiza y le pide a Claude un informe: qué preguntan los clientes, cómo responde el equipo,
 * objeciones, productos que piden y no hay, tono, y sugerencias para las instrucciones del bot.
 *
 * SOLO LEE. Este archivo no importa ningún conector de mensajería: no puede mandarle nada a nadie.
 * Lo único que escribe es el informe (chat_analisis) y, si el ADMIN aplica una sugerencia, las
 * instrucciones del bot (bot_vendedor_config / categorias_productos).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { systemClient } from "@/lib/supabase/clients";
import { esquemaInforme, type Informe } from "@/lib/conversaciones/analisis-tipos";

const MODELO = "claude-sonnet-5-5";
// Precio por millón de tokens (Sonnet 5.5) para estimar el costo de cada informe.
const USD_ENTRADA = 2;
const USD_SALIDA = 10;
const MAX_CONVERSACIONES = 150;
const MAX_MENSAJES_POR_CHAT = 60;
const MAX_CARACTERES = 300_000;

const db = () => systemClient();

export { esquemaInforme, type Informe };

type Msg = { conversacion_id: string; from_me: boolean; autor_usuario_id: string | null; desde_celular: boolean; tipo: string; contenido: string | null; created_at: string };

/** Tapa lo que identifica a una persona: teléfonos, documentos, cuentas, correos. */
export function anonimizar(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[correo]")
    .replace(/\+?\d[\d .-]{5,}\d/g, "[número]");
}

function linea(m: Msg): string | null {
  const quien = !m.from_me ? "Cliente" : m.autor_usuario_id || m.desde_celular ? "Vendedor" : "Bot";
  const c = (m.contenido ?? "").trim();
  const texto = c || (m.tipo !== "texto" ? `[${m.tipo}]` : "");
  return texto ? `${quien}: ${anonimizar(texto).slice(0, 800)}` : null;
}

/** Las conversaciones del período donde respondió al menos una persona, ya armadas como texto. */
async function conversacionesConPersonas(empresaId: string, desde: string, hasta: string): Promise<{ textos: string[]; mensajes: number }> {
  const { data: humanos } = await db()
    .from("chat_mensajes")
    .select("conversacion_id, created_at")
    .eq("empresa_id", empresaId)
    .eq("from_me", true)
    .or("autor_usuario_id.not.is.null,desde_celular.eq.true")
    .neq("tipo", "nota")
    .gte("created_at", desde)
    .lte("created_at", hasta)
    .order("created_at", { ascending: false })
    .limit(5000);
  const ids = [...new Set(((humanos ?? []) as { conversacion_id: string }[]).map((h) => h.conversacion_id))].slice(0, MAX_CONVERSACIONES);
  const textos: string[] = [];
  let mensajes = 0;
  let total = 0;
  for (const id of ids) {
    const { data } = await db()
      .from("chat_mensajes")
      .select("conversacion_id, from_me, autor_usuario_id, desde_celular, tipo, contenido, created_at")
      .eq("conversacion_id", id)
      .not("tipo", "in", "(nota,sistema,reaccion)")
      .gte("created_at", desde)
      .lte("created_at", hasta)
      .order("created_at", { ascending: false })
      .limit(MAX_MENSAJES_POR_CHAT);
    const lineas = ((data ?? []) as Msg[]).reverse().map(linea).filter((x): x is string => !!x);
    if (lineas.length < 2) continue;
    const texto = `--- Conversación ${textos.length + 1} ---\n${lineas.join("\n")}`;
    if (total + texto.length > MAX_CARACTERES) break;
    textos.push(texto);
    mensajes += lineas.length;
    total += texto.length;
  }
  return { textos, mensajes };
}

const INSTRUCCIONES = [
  "Sos un analista comercial. Te paso conversaciones reales de WhatsApp entre clientes y el equipo de ventas de una tienda de Paraguay (los datos personales están tapados).",
  "\"Vendedor\" es una persona del equipo; \"Bot\" es el asistente automático: aprendé sobre todo de lo que hacen las personas.",
  "Armá el informe con lo que de verdad aparece en las conversaciones: no inventes, no generalices de un solo caso, y si algo no aparece devolvé la lista vacía.",
  "Las sugerencias son instrucciones para el bot vendedor de la tienda, escritas en español de Paraguay con voseo, concretas y cortas. No repitas lo que ya dicen sus instrucciones actuales, no prometas descuentos, plazos ni precios que no estén en las conversaciones, y no copies datos personales.",
].join("\n");

let cliente: Anthropic | null = null;

/** Corre el análisis de un informe ya creado ("procesando"). Nunca tira: deja el informe en "listo" o "error". */
export async function correrAnalisis(analisisId: string): Promise<void> {
  const { data: fila } = await db().from("chat_analisis").select("id, empresa_id, desde, hasta").eq("id", analisisId).maybeSingle();
  const a = fila as { id: string; empresa_id: string; desde: string; hasta: string } | null;
  if (!a) return;
  const terminar = (cambio: Record<string, unknown>) =>
    db().from("chat_analisis").update({ ...cambio, terminado_at: new Date().toISOString() }).eq("id", a.id);
  try {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("Falta la clave de Claude en el servidor (ANTHROPIC_API_KEY)");
    const { textos, mensajes } = await conversacionesConPersonas(a.empresa_id, a.desde, a.hasta);
    if (!textos.length) {
      await terminar({ estado: "listo", conversaciones: 0, mensajes: 0, resultado: null, costo_usd: 0 });
      return;
    }
    const [cfg, cats] = await Promise.all([
      db().from("bot_vendedor_config").select("tienda, instrucciones").eq("empresa_id", a.empresa_id).maybeSingle(),
      db().from("categorias_productos").select("nombre, bot_instrucciones").eq("empresa_id", a.empresa_id).eq("activo", true).order("nombre"),
    ]);
    const c = cfg.data as { tienda: string | null; instrucciones: string | null } | null;
    const categorias = (cats.data ?? []) as { nombre: string; bot_instrucciones: string | null }[];
    const contexto = [
      `Tienda: ${c?.tienda ?? "(sin nombre)"}`,
      `Instrucciones actuales del bot: ${c?.instrucciones?.trim() || "(ninguna)"}`,
      `Categorías (y lo que ya dice el vendedor de cada una):\n${categorias.map((x) => `- ${x.nombre}: ${x.bot_instrucciones?.trim() || "(sin instrucciones)"}`).join("\n") || "(sin categorías)"}`,
    ].join("\n\n");

    cliente ??= new Anthropic({ timeout: 600_000, maxRetries: 1 });
    const r = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(esquemaInforme) },
      system: INSTRUCCIONES,
      messages: [{ role: "user", content: `${contexto}\n\nConversaciones (${textos.length}):\n\n${textos.join("\n\n")}` }],
    });
    const costo = ((r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0)) * USD_ENTRADA + r.usage.output_tokens * USD_SALIDA) / 1_000_000;
    if (r.stop_reason === "refusal") throw new Error("Claude no quiso analizar estas conversaciones");
    if (r.stop_reason === "max_tokens") throw new Error("El informe quedó cortado: probá con un período más corto");
    const texto = r.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    const p = esquemaInforme.safeParse(JSON.parse(texto));
    if (!p.success) throw new Error("La respuesta de Claude no tuvo el formato esperado");
    await terminar({ estado: "listo", conversaciones: textos.length, mensajes, resultado: p.data, costo_usd: Math.round(costo * 10_000) / 10_000 });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Claude respondió ${e.status}: ${e.message}` : (e as Error).message;
    console.error("[analisis]", msg);
    await terminar({ estado: "error", error: msg.slice(0, 500) });
  }
}

/** Agrega una sugerencia a las instrucciones del bot (general o de su categoría). Devuelve dónde quedó. */
export async function aplicarSugerencia(empresaId: string, analisisId: string, indice: number, usuarioId: string): Promise<string> {
  const { data } = await db().from("chat_analisis").select("resultado, aplicadas").eq("id", analisisId).eq("empresa_id", empresaId).maybeSingle();
  const a = data as { resultado: Informe | null; aplicadas: number[] } | null;
  const s = a?.resultado?.sugerencias?.[indice];
  if (!a || !s) throw new Error("No existe esa sugerencia");
  if ((a.aplicadas ?? []).includes(indice)) throw new Error("Esa sugerencia ya se aplicó");
  const sumar = (previo: string | null) => [previo?.trim(), s.texto.trim()].filter(Boolean).join("\n");
  let donde: string;
  if (s.destino === "categoria" && s.categoria) {
    const { data: cat } = await db()
      .from("categorias_productos")
      .select("id, nombre, bot_instrucciones")
      .eq("empresa_id", empresaId)
      .ilike("nombre", s.categoria.trim())
      .maybeSingle();
    const k = cat as { id: string; nombre: string; bot_instrucciones: string | null } | null;
    if (!k) throw new Error(`No existe la categoría "${s.categoria}"`);
    const { error } = await db().from("categorias_productos").update({ bot_instrucciones: sumar(k.bot_instrucciones).slice(0, 3000) }).eq("id", k.id);
    if (error) throw new Error("No se pudo guardar en la categoría");
    donde = `instrucciones del vendedor de ${k.nombre}`;
  } else {
    const { data: cfg } = await db().from("bot_vendedor_config").select("instrucciones").eq("empresa_id", empresaId).maybeSingle();
    const { error } = await db()
      .from("bot_vendedor_config")
      .upsert({ empresa_id: empresaId, instrucciones: sumar((cfg as { instrucciones: string | null } | null)?.instrucciones ?? null).slice(0, 4000), updated_at: new Date().toISOString(), updated_by: usuarioId });
    if (error) throw new Error("No se pudo guardar en las instrucciones de la tienda");
    donde = "instrucciones generales de la tienda";
  }
  await db().from("chat_analisis").update({ aplicadas: [...(a.aplicadas ?? []), indice] }).eq("id", analisisId);
  return donde;
}
