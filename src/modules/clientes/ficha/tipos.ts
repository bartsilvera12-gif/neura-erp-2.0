/** Ficha del cliente: lo que devuelve GET /api/clientes/[id] y las listas de sus pestañas. */
import type { ClienteCompleto } from "@/modules/clientes/esquema";

export type Contacto = { id: string; nombre: string; cargo: string | null; telefono: string | null; email: string | null; notas: string | null };
export type Venta = { id: string; numero_control: string; fecha: string; total: number; tipo_venta: string; estado: string };
export type Resumen = { total_comprado: number; compras: number; ultima_compra: string | null; deuda: number; vencido: number; ticket_promedio: number; saldo_favor?: number };

export type Detalle = {
  cliente: ClienteCompleto;
  estado_cuenta: { saldo: number; limite_credito: number; disponible: number | null };
  ventas: Venta[];
  contactos: Contacto[];
  resumen: Resumen | null;
  notas_count: number;
};

export type EventoHistorial = {
  id: string;
  accion: string;
  detalle: {
    cambios?: { campo: string; antes: string | null; despues: string | null }[];
    motivo?: string | null;
    origen?: string | null;
    // Suscripciones (accion = "suscripcion")
    evento?: "alta" | "cuota" | "cambio_plan" | "pausada" | "activa" | "cancelada" | string;
    plan?: string | null;
    precio?: number | null;
    moneda?: string | null;
    periodo?: string | null;
    numero?: string | null;
    monto?: number | null;
    modo?: string | null;
    plan_anterior?: string | null;
    plan_nuevo?: string | null;
  } | null;
  usuario_nombre: string | null;
  created_at: string;
};

export type Nota = { id: string; texto: string; usuario_id: string | null; usuario_nombre: string | null; created_at: string };

export type UsuarioMin = { id: string; nombre: string; rol?: string };
