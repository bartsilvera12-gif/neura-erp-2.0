/**
 * Flujos del bot vendedor (receta 173). Compartido cliente/servidor: sin imports de servidor.
 *
 * Un flujo es el guion del bot dibujado como diagrama: pasos (cajas) unidos por flechas. Cada paso
 * tiene un TIPO con una regla técnica fija (cómo usar las herramientas: no se edita, así un texto de
 * la tienda no rompe la venta) y una INSTRUCCIÓN que la tienda escribe. El bot recibe el flujo
 * activo convertido en un guion numerado (`guionDelFlujo`), en el orden de las flechas.
 */

export type TipoPaso =
  | "saludo" | "categoria" | "productos" | "cantidad" | "entrega" | "pago" | "datos" | "confirmar" | "despedida" | "humano" | "mensaje";

export type EstiloFlujo = "menus" | "charla";
export type PasoFlujo = { id: string; tipo: TipoPaso; titulo: string; instruccion: string; activo: boolean; x: number; y: number };
export type ConexionFlujo = { id: string; de: string; a: string };
export type Flujo = { nombre: string; estilo: EstiloFlujo; nodos: PasoFlujo[]; conexiones: ConexionFlujo[] };

/** Catálogo de tipos de paso: nombre, color, la regla técnica fija y la instrucción de arranque. */
export const TIPOS_PASO: Record<TipoPaso, { nombre: string; color: string; regla: string; instruccion: string }> = {
  saludo: {
    nombre: "Saludo", color: "#0f766e", regla: "",
    instruccion: "Saludá con el nombre de la tienda y mostrá las categorías numeradas. Si ya dice lo que busca, pasá directo a esa categoría.",
  },
  categoria: {
    nombre: "Elegir categoría", color: "#2563eb",
    regla: "Cuando elige una categoría (por número o por nombre), llamá a elegir_categoria con el nombre exacto de la lista: desde ahí sos el vendedor de esa categoría y seguís sus instrucciones. Si después quiere otra cosa, cambiá con elegir_categoria.",
    instruccion: "Ofrecé siempre una opción numerada para volver a las categorías.",
  },
  productos: {
    nombre: "Mostrar productos", color: "#7c3aed",
    regla: "Precios, stock y descripciones salen SOLO de las herramientas (elegir_categoria, buscar_productos): nunca inventes un producto, un precio, un descuento ni un plazo. Si el producto tiene foto y ayuda a vender, mandala con enviar_foto.",
    instruccion: "Mostrá los productos numerados, con el precio en la misma línea. Si algo no está, decilo y ofrecé lo más parecido.",
  },
  cantidad: {
    nombre: "Cantidad y carrito", color: "#9333ea",
    regla: "Con agregar_al_carrito armás el pedido; nunca agregues más unidades que el stock que muestra la herramienta.",
    instruccion: "Preguntá simplemente \"¿Cuántas querés?\" (sin lista: el cliente escribe el número). Después ofrecé: seguir comprando, ver otra categoría o terminar el pedido.",
  },
  entrega: {
    nombre: "Envío o retiro", color: "#ea580c",
    regla: "Solo las opciones de entrega de la tienda. Si es envío, hace falta la dirección (sirve la ubicación de WhatsApp).",
    instruccion: "Preguntá si prefiere envío o retiro, con el costo del envío tal como figura.",
  },
  pago: {
    nombre: "Forma de pago", color: "#ca8a04",
    regla: "Solo las formas de pago de la tienda.",
    instruccion: "Preguntá cómo paga.",
  },
  datos: {
    nombre: "Nombre del cliente", color: "#0891b2", regla: "",
    instruccion: "Pedí el nombre de quien recibe o retira el pedido.",
  },
  confirmar: {
    nombre: "Resumen y confirmar", color: "#16a34a",
    regla: "Antes de confirmar tenés que tener el nombre, envío o retiro (y la dirección si es envío) y la forma de pago, aunque no haya un paso para cada cosa. Recién cuando el cliente elige confirmar, llamá a confirmar_pedido. Si paga por transferencia, pasale los datos de la cuenta y pedile la foto del comprobante.",
    instruccion: "Mostrá el resumen con el total y ofrecé *1* · Confirmar pedido, *2* · Cambiar algo.",
  },
  despedida: {
    nombre: "Despedida", color: "#64748b", regla: "",
    instruccion: "Si agradece o se despide, despedite corto y cordial.",
  },
  humano: {
    nombre: "Pasar a una persona", color: "#dc2626",
    regla: "Llamá a pasar_a_humano.",
    instruccion: "Si pide hablar con una persona, se queja, o pregunta algo que las herramientas no responden (garantías, cambios, mayoristas, factura con RUC).",
  },
  mensaje: { nombre: "Paso libre", color: "#475569", regla: "", instruccion: "" },
};

