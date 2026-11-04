/**
 * Normalizadores del webhook: payload crudo del proveedor → mensajes entrantes y cambios de estado
 * de entrega. Sin dependencias (se prueban solos con node):
 *   · simulador: { canal_id, telefono, nombre, texto, externo_id }
 *   · ycloud:    whatsapp.inbound_message.received (whatsappInboundMessage) y
 *                whatsapp.message.updated (whatsappMessage)        — docs.ycloud.com
 *   · meta:      entry[].changes[].value.messages[] / statuses[]  — WhatsApp Cloud API
 * La media (foto del comprobante, PDF, audio) viene como referencia: el procesador del webhook la
 * descarga con la clave del canal y la guarda en erp-chat.
 */
import type { EstadoEntrega } from "@/modules/conversaciones/dominio";

export type MediaEntrante = {
  /** Id del archivo en el proveedor (Meta: media id; YCloud: id si no hay link). */
  id?: string | null;
  /** Link temporal para bajarlo (YCloud). */
  link?: string | null;
  mime?: string | null;
  nombre?: string | null;
};

export type EntranteNormalizado = {
  /** Para rutear al canal: phone_number_id de Meta, número de negocio de YCloud… */
  canal_identificador?: string | null;
  /** Simulador: id del canal directo. */
  canal_id?: string | null;
  telefono: string;
  nombre?: string | null;
  externo_id?: string | null;
  tipo?: string;
  contenido?: string | null;
  fecha?: string | null;
  media?: MediaEntrante | null;
  /** Anuncio de Meta (Click-to-WhatsApp) que trajo al cliente. */
  anuncio?: { id: string; titulo: string | null } | null;
};
export type EstadoNormalizado = { externo_id: string; estado: EstadoEntrega; error?: string | null };
export type Normalizado = { entrantes: EntranteNormalizado[]; estados: EstadoNormalizado[] };

const VACIO: Normalizado = { entrantes: [], estados: [] };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const txt = (v: unknown, max = 4096): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const digitos = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");

/** Un nombre de perfil que es solo el número no sirve como nombre. */
function nombrePerfil(v: unknown, telefono: string): string | null {
  const n = txt(v, 120);
  if (!n || !/\p{L}/u.test(n) || digitos(n) === telefono) return null;
  return n;
}

/**
 * Cuerpo común de un mensaje de WhatsApp (YCloud reenvía el formato de Meta): tipo del chat,
 * texto y media. Botones y listas llegan como texto (lo que tocó el cliente).
 */
function cuerpoWhatsapp(m: Obj): Pick<EntranteNormalizado, "tipo" | "contenido" | "media"> {
  const t = typeof m.type === "string" ? m.type : "text";
  const parte = obj(m[t]);
  const media = (tipo: string): Pick<EntranteNormalizado, "tipo" | "contenido" | "media"> => ({
    tipo,
    contenido: txt(parte?.caption),
    media: {
      id: txt(parte?.id, 200),
      link: txt(parte?.link, 2000),
      mime: txt(parte?.mime_type, 120),
      nombre: txt(parte?.filename, 200),
    },
  });
  switch (t) {
    case "text":
      return { tipo: "texto", contenido: txt(obj(m.text)?.body) };
    case "image":
      return media("imagen");
    case "document":
      return media("documento");
    case "audio":
    case "voice":
      return media("audio");
    case "video":
      return media("video");
    case "sticker":
      return { ...media("sticker"), contenido: null };
    case "location": {
      const l = obj(m.location);
      const nombre = txt(l?.name) ?? txt(l?.address);
      return { tipo: "ubicacion", contenido: [nombre, l?.latitude != null && l?.longitude != null ? `${l.latitude},${l.longitude}` : null].filter(Boolean).join(" · ") || null };
    }
    case "button":
      return { tipo: "texto", contenido: txt(obj(m.button)?.text) ?? txt(obj(m.button)?.payload) };
    case "interactive": {
      const i = obj(m.interactive);
      const r = obj(i?.button_reply) ?? obj(i?.list_reply);
      return { tipo: "texto", contenido: txt(r?.title) ?? txt(r?.id) };
    }
    case "reaction":
      return { tipo: "reaccion", contenido: txt(obj(m.reaction)?.emoji, 20) };
    default:
      return { tipo: "texto", contenido: `[${t}]` };
  }
}

function anuncioDe(m: Obj): EntranteNormalizado["anuncio"] {
  const r = obj(m.referral);
  const id = txt(r?.source_id, 120) ?? txt(r?.ctwa_clid, 200);
  return id ? { id, titulo: txt(r?.headline, 200) ?? txt(r?.body, 200) } : null;
}

const ESTADOS: Record<string, EstadoEntrega> = {
  accepted: "enviado", sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido", undelivered: "fallido",
};

