/**
 * Historial omnicanal.
 *   GET /api/conversaciones/historial?q=<nombre o número>  → { contactos: ContactoBuscado[] }
 *       (búsqueda inteligente de la bandeja —sin tildes, tolera errores, número sin
 *        separadores— sobre abiertas y cerradas, agrupada por contacto)
 *   GET /api/conversaciones/historial?contacto=<id>        → Historial (chat_historial_contacto):
 *       contacto, todas sus conversaciones (cualquier canal) y los eventos de ruteo.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { UUID_RE } from "@/modules/tipificacion/server";
import type { FilaBandeja } from "@/modules/conversaciones/dominio";
import type { ContactoBuscado, Historial } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const contacto = sp.get("contacto");

  if (contacto) {
    if (!UUID_RE.test(contacto)) return ERR.invalid("Contacto inválido");
    const { data, error } = await ctx.db.rpc<Historial>("chat_historial_contacto", { p_contacto: contacto });
    if (error) {
      console.error("[conversaciones] historial", error.message);
      return ERR.server();
    }
    if (!data?.contacto) return ERR.notFound("Contacto");
    return ok({ contacto: data.contacto, conversaciones: data.conversaciones ?? [], ruteo: data.ruteo ?? [] } satisfies Historial);
  }

  const q = sp.get("q")?.trim().slice(0, 120) ?? "";
  if (q.length < 2) return ok({ contactos: [] as ContactoBuscado[] });
  const buscar = (vista: "todas" | "cerradas") =>
    ctx.db.rpc<{ rows: FilaBandeja[] }>("chat_bandeja", {
      p_vista: vista, p_q: q, p_asignado: null, p_canal: null, p_cursor_at: null, p_cursor_id: null, p_limite: 60,
    });
  const [abiertas, cerradas] = await Promise.all([buscar("todas"), buscar("cerradas")]);
  if (abiertas.error || cerradas.error) {
    console.error("[conversaciones] historial buscar", abiertas.error?.message ?? cerradas.error?.message);
    return ERR.server();
  }
  const porContacto = new Map<string, ContactoBuscado>();
  for (const f of [...(abiertas.data?.rows ?? []), ...(cerradas.data?.rows ?? [])]) {
    const c = porContacto.get(f.contacto_id);
    if (!c) {
      porContacto.set(f.contacto_id, {
        id: f.contacto_id,
        nombre: f.contacto_nombre,
        telefono: f.contacto_telefono,
        canales: [f.canal_nombre],
        conversaciones: 1,
        ultimo_mensaje_at: f.ultimo_mensaje_at,
        cliente_id: f.cliente_id,
      });
      continue;
    }
    c.conversaciones += 1;
    if (!c.canales.includes(f.canal_nombre)) c.canales.push(f.canal_nombre);
    if (f.ultimo_mensaje_at && (!c.ultimo_mensaje_at || f.ultimo_mensaje_at > c.ultimo_mensaje_at)) c.ultimo_mensaje_at = f.ultimo_mensaje_at;
  }
  const contactos = [...porContacto.values()]
    .sort((a, b) => (b.ultimo_mensaje_at ?? "").localeCompare(a.ultimo_mensaje_at ?? ""))
    .slice(0, 40);
  return ok({ contactos });
});
