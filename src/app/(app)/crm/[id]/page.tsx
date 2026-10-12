"use client";

/** /crm/[id] — detalle del prospecto en página completa (el tablero lo abre en modal). */
import { use } from "react";
import { useRouter } from "next/navigation";
import { ProspectoDetalle } from "@/modules/crm/ui/ProspectoDetalle";

export default function ProspectoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  return <ProspectoDetalle id={id} variant="page" onClose={() => router.push("/crm")} onEliminado={() => router.push("/crm")} />;
}
