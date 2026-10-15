/**
 * Datos para convertir un presupuesto en venta. GET /api/presupuestos/[id]/conversion
 * → { presupuesto, cliente, lineas[] con el producto ACTUAL (precio, stock, activo) }.
 * Lo usan el aviso previo de la ficha ("Convertir a venta") y la precarga de la Caja
 * (/caja/nueva?presupuesto=<id>); los avisos se calculan con analizarConversion().
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { estadoEfectivo, ROLES_PRESUPUESTOS, type EstadoGuardado } from "@/modules/presupuestos/tipos";

const COLS_PROD =
  "id, nombre, sku, codigo_barras, precio_venta, precio_mayorista, precio_distribuidor, stock_actual, unidad_medida, tipo_iva, controla_stock, imagen_url, descuento_pct, activo, es_vendible";
const COLS_CLIENTE =
  "id, nombre, documento, tipo_cliente, razon_social, ruc, telefono, email, direccion, ciudad, condicion_pago, limite_credito, activo";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("presupuestos") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del presupuesto");

  const [p, i] = await Promise.all([
    ctx.db.select("presupuestos", "id, numero, revision, estado, valido_hasta, moneda, tipo_cambio, condicion, plazo_dias, descuento_pct, total, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono").eq("id", id).limit(1),
    ctx.db.select("presupuestos_items", "id, descripcion, cantidad, precio_unitario, precio_lista, descuento_pct, tipo_iva, total_final, producto_id").eq("presupuesto_id", id).order("orden", { ascending: true }),
  ]);
  if (p.error || i.error) return ERR.server();
  const pres = p.data?.[0] as unknown as (Record<string, unknown> & { estado: EstadoGuardado; valido_hasta: string; cliente_id: string | null }) | undefined;
  if (!pres) return ERR.notFound("presupuesto");
  const items = (i.data ?? []) as unknown as { id: string; producto_id: string | null; [k: string]: unknown }[];

  const ids = [...new Set(items.map((x) => x.producto_id).filter((x): x is string => !!x))];
  const [prods, cli] = await Promise.all([
    ids.length ? ctx.db.select("productos", COLS_PROD).in("id", ids) : Promise.resolve({ data: [], error: null }),
    pres.cliente_id ? ctx.db.select("clientes", COLS_CLIENTE).eq("id", pres.cliente_id).is("deleted_at", null).limit(1) : Promise.resolve({ data: [], error: null }),
  ]);
  if (prods.error || cli.error) return ERR.server();
  const porId = new Map(((prods.data ?? []) as unknown as { id: string }[]).map((x) => [x.id, x]));

  const { valido_hasta: _vh, ...cabecera } = pres;
  void _vh;
  return ok({
    presupuesto: { ...cabecera, estado: estadoEfectivo(pres.estado, pres.valido_hasta, hoyPY()) },
    cliente: (cli.data?.[0] as unknown) ?? null,
    lineas: items.map(({ id: itemId, producto_id, ...resto }) => ({
      item_id: itemId,
      ...resto,
      producto: producto_id ? porId.get(producto_id) ?? null : null,
    })),
  });
}, { roles: ROLES_PRESUPUESTOS });
