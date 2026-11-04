/**
 * Bot de venta de Sorteos por WhatsApp (receta 125). Solo servidor (service_role).
 *
 * Se engancha a los mensajes que ENTRAN a la bandeja (webhook del proveedor y simuladores). Atiende el
 * chat si la empresa tiene Sorteos y el bot prendidos, el canal es el elegido y nadie de la empresa
 * escribió en ese chat en las últimas 12 h. Pasos: elegir sorteo → cantidad (combos) → nombre → cédula → ciudad → confirmar →
 * reserva y datos para transferir → foto del comprobante → lectura automática → ticket o revisión.
 * En cualquier momento: MENU, MIS NUMEROS, CANCELAR, ASESOR.
 *
 * La venta y el chequeo del comprobante son funciones de la base (sorteo_orden_registrar,
 * sorteo_bot_comprobante): acá solo se conversa. Lo que el bot escribe queda en el chat como mensaje
 * saliente sin autor (lo ven los asesores en la bandeja).
 */
import { randomUUID } from "node:crypto";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { conectorPara, type DestinoChat } from "@/modules/conversaciones/conectores";
import { leerComprobante, type LecturaComprobante } from "@/lib/sorteos/lector-comprobante";

// ── Tipos ────────────────────────────────────────────────────────────────────
type Paso = "inicio" | "sorteo" | "cantidad" | "nombre" | "documento" | "ciudad" | "confirmar" | "pago" | "revision" | "humano";
type Datos = {
  nombre?: string;
  documento?: string;
  ciudad?: string;
  cantidad?: number;
  vendedor?: string;
  anuncio?: { id: string; titulo: string | null };
  opciones?: number[];
  sorteos?: string[];
};
type Sesion = { conversacion_id: string; empresa_id: string; sorteo_id: string | null; paso: Paso; datos: Datos; orden_id: string | null; updated_at: string };

type Conv = {
  id: string;
  empresa_id: string;
  asignado_id: string | null;
  ventana_expira_at: string | null;
  etiquetas: string[] | null;
  canal: { id: string; tipo: string; proveedor: string; identificador: string | null; activo: boolean } | null;
  contacto: { telefono: string | null; nombre: string | null; externo_id: string | null } | null;
};

type CuentaPago = { banco?: string; titular?: string; cuenta?: string; documento?: string; alias?: string };
type Combo = { cantidad: number; precio: number; etiqueta: string | null; orden: number; activo: boolean };
type SorteoBot = {
  id: string;
  nombre: string;
  slug: string;
  descripcion: string | null;
  precio: number;
  max_por_compra: number | null;
  reserva_minutos: number;
  fecha_sorteo: string | null;
  datos_pago: CuentaPago[];
  combos: Combo[];
};

type OrdenJson = {
  id: string;
  numero: number;
  token: string;
  sorteo: string;
  sorteo_id: string;
  estado: string;
  cantidad: number;
  monto: number;
  comprador_nombre: string;
  numeros: string[];
  vence_at: string | null;
  motivo: string | null;
  conversacion_id?: string | null;
  resultado?: "confirmada" | "revision" | "repetido" | "vencida" | "estado";
  mensaje_ticket?: string | null;
};

export type EntranteBot = {
  conversacion_id: string;
  mensaje_id: string;
  tipo: string;
  contenido: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  /** Anuncio de Meta (Click-to-WhatsApp) que trajo al cliente: queda en la compra. */
  anuncio?: { id: string; titulo: string | null } | null;
};

export type OpcionesBot = {
  /** URL pública del sistema (links a la compra y a la página del sorteo). */
  base: string;
  /** Simulador: lectura del comprobante escrita a mano (salta el lector). undefined = leer de verdad. */
  lecturaSimulada?: LecturaComprobante | null;
};

const HUMANO_MS = 12 * 60 * 60 * 1000;
const TIPOS_COMPROBANTE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

const gs = (n: number) => `Gs ${Math.round(Number(n) || 0).toLocaleString("es-PY")}`;
const plano = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const primerNombre = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] ?? "";
const db = () => systemClient();

// ── Lecturas ─────────────────────────────────────────────────────────────────
async function leerConv(id: string): Promise<Conv | null> {
  const { data } = await db()
    .from("chat_conversaciones")
    .select(
      "id, empresa_id, asignado_id, ventana_expira_at, etiquetas, canal:chat_canales!canal_id(id, tipo, proveedor, identificador, activo), contacto:chat_contactos!contacto_id(telefono, nombre, externo_id)",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Conv | null) ?? null;
}

