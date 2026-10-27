/**
 * Lado servidor del menú público de una mesa (/m/<token>, receta 68). Todo pasa por funciones de
 * la base habilitadas a `anon` que validan el token de la mesa (mesa_menu_publico,
 * mesa_pedido_publico_crear, mesa_pedidos_publico_estado). Con la clave anónima: aunque hubiera
 * un bug acá, no se puede leer nada más que lo que esas funciones deciden mostrar.
 */
import { clientePublico } from "@/lib/supabase/publico";
import { SEGUIMIENTO_RE, TOKEN_MESA_RE, type EstadoPedido } from "@/modules/mesas/tipos";
import type { ModsCatalogo, ModsSeleccion } from "@/modules/mesas/modificadores";

export type ProductoMenu = {
  id: string;
  nombre: string;
  descripcion: string | null;
  imagen_url: string | null;
  precio: number;
  precio_lista: number | null;
  categoria: string;
  /** Receta 73: quitar / extras / opciones del plato (null = se agrega directo). */
  mods?: ModsCatalogo | null;
};

export type MenuMesa =
  /** sin_qr (receta 75): el local tiene Mesas y QR apagada (no la mesa). */
  | { activa: false; mesa: string; empresa: string; logo_url: string | null; sin_qr?: boolean }
  | {
      activa: true;
      mesa: string;
      zona: string | null;
      sucursal: string | null;
      empresa: string;
      logo_url: string | null;
      productos: ProductoMenu[];
    };

export type EstadoPedidoPublico = {
  seguimiento: string;
  numero: number;
  estado: EstadoPedido;
  motivo_rechazo: string | null;
  total: number;
  creado_at: string;
  cuenta_cerrada: boolean;
  /** Receta 69: la cuenta se envió a caja (la mesa pidió la cuenta). */
  cuenta_en_caja?: boolean;
  items: { nombre: string; cantidad: number; total: number; modificadores_texto?: string | null }[];
};

const limpio = (m: string) => m.replace(/^.*?ERROR:\s*/, "");

export async function menuPorToken(token: string): Promise<MenuMesa | null> {
  if (!TOKEN_MESA_RE.test(token)) return null;
  const sb = clientePublico();
  // Receta 75: ¿el local toma pedidos por QR? (Mesas y QR prendida). En paralelo con el menú.
  const [{ data, error }, qr] = await Promise.all([
    sb.rpc("mesa_menu_publico", { p_token: token }),
    sb.rpc("mesa_qr_activo", { p_token: token }),
  ]);
  if (error) {
    console.error("[mesa_menu_publico]", error.message);
    throw new Error("No se pudo cargar el menú");
  }
  const menu = (data as MenuMesa | null) ?? null;
  // Si la base todavía no tiene mesa_qr_activo (sin la 75) se sigue como antes.
  if (menu && !qr.error && qr.data === false) {
    return { activa: false, sin_qr: true, mesa: menu.mesa, empresa: menu.empresa, logo_url: menu.logo_url };
  }
  return menu;
}

export async function crearPedido(
  token: string,
  items: { producto_id: string; cantidad: number; nota?: string | null; mods?: ModsSeleccion }[],
  nota: string | null,
  nombre: string | null,
) {
  if (!TOKEN_MESA_RE.test(token)) return { ok: false as const, error: "Mesa no encontrada" };
  // Receta 75: con Mesas y QR apagada no entra (la base también lo corta con un trigger).
  const qr = await clientePublico().rpc("mesa_qr_activo", { p_token: token });
  if (!qr.error && qr.data === false) return { ok: false as const, error: "Este local no está tomando pedidos por QR. Pedile a quien te atiende." };
  const { data, error } = await clientePublico().rpc("mesa_pedido_publico_crear", {
    p_token: token,
    p_items: items,
    p_nota: nota,
    p_nombre: nombre,
  });
  if (error) return { ok: false as const, error: limpio(error.message) };
  return { ok: true as const, pedido: data as { seguimiento: string; numero: number; estado: EstadoPedido; total: number } };
}

export async function estadoPedidos(token: string, seguimientos: string[]): Promise<EstadoPedidoPublico[]> {
  const segs = seguimientos.filter((s) => SEGUIMIENTO_RE.test(s)).slice(0, 20);
  if (!TOKEN_MESA_RE.test(token) || !segs.length) return [];
  const { data, error } = await clientePublico().rpc("mesa_pedidos_publico_estado", { p_token: token, p_seguimientos: segs });
  if (error) {
    console.error("[mesa_pedidos_publico_estado]", error.message);
    throw new Error("No se pudo consultar el pedido");
  }
  return (data as EstadoPedidoPublico[] | null) ?? [];
}
