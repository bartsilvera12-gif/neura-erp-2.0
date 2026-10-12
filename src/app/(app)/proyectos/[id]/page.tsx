"use client";

/** /proyectos/[id] — detalle del proyecto en página completa (el tablero lo abre en modal; las notificaciones llegan acá). */
import { use } from "react";
import { useRouter } from "next/navigation";
import { ProyectoDetalle } from "@/modules/proyectos/ui/ProyectoDetalle";

export default function ProyectoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  return <ProyectoDetalle id={id} variant="page" onClose={() => router.push("/proyectos")} onEliminado={() => router.push("/proyectos")} />;
}
