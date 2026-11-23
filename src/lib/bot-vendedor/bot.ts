/**
 * Bot vendedor por WhatsApp (receta 172). Solo servidor (service_role).
 *
 * El cliente escribe, elige una categoría y el bot pasa a ser el VENDEDOR de esa categoría, con las
 * instrucciones que la tienda cargó para ella (Omnicanal › Bot vendedor). Muestra productos con
 * precio y stock del ERP, arma el carrito y toma el pedido: envío o retiro, y pago al recibir o por
 * transferencia (con la foto del comprobante). El pedido cae en Caja › Pedidos de WhatsApp.
 *
 * La conversación la lleva Claude con herramientas; lo que tiene que ser verdad (precios, stock, el
 * pedido) lo deciden la base y este archivo, nunca el modelo.
 *
 * Atiende si: el bot está prendido, el canal es el elegido (o no hay uno elegido), la función Pedidos
 * está activa y nadie de la empresa escribió en el chat en las últimas 12 h (o lo escribió pero
 * después finalizó el chat: Finalizar le devuelve el chat al bot). "Asesor" o el pedido explícito
 * del cliente lo pasan a una persona.
 */
import Anthropic from "@anthropic-ai/sdk";
import { systemClient } from "@/lib/supabase/clients";
import { conectorPara, type DestinoChat } from "@/modules/conversaciones/conectores";
import { CARTEL_MEDIA } from "@/modules/conversaciones/conectores/normalizadores";
import { leerComprobante, lectorConfigurado } from "@/lib/sorteos/lector-comprobante";
import { CHAT_BUCKET } from "@/lib/conversaciones/servidor";

const MODELO = process.env.BOT_VENDEDOR_MODELO?.trim() || "claude-sonnet-5-5";
const HUMANO_MS = 12 * 60 * 60 * 1000;
/** Tope de respuestas del bot por chat y por día (cuida el saldo de la API). */
const TURNOS_DIA = 60;
const HISTORIA = 30;
const VUELTAS_HERRAMIENTAS = 8;

