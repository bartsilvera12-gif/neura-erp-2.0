/** Elige el conector del canal. Solo servidor. */
import { conectorSimulador } from "./simulador";
import { conectorMeta, conectorYcloud } from "./reales";
import { conectorBaileys } from "./stubs";
import { ConectorNoConfigurado, type ConectorChat } from "./tipos";

export * from "./tipos";
export { normalizar, identificadoresDe, type Normalizado, type EntranteNormalizado, type EstadoNormalizado, type MediaEntrante } from "./normalizadores";
export { bajarMediaEntrante, probarCredenciales } from "./reales";

export function conectorPara(proveedor: string): ConectorChat {
  switch (proveedor) {
    case "simulador":
      return conectorSimulador;
    case "meta":
      return conectorMeta;
    case "ycloud":
      return conectorYcloud;
    case "baileys":
      return conectorBaileys;
    default:
      throw new ConectorNoConfigurado(proveedor);
  }
}
