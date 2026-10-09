/**
 * Cliente — ficha, edición y eliminación.
 *   GET    /api/clientes/[id]  → cliente (con código, categoría, vendedor, creado por, baja) +
 *                                estado de cuenta (saldo/límite) + últimas ventas + contactos +
 *                                resumen + cantidad de notas
 *   PATCH  /api/clientes/[id]  → edita campos. activo: true también levanta una baja.
 *   DELETE /api/clientes/[id]  → { motivo } eliminación lógica, solo ADMIN. Bloqueada si tiene
 *                                ventas o deuda (en ese caso, dar de baja).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import { documentoRepetido } from "@/modules/clientes/server";
import { camposCliente, errorSifen, limpiarVacios } from "@/modules/clientes/esquema";

/** Saca el id de /api/clientes/<id>[/...]. withTenant no reenvía los params de Next. */
function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const DETALLE =
  "id, codigo, nombre, razon_social, tipo_cliente, documento, ruc, nombre_contacto, telefono, telefono_secundario, email, email_secundario, " +
  "direccion, ciudad, pais, sitio_web, instagram, linkedin, categoria_id, valor_anual, moneda_preferida, condicion_pago, plazo_dias, " +
  "limite_credito, origen, notas, activo, vendedor_usuario_id, vendedor_texto, created_by, creado_at, updated_at, baja_at, baja_por, " +
  "baja_motivo, sifen_naturaleza, sifen_ti_ope, sifen_extranjero, sifen_pais_iso3, sifen_tipo_documento, sifen_num_id, sifen_direccion, sifen_numero_casa";

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");

  // Lecturas independientes: van juntas (1 viaje). Usuarios y categorías son listas cortas
  // de la empresa: se resuelven los nombres acá en vez de pedir joins.
  const [cli, saldo, resumen, ventas, contactos, usuarios, categorias, notas] = await Promise.all([
    ctx.db.select("clientes", DETALLE).eq("id", id).is("deleted_at", null).limit(1),
    ctx.db.rpc<number>("cliente_saldo", { p_cliente_id: id }),
    ctx.db.rpc("resumen_cliente", { p_cliente: id }),
    ctx.db
      .select("ventas", "id, numero_control, fecha, total, tipo_venta, estado")
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })
      .limit(50),
    ctx.db
      .select("cliente_contactos", "id, nombre, cargo, telefono, email, notas")
      .eq("cliente_id", id)
      .order("created_at", { ascending: true }),
    ctx.db.select("usuarios", "id, nombre"),
    ctx.db.select("cliente_categorias", "id, nombre, color"),
    ctx.db.select("cliente_notas", "id", { count: "exact", head: true }).eq("cliente_id", id),
  ]);
  if (cli.error) return ERR.server();
  if (!cli.data?.length) return ERR.notFound();

  const c = cli.data[0] as unknown as Record<string, unknown> & {
    limite_credito: number | null; vendedor_usuario_id: string | null; vendedor_texto: string | null;
    created_by: string | null; baja_por: string | null; categoria_id: string | null;
  };
  const nombreUsuario = new Map(((usuarios.data ?? []) as unknown as { id: string; nombre: string }[]).map((u) => [u.id, u.nombre]));
  const cat = ((categorias.data ?? []) as unknown as { id: string; nombre: string; color: string | null }[]).find((x) => x.id === c.categoria_id);
  const cliente = {
    ...c,
    categoria_nombre: cat?.nombre ?? null,
    categoria_color: cat?.color ?? null,
    vendedor_nombre: (c.vendedor_usuario_id ? nombreUsuario.get(c.vendedor_usuario_id) : null) ?? c.vendedor_texto ?? null,
    creado_por_nombre: c.created_by ? nombreUsuario.get(c.created_by) ?? null : null,
    baja_por_nombre: c.baja_por ? nombreUsuario.get(c.baja_por) ?? null : null,
  };
  const saldoNum = Number(saldo.data ?? 0);
  const limite = Number(c.limite_credito ?? 0);
  return ok({
    cliente,
    estado_cuenta: {
      saldo: saldoNum,
      limite_credito: limite,
      disponible: limite > 0 ? Math.max(0, limite - saldoNum) : null,
    },
    ventas: ventas.data ?? [],
    contactos: contactos.data ?? [],
    resumen: resumen.data ?? null,
    notas_count: notas.count ?? 0,
  });
});

const editarCliente = z.object({ ...camposCliente, activo: z.boolean().optional() });

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const sifen = errorSifen(input);
    if (sifen) return ERR.invalid(sifen);

    const patch: Record<string, unknown> = { ...limpiarVacios(input), updated_at: new Date().toISOString() };
    if (input.condicion_pago === "CONTADO") patch.plazo_dias = null;
    if (input.sifen_extranjero === false) patch.sifen_pais_iso3 = "PRY";
    // Reactivar levanta también una baja (vuelve a ser cliente).
    if (input.activo === true) Object.assign(patch, { baja_at: null, baja_por: null, baja_motivo: null });
    const doc = input.documento?.trim();
    if (doc) {
      const dup = await documentoRepetido(ctx.db, doc, id);
      if (dup) return fail(`Ya existe un cliente con el documento ${doc} (${dup}).`, 409);
    }
    const { data, error } = await ctx.db.update("clientes", patch).eq("id", id).is("deleted_at", null).select("id");
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return fail("Ya existe un cliente con ese documento.", 409);
      if (/foreign key/i.test(error.message)) return ERR.invalid("La categoría o el vendedor elegido ya no existe.");
      return ERR.server();
    }
    if (!data?.length) return ERR.notFound("Cliente");
    return ok({ id });
  },
  { roles: ["ADMIN", "VENDEDOR"], body: editarCliente },
);

const eliminar = z.object({ motivo: z.string().trim().min(3, "Escribí el motivo").max(500) });

export const DELETE = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const pre = await ctx.db.rpc<{ ventas: number; deuda: number }>("cliente_eliminar_preview", { p_cliente: id });
    if (pre.error || !pre.data) return ERR.server();
    if (Number(pre.data.ventas) > 0 || Number(pre.data.deuda) > 0) {
      return fail("No se puede eliminar: tiene ventas o deuda. Dalo de baja: deja de ser cliente y se conserva su historial.", 409);
    }
    const { data, error } = await ctx.db
      .update("clientes", {
        deleted_at: new Date().toISOString(),
        deleted_by: ctx.usuarioId,
        deleted_motivo: input.motivo,
        activo: false,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id");
    if (error) return ERR.server();
    if (!data?.length) return ERR.notFound("Cliente");
    return noContent();
  },
  { roles: ["ADMIN"], body: eliminar },
);