export const ESTILOS: Record<EstiloFlujo, { nombre: string; texto: string }> = {
  menus: {
    nombre: "Menús numerados",
    texto:
      "Menús numerados: el cliente no tiene que escribir frases. Cada vez que le ofrezcas opciones (categorías, productos, talle o color, envío o retiro, forma de pago, confirmar o cambiar; la cantidad no: esa la escribe el cliente), mostralas numeradas, una por línea, así: *1* · Remeras. Máximo 10 opciones; terminá con una línea corta como \"Respondé con el número 👇\". Si el cliente responde solo un número, es la opción con ese número de TU último mensaje con opciones. Igual aceptá que escriba con sus palabras, aunque esté mal escrito o sin tildes (\"remra\", \"pantalon\", \"zapatiyas\"): entendé a qué se refiere.",
  },
  charla: {
    nombre: "Charla natural",
    texto:
      "Conversación natural, como un buen vendedor de mostrador por WhatsApp: mensajes cortos, una sola pregunta por mensaje, sin formularios. Usá listas numeradas solo para mostrar productos (máximo 5) o cuando el cliente duda entre opciones; el resto, preguntá con naturalidad. Si el cliente ya te dio un dato (talle, dirección, nombre, forma de pago), no se lo vuelvas a pedir. Entendé lo que escribe aunque esté mal escrito o sin tildes. Si responde solo un número, es la opción con ese número de tu último mensaje con opciones.",
  },
};

// ── Flujos de fábrica ────────────────────────────────────────────────────────
const paso = (id: string, tipo: TipoPaso, x: number, y: number, instruccion?: string, titulo?: string): PasoFlujo => ({
  id, tipo, titulo: titulo ?? TIPOS_PASO[tipo].nombre, instruccion: instruccion ?? TIPOS_PASO[tipo].instruccion, activo: true, x, y,
});
const cadena = (ids: string[]): ConexionFlujo[] => ids.slice(1).map((a, i) => ({ id: `c-${ids[i]}-${a}`, de: ids[i], a }));

/** El guion con el que salió el bot (menús numerados, paso a paso). */
export const FLUJO_ORIGINAL: Flujo = acomodar({
  nombre: "Venta con menús",
  estilo: "menus",
  nodos: [
    paso("saludo", "saludo", 0, 0),
    paso("categoria", "categoria", 300, 0),
    paso("productos", "productos", 600, 0),
    paso("cantidad", "cantidad", 900, 0),
    paso("entrega", "entrega", 900, 220, "Preguntá, de a una cosa por mensaje y con opciones numeradas: envío o retiro, y la dirección si es envío."),
    paso("pago", "pago", 600, 220, "Preguntá la forma de pago, numerada."),
    paso("datos", "datos", 300, 220),
    paso("confirmar", "confirmar", 0, 220),
    paso("despedida", "despedida", 0, 440),
    paso("humano", "humano", 600, 440),
  ],
  conexiones: cadena(["saludo", "categoria", "productos", "cantidad", "entrega", "pago", "datos", "confirmar", "despedida"]),
});