async function botActivo(conv: Conv): Promise<{ bienvenida: string | null } | null> {
  if (!conv.canal || conv.canal.tipo !== "whatsapp") return null;
  const [cfg, fun] = await Promise.all([
    db().from("sorteo_bot_config").select("activo, canal_id, bienvenida").eq("empresa_id", conv.empresa_id).maybeSingle(),
    db().from("empresa_funciones").select("sorteos").eq("empresa_id", conv.empresa_id).maybeSingle(),
  ]);
  const c = cfg.data as { activo: boolean; canal_id: string | null; bienvenida: string | null } | null;
  if (!c?.activo || (c.canal_id && c.canal_id !== conv.canal.id)) return null;
  if (!(fun.data as { sorteos?: boolean } | null)?.sorteos) return null;
  return { bienvenida: c.bienvenida };
}

async function leerSesion(conv: Conv): Promise<Sesion> {
  const { data } = await db().from("sorteo_bot_sesiones").select("*").eq("conversacion_id", conv.id).maybeSingle();
  return (
    (data as Sesion | null) ?? {
      conversacion_id: conv.id, empresa_id: conv.empresa_id, sorteo_id: null, paso: "inicio", datos: {}, orden_id: null, updated_at: new Date().toISOString(),
    }
  );
}

async function guardarSesion(s: Sesion) {
  const { error } = await db()
    .from("sorteo_bot_sesiones")
    .upsert({ conversacion_id: s.conversacion_id, empresa_id: s.empresa_id, sorteo_id: s.sorteo_id, paso: s.paso, datos: s.datos, orden_id: s.orden_id, updated_at: new Date().toISOString() });
  if (error) console.error("[sorteos/bot] sesión", error.message);
}

/** Vuelve al principio conservando los datos del comprador (para no pedirlos otra vez). */
function reiniciar(s: Sesion) {
  s.paso = "inicio";
  s.sorteo_id = null;
  s.orden_id = null;
  s.datos = { nombre: s.datos.nombre, documento: s.datos.documento, ciudad: s.datos.ciudad, vendedor: s.datos.vendedor, anuncio: s.datos.anuncio };
}

async function sorteosALaVenta(empresaId: string): Promise<SorteoBot[]> {
  const { data, error } = await db()
    .from("sorteos")
    .select("id, nombre, slug, descripcion, precio, max_por_compra, reserva_minutos, fecha_sorteo, datos_pago, combos:sorteo_combos(cantidad, precio, etiqueta, orden, activo)")
    .eq("empresa_id", empresaId)
    .eq("estado", "activo")
    .order("activado_at", { ascending: false })
    .limit(9);
  if (error) console.error("[sorteos/bot] sorteos", error.message);
  return ((data ?? []) as unknown as SorteoBot[]).map((s) => ({
    ...s,
    precio: Number(s.precio),
    datos_pago: Array.isArray(s.datos_pago) ? s.datos_pago : [],
    combos: (s.combos ?? []).filter((c) => c.activo).map((c) => ({ ...c, precio: Number(c.precio) })).sort((a, b) => a.orden - b.orden || a.cantidad - b.cantidad),
  }));
}

async function libres(sorteoId: string): Promise<number> {
  const { count } = await db().from("sorteo_numeros").select("numero", { count: "exact", head: true }).eq("sorteo_id", sorteoId).eq("estado", "libre");
  return count ?? 0;
}

async function ordenJson(id: string): Promise<OrdenJson | null> {
  const { data } = await db().rpc("sorteo_orden_json", { p_orden: id });
  return (data as OrdenJson | null) ?? null;
}

// ── Envío ────────────────────────────────────────────────────────────────────
async function enviar(conv: Conv, textos: string[]) {
  if (!conv.canal) return;
  const destino: DestinoChat = {
    canal: { id: conv.canal.id, tipo: conv.canal.tipo, proveedor: conv.canal.proveedor, identificador: conv.canal.identificador },
    telefono: conv.contacto?.telefono ?? null,
    externoContacto: conv.contacto?.externo_id ?? null,
  };
  for (const contenido of textos.filter((t) => t.trim())) {
    const { data, error } = await db()
      .from("chat_mensajes")
      .insert({ empresa_id: conv.empresa_id, conversacion_id: conv.id, from_me: true, tipo: "texto", contenido, estado_entrega: "pendiente" })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[sorteos/bot] guardar mensaje", error?.message);
      continue;
    }
    let estado = "enviado";
    let externo: string | null = null;
    let fallo: string | null = null;
    try {
      externo = (await conectorPara(conv.canal.proveedor).enviarTexto(destino, contenido)).externo_id;
      if (conv.canal.proveedor === "simulador") estado = "entregado";
    } catch (e) {
      estado = "fallido";
      fallo = (e as Error).message || "No se pudo enviar";
    }
    await db().from("chat_mensajes").update({ estado_entrega: estado, externo_id: externo, error: fallo }).eq("id", (data as { id: string }).id);
  }
}

