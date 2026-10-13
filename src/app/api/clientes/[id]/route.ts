/**
 * Cliente — ficha, edición y eliminación.
 *   GET    /api/clientes/[id]  → cliente (con código, categoría, vendedor, creado por, baja) +
 *                                estado de cuenta (saldo/límite) + últimas ventas + contactos +
 *                                resumen + cantidad de notas (ficha_cliente: UNA llamada a la base)
 *                                ?con=suscripciones → además `suscripciones` (facturacion_suscripciones)
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");
  // Un id que no es uuid no existe (y así la base no responde con error de tipo → 500).
  if (!UUID_RE.test(id)) return ERR.notFound();

  // Todo en UNA llamada (ficha_cliente, 46_clientes_rendimiento): antes eran 8 consultas en
  // paralelo (cliente, saldo, resumen, ventas, contactos, usuarios, categorías, notas) y la
  // ficha pedía aparte /facturacion. Misma forma de respuesta; `suscripciones` solo si se pide.
  const conSubs = new URL(req.url).searchParams.get("con") === "suscripciones";
  const { data, error } = await ctx.db.rpc<Record<string, unknown> | null>("ficha_cliente", { p_cliente: id, p_suscripciones: conSubs });
  if (error) return ERR.server();
  if (!data) return ERR.notFound();
  return ok(data);
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
