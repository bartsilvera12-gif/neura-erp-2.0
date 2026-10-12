/**
 * Conector SIMULADOR: permite probar toda la bandeja sin WhatsApp.
 * "Envía" al instante (id externo sim-…) y después hace avanzar las tildes
 * (entregado a ~1 s, leído a ~3 s) como haría el webhook de un proveedor real.
 * Los entrantes se simulan con POST /api/conversaciones/simular (solo ADMIN).
 */
import type { ConectorChat } from "./tipos";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idSimulado = () => `sim-${crypto.randomUUID()}`;

export const conectorSimulador: ConectorChat = {
  proveedor: "simulador",
  async enviarTexto() {
    return { externo_id: idSimulado() };
  },
  async enviarMedia() {
    return { externo_id: idSimulado() };
  },
  async enviarPlantilla() {
    return { externo_id: idSimulado() };
  },
  async marcarLeido() {
    /* nada que avisar */
  },
  async simularEntrega(avanzar) {
    await esperar(1000);
    await avanzar("entregado");
    await esperar(2000);
    await avanzar("leido");
  },
};
