/** Con el módulo apagado (cliente.config), un enlace viejo a /proyectos vuelve a Comercial. */
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { clienteConfig } from "@/cliente.config";

export default function ProyectosLayout({ children }: { children: ReactNode }) {
  if (!clienteConfig.modulos.includes("proyectos")) redirect("/comercial");
  return children;
}