// ── Textos ───────────────────────────────────────────────────────────────────
function opcionesDe(s: SorteoBot): { cantidad: number; precio: number; etiqueta: string | null }[] {
  const tope = s.max_por_compra ?? Infinity;
  const suelta = (n: number) => ({ cantidad: n, precio: n * s.precio, etiqueta: null, orden: -1, activo: true });
  // Con combos: la boleta suelta primero (si no hay combo de 1) y los combos en su orden.
  const base = s.combos.length
    ? [...(s.combos.some((c) => c.cantidad === 1) ? [] : [suelta(1)]), ...s.combos]
    : [1, 2, 3, 5, 10].map(suelta);
  return base.filter((c) => c.cantidad <= tope).slice(0, 9).map((c) => ({ cantidad: c.cantidad, precio: c.precio, etiqueta: c.etiqueta }));
}

function precioDe(s: SorteoBot, cantidad: number) {
  return s.combos.find((c) => c.cantidad === cantidad)?.precio ?? cantidad * s.precio;
}

function textoOferta(s: SorteoBot, base: string): string {
  const ops = opcionesDe(s);
  const lineas = [`🎟️ *${s.nombre}*`];
  if (s.descripcion) lineas.push(s.descripcion.slice(0, 300));
  if (s.fecha_sorteo) {
    lineas.push(`📅 Sorteo: ${new Date(s.fecha_sorteo).toLocaleString("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`);
  }
  lineas.push(`Cada boleta: ${gs(s.precio)}`, "", "¿Cuántas boletas querés?");
  ops.forEach((o, i) => {
    const lista = o.cantidad * s.precio;
    const ahorro = lista > o.precio ? ` (ahorrás ${gs(lista - o.precio)})` : "";
    lineas.push(`*${i + 1}* · ${o.cantidad} boleta${o.cantidad === 1 ? "" : "s"} — ${gs(o.precio)}${ahorro}`);
  });
  lineas.push("", "Respondé con el número de la opción, o escribí la cantidad (por ejemplo: *7 boletas*).");
  if (base) lineas.push(`También podés comprar desde la web: ${base}/s/${s.slug}`);
  return lineas.join("\n");
}

function textoResumen(s: SorteoBot, d: Datos): string {
  const doc = d.documento ? ` · CI ${Number(d.documento).toLocaleString("es-PY")}` : "";
  return [
    "Revisá tu pedido:",
    `• Sorteo: *${s.nombre}*`,
    `• ${d.cantidad} boleta${d.cantidad === 1 ? "" : "s"} — *${gs(precioDe(s, d.cantidad ?? 1))}*`,
    `• A nombre de: ${d.nombre}${doc}${d.ciudad ? ` · ${d.ciudad}` : ""}`,
    "",
    "*1* · Confirmar y reservar mis números",
    "*2* · Cambiar mis datos",
    "*3* · Cancelar",
  ].join("\n");
}

function textoCuentas(cuentas: CuentaPago[]): string {
  return cuentas
    .map((c) =>
      [
        c.banco ? `🏦 *${c.banco}*` : null,
        c.titular ? `Titular: ${c.titular}` : null,
        c.cuenta ? `Cuenta: ${c.cuenta}` : null,
        c.documento ? `RUC/CI: ${c.documento}` : null,
        c.alias ? `Alias: ${c.alias}` : null,
      ].filter(Boolean).join("\n"),
    )
    .join("\n\n");
}

