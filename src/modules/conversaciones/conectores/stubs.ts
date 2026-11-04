/**
 * Conector todavía SIN implementar: Baileys (servicio propio por socket; enviar por HTTP al worker).
 * Queda como stub para que la bandeja ya hable el contrato. YCloud y Meta están en reales.ts.
 */
import { ConectorNoConfigurado, type ConectorChat, type Proveedor } from "./tipos";

function stub(proveedor: Proveedor): ConectorChat {
  const no = async (): Promise<never> => {
    throw new ConectorNoConfigurado(proveedor);
  };
  return { proveedor, enviarTexto: no, enviarMedia: no, enviarPlantilla: no, marcarLeido: no };
}

export const conectorBaileys = stub("baileys");
