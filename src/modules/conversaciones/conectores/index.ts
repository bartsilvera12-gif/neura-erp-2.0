/** Elige el conector del canal. Solo servidor. */
import { conectorSimulador } from "./simulador";
import { conectorBaileys, conectorMeta, conectorYcloud } from "./stubs";
import { ConectorNoConfigurado, type ConectorChat } from "./tipos";

export * from "./tipos";
export { normalizar, type Normalizado, type EntranteNormalizado, type EstadoNormalizado } from "./normalizadores";

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