/** Un guion de charla más natural: entiende qué busca, recomienda y cierra en una sola pregunta. */
export const FLUJO_FLUIDO: Flujo = acomodar({
  nombre: "Charla fluida",
  estilo: "charla",
  nodos: [
    paso("saludo", "saludo", 0, 0, "Saludá cálido, con el nombre de la tienda, y preguntá qué anda buscando. No listes las categorías de entrada: solo si pregunta qué hay o no sabe qué quiere."),
    paso("necesidad", "categoria", 300, 0, "Entendé qué busca con una o dos preguntas cortas (para quién es, para qué lo usa, talle o número) y elegí vos la categoría. No preguntes lo que ya dijo.", "Entender qué busca"),
    paso("recomendar", "productos", 600, 0, "Recomendá 2 o 3 productos que encajen, cada uno con una razón corta (\"es el más vendido\", \"aguanta todo el día\"). Si tiene foto, mandá la del que más le sirve.", "Recomendar"),
    paso("carrito", "cantidad", 900, 0, "Cuando elige, preguntá cuántas solo si no lo dijo y agregalo. Ofrecé un complemento que tenga sentido, una sola vez y sin insistir; después preguntá si cerramos.", "Agregar y sugerir"),
    paso("cierre", "entrega", 900, 220, "Para cerrar preguntá en un solo mensaje, natural: si se lo enviamos o lo retira, cómo paga y a nombre de quién. Pedí solo lo que falte; si es envío, la dirección o la ubicación.", "Datos para cerrar"),
    paso("confirmar", "confirmar", 600, 220, "Mostrá un resumen corto con el total y preguntá \"¿Lo confirmo?\". Si dice que sí (\"dale\", \"sí\", \"ok\"), confirmalo."),
    paso("despedida", "despedida", 300, 220, "Agradecé por el nombre, recordale el número de pedido una sola vez y despedite. Si escribe de nuevo, retomá con naturalidad."),
    paso("humano", "humano", 600, 440),
  ],
  conexiones: cadena(["saludo", "necesidad", "recomendar", "carrito", "cierre", "confirmar", "despedida"]),
});

export const PLANTILLAS: { clave: string; flujo: Flujo; descripcion: string }[] = [
  { clave: "original", flujo: FLUJO_ORIGINAL, descripcion: "El guion actual: cada elección con opciones numeradas." },
  { clave: "fluido", flujo: FLUJO_FLUIDO, descripcion: "Conversación natural: entiende qué busca, recomienda y cierra en una sola pregunta." },
];

// ── Del diagrama al guion ────────────────────────────────────────────────────
/**
 * Orden de los pasos según las flechas: desde el saludo (o el primer paso sin flechas que lleguen),
 * en anchura. Los pasos apagados no se cuentan, pero sus flechas sí se siguen (apagar un paso del
 * medio no corta el flujo). Lo que no se alcanza queda como "en cualquier momento".
 */
export function ordenDelFlujo(f: Pick<Flujo, "nodos" | "conexiones">): { orden: PasoFlujo[]; sueltos: PasoFlujo[]; recorrido: PasoFlujo[] } {
  const porId = new Map(f.nodos.map((n) => [n.id, n]));
  const salen = new Map<string, string[]>();
  const entran = new Set<string>();
  for (const c of f.conexiones) {
    if (!porId.has(c.de) || !porId.has(c.a)) continue;
    salen.set(c.de, [...(salen.get(c.de) ?? []), c.a]);
    entran.add(c.a);
  }
  const inicio = f.nodos.find((n) => n.tipo === "saludo" && n.activo) ?? f.nodos.find((n) => !entran.has(n.id) && (salen.get(n.id)?.length ?? 0) > 0);
  const vistos = new Set<string>();
  const orden: PasoFlujo[] = [];
  const recorrido: PasoFlujo[] = [];
  const cola = inicio ? [inicio.id] : [];
  while (cola.length) {
    const id = cola.shift()!;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const n = porId.get(id)!;
    recorrido.push(n);
    if (n.activo) orden.push(n);
    for (const sig of salen.get(id) ?? []) cola.push(sig);
  }
  const sueltos = f.nodos.filter((n) => n.activo && !vistos.has(n.id));
  return { orden, sueltos, recorrido };
}

/**
 * Acomoda las cajas para que el flujo se lea como un texto: en el orden de las flechas, de izquierda
 * a derecha y en filas de 4. Abajo, aparte, los pasos sueltos ("en cualquier momento") y los apagados
 * que no están en el recorrido.
 */
