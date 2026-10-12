/**
 * Catálogos de Soporte.
 *   GET /api/soporte/catalogos → estados, tipos, clasificaciones (SLA), prioridades,
 *       el equipo (personas), la config (qa_activo, horario) y permisos de quien mira.
 *   PUT /api/soporte/catalogos { catalogo, codigo?, ...campos } → crea (sin codigo) o
 *       edita una fila. El `codigo` no se edita nunca: es lo que guardan los tickets.
 *       Solo ADMIN.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import {
  TABLAS_CATALOGO,
  accesoSoporte,
  cuerpo,
  falla,
  invalidarCatalogos,
  leerCatalogos,
  leerConfig,
  personasDeEmpresa,
  sinAccesoSoporte,
} from "@/modules/soporte/server";

export const GET = withTenant(async (ctx) => {
  const acc = await accesoSoporte(ctx);
  if (!acc) return sinAccesoSoporte();
  try {
    const [cat, personas, config] = await Promise.all([leerCatalogos(ctx), personasDeEmpresa(ctx), leerConfig(ctx)]);
    return ok({
      ...cat,
      personas,
      config,
      hay_equipo: personas.some((p) => p.es_tecnico || p.es_qa),
      puede_configurar: acc.puedeConfigurar,
      usuario_id: ctx.usuarioId,
    });
  } catch (e) {
    console.error("[soporte/catalogos]", (e as Error)?.message);
    return falla("No se pudieron leer los catálogos", 500);
  }
});

type Catalogo = keyof typeof TABLAS_CATALOGO;

/** Campos editables por catálogo. Lo que no está acá no se toca. */
const EDITABLES: Record<Catalogo, string[]> = {
  estados: ["nombre", "tipo", "color", "area", "detiene_sla", "sort_order", "activo"],
  tipos: ["nombre", "sla_horas", "sort_order", "activo"],
  clasificaciones: ["nombre", "sla_horas", "prioridad_sugerida", "sort_order", "activo"],
  prioridades: ["nombre", "color", "sort_order", "activo"],
};

function slug(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export const PUT = withTenant(
  async (ctx, req) => {
    const body = await cuerpo(req);
    const catalogo = body?.catalogo as Catalogo;
    if (!catalogo || !(catalogo in TABLAS_CATALOGO)) return falla("Catálogo inválido");
    const tabla = TABLAS_CATALOGO[catalogo];

    const patch: Record<string, unknown> = {};
    for (const campo of EDITABLES[catalogo]) {
      if (!body || !(campo in body)) continue;
      const v = body[campo];
      if (campo === "sla_horas") {
        if (v === null || v === "") patch[campo] = null;
        else {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0 || n > 10_000) return falla("SLA inválido");
          patch[campo] = n;
        }
      } else if (campo === "sort_order") {
        const n = Number(v);
        if (!Number.isInteger(n)) return falla("Orden inválido");
        patch[campo] = n;
      } else if (campo === "activo" || campo === "detiene_sla") {
        patch[campo] = v === true;
      } else if (campo === "tipo") {
        if (v !== "abierto" && v !== "cerrado") return falla("Tipo de estado inválido");
        patch[campo] = v;
      } else if (campo === "color") {
        if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return falla("Color inválido");
        patch[campo] = v;
      } else {
        patch[campo] = typeof v === "string" ? v.trim() || null : (v ?? null);
      }
    }
    if ("nombre" in patch && !patch.nombre) return falla("El nombre es obligatorio");

    const codigo = typeof body?.codigo === "string" ? body.codigo.trim() : "";
    if (codigo) {
      if (Object.keys(patch).length === 0) return falla("Nada para actualizar");
      const { error } = await ctx.db.update(tabla, patch).eq("codigo", codigo);
      if (error) return falla("No se pudo guardar el cambio");
    } else {
      const nombre = String(patch.nombre ?? "");
      if (!nombre) return falla("El nombre es obligatorio");
      const nuevo: Record<string, unknown> = { ...patch, codigo: slug(nombre) || crypto.randomUUID().slice(0, 8) };
      if (catalogo === "clasificaciones") {
        const tipo = typeof body?.tipo_codigo === "string" ? body.tipo_codigo : "";
        if (!tipo) return falla("La clasificación necesita un tipo");
        if (nuevo.sla_horas == null) return falla("La clasificación necesita un SLA");
        nuevo.tipo_codigo = tipo;
      }
      const { error } = await ctx.db.insert(tabla, nuevo);
      if (error) {
        if (error.code === "23505" || /duplicate/i.test(error.message)) return falla("Ya existe uno con ese nombre");
        return falla("No se pudo crear");
      }
    }
    invalidarCatalogos(ctx);
    return ok(await leerCatalogos(ctx));
  },
  { roles: ["ADMIN"] },
);
