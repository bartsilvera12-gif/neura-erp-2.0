import { redirect } from "next/navigation";

/**
 * El alta directa de tickets está cerrada (igual que en el sistema actual): nacen
 * de la tipificación del cliente. Un enlace a esta página lleva a Gestión de clientes.
 */
export default function SoporteNuevoTicketPage() {
  redirect("/clientes/gestion");
}