export function acomodar<T extends Pick<Flujo, "nodos" | "conexiones">>(f: T): T {
  const { recorrido } = ordenDelFlujo(f);
  const enRecorrido = new Set(recorrido.map((n) => n.id));
  const resto = f.nodos.filter((n) => !enRecorrido.has(n.id));
  const pos = new Map<string, { x: number; y: number }>();
  recorrido.forEach((n, i) => pos.set(n.id, { x: (i % 4) * 300, y: Math.floor(i / 4) * 230 }));
  const filaResto = Math.ceil(recorrido.length / 4) + 0.3;
  resto.forEach((n, i) => pos.set(n.id, { x: (i % 4) * 300, y: Math.round((filaResto + Math.floor(i / 4)) * 230) }));
  return { ...f, nodos: f.nodos.map((n) => ({ ...n, ...pos.get(n.id)! })) };
}

/** Siguientes pasos activos de un paso (saltando los apagados). */
function siguientes(f: Pick<Flujo, "nodos" | "conexiones">, id: string, vistos = new Set<string>()): PasoFlujo[] {
  const porId = new Map(f.nodos.map((n) => [n.id, n]));
  const out: PasoFlujo[] = [];
  for (const c of f.conexiones.filter((x) => x.de === id)) {
    const n = porId.get(c.a);
    if (!n || vistos.has(n.id)) continue;
    vistos.add(n.id);
    if (n.activo) out.push(n);
    else out.push(...siguientes(f, n.id, vistos));
  }
  return out;
}

/** El flujo convertido en el guion numerado que lee el bot. */
export function guionDelFlujo(f: Flujo): string {
  const { orden, sueltos } = ordenDelFlujo(f);
  const num = new Map(orden.map((n, i) => [n.id, i + 1]));
  const linea = (n: PasoFlujo, prefijo: string) => {
    const t = TIPOS_PASO[n.tipo] ?? TIPOS_PASO.mensaje;
    const sig = siguientes(f, n.id).filter((x) => num.has(x.id));
    return [
      `${prefijo} ${n.titulo.trim() || t.nombre}: ${n.instruccion.trim()}`.trim(),
      t.regla ? `   (Regla fija: ${t.regla})` : "",
      sig.length ? `   → Después: ${sig.map((x) => `paso ${num.get(x.id)} (${x.titulo.trim() || TIPOS_PASO[x.tipo].nombre})`).join(" o ")}.` : "",
    ].filter(Boolean).join("\n");
  };
  const partes = [ESTILOS[f.estilo]?.texto ?? ESTILOS.menus.texto, "", "Guion de la conversación (seguilo en este orden; si el cliente ya resolvió un paso, salteálo):"];
  orden.forEach((n, i) => partes.push(linea(n, `${i + 1}.`)));
  if (sueltos.length) {
    partes.push("", "En cualquier momento de la charla:");
    sueltos.forEach((n) => partes.push(linea(n, "-")));
  }
  // Lo mínimo para poder vender, aunque la tienda haya borrado o apagado esos pasos.
  const tipos = new Set([...orden, ...sueltos].map((n) => n.tipo));
  const faltan: string[] = [];
  if (!tipos.has("productos")) faltan.push(TIPOS_PASO.productos.regla);
  if (!tipos.has("cantidad")) faltan.push(TIPOS_PASO.cantidad.regla);
  if (!tipos.has("confirmar")) faltan.push(TIPOS_PASO.confirmar.regla);
  if (!tipos.has("humano")) faltan.push(`Si pide hablar con una persona o se queja: ${TIPOS_PASO.humano.regla}`);
  if (faltan.length) partes.push("", "Siempre:", ...faltan.map((r) => `- ${r}`));
  return partes.join("\n");
}

/** Avisos para la pantalla (no impiden guardar). */
export function avisosDelFlujo(f: Pick<Flujo, "nodos" | "conexiones">): string[] {
  const { orden, sueltos } = ordenDelFlujo(f);
  const avisos: string[] = [];
  if (!f.nodos.some((n) => n.tipo === "saludo" && n.activo)) avisos.push("No hay un Saludo prendido: el flujo arranca en el primer paso sin flechas que lleguen.");
  if (!orden.some((n) => n.tipo === "confirmar")) avisos.push("Ningún paso de Resumen y confirmar en el recorrido: el bot igual va a poder confirmar, pero sin tu texto.");
  const sinLlegar = sueltos.filter((n) => n.tipo !== "humano" && n.tipo !== "despedida");
  if (sinLlegar.length) avisos.push(`Pasos sin flechas que lleguen (el bot los usa "en cualquier momento"): ${sinLlegar.map((n) => n.titulo).join(", ")}.`);
  return avisos;
}
