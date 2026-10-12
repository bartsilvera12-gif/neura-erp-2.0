/**
 * Conectores reales: todavía SIN proveedor. Quedan como stub para que la bandeja ya
 * hable el contrato; al conectar uno se implementa acá (y su normalizador del webhook).
 *   · meta:    WhatsApp Cloud API (graph.facebook.com/<versión>/<phone_number_id>/messages)
 *   · ycloud:  api.ycloud.com/v2/whatsapp/messages
 *   · baileys: servicio propio (socket) — enviar por HTTP al worker
 * Los tokens van en chat_canal_secretos.config (solo servidor, ver secretosDelCanal).
 */
import { ConectorNoConfigurado, type ConectorChat, type Proveedor } from "./tipos";

function stub(proveedor: Proveedor): ConectorChat {
  const no = async (): Promise<never> => {
    throw new ConectorNoConfigurado(proveedor);
  };
  return { proveedor, enviarTexto: no, enviarMedia: no, enviarPlantilla: no, marcarLeido: no };
}

export const conectorMeta = stub("meta");
export const conectorYcloud = stub("ycloud");
export const conectorBaileys = stub("baileys");
