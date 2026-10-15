"use client";

/**
 * Usuario logueado (rol, email, empresa, perfil) compartido por TODAS las pantallas de (app).
 * El layout lo pide una sola vez a /api/me y lo entrega por contexto: las páginas ya no
 * hacen su propio fetch a /api/me.
 *
 *   const me = useUsuario();            // null mientras carga
 *   const esAdmin = me?.rol === "ADMIN"; // con null queda en false hasta que llegue
 *   const puedeAnular = usePermiso("anular_ventas"); // false hasta que llegue /api/me
 */
import { createContext, useContext } from "react";
import type { PerfilSesion, Permiso } from "@/modules/usuarios/permisos";

export type Usuario = {
  usuarioId?: string;
  empresaId?: string;
  rol: string;
  nombre?: string;
  email: string | null;
  sucursalId?: string | null;
  /** perfil efectivo (pantallas, permisos, alcance, tope de descuento) */
  perfil?: PerfilSesion | null;
};

const ContextoUsuario = createContext<Usuario | null>(null);

export const ProveedorUsuario = ContextoUsuario.Provider;

/** El usuario de la sesión, o null mientras /api/me no respondió. */
export function useUsuario(): Usuario | null {
  return useContext(ContextoUsuario);
}

/** ¿El perfil de un usuario tiene el permiso? (Administrador: todos; sin perfil cargado: no) */
export function tienePermiso(me: Usuario | null | undefined, permiso: Permiso): boolean {
  const p = me?.perfil;
  if (!p) return false;
  return p.todo || p.permisos.includes(permiso);
}

/** ¿El perfil de la sesión tiene el permiso? false mientras carga. */
export function usePermiso(permiso: Permiso): boolean {
  return tienePermiso(useContext(ContextoUsuario), permiso);
}
