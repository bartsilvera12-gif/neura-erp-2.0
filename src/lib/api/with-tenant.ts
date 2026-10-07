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

// ── Cache de verificación del token ─────────────────────────────────────────
// Cada request validaba el token contra el servidor de auth (un viaje de red, ~70 ms
// desde fuera de la VPS). Se recuerda el resultado por token unos segundos: nunca más
// allá de su vencimiento (exp del JWT). Un logout/revocación tarda a lo sumo TOKEN_TTL_MS
// en surtir efecto en la API; la RLS de la base sigue validando el token en cada query.
const TOKEN_TTL_MS = 30_000;
const TOKEN_CACHE_MAX = 1000;
const tokenCache = new Map<string, { user: User; hasta: number }>();

function expDelJwt(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function usuarioDelToken(token: string): Promise<User | null> {
  const ahora = Date.now();
  const hit = tokenCache.get(token);
  if (hit && hit.hasta > ahora) return hit.user;
  if (hit) tokenCache.delete(token);

  const { data, error } = await authOnlyClient().auth.getUser(token);
  if (error || !data.user?.id) return null;

  const exp = expDelJwt(token);
  const hasta = Math.min(ahora + TOKEN_TTL_MS, exp ?? ahora);
  if (hasta > ahora) {
    if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value!);
    tokenCache.set(token, { user: data.user, hasta });
  }
  return data.user;
}

export function withTenant<B = unknown>(handler: Handler<B>, opts: Options<B> = {}) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const bearer = extractBearer(req);
      if (!bearer) return ERR.unauth();

      const user = await usuarioDelToken(bearer);
      if (!user) return ERR.unauth();

      const session = await resolveTenantSession(user.id);
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
        user,
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
