/**
 * Lado público del rubro Sorteos (recetas 123 y 124): la página del sorteo (/s/<slug>), la compra por
 * su link privado (/t/<token>) y la verificación. Todo con el cliente ANÓNIMO: solo las funciones
 * sorteo_publico_* que la base habilita a `anon`, que validan slug / token y devuelven lo público.
 */
import { clientePublico } from "@/lib/supabase/publico";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TOKEN_RE = /^[0-9a-f]{48}$/;
export const CODIGO_RE = /^[A-Za-z0-9]{3,20}$/;

export type PremioPublico = {
  posicion: number;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  numero_ganador: string | null;
  ganador: string | null;
  ciudad: string | null;
  metodo: "digital" | "urna" | "externo" | null;
  intento: number | null;
  sorteado_at: string | null;
};

export type SorteoPublico = {
  slug: string;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  estado: "activo" | "pausado" | "cerrado" | "sorteado";
  precio: number;
  fecha_sorteo: string | null;
  max_por_compra: number | null;
  permite_elegir: boolean;
  numero_desde: number;
  numero_hasta: number;
  digitos: number;
  reserva_minutos: number;
  empresa: string;
  combos: { cantidad: number; precio: number; etiqueta: string | null }[];
  disponibles: number;
  vendidos: number;
  premios: PremioPublico[];
  /** Link del vivo donde se sortea (receta 127). */
  vivo_url: string | null;
  verificacion: { semilla_hash: string | null; lista_hash: string | null; lista_cantidad: number | null; semilla: string | null };
};

export type CuentaPago = { banco: string; titular: string; cuenta: string; documento?: string; alias?: string };

export type CompraPublica = {
  id: string;
  numero: number;
  sorteo: string;
  sorteo_id: string;
  slug: string;
  estado: "pendiente_pago" | "en_revision" | "confirmada" | "rechazada" | "anulada" | "vencida";
  cantidad: number;
  monto: number;
  precio_lista: number;
  comprador_nombre: string;
  comprador_telefono: string | null;
  comprador_ciudad: string | null;
  metodo_pago: string;
  canal: string;
  motivo: string | null;
  vence_at: string | null;
  created_at: string;
  numeros: string[];
  imagen_url: string | null;
  fecha_sorteo: string | null;
  empresa: string;
  mensaje_ticket: string | null;
  datos_pago: CuentaPago[] | null;
  comprobante_subido: boolean;
};

export async function sorteoPublico(slug: string): Promise<SorteoPublico | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data, error } = await clientePublico().rpc("sorteo_publico", { p_slug: slug });
  if (error) throw new Error(error.message);
  return (data as SorteoPublico | null) ?? null;
}

export async function compraPublica(token: string): Promise<CompraPublica | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data, error } = await clientePublico().rpc("sorteo_publico_orden", { p_token: token });
  if (error) throw new Error(error.message);
  return (data as CompraPublica | null) ?? null;
}

/** IP del que llama (detrás de Cloudflare / Coolify). Solo para los límites de intentos. */
export function ipDe(req: Request): string {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "?").trim().slice(0, 64);
}

/** Mensaje de la base sin el prefijo técnico. */
export const mensajeDb = (m: string | undefined, porDefecto: string) => {
  const t = (m ?? "").replace(/^.*?ERROR:\s*/, "").trim();
  return !t || /syntax|relation|column|function .* does not exist|permission denied/i.test(t) ? porDefecto : t;
};
