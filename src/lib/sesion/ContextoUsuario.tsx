"use client";

/**
 * Usuario logueado (rol, email, empresa) compartido por TODAS las pantallas de (app).
 * El layout lo pide una sola vez a /api/me y lo entrega por contexto: las páginas ya no
 * hacen su propio fetch a /api/me.
 *
 *   const me = useUsuario();            // null mientras carga
 *   const esAdmin = me?.rol === "ADMIN"; // con null queda en false hasta que llegue
 */
import { createContext, useContext } from "react";

export type Usuario = {
  usuarioId?: string;
  empresaId?: string;
  rol: string;
  email: string | null;
};

const ContextoUsuario = createContext<Usuario | null>(null);

export const ProveedorUsuario = ContextoUsuario.Provider;

/** El usuario de la sesión, o null mientras /api/me no respondió. */
export function useUsuario(): Usuario | null {
  return useContext(ContextoUsuario);
}
