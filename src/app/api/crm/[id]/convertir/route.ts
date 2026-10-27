/**
 * Transformar a cliente: crea el cliente con los datos del prospecto (origen CRM), lo
 * vincula y pasa el prospecto a la etapa de ganado (crm_convertir_cliente, una transacción).
 *   POST /api/crm/[id]/convertir { nombre?, tipo_cliente?, razon_social?, telefono?, email?,
 *                                  documento?, ruc?, ciudad?, direccion? } → { cliente_id, etapa }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { errorCrm, idProspecto } from "@/modules/crm/server";
import { rucFacturacion } from "@/modules/clientes/esquema";

export const dynamic = "force-dynamic";

const t = (max: number) => z.string().trim().max(max).optional().nullable();

const convertir = z.object({
  nombre: t(200),
  tipo_cliente: z.enum(["persona", "empresa"]).optional(),
  razon_social: t(200),
  telefono: t(40),
  email: t(200),
  documento: t(40),
  ruc: rucFacturacion(), // RUC con dígito verificador correcto (sin RUC válido no hay factura)
  ciudad: t(120),
  direccion: t(300),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idProspecto(req);
    if (!id) return ERR.notFound("Prospecto");
    const cliente = Object.fromEntries(Object.entries(input).filter(([, v]) => v != null && v !== ""));
    const { data, error } = await ctx.db.rpc<{ cliente_id: string }>("crm_convertir_cliente", { p_prospecto: id, p_cliente: cliente });
    if (error) return errorCrm(error, "No se pudo crear el cliente");
    // Etapa en la que quedó (la primera de ganado activa) para mover la tarjeta sin recargar.
    const { data: p } = await ctx.db.select("crm_prospectos", "etapa, updated_at, etapa_desde").eq("id", id).limit(1);
    const fila = p?.[0] as unknown as { etapa?: string; updated_at?: string; etapa_desde?: string } | undefined;
    return ok({ cliente_id: data?.cliente_id ?? null, etapa: fila?.etapa ?? null, updated_at: fila?.updated_at ?? null, etapa_desde: fila?.etapa_desde ?? null });
  },
  { body: convertir },
);
