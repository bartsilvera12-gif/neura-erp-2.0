/**
 * withTenant — el ÚNICO portón de las rutas de /api.
 *
 * Toda ruta se escribe así:
 *
 *   export const GET = withTenant(async (ctx) => ok(await ctx.db.select("clientes")));
 *   export const POST = withTenant(handler, { roles: ["ADMIN"], body: miSchema });
 *
 * Garantías (no dependen de que el programador se acuerde):
 *   1. sin sesión válida → 401
 *   2. empresa_id / usuario / rol salen de la BASE, nunca del request
 *   3. rol insuficiente → 403
 *   4. body inválido → 422 (validado con zod)
 *   5. ctx.db está atado a la empresa: imposible tocar datos de otra
 */
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import { authOnlyClient, userClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";
import { resolveTenantSession } from "@/lib/api/resolve-session";
import { TenantDb } from "@/lib/api/tenant-db";
import { ERR } from "@/lib/api/responses";

export type TenantContext = {
  user: User;
  usuarioId: string;
  empresaId: string;
  rol: string;
  schema: string;
  db: TenantDb;
};

type Options<B> = { roles?: string[]; body?: ZodType<B> };
type Handler<B> = (ctx: TenantContext, req: NextRequest, input: B) => Promise<Response> | Response;

function extractBearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7).trim() || null;
  return null;
}

async function safeJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function withTenant<B = unknown>(handler: Handler<B>, opts: Options<B> = {}) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const bearer = extractBearer(req);
      if (!bearer) return ERR.unauth();

      const { data, error } = await authOnlyClient().auth.getUser(bearer);
      if (error || !data.user?.id) return ERR.unauth();

      const session = await resolveTenantSession(data.user.id);
      if (!session) return ERR.forbidden();

      if (opts.roles && !opts.roles.includes(session.rol)) return ERR.forbidden();

      let input = undefined as unknown as B;
      if (opts.body) {
        const parsed = opts.body.safeParse(await safeJson(req));
        if (!parsed.success) {
          return ERR.invalid(parsed.error.issues.map((i) => i.message).join("; "));
        }
        input = parsed.data;
      }

      const schema = tenantSchema();
      // Cliente con la sesión del usuario → la RLS también aísla (doble red).
      const sb = userClient(bearer, schema);
      const db = new TenantDb(sb, session.empresaId);

      const ctx: TenantContext = {
        user: data.user,
        usuarioId: session.usuarioId,
        empresaId: session.empresaId,
        rol: session.rol,
        schema,
        db,
      };
      return await handler(ctx, req, input);
    } catch (e) {
      console.error("[withTenant]", (e as Error)?.message);
      return ERR.server();
    }
  };
}
