/**
 * ¿El usuario puede abrir Monitoreo? (ADMIN o supervisor de una cola)
 *   GET /api/conversaciones/monitoreo/acceso → { puede }
 * Liviano: lo usa el panel Omnicanal para mostrarle la tarjeta a un supervisor de cola cuyo
 * nivel no es ADMIN (el menú y los perfiles solo la ofrecen al nivel ADMIN).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { puedeSupervisar } from "@/modules/conversaciones/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => ok({ puede: await puedeSupervisar(ctx) }));
