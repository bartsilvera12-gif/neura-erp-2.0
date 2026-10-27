/**
 * Detalle de "Leads del día" de un asesor (Monitoreo): los chats que se le asignaron ese día.
 *   GET /api/conversaciones/monitoreo/leads?agente=<usuario>&fecha=YYYY-MM-DD → { leads: LeadDia[] }
 * Tiempo de 1ª respuesta = primera respuesta humana − asignación (si es de este ciclo).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { UUID_RE } from "@/modules/tipificacion/server";
import { alcanceSupervision, puedeSupervisar } from "@/modules/conversaciones/server";
import { segundosEntre, type LeadDia } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

type Fila = {
  id: string;
  estado: LeadDia["estado"];
  asignada_at: string | null;
  ultimo_mensaje_at: string | null;
  ultimo_preview: string | null;
  primera_respuesta_at: string | null;
  contacto: { nombre: string | null; telefono: string | null } | null;
  canal: { nombre: string } | null;
};

export const GET = withTenant(async (ctx, req) => {
  if (!(await puedeSupervisar(ctx))) return ERR.forbidden();
  const sp = new URL(req.url).searchParams;
  const agente = sp.get("agente");
  if (!agente || !UUID_RE.test(agente)) return ERR.invalid("Asesor inválido");
  const equipo = await alcanceSupervision(ctx);
  if (equipo && !equipo.includes(agente)) return ERR.forbidden();
  const f = sp.get("fecha");
  const fecha = f && FECHA_RE.test(f) ? f : hoyPY();
  // Paraguay es UTC-3 todo el año (ver lib/fecha/paraguay).
  const desde = new Date(`${fecha}T00:00:00-03:00`);
  const hasta = new Date(desde.getTime() + 86_400_000);

  const { data, error } = await ctx.db
    .select(
      "chat_conversaciones",
      "id, estado, asignada_at, ultimo_mensaje_at, ultimo_preview, primera_respuesta_at, contacto:chat_contactos!contacto_id(nombre, telefono), canal:chat_canales!canal_id(nombre)",
    )
    .eq("asignado_id", agente)
    .gte("asignada_at", desde.toISOString())
    .lt("asignada_at", hasta.toISOString())
    .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) {
    console.error("[conversaciones] leads", error.message);
    return ERR.server();
  }
  const leads: LeadDia[] = ((data ?? []) as unknown as Fila[]).map((r) => {
    const seg = segundosEntre(r.asignada_at, r.primera_respuesta_at);
    return {
      id: r.id,
      contacto: r.contacto?.nombre ?? null,
      telefono: r.contacto?.telefono ?? null,
      canal: r.canal?.nombre ?? null,
      estado: r.estado,
      asignada_at: r.asignada_at,
      ultimo_mensaje_at: r.ultimo_mensaje_at,
      ultimo_preview: r.ultimo_preview,
      primera_respuesta_seg: seg,
      sin_respuesta: !r.primera_respuesta_at,
    };
  });
  return ok({ leads });
});