function textoTicket(o: OrdenJson, base: string, mensaje?: string | null): string {
  const nums = o.numeros ?? [];
  const muestra = nums.slice(0, 40).map((n) => `*${n}*`).join(" · ");
  const resto = nums.length > 40 ? ` y ${nums.length - 40} más (todos en tu ticket)` : "";
  return [
    `🎉 ¡Pago confirmado${primerNombre(o.comprador_nombre) ? `, ${primerNombre(o.comprador_nombre)}` : ""}!`,
    `Compra N° ${o.numero} · ${o.sorteo}`,
    `${nums.length === 1 ? "Tu número" : "Tus números"}: ${muestra}${resto}`,
    mensaje ? `\n${mensaje}` : "",
    base ? `\nTu ticket: ${base}/t/${o.token}` : "",
    "\n¡Mucha suerte! 🍀",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

const AYUDA = "Escribí *MENU* para empezar de nuevo o *ASESOR* para hablar con una persona.";

// ── Pasos ────────────────────────────────────────────────────────────────────
function parsearCantidad(t: string, opciones: number[]): number | null {
  const conPalabra = t.match(/(\d[\d.]*)\s*(boletas?|numeros?|tickets?|cupones?|rifas?|entradas?)/);
  if (conPalabra) return Number(conPalabra[1].replace(/\./g, "")) || null;
  const solo = t.match(/^(\d{1,6})$/);
  if (!solo) return null;
  const n = Number(solo[1]);
  return n >= 1 && n <= opciones.length ? opciones[n - 1] : n;
}

async function compradorConocido(empresaId: string, telefono: string | null): Promise<Pick<Datos, "nombre" | "documento" | "ciudad"> | null> {
  if (!telefono) return null;
  const { data } = await db()
    .from("sorteo_ordenes")
    .select("comprador_nombre, comprador_documento, comprador_ciudad")
    .eq("empresa_id", empresaId)
    .eq("comprador_telefono", telefono.replace(/\D/g, ""))
    .order("created_at", { ascending: false })
    .limit(1);
  const f = (data?.[0] ?? null) as { comprador_nombre: string; comprador_documento: string | null; comprador_ciudad: string | null } | null;
  return f?.comprador_documento ? { nombre: f.comprador_nombre, documento: f.comprador_documento, ciudad: f.comprador_ciudad ?? undefined } : null;
}

async function vendedorPorCodigo(empresaId: string, codigo: string): Promise<string | null> {
  const { data } = await db().from("sorteo_vendedores").select("id").eq("empresa_id", empresaId).eq("codigo", codigo.toUpperCase()).eq("activo", true).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const mensajeBase = (m: string | undefined) => {
  const t = (m ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  return !t || /syntax|relation|column|function .* does not exist|permission denied|violates/i.test(t) ? null : t;
};

/** Atiende un mensaje entrante. Nunca tira: un error del bot no puede romper el webhook. */
export async function botSorteos(e: EntranteBot, opciones: OpcionesBot): Promise<{ respondio: boolean }> {
  try {
    return await atender(e, opciones);
  } catch (err) {
    console.error("[sorteos/bot]", (err as Error).message);
    return { respondio: false };
  }
}

async function atender(e: EntranteBot, op: OpcionesBot): Promise<{ respondio: boolean }> {
  const conv = await leerConv(e.conversacion_id);
  if (!conv) return { respondio: false };
  const cfg = await botActivo(conv);
  if (!cfg) return { respondio: false };
  // Una persona de la empresa escribió en el chat hace poco: el bot no se mete. (La asignación sola no
  // cuenta: las colas reparten los chats nuevos a un asesor apenas entran.)
  const { data: humano } = await db()
    .from("chat_mensajes")
    .select("id")
    .eq("conversacion_id", conv.id)
    .eq("from_me", true)
    .not("autor_usuario_id", "is", null)
    .neq("tipo", "nota")
    .gte("created_at", new Date(Date.now() - HUMANO_MS).toISOString())
    .limit(1);
  if (humano?.length) return { respondio: false };

  const s = await leerSesion(conv);
  if (s.paso === "humano") {
    if (Date.now() - Date.parse(s.updated_at) < HUMANO_MS) return { respondio: false };
    reiniciar(s);
  }

  const salida: string[] = [];
  const texto = (e.contenido ?? "").trim();
  const t = plano(texto);
  const media = (e.tipo === "imagen" || e.tipo === "documento") && !!e.media_path;
  const tel = conv.contacto?.telefono ?? null;

  // Código de vendedor en el primer mensaje ("ref ABC123", del link de WhatsApp del vendedor).
  const ref = texto.match(/\b(?:ref|codigo|código|vendedor)[:\s#-]*([A-Za-z0-9]{3,20})\b/i);
  if (ref && (await vendedorPorCodigo(conv.empresa_id, ref[1]))) s.datos.vendedor = ref[1].toUpperCase();
  // El anuncio que trajo al cliente (llega en el primer mensaje): queda para la compra.
  if (e.anuncio?.id) s.datos.anuncio = { id: e.anuncio.id.slice(0, 120), titulo: e.anuncio.titulo?.slice(0, 200) ?? null };

  // ── Comandos que valen en cualquier paso ──
  if (/^(asesor|humano|persona|operador|atencion|hablar con (alguien|una persona))\b/.test(t)) {
    s.paso = "humano";
    salida.push("Listo, te paso con una persona del equipo. En breve te responden por acá. 🙌");
    const etiquetas = new Set(conv.etiquetas ?? []);
    etiquetas.add("Pide asesor");
    await db().from("chat_conversaciones").update({ etiquetas: [...etiquetas], updated_at: new Date().toISOString() }).eq("id", conv.id);
    await guardarSesion(s);
    await enviar(conv, salida);
    return { respondio: true };
  }
  if (/^mis (numeros|boletas|compras|tickets|cupones)\b/.test(t)) {
    const { data } = await db().rpc("sorteo_bot_mis_compras", { p_empresa: conv.empresa_id, p_telefono: tel ?? "" });
    const compras = (data ?? []) as OrdenJson[];
    salida.push(
      compras.length
        ? ["Tus compras:", ...compras.map((o) =>
            `• N° ${o.numero} · ${o.sorteo}: ${o.estado === "confirmada" ? (o.numeros ?? []).slice(0, 20).join(", ") + ((o.numeros ?? []).length > 20 ? "…" : "") : o.estado === "en_revision" ? "pago en revisión" : "esperando el pago"}${op.base && o.estado === "confirmada" ? `\n  ${op.base}/t/${o.token}` : ""}`)].join("\n")
        : "No encontramos compras con este número de WhatsApp.",
    );
    await guardarSesion(s);
    await enviar(conv, salida);
    return { respondio: true };
  }
  if (/^cancelar\b/.test(t)) {
    if (s.orden_id && s.paso === "pago") {
      const { error } = await db().rpc("sorteo_orden_baja", {
        p_empresa: conv.empresa_id, p_id: s.orden_id, p_usuario: null, p_estado: "anulada", p_motivo: "Cancelada por el cliente por WhatsApp",
      });
      salida.push(error ? "No pudimos cancelar la compra. " + AYUDA : "Listo, cancelamos tu compra y liberamos los números.");
    } else {
      salida.push("Listo, cancelado.");
    }
    reiniciar(s);
    salida.push("Cuando quieras comprar, escribí *MENU*.");
    await guardarSesion(s);
    await enviar(conv, salida);
    return { respondio: true };
  }
  const pideMenu = /^(menu|inicio|empezar|volver|comprar|0)$/.test(t);
  if (pideMenu && s.paso !== "pago" && s.paso !== "revision") reiniciar(s);

  // ── Pasos ──
  const sorteos = await sorteosALaVenta(conv.empresa_id);
  const sorteo = sorteos.find((x) => x.id === s.sorteo_id) ?? null;
  if (s.sorteo_id && !sorteo && s.paso !== "pago" && s.paso !== "revision") {
    salida.push("Ese sorteo ya no está a la venta.");
    reiniciar(s);
  }

  switch (s.paso) {
    case "inicio":
    case "sorteo": {
      if (!sorteos.length) {
        salida.push(cfg.bienvenida ?? "¡Hola! Gracias por escribirnos.", "Por ahora no tenemos sorteos a la venta. Te avisamos cuando arranque el próximo. 🙌");
        reiniciar(s);
        break;
      }
      let elegido: SorteoBot | null = null;
      if (s.paso === "sorteo") {
        const n = Number(t.match(/^(\d)$/)?.[1] ?? 0);
        const id = s.datos.sorteos?.[n - 1];
        elegido = sorteos.find((x) => x.id === id) ?? null;
        if (!elegido) {
          salida.push("Respondé con el número del sorteo que te interesa. " + AYUDA);
          break;
        }
      } else {
        const nombre = primerNombre(s.datos.nombre ?? conv.contacto?.nombre);
        salida.push(cfg.bienvenida ?? `¡Hola${nombre ? ` ${nombre}` : ""}! 👋 Gracias por escribirnos.`);
        if (media) salida.push("Si ya pagaste una compra, escribí *ASESOR* y una persona la revisa.");
        if (sorteos.length === 1) elegido = sorteos[0];
        else {
          s.paso = "sorteo";
          s.datos.sorteos = sorteos.map((x) => x.id);
          salida.push(["Estos son nuestros sorteos a la venta:", ...sorteos.map((x, i) => `*${i + 1}* · ${x.nombre} — ${gs(x.precio)} la boleta`), "", "¿Cuál te interesa? Respondé con el número."].join("\n"));
          break;
        }
      }
      s.sorteo_id = elegido.id;
      s.paso = "cantidad";
      s.datos.opciones = opcionesDe(elegido).map((o) => o.cantidad);
      salida.push(textoOferta(elegido, op.base));
      break;
    }

    case "cantidad": {
      if (!sorteo) break;
      const n = parsearCantidad(t, s.datos.opciones ?? []);
      if (!n || n < 1) {
        salida.push("Decime cuántas boletas querés: respondé con el número de la opción o escribí, por ejemplo, *7 boletas*.");
        break;
      }
      if (sorteo.max_por_compra && n > sorteo.max_por_compra) {
        salida.push(`El máximo por compra es ${sorteo.max_por_compra} boleta${sorteo.max_por_compra === 1 ? "" : "s"}. Elegí una cantidad menor.`);
        break;
      }
      const disp = await libres(sorteo.id);
      if (n > disp) {
        salida.push(disp ? `Quedan ${disp} boleta${disp === 1 ? "" : "s"} disponibles. Elegí una cantidad menor.` : "¡Se agotaron las boletas de este sorteo! 🙏");
        if (!disp) reiniciar(s);
        break;
      }
      s.datos.cantidad = n;
      if (!s.datos.documento) {
        const conocido = await compradorConocido(conv.empresa_id, tel);
        if (conocido) Object.assign(s.datos, conocido);
      }
      if (s.datos.nombre && s.datos.documento) {
        s.paso = "confirmar";
        salida.push(textoResumen(sorteo, s.datos));
      } else {
        s.paso = "nombre";
        salida.push(`${n} boleta${n === 1 ? "" : "s"} por ${gs(precioDe(sorteo, n))}. 👍`, "¿A nombre de quién van? Escribí *nombre y apellido*.");
      }
      break;
    }

    case "nombre": {
      const nombre = texto.replace(/\s+/g, " ").trim();
      if (media || nombre.length < 3 || !/[a-zA-ZÁÉÍÓÚáéíóúñÑ]{2}/.test(nombre) || /^\d+$/.test(nombre)) {
        salida.push("Escribí tu *nombre y apellido*, por favor.");
        break;
      }
      s.datos.nombre = nombre.slice(0, 120);
      s.paso = "documento";
      salida.push("Gracias. Ahora tu *número de cédula* (solo los números).");
      break;
    }

    case "documento": {
      const doc = texto.replace(/[^\d]/g, "");
      if (media || doc.length < 5 || doc.length > 12) {
        salida.push("Escribí tu número de cédula, solo los números (por ejemplo: 4123456).");
        break;
      }
      s.datos.documento = doc;
      s.paso = "ciudad";
      salida.push("¿De qué ciudad sos?");
      break;
    }

    case "ciudad": {
      const ciudad = texto.replace(/\s+/g, " ").trim();
      if (media || ciudad.length < 2 || /^\d+$/.test(ciudad)) {
        salida.push("Escribí el nombre de tu ciudad.");
        break;
      }
      s.datos.ciudad = ciudad.slice(0, 60);
      if (!sorteo) break;
      s.paso = "confirmar";
      salida.push(textoResumen(sorteo, s.datos));
      break;
    }

    case "confirmar": {
      if (!sorteo) break;
      if (/^(2|cambiar|cambiar mis datos|corregir)$/.test(t)) {
        s.datos.nombre = undefined;
        s.datos.documento = undefined;
        s.datos.ciudad = undefined;
        s.paso = "nombre";
        salida.push("Dale. ¿A nombre de quién van? Escribí *nombre y apellido*.");
        break;
      }
      if (/^(3|no)$/.test(t)) {
        reiniciar(s);
        salida.push("Listo, no reservamos nada. Cuando quieras, escribí *MENU*.");
        break;
      }
      if (!/^(1|si|confirmar|confirmo|dale|ok|listo|reservar)\b/.test(t)) {
        salida.push("Respondé *1* para confirmar, *2* para cambiar tus datos o *3* para cancelar.");
        break;
      }
      const vendedorId = s.datos.vendedor ? await vendedorPorCodigo(conv.empresa_id, s.datos.vendedor) : null;
      const { data, error } = await db().rpc("sorteo_orden_registrar", {
        p_empresa: conv.empresa_id,
        p: {
          sorteo_id: sorteo.id,
          cantidad: s.datos.cantidad,
          canal: "whatsapp",
          estado: "pendiente_pago",
          metodo_pago: "transferencia",
          comprador: { nombre: s.datos.nombre, documento: s.datos.documento, telefono: tel, ciudad: s.datos.ciudad },
          conversacion_id: conv.id,
          vendedor_id: vendedorId,
          anuncio_id: s.datos.anuncio?.id ?? null,
          anuncio_titulo: s.datos.anuncio?.titulo ?? null,
          idempotency_key: `wa:${e.mensaje_id}`,
        },
      });
      if (error || !data) {
        salida.push(`No pudimos reservar tus boletas${mensajeBase(error?.message) ? `: ${mensajeBase(error?.message)}` : ""}.`, "Elegí otra cantidad o escribí *ASESOR*.");
        s.paso = "cantidad";
        break;
      }
      const o = data as OrdenJson;
      s.orden_id = o.id;
      s.paso = "pago";
      salida.push(
        [
          `✅ ¡Listo! Reservamos ${o.cantidad === 1 ? "tu número" : `tus ${o.cantidad} números`} por ${sorteo.reserva_minutos} minutos.`,
          `Compra N° ${o.numero} · Total: *${gs(o.monto)}*`,
          "",
          sorteo.datos_pago.length ? `Transferí a:\n${textoCuentas(sorteo.datos_pago)}` : "",
          "",
          "Cuando pagues, mandá por acá la *foto o captura del comprobante* 📸 y te confirmamos tus números.",
          op.base ? `Tu compra: ${op.base}/t/${o.token}` : "",
        ].join("\n").replace(/\n{3,}/g, "\n\n"),
      );
      break;
    }

    case "pago": {
      if (!s.orden_id) {
        reiniciar(s);
        salida.push(AYUDA);
        break;
      }
      const o = await ordenJson(s.orden_id);
      if (!o) {
        reiniciar(s);
        salida.push(AYUDA);
        break;
      }
      if (media) {
        await comprobante(e, s, conv, o, op, salida);
        break;
      }
      if (o.estado === "pendiente_pago" && o.vence_at && Date.parse(o.vence_at) < Date.now()) {
        await db().rpc("sorteo_liberar_vencidas", { p_sorteo: o.sorteo_id });
        reiniciar(s);
        salida.push("Se venció el tiempo para pagar y tus números se liberaron. 😕 Escribí *MENU* para hacer una compra nueva.");
        break;
      }
      if (o.estado !== "pendiente_pago") {
        await seguimiento(o, s, op, salida);
        break;
      }
      const min = o.vence_at ? Math.max(1, Math.round((Date.parse(o.vence_at) - Date.now()) / 60000)) : null;
      salida.push(
        `Estamos esperando la *foto del comprobante* de ${gs(o.monto)} (compra N° ${o.numero}).${min ? ` Tus números quedan reservados ${min} minuto${min === 1 ? "" : "s"} más.` : ""}`,
        "Si querés cancelar la compra, escribí *CANCELAR*.",
      );
      break;
    }

    case "revision": {
      const o = s.orden_id ? await ordenJson(s.orden_id) : null;
      if (!o) {
        reiniciar(s);
        salida.push(AYUDA);
        break;
      }
      await seguimiento(o, s, op, salida);
      break;
    }
  }

  await guardarSesion(s);
  await enviar(conv, salida);
  return { respondio: salida.length > 0 };
}

/** Compra que ya no espera el pago: confirmada (ticket), en revisión o dada de baja. */
async function seguimiento(o: OrdenJson, s: Sesion, op: OpcionesBot, salida: string[]) {
  if (o.estado === "confirmada") {
    salida.push(textoTicket(o, op.base));
    reiniciar(s);
  } else if (o.estado === "en_revision") {
    s.paso = "revision";
    salida.push(`Tu comprobante de la compra N° ${o.numero} está en revisión. Te avisamos por acá apenas se confirme. 🙌`);
  } else {
    reiniciar(s);
    salida.push(`Tu compra N° ${o.numero} quedó ${o.estado === "vencida" ? "vencida" : o.estado === "rechazada" ? "rechazada" : "anulada"}${o.motivo ? ` (${o.motivo})` : ""}. Escribí *MENU* para hacer una nueva.`);
  }
}

/** Foto/PDF del comprobante: se copia a la carpeta de la compra, se lee y la base decide. */
async function comprobante(e: EntranteBot, s: Sesion, conv: Conv, o: OrdenJson, op: OpcionesBot, salida: string[]) {
  const mime = (e.media_mime ?? "").toLowerCase();
  const ext = TIPOS_COMPROBANTE[mime];
  if (!ext || !e.media_path) {
    salida.push("Mandá el comprobante como foto (JPG o PNG) o como PDF, por favor.");
    return;
  }
  const { data: blob, error: errBajar } = await db().storage.from("erp-chat").download(e.media_path);
  if (errBajar || !blob) {
    salida.push("No pudimos abrir el archivo. Probá mandarlo de nuevo.");
    return;
  }
  const datos = Buffer.from(await blob.arrayBuffer());
  if (datos.length > 10 * 1024 * 1024) {
    salida.push("El archivo es muy grande. Mandá una captura de pantalla del comprobante.");
    return;
  }
  const lectura = op.lecturaSimulada !== undefined ? op.lecturaSimulada : await leerComprobante(datos, mime);
  if (lectura && !lectura.es_comprobante) {
    salida.push("Esa imagen no parece un comprobante de transferencia. 🤔 Mandá la captura del comprobante del banco, por favor.");
    return;
  }
  const path = `${tenantSchema()}/${conv.empresa_id}/${o.id}/wa-${randomUUID()}.${ext}`;
  const bucket = db().storage.from("erp-sorteos");
  const { error: errSubir } = await bucket.upload(path, datos, { contentType: mime, upsert: false });
  if (errSubir) {
    console.error("[sorteos/bot] subir comprobante", errSubir.message);
    salida.push("No pudimos guardar el comprobante. Probá mandarlo de nuevo en un momento.");
    return;
  }
  const { data, error } = await db().rpc("sorteo_bot_comprobante", { p_empresa: conv.empresa_id, p_orden: o.id, p_path: path, p_lectura: lectura });
  if (error || !data) {
    await bucket.remove([path]).catch(() => {});
    console.error("[sorteos/bot] comprobante", error?.message);
    salida.push("No pudimos registrar el comprobante. " + AYUDA);
    return;
  }
  const r = data as OrdenJson;
  if (r.resultado === "confirmada") {
    salida.push(textoTicket(r, op.base, r.mensaje_ticket));
    reiniciar(s);
  } else if (r.resultado === "vencida") {
    await bucket.remove([path]).catch(() => {});
    reiniciar(s);
    salida.push("Se venció el tiempo para pagar y tus números se liberaron. 😕 Escribí *ASESOR* si ya transferiste, o *MENU* para una compra nueva.");
  } else if (r.resultado === "estado") {
    await bucket.remove([path]).catch(() => {});
    await seguimiento(r, s, op, salida);
  } else {
    s.paso = "revision";
    salida.push(`📥 Recibimos tu comprobante de la compra N° ${r.numero}. Lo estamos revisando y te avisamos por acá apenas se confirme.`);
  }
}

/**
 * Plantilla de WhatsApp para mandar el ticket cuando pasaron más de 24 h desde el último mensaje del
 * cliente (fuera de la ventana solo se puede escribir con plantillas aprobadas). Se tiene que dar de
 * alta con este nombre y estas 5 variables en la cuenta de WhatsApp Business del cliente.
 */
export const PLANTILLA_TICKET = {
  id: "sorteo_ticket",
  idioma: "es",
  texto: "¡Hola {{1}}! Tu compra N° {{2}} de {{3}} está confirmada. Tus números: {{4}}. Tu ticket: {{5}}",
};

async function enviarPlantillaTicket(conv: Conv, o: OrdenJson, base: string) {
  if (!conv.canal) return;
  const nums = o.numeros ?? [];
  const variables = [
    primerNombre(o.comprador_nombre) || "cliente", String(o.numero), o.sorteo,
    nums.slice(0, 30).join(", ") + (nums.length > 30 ? ` y ${nums.length - 30} más` : ""), base ? `${base}/t/${o.token}` : "-",
  ];
  const contenido = variables.reduce((t, v, i) => t.replace(`{{${i + 1}}}`, v), PLANTILLA_TICKET.texto);
  const { data, error } = await db()
    .from("chat_mensajes")
    .insert({ empresa_id: conv.empresa_id, conversacion_id: conv.id, from_me: true, tipo: "plantilla", contenido, estado_entrega: "pendiente" })
    .select("id")
    .single();
  if (error || !data) return;
  let estado = "enviado";
  let externo: string | null = null;
  let fallo: string | null = null;
  try {
    externo = (await conectorPara(conv.canal.proveedor).enviarPlantilla(
      { canal: conv.canal, telefono: conv.contacto?.telefono ?? null, externoContacto: conv.contacto?.externo_id ?? null },
      { id: PLANTILLA_TICKET.id, idioma: PLANTILLA_TICKET.idioma, variables, texto: contenido },
    )).externo_id;
  } catch (e) {
    estado = "fallido";
    fallo = (e as Error).message || "No se pudo enviar la plantilla";
  }
  await db().from("chat_mensajes").update({ estado_entrega: estado, externo_id: externo, error: fallo }).eq("id", (data as { id: string }).id);
}

/**
 * Alguien de la empresa confirmó, rechazó o anuló una compra hecha por WhatsApp: se le avisa al cliente
 * en su chat. Si pasaron más de 24 h, el ticket sale con la plantilla `sorteo_ticket`; un rechazo fuera
 * de la ventana no se avisa (lo ve en el link de su compra).
 */
export async function avisarCompraWhatsApp(empresaId: string, ordenId: string, base: string): Promise<void> {
  try {
    const { data: fila } = await db().from("sorteo_ordenes").select("conversacion_id, canal").eq("id", ordenId).eq("empresa_id", empresaId).maybeSingle();
    const f = fila as { conversacion_id: string | null; canal: string } | null;
    if (!f?.conversacion_id) return;
    const conv = await leerConv(f.conversacion_id);
    if (!conv || conv.empresa_id !== empresaId || !conv.canal?.activo) return;
    const o = await ordenJson(ordenId);
    if (!o) return;
    if (conv.ventana_expira_at && Date.parse(conv.ventana_expira_at) < Date.now()) {
      if (o.estado === "confirmada") await enviarPlantillaTicket(conv, o, base);
      return;
    }
    const { data: ses } = await db().from("sorteo_bot_sesiones").select("*").eq("conversacion_id", conv.id).maybeSingle();
    const s = ses as Sesion | null;
    const salida: string[] = [];
    if (o.estado === "confirmada") {
      const { data: sor } = await db().from("sorteos").select("mensaje_ticket").eq("id", o.sorteo_id).maybeSingle();
      salida.push(textoTicket(o, base, (sor as { mensaje_ticket: string | null } | null)?.mensaje_ticket));
    } else if (o.estado === "rechazada" || o.estado === "anulada") {
      salida.push(`No pudimos confirmar el pago de tu compra N° ${o.numero}${o.motivo ? `: ${o.motivo}` : ""}.`, AYUDA);
    } else return;
    if (s && s.orden_id === ordenId && s.paso !== "humano") {
      reiniciar(s);
      await guardarSesion(s);
    }
    await enviar(conv, salida);
  } catch (err) {
    console.error("[sorteos/bot] aviso", (err as Error).message);
  }
}