function simulador(payload: unknown): Normalizado {
  const p = obj(payload) ?? {};
  const telefono = digitos(p.telefono);
  const texto = typeof p.texto === "string" ? p.texto.slice(0, 4096) : "";
  if (!telefono || !texto.trim()) return VACIO;
  return {
    entrantes: [
      {
        canal_id: typeof p.canal_id === "string" ? p.canal_id : null,
        telefono,
        nombre: typeof p.nombre === "string" ? p.nombre.slice(0, 120) : null,
        externo_id: typeof p.externo_id === "string" ? p.externo_id.slice(0, 200) : null,
        tipo: "texto",
        contenido: texto,
      },
    ],
    estados: [],
  };
}

function ycloud(payload: unknown): Normalizado {
  const p = obj(payload);
  if (!p) return VACIO;
  if (p.type === "whatsapp.inbound_message.received") {
    const m = obj(p.whatsappInboundMessage);
    const telefono = digitos(m?.from);
    const negocio = digitos(m?.to);
    if (!m || !telefono || !negocio) return VACIO;
    return {
      entrantes: [{
        canal_identificador: negocio,
        telefono,
        nombre: nombrePerfil(obj(m.customerProfile)?.name, telefono),
        externo_id: txt(m.wamid, 200) ?? txt(m.id, 200),
        fecha: txt(m.sendTime, 40),
        anuncio: anuncioDe(m),
        ...cuerpoWhatsapp(m),
      }],
      estados: [],
    };
  }
  if (p.type === "whatsapp.message.updated") {
    const m = obj(p.whatsappMessage);
    const estado = ESTADOS[String(m?.status ?? "").toLowerCase()];
    const externo = txt(m?.wamid, 200) ?? txt(m?.id, 200);
    if (!m || !estado || !externo) return VACIO;
    const estados: EstadoNormalizado[] = [{ externo_id: externo, estado, error: estado === "fallido" ? txt(m.errorMessage, 500) ?? txt(m.errorCode, 50) : null }];
    // Se guardó el que devolvió el envío (wamid o id): se actualizan los dos.
    const otro = txt(m.id, 200);
    if (otro && otro !== externo) estados.push({ ...estados[0], externo_id: otro });
    return { entrantes: [], estados };
  }
  return VACIO;
}

function meta(payload: unknown): Normalizado {
  const p = obj(payload);
  if (!p || p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return VACIO;
  const out: Normalizado = { entrantes: [], estados: [] };
  for (const e of p.entry) {
    for (const c of Array.isArray(obj(e)?.changes) ? (obj(e)!.changes as unknown[]) : []) {
      const v = obj(obj(c)?.value);
      if (!v) continue;
      const negocio = txt(obj(v.metadata)?.phone_number_id, 60);
      const contactos = Array.isArray(v.contacts) ? (v.contacts as unknown[]).map(obj) : [];
      for (const raw of Array.isArray(v.messages) ? (v.messages as unknown[]) : []) {
        const m = obj(raw);
        const telefono = digitos(m?.from);
        if (!m || !telefono || !negocio) continue;
        const perfil = contactos.find((k) => digitos(k?.wa_id) === telefono) ?? contactos[0];
        const ts = Number(m.timestamp);
        out.entrantes.push({
          canal_identificador: negocio,
          telefono,
          nombre: nombrePerfil(obj(perfil?.profile)?.name, telefono),
          externo_id: txt(m.id, 200),
          fecha: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
          anuncio: anuncioDe(m),
          ...cuerpoWhatsapp(m),
        });
      }
      for (const raw of Array.isArray(v.statuses) ? (v.statuses as unknown[]) : []) {
        const s = obj(raw);
        const estado = ESTADOS[String(s?.status ?? "").toLowerCase()];
        const externo = txt(s?.id, 200);
        if (!s || !estado || !externo) continue;
        const err = Array.isArray(s.errors) ? obj(s.errors[0]) : null;
        out.estados.push({ externo_id: externo, estado, error: estado === "fallido" ? txt(err?.message, 500) ?? txt(err?.title, 500) : null });
      }
    }
  }
  return out;
}

export function normalizar(proveedor: string, payload: unknown): Normalizado {
  switch (proveedor) {
    case "simulador":
      return simulador(payload);
    case "ycloud":
      return ycloud(payload);
    case "meta":
      return meta(payload);
    // baileys: formato del worker propio, cuando exista.
    default:
      return VACIO;
  }
}

/** Identificadores de canal que trae un payload (para buscar el secreto del canal antes de procesar). */
export function identificadoresDe(proveedor: string, payload: unknown): string[] {
  const n = normalizar(proveedor, payload);
  const ids = n.entrantes.map((e) => e.canal_identificador).filter((x): x is string => !!x);
  if (proveedor === "meta") {
    for (const e of Array.isArray(obj(payload)?.entry) ? (obj(payload)!.entry as unknown[]) : []) {
      for (const c of Array.isArray(obj(e)?.changes) ? (obj(e)!.changes as unknown[]) : []) {
        const id = txt(obj(obj(obj(c)?.value)?.metadata)?.phone_number_id, 60);
        if (id) ids.push(id);
      }
    }
  }
  if (proveedor === "ycloud") {
    const m = obj(obj(payload)?.whatsappMessage);
    const de = digitos(m?.from);
    if (de) ids.push(de);
  }
  return [...new Set(ids)];
}
