/**
 * Marcar leída (al abrir el chat o al llegar un mensaje con el chat abierto).
 *   POST /api/conversaciones/[id]/leida
 * Pone no_leidos en 0 y, en segundo plano, avisa al proveedor el último entrante
 * (doble tilde azul del lado del cliente; el simulador no hace nada).
 */
import { after } from "next/server";
import { withTenant } from "@/lib/api/with-tenant";
import { noContent, ERR } from "@/lib/api/responses";
import { conectorPara } from "@/modules/conversaciones/conectores";
import { idConversacion, leerConversacionEnvio } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");
  const { error } = await ctx.db.rpc("chat_marcar_leida", { p_conversacion: id });
  if (error) return ERR.server();

  const db = ctx.db;
  after(async () => {
    try {
      const conv = await leerConversacionEnvio(db, id);
      if (!conv?.canal || conv.canal.proveedor === "simulador") return;
      const { data } = await db
        .select("chat_mensajes", "externo_id")
        .eq("conversacion_id", id)
        .eq("from_me", false)
        .not("externo_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      const ext = (data?.[0] as { externo_id?: string } | undefined)?.externo_id;
      if (!ext) return;
      await conectorPara(conv.canal.proveedor).marcarLeido(
        { canal: conv.canal, telefono: conv.contacto?.telefono ?? null, externoContacto: conv.contacto?.externo_id ?? null },
        ext,
      );
    } catch {
      /* conector sin configurar: no hay a quién avisar */
    }
  });
  return noContent();
});
