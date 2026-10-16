"use client";

/**
 * /presupuestos/[id] — página del presupuesto (links directos: ficha del cliente, caja,
 * notificaciones, el formulario al guardar). El contenido es el mismo que el modal de la lista:
 * PresupuestoDetalle.
 * ?creado=1 / ?guardado=1 (viene del formulario): muestra el aviso y deja la URL limpia.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PresupuestoDetalle } from "@/modules/presupuestos/PresupuestoDetalle";

export default function PresupuestoPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (sp.get("creado")) setAviso("Presupuesto creado. Descargá el PDF, mandáselo al cliente y marcalo como enviado.");
    else if (sp.get("guardado")) setAviso("Cambios guardados.");
    else return;
    router.replace(`/presupuestos/${id}`, { scroll: false });
  }, [sp, router, id]);

  return <PresupuestoDetalle key={id} id={id} avisoInicial={aviso} />;
}
