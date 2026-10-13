"use client";

/** /clientes/[id] — ficha del cliente en página propia (links directos desde otros módulos). */
import { useParams } from "next/navigation";
import { FichaCliente } from "@/modules/clientes/ficha/FichaCliente";

export default function ClienteDetallePage() {
  const { id } = useParams<{ id: string }>();
  return <FichaCliente id={id} />;
}
