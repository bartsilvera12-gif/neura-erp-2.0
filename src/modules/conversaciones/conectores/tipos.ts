/**
 * Contrato de un CONECTOR de mensajería (WhatsApp Cloud de Meta, YCloud, Baileys…).
 * La bandeja no sabe con qué proveedor habla: arma el destino y llama a esto.
 * Solo servidor.
 */
import type { EstadoEntrega, TipoMedia } from "@/modules/conversaciones/dominio";

export type Proveedor = "meta" | "ycloud" | "baileys" | "simulador";

export type DestinoChat = {
  canal: { id: string; tipo: string; proveedor: string; identificador: string | null };
  /** Solo dígitos, con código de país (595…). */
  telefono: string | null;
  /** Id del usuario en IG/Messenger (cuando no hay teléfono). */
  externoContacto: string | null;
};

export type ResultadoEnvio = { externo_id: string | null };

export type MediaSaliente = {
  tipo: TipoMedia;
  mime: string;
  nombre: string;
  caption?: string | null;
  /** URL firmada para que el proveedor descargue el archivo (se pide solo si hace falta). */
  url: () => Promise<string>;
  /** Nota de voz grabada en el chat (algunos proveedores la mandan distinto). */
  notaDeVoz?: boolean;
};

export type OpcionesEnvio = { respondeAExterno?: string | null };

export interface ConectorChat {
  readonly proveedor: Proveedor;
  enviarTexto(d: DestinoChat, texto: string, o?: OpcionesEnvio): Promise<ResultadoEnvio>;
  enviarMedia(d: DestinoChat, media: MediaSaliente, o?: OpcionesEnvio): Promise<ResultadoEnvio>;
  enviarPlantilla(d: DestinoChat, plantilla: { id: string; idioma: string; variables: string[]; texto: string }): Promise<ResultadoEnvio>;
  /** Avisa al proveedor que se leyó un mensaje entrante (doble tilde azul del lado del cliente). */
  marcarLeido(d: DestinoChat, externoMensajeId: string): Promise<void>;
  /**
   * Solo el simulador: avanza los estados de entrega como lo haría el proveedor por webhook
   * (enviado → entregado → leído). Se ejecuta en segundo plano después de responder.
   */
  simularEntrega?(avanzar: (estado: EstadoEntrega) => Promise<void>): Promise<void>;
}

export class ConectorNoConfigurado extends Error {
  constructor(proveedor: string) {
    super(`Conector no configurado (${proveedor}). Todavía no hay proveedor de WhatsApp conectado.`);
    this.name = "ConectorNoConfigurado";
  }
}
