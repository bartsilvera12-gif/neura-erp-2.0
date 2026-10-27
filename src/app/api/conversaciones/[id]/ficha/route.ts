/**
 * Ficha del contacto (panel lateral del chat), todo en un viaje:
 *   GET /api/conversaciones/[id]/ficha
 *   → contacto · último cierre de la conversación · cliente del ERP (código, deuda, suscripción
 *     activa, últimos tickets de Soporte, última tipificación) · prospecto del CRM ·
 *     conversaciones previas del contacto (otros canales) · proyectos activos del cliente.
 * Si el contacto todavía no tiene cliente, se reintenta el vínculo por teléfono (últimos 9
 * dígitos) y se guarda SOLO si hay un único cliente que coincide.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { idConversacion } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

type ContactoFila = { id: string; nombre: string | null; telefono: string | null; cliente_id: string | null; prospecto_id: string | null; created_at: string };

export const GET = withTenant(async (ctx, req) => {
  const id = idConversacion(req);
  if (!id) return ERR.invalid("Conversación inválida");

  const { data: cv } = await ctx.db
    .select(
      "chat_conversaciones",
      "id, estado, cerrada_at, cerrada_por, cierre_familia_id, cierre_estado_id, cierre_observacion, created_at, " +
        "contacto:chat_contactos!contacto_id(id, nombre, telefono, cliente_id, prospecto_id, created_at)",
    )
    .eq("id", id)
    .limit(1);
  const conv = (cv?.[0] ?? null) as unknown as {
    id: string; estado: string; cerrada_at: string | null; cerrada_por: string | null; cierre_familia_id: string | null;
    cierre_estado_id: string | null; cierre_observacion: string | null; created_at: string; contacto: ContactoFila | null;
  } | null;
  if (!conv?.contacto) return ERR.notFound("Conversación");
  const contacto = conv.contacto;

  // Vínculo por teléfono (una sola vez, solo si es inequívoco).
  let clienteId = contacto.cliente_id;
  let vinculadoAhora = false;
  const digitos = (contacto.telefono ?? "").replace(/\D/g, "");
  if (!clienteId && digitos.length >= 9) {
    const { data: cand } = await ctx.db
      .select("clientes", "id")
      .is("deleted_at", null)
      .ilike("busqueda", `%${digitos.slice(-9)}%`)
      .limit(2);
    if (cand?.length === 1) {
      clienteId = (cand[0] as unknown as { id: string }).id;
      await ctx.db.update("chat_contactos", { cliente_id: clienteId, updated_at: new Date().toISOString() }).eq("id", contacto.id);
      vinculadoAhora = true;
    }
  }

  const vacio = Promise.resolve({ data: null, error: null } as { data: unknown; error: unknown });
  const [cierreFam, cierreSub, cierrePor, cli, saldo, susc, tks, tip, pros, prev, proy] = await Promise.all([
    conv.cierre_familia_id ? ctx.db.select("tipificacion_familias", "nombre").eq("id", conv.cierre_familia_id).limit(1) : vacio,
    conv.cierre_estado_id ? ctx.db.select("tipificacion_estados", "nombre").eq("id", conv.cierre_estado_id).limit(1) : vacio,
    conv.cerrada_por ? ctx.db.select("usuarios", "nombre").eq("id", conv.cerrada_por).limit(1) : vacio,
    clienteId
      ? ctx.db.select("clientes", "id, codigo, nombre, razon_social, ruc, documento, telefono, email, ciudad, activo, baja_at").eq("id", clienteId).is("deleted_at", null).limit(1)
      : vacio,
    clienteId ? ctx.db.rpc<number>("cliente_saldo", { p_cliente_id: clienteId }) : vacio,
    clienteId
      ? ctx.db.select("suscripciones", "id, plan_nombre, precio, moneda, estado, fecha_inicio").eq("cliente_id", clienteId).eq("estado", "activa").order("fecha_inicio", { ascending: false }).limit(3)
      : vacio,
    clienteId
      ? ctx.db.select("soporte_tickets", "id, numero, asunto, estado_codigo, created_at").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(5)
      : vacio,
    clienteId
      ? ctx.db.select("tipificaciones", "id, fecha, usuario, tipo_gestion, resultado, observacion").eq("cliente_id", clienteId).order("fecha", { ascending: false }).limit(1)
      : vacio,
    contacto.prospecto_id
      ? ctx.db.select("crm_prospectos", "id, numero_control, contacto, empresa, etapa, valor_estimado, responsable_usuario_id").eq("id", contacto.prospecto_id).limit(1)
      : vacio,
    // Conversaciones previas: las otras del contacto (una por canal; la de este canal es esta misma).
    ctx.db
      .select(
        "chat_conversaciones",
        "id, estado, created_at, ultimo_mensaje_at, cerrada_at, cierre_estado_id, canal:chat_canales!canal_id(nombre, tipo), asignado:usuarios!asignado_id(nombre)",
      )
      .eq("contacto_id", contacto.id)
      .neq("id", conv.id)
      .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false })
      .limit(10),
    clienteId
      ? ctx.db
          .select("proyectos", "id, numero, titulo, estado:proyecto_estados!estado_id(nombre, color)")
          .eq("cliente_id", clienteId)
          .eq("archivado", false)
          .order("ultimo_movimiento_at", { ascending: false })
          .limit(5)
      : vacio,
  ]);
  if (prev.error) console.error("[conversaciones] ficha previas", (prev.error as { message?: string }).message);
  if (proy.error) console.error("[conversaciones] ficha proyectos", (proy.error as { message?: string }).message);
  type Previa = {
    id: string; estado: "abierta" | "pendiente" | "cerrada"; created_at: string; ultimo_mensaje_at: string | null; cerrada_at: string | null;
    cierre_estado_id: string | null; canal: { nombre: string; tipo: string } | null; asignado: { nombre: string } | null;
  };
  type Proy = { id: string; numero: string; titulo: string; estado: { nombre: string; color: string | null } | null };
  const previas = (prev.data ?? []) as unknown as Previa[];
  // cierre_estado_id no tiene FK (es del catálogo de Tipificación): los nombres van aparte.
  const idsCierre = [...new Set(previas.map((p) => p.cierre_estado_id).filter((x): x is string => !!x))];
  const nombreCierre = new Map<string, string>();
  if (idsCierre.length) {
    const { data } = await ctx.db.select("tipificacion_estados", "id, nombre").in("id", idsCierre);
    for (const r of (data ?? []) as unknown as { id: string; nombre: string }[]) nombreCierre.set(r.id, r.nombre);
  }

  const primero = <T,>(r: { data: unknown }): T | null => ((r.data as T[] | null)?.[0] ?? null);
  const cliente = primero<Record<string, unknown>>(cli);
  const tickets = (tks.data ?? []) as { id: string; numero: number; asunto: string; estado_codigo: string; created_at: string }[];
  let estadosSop: { codigo: string; nombre: string; color: string | null }[] = [];
  if (tickets.length) {
    const { data } = await ctx.db.select("soporte_estados", "codigo, nombre, color");
    estadosSop = (data ?? []) as unknown as typeof estadosSop;
  }
  const prospecto = primero<{ id: string; numero_control: string; contacto: string; empresa: string | null; etapa: string; valor_estimado: number }>(pros);
  let etapaNombre: string | null = null;
  if (prospecto) {
    const { data } = await ctx.db.select("crm_etapas", "nombre").eq("codigo", prospecto.etapa).limit(1);
    etapaNombre = (data?.[0] as { nombre?: string } | undefined)?.nombre ?? prospecto.etapa;
  }

  return ok({
    contacto: { id: contacto.id, nombre: contacto.nombre, telefono: contacto.telefono, creado_at: contacto.created_at },
    cierre: conv.cerrada_at
      ? {
          fecha: conv.cerrada_at,
          estado: primero<{ nombre: string }>(cierreFam)?.nombre ?? null,
          subestado: primero<{ nombre: string }>(cierreSub)?.nombre ?? null,
          observacion: conv.cierre_observacion,
          por: primero<{ nombre: string }>(cierrePor)?.nombre ?? null,
          reabierta: conv.estado !== "cerrada",
        }
      : null,
    cliente: cliente
      ? {
          id: String(cliente.id),
          codigo: (cliente.codigo as string | null) ?? null,
          nombre: String(cliente.razon_social || cliente.nombre || ""),
          ruc: (cliente.ruc as string | null) ?? (cliente.documento as string | null) ?? null,
          telefono: (cliente.telefono as string | null) ?? null,
          email: (cliente.email as string | null) ?? null,
          ciudad: (cliente.ciudad as string | null) ?? null,
          activo: cliente.activo !== false && !cliente.baja_at,
          deuda: Number((saldo as { data: unknown }).data ?? 0),
          suscripciones: ((susc.data ?? []) as { id: string; plan_nombre: string; precio: number; moneda: string }[]).map((s) => ({
            ...s,
            precio: Number(s.precio),
          })),
          tickets: tickets.map((t) => {
            const e = estadosSop.find((x) => x.codigo === t.estado_codigo);
            return { ...t, numero: Number(t.numero), estado_nombre: e?.nombre ?? t.estado_codigo, estado_color: e?.color ?? null };
          }),
          ultima_tipificacion: primero(tip),
          vinculado_ahora: vinculadoAhora,
        }
      : null,
    prospecto: prospecto ? { ...prospecto, valor_estimado: Number(prospecto.valor_estimado ?? 0), etapa_nombre: etapaNombre } : null,
    previas: previas.map((p) => ({
      id: p.id,
      canal: p.canal?.nombre ?? "Canal",
      canal_tipo: p.canal?.tipo ?? "whatsapp",
      estado: p.estado,
      created_at: p.created_at,
      ultimo_mensaje_at: p.ultimo_mensaje_at,
      cerrada_at: p.cerrada_at,
      asignado: p.asignado?.nombre ?? null,
      cierre_estado: p.cierre_estado_id ? nombreCierre.get(p.cierre_estado_id) ?? null : null,
    })),
    proyectos: ((proy.data ?? []) as unknown as Proy[]).map((p) => ({
      id: p.id, numero: p.numero, titulo: p.titulo, estado: p.estado?.nombre ?? null, color: p.estado?.color ?? null,
    })),
  });
});