const db = () => systemClient();
const gs = (n: number) => `Gs ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const CARTELES = new Set(Object.values(CARTEL_MEDIA));

// ── Tipos ────────────────────────────────────────────────────────────────────
type Cuenta = { banco?: string; titular?: string; cuenta?: string; documento?: string; alias?: string };
export type ConfigBot = {
  empresa_id: string; activo: boolean; canal_id: string | null; tienda: string | null; instrucciones: string | null;
  envio_activo: boolean; envio_texto: string | null; retiro_activo: boolean; retiro_texto: string | null;
  pago_al_recibir: boolean; pago_transferencia: boolean; cuentas: Cuenta[];
};
type Conv = {
  id: string; empresa_id: string; etiquetas: string[] | null;
  canal: { id: string; tipo: string; proveedor: string; identificador: string | null; activo: boolean } | null;
  contacto: { telefono: string | null; nombre: string | null; externo_id: string | null } | null;
};
type Linea = { producto_id: string; cantidad: number };
type Sesion = {
  conversacion_id: string; empresa_id: string; categoria_id: string | null; carrito: Linea[];
  datos: { ubicacion?: string }; paso: "charla" | "pago" | "humano"; pedido_id: string | null;
  turnos_dia: number; turnos_fecha: string | null; updated_at: string;
};
type Categoria = { id: string; nombre: string; descripcion: string | null; bot_instrucciones: string | null };
type Producto = {
  id: string; nombre: string; descripcion: string | null; precio_venta: number; descuento_pct: number; stock_actual: number;
  controla_stock: boolean; tipo_producto: string; imagen_url: string | null; categoria_principal_id: string | null;
};
type Pedido = { id: string; etiqueta: string; total: number; estado: string; whatsapp: { forma_pago: string | null; pago_estado: string | null } | null };

export type EntranteVendedor = {
  conversacion_id: string; mensaje_id: string; tipo: string; contenido: string | null; media_path?: string | null; media_mime?: string | null;
  /** Por QR: el archivo de una foto que llegó después del mensaje (el epígrafe, si tenía, ya se contestó). */
  archivoTardio?: boolean;
};

// ── Lecturas ─────────────────────────────────────────────────────────────────
async function leerConv(id: string): Promise<Conv | null> {
  const { data } = await db()
    .from("chat_conversaciones")
    .select("id, empresa_id, etiquetas, canal:chat_canales!canal_id(id, tipo, proveedor, identificador, activo), contacto:chat_contactos!contacto_id(telefono, nombre, externo_id)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Conv | null) ?? null;
}

async function configDe(conv: Conv): Promise<ConfigBot | null> {
  if (!conv.canal || conv.canal.tipo !== "whatsapp") return null;
  const [cfg, fun] = await Promise.all([
    db().from("bot_vendedor_config").select("*").eq("empresa_id", conv.empresa_id).maybeSingle(),
    db().from("empresa_funciones").select("pedidos").eq("empresa_id", conv.empresa_id).maybeSingle(),
  ]);
  const c = cfg.data as ConfigBot | null;
  if (!c?.activo || (c.canal_id && c.canal_id !== conv.canal.id)) return null;
  // Sin fila de funciones = Comercio = Pedidos prendida (receta 77).
  if ((fun.data as { pedidos?: boolean } | null)?.pedidos === false) return null;
  return { ...c, cuentas: Array.isArray(c.cuentas) ? c.cuentas : [] };
}

async function leerSesion(conv: Conv): Promise<Sesion> {
  const { data } = await db().from("bot_vendedor_sesiones").select("*").eq("conversacion_id", conv.id).maybeSingle();
  const s = data as Sesion | null;
  return s
    ? { ...s, carrito: Array.isArray(s.carrito) ? s.carrito : [], datos: s.datos ?? {} }
    : { conversacion_id: conv.id, empresa_id: conv.empresa_id, categoria_id: null, carrito: [], datos: {}, paso: "charla", pedido_id: null, turnos_dia: 0, turnos_fecha: null, updated_at: new Date().toISOString() };
}

async function guardarSesion(s: Sesion) {
  const { error } = await db().from("bot_vendedor_sesiones").upsert({
    conversacion_id: s.conversacion_id, empresa_id: s.empresa_id, categoria_id: s.categoria_id, carrito: s.carrito, datos: s.datos,
    paso: s.paso, pedido_id: s.pedido_id, turnos_dia: s.turnos_dia, turnos_fecha: s.turnos_fecha, updated_at: new Date().toISOString(),
  });
  if (error) console.error("[bot-vendedor] sesión", error.message);
}

/** Toma el chat para un turno (dos mensajes seguidos no disparan dos respuestas a la vez). */
async function tomarTurno(conv: Conv): Promise<boolean> {
  await db().from("bot_vendedor_sesiones").upsert({ conversacion_id: conv.id, empresa_id: conv.empresa_id }, { onConflict: "conversacion_id", ignoreDuplicates: true });
  const ahora = new Date();
  const { data } = await db()
    .from("bot_vendedor_sesiones")
    .update({ ocupado_hasta: new Date(ahora.getTime() + 120_000).toISOString() })
    .eq("conversacion_id", conv.id)
    .or(`ocupado_hasta.is.null,ocupado_hasta.lt.${ahora.toISOString()}`)
    .select("conversacion_id");
  return !!data?.length;
}
const soltarTurno = (convId: string) => db().from("bot_vendedor_sesiones").update({ ocupado_hasta: null }).eq("conversacion_id", convId);

async function categoriasVisibles(empresaId: string): Promise<Categoria[]> {
  const { data } = await db()
    .from("categorias_productos")
    .select("id, nombre, descripcion, bot_instrucciones")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("bot_visible", true)
    .order("nombre")
    .limit(60);
  return (data ?? []) as Categoria[];
}

const COLS_PRODUCTO = "id, nombre, descripcion, precio_venta, descuento_pct, stock_actual, controla_stock, tipo_producto, imagen_url, categoria_principal_id";
const precioDe = (p: Producto) => Math.round(Number(p.precio_venta) * (1 - Math.max(0, Math.min(Number(p.descuento_pct) || 0, 100)) / 100));
const conStock = (p: Producto) => !p.controla_stock || p.tipo_producto === "menu" || Number(p.stock_actual) > 0;
const disponible = (p: Producto) => (!p.controla_stock || p.tipo_producto === "menu" ? null : Math.max(0, Number(p.stock_actual)));

function vistaProducto(p: Producto) {
  const stock = disponible(p);
  return {
    producto_id: p.id,
    nombre: p.nombre,
    precio: gs(precioDe(p)),
    ...(Number(p.descuento_pct) > 0 ? { precio_lista: gs(Number(p.precio_venta)), descuento: `${Number(p.descuento_pct)}%` } : {}),
    stock: stock === null ? "disponible" : stock > 0 ? `quedan ${stock}` : "sin stock",
    ...(p.descripcion ? { descripcion: p.descripcion.slice(0, 300) } : {}),
    tiene_foto: /^https?:\/\//i.test(p.imagen_url ?? ""),
  };
}

async function productosVendibles(empresaId: string, filtro: { categorias?: string[]; texto?: string; ids?: string[] }, limite = 40): Promise<Producto[]> {
  let q = db()
    .from("productos")
    .select(COLS_PRODUCTO)
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .eq("es_vendible", true)
    .neq("tipo_producto", "materia_prima");
  if (filtro.ids) q = q.in("id", filtro.ids);
  if (filtro.categorias) q = q.in("categoria_principal_id", filtro.categorias.length ? filtro.categorias : ["00000000-0000-0000-0000-000000000000"]);
  if (filtro.texto) {
    const t = filtro.texto.replace(/[%,()*]/g, " ").trim().slice(0, 60);
    if (t) q = q.or(`nombre.ilike.%${t}%,descripcion.ilike.%${t}%`);
  }
  const { data, error } = await q.order("destacado", { ascending: false }).order("nombre").limit(limite);
  if (error) console.error("[bot-vendedor] productos", error.message);
  return (data ?? []) as Producto[];
}

// ── Envío ────────────────────────────────────────────────────────────────────
function destinoDe(conv: Conv): DestinoChat {
  return {
    canal: { id: conv.canal!.id, tipo: conv.canal!.tipo, proveedor: conv.canal!.proveedor, identificador: conv.canal!.identificador },
    telefono: conv.contacto?.telefono ?? null,
    externoContacto: conv.contacto?.externo_id ?? null,
  };
}

/** Lo que escribe el bot queda en el chat como mensaje saliente sin autor (lo ven los asesores). */
async function enviar(conv: Conv, contenido: string, foto?: { url: string; nombre: string }) {
  if (!conv.canal || !contenido.trim()) return;
  const { data, error } = await db()
    .from("chat_mensajes")
    .insert({ empresa_id: conv.empresa_id, conversacion_id: conv.id, from_me: true, tipo: "texto", contenido, estado_entrega: "pendiente" })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[bot-vendedor] guardar mensaje", error?.message);
    return;
  }
  let estado = "enviado";
  let externo: string | null = null;
  let fallo: string | null = null;
  try {
    const c = conectorPara(conv.canal.proveedor);
    const r = foto
      ? await c.enviarMedia(destinoDe(conv), { tipo: "imagen", mime: "image/jpeg", nombre: foto.nombre, caption: contenido, url: async () => foto.url })
      : await c.enviarTexto(destinoDe(conv), contenido);
    externo = r.externo_id;
    if (conv.canal.proveedor === "simulador") estado = "entregado";
  } catch (e) {
    estado = "fallido";
    fallo = (e as Error).message || "No se pudo enviar";
  }
  await db().from("chat_mensajes").update({ estado_entrega: estado, externo_id: externo, error: fallo }).eq("id", (data as { id: string }).id);
}

/**
 * ¿Alguien del equipo finalizó el chat (botón Finalizar de la bandeja) después de `desde`?
 * Finalizar deja una nota "✅ Conversación finalizada": desde ahí el chat vuelve a ser del bot.
 */
async function finalizadaDespuesDe(convId: string, desde: string): Promise<boolean> {
  const { data } = await db()
    .from("chat_mensajes")
    .select("id")
    .eq("conversacion_id", convId)
    .eq("tipo", "nota")
    .like("contenido", "✅ Conversación finalizada%")
    .gt("created_at", desde)
    .limit(1);
  return !!data?.length;
}

async function pasarAHumano(conv: Conv, s: Sesion, aviso: string) {
  s.paso = "humano";
  const etiquetas = new Set(conv.etiquetas ?? []);
  etiquetas.add("Pide asesor");
  await db().from("chat_conversaciones").update({ etiquetas: [...etiquetas], updated_at: new Date().toISOString() }).eq("id", conv.id);
  await guardarSesion(s);
  await enviar(conv, aviso);
}

// ── Historia del chat → mensajes para Claude ─────────────────────────────────
type FilaMsg = { id: string; from_me: boolean; tipo: string; contenido: string | null; media_path: string | null; created_at: string };

function textoDe(m: FilaMsg): string {
  const c = (m.contenido ?? "").trim();
  if (m.tipo === "ubicacion") return `[El cliente compartió su ubicación: ${c}]`;
  if (m.tipo === "imagen" || (CARTELES.has(c) && c === "[imagen]")) return c && !CARTELES.has(c) ? `[Foto] ${c}` : "[El cliente mandó una foto]";
  if (m.tipo === "audio" || c === "[audio]") return "[El cliente mandó un audio: no podés escucharlo, pedile que lo escriba]";
  if (m.tipo === "video" || c === "[video]") return "[El cliente mandó un video]";
  if (m.tipo === "documento" || c === "[documento]") return "[El cliente mandó un archivo]";
  if (m.tipo === "sticker" || c === "[sticker]") return "[sticker]";
  return c;
}

async function historia(convId: string): Promise<{ mensajes: Anthropic.Beta.BetaMessageParam[]; ultimoEntrante: string | null }> {
  const { data } = await db()
    .from("chat_mensajes")
    .select("id, from_me, tipo, contenido, media_path, created_at")
    .eq("conversacion_id", convId)
    .not("tipo", "in", "(nota,sistema,reaccion)")
    .order("created_at", { ascending: false })
    .limit(HISTORIA);
  const filas = ((data ?? []) as FilaMsg[]).reverse();
  const mensajes: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of filas) {
    const texto = textoDe(m);
    if (!texto) continue;
    const role = m.from_me ? "assistant" : "user";
    const ult = mensajes[mensajes.length - 1];
    if (ult && ult.role === role) ult.content = `${ult.content as string}\n${texto}`;
    else mensajes.push({ role, content: texto });
  }
  while (mensajes.length && mensajes[0].role !== "user") mensajes.shift();
  const ultimo = [...filas].reverse().find((m) => !m.from_me);
  return { mensajes, ultimoEntrante: ultimo?.id ?? null };
}

// ── Instrucciones ────────────────────────────────────────────────────────────
function sistemaFijo(cfg: ConfigBot, categorias: Categoria[]): string {
  const tienda = cfg.tienda?.trim() || "la tienda";
  const entrega = [
    cfg.envio_activo ? `- Envío a domicilio${cfg.envio_texto ? `: ${cfg.envio_texto}` : ""}` : null,
    cfg.retiro_activo ? `- Retiro en el local${cfg.retiro_texto ? `: ${cfg.retiro_texto}` : ""}` : null,
  ].filter(Boolean).join("\n");
  const pago = [
    cfg.pago_al_recibir ? "- al_recibir: paga cuando recibe o retira el pedido" : null,
    cfg.pago_transferencia ? "- transferencia: transfiere y manda la foto del comprobante por este chat" : null,
  ].filter(Boolean).join("\n");
  return [
    `Atendés el WhatsApp de ${tienda}, en Paraguay. Hablás en español de Paraguay, con voseo, cálido y breve: son mensajes de WhatsApp, de 1 a 4 líneas, sin títulos ni tablas. Podés usar *negrita* de WhatsApp y algún emoji, sin exagerar.`,
    "",
    "Menús numerados (importante): el cliente no tiene que escribir frases. Cada vez que le ofrezcas opciones (categorías, productos, talle o color, envío o retiro, forma de pago, confirmar o cambiar; la cantidad no: esa la escribe el cliente), mostralas numeradas, una por línea, así: *1* · Remeras. Máximo 10 opciones; terminá con una línea corta como \"Respondé con el número 👇\". Si el cliente responde solo un número, es la opción con ese número de TU último mensaje con opciones. Igual aceptá que escriba con sus palabras, aunque esté mal escrito o sin tildes (\"remra\", \"pantalon\", \"zapatiyas\"): entendé a qué se refiere.",
    "",
    "Cómo funciona la atención:",
    "1. Si el cliente todavía no eligió una categoría, saludalo y mostrale las categorías numeradas. Si ya dice lo que busca, elegí vos la categoría que corresponde.",
    "2. Cuando elige una (por número o por nombre), llamá a elegir_categoria con el nombre exacto de la lista: desde ahí sos el vendedor especialista de esa categoría y seguís sus instrucciones. Si después quiere otra cosa, cambiá de categoría con elegir_categoria. Ofrecé siempre una opción numerada para volver a las categorías.",
    "3. Mostrá los productos de esa categoría numerados, con el precio en la misma línea. Precios, stock y descripciones salen SOLO de las herramientas: nunca inventes un producto, un precio, un descuento ni un plazo. Si algo no está, decilo y ofrecé lo más parecido.",
    "4. Si el producto tiene foto y ayuda a vender, mandala con enviar_foto.",
    "5. Para la cantidad preguntá simplemente \"¿Cuántas querés?\" (sin lista numerada: el cliente escribe el número). Con agregar_al_carrito armás el pedido; nunca agregues más unidades que el stock que muestra la herramienta. Después ofrecé: seguir comprando, ver otra categoría o terminar el pedido.",
    "6. Para cerrar pedí, de a una cosa por mensaje y con opciones numeradas cuando se pueda: envío o retiro, la dirección si es envío (sirve la ubicación de WhatsApp), la forma de pago y el nombre de quien recibe. Mostrá el resumen con el total y ofrecé *1* · Confirmar pedido, *2* · Cambiar algo. Recién cuando elige confirmar, llamá a confirmar_pedido.",
    "7. Si pide hablar con una persona, se queja, o pregunta algo que las herramientas no responden (garantías, cambios, mayoristas, factura con RUC), llamá a pasar_a_humano.",
    "8. Nunca te desdigas de algo que ya le confirmaste al cliente (un pedido, un precio). Si algo no te cierra, no afirmes que no existe: llamá a pasar_a_humano.",
    "",
    `Categorías de la tienda: ${categorias.length ? categorias.map((c) => c.nombre).join(" · ") : "(todavía no hay categorías cargadas)"}`,
    "",
    `Entrega:\n${entrega || "- A coordinar con la tienda"}`,
    "",
    `Formas de pago (valor para confirmar_pedido):\n${pago || "- al_recibir"}`,
    "",
    "Los precios son en guaraníes (Gs) y ya tienen el IVA. El envío no está en el total del pedido: si tiene costo, decilo aparte tal como figura arriba.",
    cfg.instrucciones?.trim() ? `\nInstrucciones de la tienda:\n${cfg.instrucciones.trim()}` : "",
  ].join("\n");
}

const ESTADO_PEDIDO: Record<string, string> = {
  whatsapp: "recibido, la tienda lo está preparando", en_caja: "listo, esperando el cobro", cobrado: "cobrado y entregado o listo para entregar", anulado: "anulado por la tienda",
};

/**
 * Los pedidos que este chat ya hizo (últimos 30 días). El bot ve la charla solo como texto: sin esto,
 * al volver el cliente veía "Pedido confirmado P-0001" en la historia y el carrito vacío, y concluía
 * que el pedido no existía.
 */
type PedidoChat = { etiqueta: string; estado: string; texto: string };

async function pedidosDelChat(convId: string): Promise<PedidoChat[]> {
  const { data } = await db()
    .from("pedidos_mostrador")
    .select("numero, estado, total, entrega, forma_pago, pago_estado, creado_at, items:pedido_mostrador_items(cantidad, producto_nombre)")
    .eq("conversacion_id", convId)
    .eq("origen", "whatsapp")
    .gte("creado_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .order("creado_at", { ascending: false })
    .limit(5);
  const filas = (data ?? []) as { numero: number; estado: string; total: number; entrega: string | null; forma_pago: string | null; pago_estado: string | null; creado_at: string; items: { cantidad: number; producto_nombre: string }[] }[];
  return filas.map((p, i) => {
    const min = Math.max(0, Math.round((Date.now() - Date.parse(p.creado_at)) / 60_000));
    const hace = min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
    const etiqueta = `P-${String(p.numero).padStart(4, "0")}`;
    const items = (p.items ?? []).map((x) => `${Number(x.cantidad)} × ${x.producto_nombre}`).join(", ");
    const pago = p.forma_pago === "transferencia" ? (p.pago_estado === "comprobante" ? "transferencia, comprobante recibido" : "transferencia, falta el comprobante") : "paga al recibir o retirar";
    return {
      etiqueta,
      estado: p.estado,
      texto: `- *${etiqueta}* (creado ${hace}${i === 0 ? "; es el último pedido que confirmaste en esta charla" : ""}): ${items}. Total ${gs(Number(p.total))}. ${p.entrega === "envio" ? "Envío" : "Retiro"}, ${pago}. Estado: ${ESTADO_PEDIDO[p.estado] ?? p.estado}.`,
    };
  });
}

async function sistemaEstado(s: Sesion, categorias: Categoria[]): Promise<string> {
  const cat = categorias.find((c) => c.id === s.categoria_id) ?? null;
  const partes: string[] = [];
  if (cat) {
    partes.push(`Ahora sos el vendedor de *${cat.nombre}*.${cat.descripcion ? ` ${cat.descripcion}` : ""}`);
    if (cat.bot_instrucciones?.trim()) partes.push(`Cómo vende el vendedor de ${cat.nombre}:\n${cat.bot_instrucciones.trim()}`);
  } else {
    partes.push("El cliente todavía no eligió una categoría.");
  }
  partes.push(`Carrito: ${s.carrito.length ? (await resumenCarrito(s)).texto : "vacío"}`);
  const pedidos = await pedidosDelChat(s.conversacion_id);
  if (pedidos.length) {
    partes.push(
      `Pedidos de este cliente REGISTRADOS en el sistema (son reales y correctos):\n${pedidos.map((p) => p.texto).join("\n")}\n` +
        "Todo pedido que confirmaste en esta charla está en esta lista, con el mismo número. El carrito queda vacío cuando un pedido se confirma: es lo normal, no significa que algo falló. " +
        "Nunca digas que un pedido no quedó confirmado o registrado, ni ofrezcas armarlo de nuevo. Si el cliente agradece o se despide, despedite. Si pregunta por un pedido, contale su estado.",
    );
  }
  if (s.datos.ubicacion) partes.push(`Ubicación que compartió el cliente: ${s.datos.ubicacion}`);
  if (s.paso === "pago" && s.pedido_id) partes.push("Ya hizo un pedido y falta la foto del comprobante de la transferencia: si pregunta, recordale que la mande por acá.");
  return partes.join("\n\n");
}

async function resumenCarrito(s: Sesion): Promise<{ texto: string; total: number; lineas: { p: Producto; cantidad: number }[] }> {
  if (!s.carrito.length) return { texto: "vacío", total: 0, lineas: [] };
  const prods = await productosVendibles(s.empresa_id, { ids: s.carrito.map((l) => l.producto_id) }, 60);
  const lineas = s.carrito.map((l) => ({ p: prods.find((x) => x.id === l.producto_id), cantidad: l.cantidad })).filter((l): l is { p: Producto; cantidad: number } => !!l.p);
  const total = lineas.reduce((a, l) => a + precioDe(l.p) * l.cantidad, 0);
  return { texto: `${lineas.map((l) => `${l.cantidad} × ${l.p.nombre} (${gs(precioDe(l.p))} c/u)`).join("; ")}. Total ${gs(total)}`, total, lineas };
}

// ── Herramientas ─────────────────────────────────────────────────────────────
const obj = (props: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties: props, required, additionalProperties: false });

export const HERRAMIENTAS: Anthropic.Beta.BetaToolUnion[] = [
  { name: "ver_categorias", description: "Lista las categorías de la tienda (con cuántos productos tiene cada una).", input_schema: obj({}, []), strict: true },
  {
    name: "elegir_categoria",
    description: "El cliente eligió una categoría (o lo que busca pertenece a ella): pasás a ser el vendedor de esa categoría. Devuelve sus productos con precio y stock.",
    input_schema: obj({ categoria: { type: "string", description: "Nombre de la categoría, tal como figura en la lista" } }, ["categoria"]),
    strict: true,
  },
  {
    name: "buscar_productos",
    description: "Busca productos por nombre o descripción en todas las categorías. Usala cuando el cliente pide algo puntual.",
    input_schema: obj({ texto: { type: "string" } }, ["texto"]),
    strict: true,
  },
  {
    name: "enviar_foto",
    description: "Manda al cliente la foto de un producto (solo si tiene_foto es true). El texto va como epígrafe de la foto.",
    input_schema: obj({ producto_id: { type: "string" }, texto: { type: "string" } }, ["producto_id", "texto"]),
    strict: true,
  },
  {
    name: "agregar_al_carrito",
    description: "Pone la cantidad de un producto en el carrito (si ya estaba, reemplaza la cantidad). Cantidad 0 lo saca.",
    input_schema: obj({ producto_id: { type: "string" }, cantidad: { type: "integer", description: "Unidades (0 lo saca del carrito)" } }, ["producto_id", "cantidad"]),
    strict: true,
  },
  { name: "ver_carrito", description: "Muestra el carrito con el total.", input_schema: obj({}, []), strict: true },
  {
    name: "confirmar_pedido",
    description: "Crea el pedido con el carrito. Solo después de mostrar el resumen y que el cliente diga que confirma.",
    input_schema: obj(
      {
        nombre: { type: "string", description: "Nombre de quien recibe o retira" },
        entrega: { type: "string", enum: ["envio", "retiro"] },
        direccion: { type: "string", description: "Dirección y referencias para el envío. Vacío si retira." },
        forma_pago: { type: "string", enum: ["al_recibir", "transferencia"] },
        nota: { type: "string", description: "Aclaraciones del cliente (horario, talle, color). Vacío si no hay." },
      },
      ["nombre", "entrega", "direccion", "forma_pago", "nota"],
    ),
    strict: true,
  },
  {
    name: "pasar_a_humano",
    description: "Pasa la conversación a una persona del equipo. Después de esto no respondés más en este chat.",
    input_schema: obj({ motivo: { type: "string" } }, ["motivo"]),
    strict: true,
  },
];

/** envios: mensajes que el bot ya mandó en este turno (texto antes de las herramientas, fotos). */
/** Texto para comparar: sin tildes, sin mayúsculas y sin signos ("Remeras!" = "remeras"). */
const plano = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Distancia de edición (para "remra" ≈ "remeras"). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** La categoría que quiso decir: exacta, contenida, singular/plural o con un error de tipeo chico. */
export function buscarCategoria<T extends { nombre: string }>(categorias: T[], texto: string): T | null {
  const q = plano(texto);
  if (!q) return null;
  const sinS = (t: string) => t.replace(/(es|s)$/, "");
  return (
    categorias.find((c) => plano(c.nombre) === q) ??
    categorias.find((c) => sinS(plano(c.nombre)) === sinS(q)) ??
    categorias.find((c) => plano(c.nombre).includes(q) || q.includes(plano(c.nombre))) ??
    categorias
      .map((c) => ({ c, d: distancia(sinS(plano(c.nombre)), sinS(q)) }))
      .filter((x) => x.d <= Math.max(1, Math.floor(sinS(plano(x.c.nombre)).length / 4)))
      .sort((a, b) => a.d - b.d)[0]?.c ??
    null
  );
}

type Ctx = { conv: Conv; cfg: ConfigBot; s: Sesion; categorias: Categoria[]; fin: boolean; envios: number };

async function ejecutar(ctx: Ctx, nombre: string, input: Record<string, unknown>): Promise<unknown> {
  const { conv, cfg, s, categorias } = ctx;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  switch (nombre) {
    case "ver_categorias": {
      const prods = await productosVendibles(s.empresa_id, { categorias: categorias.map((c) => c.id) }, 1000);
      return categorias.map((c) => ({ categoria: c.nombre, productos: prods.filter((p) => p.categoria_principal_id === c.id && conStock(p)).length }));
    }
    case "elegir_categoria": {
      const cat = buscarCategoria(categorias, str("categoria"));
      if (!cat) return { error: `No existe esa categoría. Las categorías son: ${categorias.map((c) => c.nombre).join(", ")}` };
      s.categoria_id = cat.id;
      const prods = (await productosVendibles(s.empresa_id, { categorias: [cat.id] })).filter(conStock);
      return {
        ahora_sos: `el vendedor de ${cat.nombre}`,
        instrucciones: cat.bot_instrucciones?.trim() || null,
        productos: prods.map(vistaProducto),
        ...(prods.length ? {} : { aviso: "Esta categoría no tiene productos con stock ahora." }),
      };
    }
    case "buscar_productos": {
      const prods = await productosVendibles(s.empresa_id, { categorias: categorias.map((c) => c.id), texto: str("texto") }, 15);
      return prods.length ? prods.map((p) => ({ ...vistaProducto(p), categoria: categorias.find((c) => c.id === p.categoria_principal_id)?.nombre ?? null })) : { resultado: "No hay productos con ese nombre." };
    }
    case "enviar_foto": {
      const [p] = await productosVendibles(s.empresa_id, { ids: [str("producto_id")] }, 1);
      if (!p || !/^https?:\/\//i.test(p.imagen_url ?? "")) return { error: "Ese producto no tiene foto." };
      await enviar(conv, str("texto") || p.nombre, { url: p.imagen_url!, nombre: `${p.nombre}.jpg` });
      ctx.envios += 1;
      return { ok: true, nota: "La foto ya se mandó con ese texto: no repitas el texto." };
    }
    case "agregar_al_carrito": {
      const id = str("producto_id");
      const cant = Math.max(0, Math.floor(Number(input.cantidad) || 0));
      const [p] = await productosVendibles(s.empresa_id, { ids: [id] }, 1);
      if (!p) return { error: "Ese producto no existe o ya no está a la venta." };
      const tope = disponible(p);
      if (tope !== null && cant > tope) return { error: `De ${p.nombre} quedan ${tope}.` };
      s.carrito = s.carrito.filter((l) => l.producto_id !== id);
      if (cant > 0) s.carrito.push({ producto_id: id, cantidad: cant });
      return { carrito: (await resumenCarrito(s)).texto };
    }
    case "ver_carrito":
      return { carrito: (await resumenCarrito(s)).texto };
    case "confirmar_pedido": {
      if (!s.carrito.length) return { error: "El carrito está vacío." };
      const entrega = str("entrega");
      const pago = str("forma_pago");
      if (entrega === "envio" && !cfg.envio_activo) return { error: "La tienda no hace envíos: solo retiro." };
      if (entrega === "retiro" && !cfg.retiro_activo) return { error: "La tienda no tiene retiro: solo envío." };
      if (pago === "transferencia" && !cfg.pago_transferencia) return { error: "La tienda no acepta transferencia." };
      if (pago === "al_recibir" && !cfg.pago_al_recibir) return { error: "La tienda no cobra al recibir: solo transferencia." };
      // Freno contra duplicados: si este chat ya tiene un pedido por preparar con los mismos productos y
      // cantidades (de las últimas 6 h), es el mismo pedido confirmado otra vez (ej. una respuesta que
      // falló y el cliente repitió "confirmar"): no se crea otro.
      const previo = await pedidoIgualReciente(conv.id, s.carrito);
      if (previo) {
        s.pedido_id = previo.id;
        s.carrito = [];
        return {
          pedido: previo.etiqueta,
          total: gs(previo.total),
          ya_existia: true,
          siguiente: "Este pedido YA estaba registrado (no se creó otro). Confirmale al cliente ese número, sin decir que se creó de nuevo.",
        };
      }
      const { data, error } = await db().rpc("pedido_whatsapp_crear", {
        p_empresa: s.empresa_id,
        p: {
          conversacion_id: conv.id, telefono: conv.contacto?.telefono ?? null, nombre: str("nombre"), entrega,
          direccion: entrega === "envio" ? str("direccion") : null, ubicacion: entrega === "envio" ? s.datos.ubicacion ?? null : null,
          forma_pago: pago, nota: str("nota"), items: s.carrito,
        },
      });
      if (error || !data) return { error: error?.message ?? "No se pudo crear el pedido." };
      const ped = data as Pedido;
      s.pedido_id = ped.id;
      s.carrito = [];
      s.paso = pago === "transferencia" ? "pago" : "charla";
      return {
        pedido: ped.etiqueta,
        total: gs(Number(ped.total)),
        siguiente: pago === "transferencia"
          ? `Pasale los datos para transferir y pedile la foto del comprobante por este chat:\n${textoCuentas(cfg.cuentas)}`
          : "Confirmale el pedido con su número y contale que la tienda lo prepara y le avisa.",
      };
    }
    case "pasar_a_humano": {
      ctx.fin = true;
      await pasarAHumano(conv, s, "Listo, te paso con una persona del equipo. En breve te responden por acá. 🙌");
      return { ok: true };
    }
    default:
      return { error: "Herramienta desconocida" };
  }
}

/** Un pedido por preparar de este chat, de las últimas 6 h, con exactamente los mismos productos y cantidades. */
async function pedidoIgualReciente(convId: string, carrito: Linea[]): Promise<{ id: string; etiqueta: string; total: number } | null> {
  const { data } = await db()
    .from("pedidos_mostrador")
    .select("id, numero, total, items:pedido_mostrador_items(producto_id, cantidad)")
    .eq("conversacion_id", convId)
    .eq("origen", "whatsapp")
    .eq("estado", "whatsapp")
    .gte("creado_at", new Date(Date.now() - 6 * 3_600_000).toISOString())
    .order("creado_at", { ascending: false })
    .limit(5);
  const clave = (l: { producto_id: string | null; cantidad: number }[]) =>
    l.map((x) => `${x.producto_id}:${Number(x.cantidad)}`).sort().join("|");
  const buscada = clave(carrito);
  const igual = ((data ?? []) as { id: string; numero: number; total: number; items: { producto_id: string | null; cantidad: number }[] }[])
    .find((p) => clave(p.items ?? []) === buscada);
  return igual ? { id: igual.id, etiqueta: `P-${String(igual.numero).padStart(4, "0")}`, total: Number(igual.total) } : null;
}

/** ¿La respuesta dice que un pedido no se registró o que hay que armarlo de nuevo? */
function desdiceUnPedido(t: string): boolean {
  const x = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[*_]/g, "");
  return /no (quedo|fue|se|esta) (confirmad|registrad|guardad|creado)|no se registro|no quedo (confirmad|registrad)|corregir un error|armar(lo|la)? de nuevo|armalo de nuevo/.test(x);
}

function textoCuentas(cuentas: Cuenta[]): string {
  if (!cuentas.length) return "(La tienda no cargó cuentas: decile que en breve le pasan los datos y llamá a pasar_a_humano.)";
  return cuentas
    .map((c) => [c.banco, c.titular && `Titular: ${c.titular}`, c.cuenta && `Cuenta: ${c.cuenta}`, c.documento && `CI/RUC: ${c.documento}`, c.alias && `Alias: ${c.alias}`].filter(Boolean).join("\n"))
    .join("\n\n");
}

// ── "Escribiendo…" ───────────────────────────────────────────────────────────
/**
 * Muestra "escribiendo…" en el chat del cliente mientras el bot piensa. WhatsApp lo apaga solo a los
 * pocos segundos, así que se repite cada 8 s; al mandar el mensaje se apaga igual.
 */
function mostrarEscribiendo(conv: Conv): () => void {
  if (!conv.canal) return () => {};
  const c = conectorPara(conv.canal.proveedor);
  if (!c.escribiendo) return () => {};
  const d = destinoDe(conv);
  void c.escribiendo(d, true);
  const reloj = setInterval(() => void c.escribiendo!(d, true), 8000);
  return () => clearInterval(reloj);
}

// ── Claude ───────────────────────────────────────────────────────────────────
let cliente: Anthropic | null = null;

async function conversar(ctx: Ctx, mensajes: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  cliente ??= new Anthropic({ timeout: 60_000, maxRetries: 2 });
  // Las instrucciones (incluido el estado: categoría, carrito, pedidos) se arman UNA vez por respuesta.
  // Si cambian entre una vuelta de herramientas y la siguiente, la API rechaza el pensamiento de la
  // vuelta anterior ("block is bound to a different conversation") y el bot se queda callado. Lo que
  // cambia durante la respuesta (carrito, pedido creado) ya le llega por el resultado de la herramienta.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: sistemaFijo(ctx.cfg, ctx.categorias), cache_control: { type: "ephemeral" } },
    { type: "text", text: await sistemaEstado(ctx.s, ctx.categorias) },
  ];
  const conversacion = [...mensajes];
  for (let vuelta = 0; vuelta < VUELTAS_HERRAMIENTAS; vuelta++) {
    const r = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools: HERRAMIENTAS,
      messages: conversacion,
    });
    if (r.stop_reason === "refusal") return null;
    const usos = r.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const texto = r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!usos.length || r.stop_reason !== "tool_use") return texto || null;
    // Lo que dijo antes de usar las herramientas sale ya (ej. "Dame un segundo que me fijo").
    if (texto) {
      await enviar(ctx.conv, texto);
      ctx.envios += 1;
    }
    conversacion.push({ role: "assistant", content: r.content });
    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of usos) {
      let res: unknown;
      try {
        res = await ejecutar(ctx, u.name, (u.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        res = { error: (e as Error).message };
      }
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(res), ...(res && typeof res === "object" && "error" in res ? { is_error: true } : {}) });
    }
    conversacion.push({ role: "user", content: resultados });
    await guardarSesion(ctx.s);
    if (ctx.fin) return null;
  }
  return null;
}

// ── Comprobante de transferencia ─────────────────────────────────────────────
async function tomarComprobante(conv: Conv, s: Sesion, e: EntranteVendedor): Promise<void> {
  const mime = (e.media_mime ?? "").split(";")[0].trim().toLowerCase();
  let lectura: unknown = null;
  if (lectorConfigurado() && e.media_path) {
    const { data } = await db().storage.from(CHAT_BUCKET).download(e.media_path);
    if (data) lectura = await leerComprobante(Buffer.from(await data.arrayBuffer()), mime).catch(() => null);
  }
  const { data, error } = await db().rpc("pedido_whatsapp_comprobante", { p_empresa: conv.empresa_id, p_id: s.pedido_id, p_path: e.media_path, p_mime: mime, p_lectura: lectura });
  if (error || !data) {
    console.error("[bot-vendedor] comprobante", error?.message);
    return;
  }
  const ped = data as Pedido;
  s.paso = "charla";
  await guardarSesion(s);
  const l = lectura as { es_comprobante?: boolean; monto?: number | null } | null;
  const aviso = l && l.es_comprobante === false
    ? `Recibí la imagen, pero no parece un comprobante de transferencia. Si ya transferiste, mandame la captura del comprobante del pedido *${ped.etiqueta}*. 🙏`
    : `¡Gracias! Recibimos el comprobante del pedido *${ped.etiqueta}*. Lo verificamos y la tienda te avisa por acá cuando esté listo. 🙌`;
  await enviar(conv, aviso);
}

// ── Entrada ──────────────────────────────────────────────────────────────────
export function botVendedorConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

/**
 * Se llama con cada mensaje que ENTRA a la bandeja (y, por QR, cuando llega el archivo de una foto).
 * Nunca tira: un error del bot no rompe el procesamiento del mensaje.
 */
export async function botVendedor(e: EntranteVendedor): Promise<{ respondio: boolean }> {
  if (!botVendedorConfigurado()) return { respondio: false };
  let convId: string | null = null;
  try {
    const conv = await leerConv(e.conversacion_id);
    if (!conv?.canal?.activo) return { respondio: false };
    const cfg = await configDe(conv);
    if (!cfg) return { respondio: false };

    // Una persona de la empresa escribió en el chat hace poco: el bot no se mete, salvo que después
    // la hayan finalizado (Finalizar en la bandeja le devuelve el chat al bot).
    const { data: humano } = await db()
      .from("chat_mensajes")
      .select("created_at")
      .eq("conversacion_id", conv.id)
      .eq("from_me", true)
      .not("autor_usuario_id", "is", null)
      .neq("tipo", "nota")
      .gte("created_at", new Date(Date.now() - HUMANO_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const ultimoHumano = (humano?.[0] as { created_at: string } | undefined)?.created_at ?? null;
    if (ultimoHumano && !(await finalizadaDespuesDe(conv.id, ultimoHumano))) return { respondio: false };

    const contenido = (e.contenido ?? "").trim();
    // Por QR la foto llega en dos tiempos: primero el cartel "[imagen]" y después el archivo, que vuelve a
    // llamar acá con media_path. Se contesta recién con el archivo (si no, se contestaría dos veces).
    if (!e.media_path && (contenido === "[imagen]" || contenido === "[documento]")) return { respondio: false };

    if (!(await tomarTurno(conv))) return { respondio: false };
    convId = conv.id;
    let s = await leerSesion(conv);
    if (s.paso === "humano") {
      if (Date.now() - Date.parse(s.updated_at) < HUMANO_MS && !(await finalizadaDespuesDe(conv.id, s.updated_at))) return { respondio: false };
      s.paso = "charla";
    }
    if (e.tipo === "ubicacion" && contenido) s.datos.ubicacion = contenido.slice(0, 200);

    // Esperando el comprobante y llegó una foto o un PDF: se toma como comprobante, sin pasar por Claude.
    if (s.paso === "pago" && s.pedido_id && (e.tipo === "imagen" || e.tipo === "documento") && e.media_path) {
      await tomarComprobante(conv, s, e);
      return { respondio: true };
    }
    // La foto con epígrafe ya se contestó cuando llegó el texto: el archivo solo servía como comprobante.
    if (e.archivoTardio && contenido) return { respondio: false };

    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
    if (s.turnos_fecha !== hoy) {
      s.turnos_fecha = hoy;
      s.turnos_dia = 0;
    }
    if (s.turnos_dia >= TURNOS_DIA) {
      await pasarAHumano(conv, s, "Para seguir con tu consulta te paso con una persona del equipo. En breve te responden por acá. 🙌");
      return { respondio: true };
    }

    const categorias = await categoriasVisibles(conv.empresa_id);
    // Mensajes que llegan mientras el bot piensa: se contestan en la vuelta siguiente (hasta 3).
    let respondio = false;
    let atendido: string | null = null;
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const { mensajes, ultimoEntrante } = await historia(conv.id);
      if (!mensajes.length || mensajes[mensajes.length - 1].role !== "user" || ultimoEntrante === atendido) break;
      atendido = ultimoEntrante;
      s.turnos_dia += 1;
      const ctx: Ctx = { conv, cfg, s, categorias, fin: false, envios: 0 };
      const parar = mostrarEscribiendo(conv);
      let respuesta: string | null;
      try {
        respuesta = await conversar(ctx, mensajes);
      } finally {
        parar();
      }
      s = ctx.s;
      if (ctx.fin) return { respondio: true };
      await guardarSesion(s);
      if (respuesta && desdiceUnPedido(respuesta)) {
        // El bot quiso desdecirse de un pedido. Si el chat tiene pedidos registrados, eso es falso:
        // no sale, y en su lugar se confirma el último.
        const [ultimo] = await pedidosDelChat(conv.id);
        if (ultimo && ultimo.estado !== "anulado") {
          console.warn("[bot-vendedor] respuesta que negaba un pedido registrado: no se envió", ultimo.etiqueta);
          respuesta = `Tu pedido *${ultimo.etiqueta}* está registrado ✅ La tienda ya lo tiene y te avisa por acá cuando esté listo. ¡Gracias! 🙌`;
        }
      }
      if (respuesta) {
        await enviar(conv, respuesta);
        respondio = true;
      } else if (ctx.envios > 0) {
        respondio = true;
      } else if (!respondio) {
        await pasarAHumano(conv, s, "Te paso con una persona del equipo para seguir. En breve te responden por acá. 🙌");
        return { respondio: true };
      }
    }
    return { respondio };
  } catch (err) {
    console.error("[bot-vendedor]", (err as Error).message);
    return { respondio: false };
  } finally {
    if (convId) await soltarTurno(convId);
  }
}
