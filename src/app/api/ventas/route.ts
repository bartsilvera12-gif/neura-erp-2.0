/**
 * Ventas — listado paginado EN EL SERVIDOR para el dashboard de Caja (ÓRDENES DE VENTA).
 *
 *   GET /api/ventas?pagina=1&por_pagina=25&q=&tipo=&iva=&estado=&producto=&desde=&hasta=&caja=
 *     → { rows, total, total_general }
 *     caja=<id> | caja=abierta (la abierta si hay, si no todas); contar=0 → sin contar
 *     (total y total_general en null: el navegador ya los tiene para esos filtros)
 *
 * Antes se bajaban TODAS las ventas con sus ítems y se filtraba en el navegador: con
 * miles de ventas eran MB y segundos por cada apertura de la pantalla. Ahora la base
 * filtra, cuenta y devuelve solo la página visible (sin tope de cantidad: se recorre todo).
 *
 * Búsqueda inteligente: cada palabra (o su variante por error de tipeo) tiene que aparecer
 * en la columna `busqueda` de la venta — número, tipo, estado, cliente, cajero y nombre/SKU
 * de sus ítems, sin tildes (la mantiene un trigger, ver 19_busqueda.sql) — o ser el total exacto.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { condicionGrupo, variantesBusqueda } from "@/lib/api/busqueda-servidor";

const COLS = "id, numero_control, fecha, total, tipo_venta, estado, ventas_items(producto_nombre, sku, cantidad, tipo_iva)";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = ["CONTADO", "CREDITO"];
const ESTADOS = ["pendiente", "completada", "anulada", "parcialmente_devuelta", "devuelta_total"];
const IVAS = ["EXENTA", "5%", "10%"];

// Valor seguro dentro de un filtro or=(...) de PostgREST: sin comas, paréntesis, comillas.
const limpio = (t: string) => t.replace(/[,()"\\*:]/g, "").trim();

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const tipo = sp.get("tipo") ?? "";
  const estado = sp.get("estado") ?? "";
  const iva = sp.get("iva") ?? "";
  const producto = limpio(sp.get("producto") ?? "");
  const desde = sp.get("desde") ?? "";
  const hasta = sp.get("hasta") ?? "";
  const qCruda = (sp.get("q") ?? "").trim();
  // contar=0 → el navegador ya tiene los totales de estos mismos filtros (solo cambió de
  // página): no se vuelve a contar todo. Viajan total/total_general en null.
  const contar = sp.get("contar") !== "0";
  // caja=abierta → la caja abierta, si hay (si no, todas): así la pantalla no tiene que
  // esperar a saber cuál es la caja antes de pedir las ventas.
  const [grupos, cajaId] = await Promise.all([
    variantesBusqueda(ctx.db, qCruda),
    sp.get("caja") === "abierta"
      ? ctx.db
          .select("cajas", "id")
          .eq("estado", "abierta")
          .order("fecha_apertura", { ascending: false })
          .limit(1)
          .then((r) => ((r.data?.[0] as unknown as { id: string } | undefined)?.id ?? null))
      : Promise.resolve(sp.get("caja")),
  ]);
  // Totales escritos tal cual ("12.000" o "12000") se comparan exactos.
  const numeros = qCruda.split(/\s+/).map((t) => t.replace(/\./g, "")).filter((n) => /^\d{1,15}$/.test(n));

  // Embebidos con alias para filtrar SIN recortar la lista de ítems que se muestra.
  let cols = COLS;
  if (IVAS.includes(iva)) cols += ", fi:ventas_items!inner(id)";
  if (producto) cols += ", fp:ventas_items!inner(id)";

  let query = ctx.db.select("ventas", cols, contar ? { count: "exact" } : undefined);
  if (cajaId) query = query.eq("caja_id", cajaId);
  if (TIPOS.includes(tipo)) query = query.eq("tipo_venta", tipo);
  if (ESTADOS.includes(estado)) query = query.eq("estado", estado);
  if (IVAS.includes(iva)) query = query.eq("fi.tipo_iva", iva);
  if (producto) query = query.eq("fp.producto_nombre", producto);
  if (RE_FECHA.test(desde)) query = query.gte("fecha", `${desde}T00:00:00-03:00`);
  if (RE_FECHA.test(hasta)) query = query.lte("fecha", `${hasta}T23:59:59.999-03:00`);
  for (const g of grupos) {
    const n = numeros.find((x) => g.includes(x));
    query = query.or(condicionGrupo(g, "busqueda", n ? [`total.eq.${n}`] : []));
  }

  const desdeFila = (pagina - 1) * porPagina;
  // El total general (sin filtros) solo hace falta contarlo aparte si HAY filtros: sin
  // ninguno es el mismo número que el total de la consulta.
  const hayFiltros =
    TIPOS.includes(tipo) || ESTADOS.includes(estado) || IVAS.includes(iva) || !!producto ||
    RE_FECHA.test(desde) || RE_FECHA.test(hasta) || grupos.length > 0;
  // (el builder no sale a la base hasta que se lo espera)
  let general = ctx.db.select("ventas", "id", { count: "exact", head: true });
  if (cajaId) general = general.eq("caja_id", cajaId);

  const [res, gen] = await Promise.all([
    query
      .order("fecha", { ascending: false })
      .order("id", { ascending: false }) // orden estable entre páginas
      .range(desdeFila, desdeFila + porPagina - 1),
    contar && hayFiltros ? general : null,
  ]);
  // Página fuera de rango (p. ej. tras filtrar) → PostgREST da 416: se devuelve vacía.
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();

  const rows = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((v) => {
    // Los embebidos de filtro (fi, fp) no viajan al navegador.
    const { fi, fp, ...resto } = v;
    void fi;
    void fp;
    return resto;
  });
  if (!contar) return ok({ rows, total: null, total_general: null });
  const total = res.count ?? 0;
  // Sin filtros, el general es el mismo total (salvo página fuera de rango: ahí no vino).
  const totalGeneral = gen ? (gen.count ?? 0) : res.error ? ((await general).count ?? 0) : total;
  return ok({ rows, total, total_general: totalGeneral });
});
