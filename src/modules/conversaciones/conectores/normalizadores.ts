/**
 * Normalizadores del webhook: payload crudo del proveedor → mensajes entrantes y
 * cambios de estado de entrega. Solo el simulador está hecho; el resto es TODO
 * (se completa al conectar el proveedor).
 */
import type { EstadoEntrega } from "@/modules/conversaciones/dominio";

export type EntranteNormalizado = {
  /** Para rutear al canal: phone_number_id de Meta, número de YCloud… */
  canal_identificador?: string | null;
  /** Simulador: id del canal directo. */
  canal_id?: string | null;
  telefono: string;
  nombre?: string | null;
  externo_id?: string | null;
  tipo?: string;
  contenido?: string | null;
  fecha?: string | null;
};
export type EstadoNormalizado = { externo_id: string; estado: EstadoEntrega; error?: string | null };
export type Normalizado = { entrantes: EntranteNormalizado[]; estados: EstadoNormalizado[] };

const VACIO: Normalizado = { entrantes: [], estados: [] };

function simulador(payload: unknown): Normalizado {
  const p = (payload ?? {}) as Record<string, unknown>;
  const telefono = typeof p.telefono === "string" ? p.telefono.replace(/\D/g, "") : "";
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

export function normalizar(proveedor: string, payload: unknown): Normalizado {
  switch (proveedor) {
    case "simulador":
      return simulador(payload);
    // TODO meta:    entry[].changes[].value.messages[] / statuses[] (metadata.phone_number_id → canal)
    // TODO ycloud:  whatsapp.inbound_message.received / whatsapp.message.updated
    // TODO baileys: formato del worker propio
    default:
      return VACIO;
  }
}
