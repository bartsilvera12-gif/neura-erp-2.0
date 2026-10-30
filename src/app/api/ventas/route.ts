/**
 * Ventas — listado paginado EN EL SERVIDOR para el dashboard de Caja (ÓRDENES DE VENTA).
 *
 *   GET /api/ventas?pagina=1&por_pagina=25&q=&tipo=&iva=&estado=&producto=&desde=&hasta=&caja=
 *                   &sucursal=&punto=&metodo=
 *     → { rows, total, total_general }
 *     caja=<turno> | caja=abierta (la del usuario si hay, si no todas); sucursal=<id>;
 *     punto=<caja / punto de venta>; metodo=efectivo|tarjeta_debito|tarjeta_credito|tarjeta|
 *     transferencia|qr|cheque|mixto (una venta mixta aparece en cada uno de sus métodos);
 *     contar=0 → sin contar (total y total_general en null: el navegador ya los tiene)
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
import { aplicarBusqueda, hayBusqueda, paginarConPrimeros, prepararBusqueda, primerosDe, restringirIds, type Primeros } from "@/lib/api/busqueda-servidor";

const COLS =
  "id, numero_control, fecha, total, tipo_venta, estado, metodo_pago, sucursal_id, punto_venta_id, usuario_nombre, " +
  "ventas_items(producto_nombre, sku, cantidad, tipo_iva), pagos:ventas_pagos_detalle(metodo_pago, monto), " +
  "punto:puntos_venta(nombre), sucursal:sucursales(nombre)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Forma de pago del filtro → los valores guardados en el detalle (POS viejos incluidos).
const METODOS: Record<string, string[]> = {
  efectivo: ["efectivo"],
  tarjeta_debito: ["tarjeta_debito", "pos_debito"],
  tarjeta_credito: ["tarjeta_credito", "pos_credito"],
  tarjeta: ["tarjeta", "pos"],
  transferencia: ["transferencia"],
  qr: ["qr", "billetera"],
  cheque: ["cheque"],
};
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
  const sucursal = UUID_RE.test(sp.get("sucursal") ?? "") ? (sp.get("sucursal") as string) : "";
  const punto = UUID_RE.test(sp.get("punto") ?? "") ? (sp.get("punto") as string) : "";
  const metodo = sp.get("metodo") ?? "";
  const filtroMetodo = Object.prototype.hasOwnProperty.call(METODOS, metodo) ? METODOS[metodo] : null;
  // contar=0 → el navegador ya tiene los totales de estos mismos filtros (solo cambió de
  // página): no se vuelve a contar todo. Viajan total/total_general en null.
  const contar = sp.get("contar") !== "0";
  // caja=abierta → la caja abierta, si hay (si no, todas): así la pantalla no tiene que
  // esperar a saber cuál es la caja antes de pedir las ventas.
  const [busqueda, cajaId] = await Promise.all([
    prepararBusqueda(ctx.db, "ventas", qCruda),
    sp.get("caja") === "abierta"
      ? ctx.db
          .rpc<string | null>("caja_abierta_para", {})
          .then((r) => (r.error ? null : (r.data ?? null)))
      : Promise.resolve(UUID_RE.test(sp.get("caja") ?? "") ? sp.get("caja") : null),
  ]);
  // Embebidos con alias para filtrar SIN recortar la lista de ítems que se muestra.
  let cols = COLS;
  if (IVAS.includes(iva)) cols += ", fi:ventas_items!inner(id)";
  if (producto) cols += ", fp:ventas_items!inner(id)";
  if (filtroMetodo) cols += ", fm:ventas_pagos_detalle!inner(id)";

  // Búsqueda precisa: "vta 17" / "VTA-000017" / "17" → solo esa venta; "26000" / "26.000" →
  // las de ese total primero y después el resto que coincide por texto.
  const armar = (r: Primeros) => {
    let query = ctx.db.select("ventas", cols, contar ? { count: "exact" } : undefined);
    if (cajaId) query = query.eq("caja_id", cajaId);
    if (TIPOS.includes(tipo)) query = query.eq("tipo_venta", tipo);
    if (sucursal) query = query.eq("sucursal_id", sucursal);
    if (punto) query = query.eq("punto_venta_id", punto);
    if (filtroMetodo) query = query.in("fm.metodo_pago", filtroMetodo);
    else if (metodo === "mixto") query = query.eq("metodo_pago", "mixto");
    if (ESTADOS.includes(estado)) query = query.eq("estado", estado);
    if (IVAS.includes(iva)) query = query.eq("fi.tipo_iva", iva);
    if (producto) query = query.eq("fp.producto_nombre", producto);
    if (RE_FECHA.test(desde)) query = query.gte("fecha", `${desde}T00:00:00-03:00`);
    if (RE_FECHA.test(hasta)) query = query.lte("fecha", `${hasta}T23:59:59.999-03:00`);
    query = restringirIds(aplicarBusqueda(query, busqueda), r);
    return query
      .order("fecha", { ascending: false })
      .order("id", { ascending: false }); // orden estable entre páginas
  };

  const desdeFila = (pagina - 1) * porPagina;
  // El total general (sin filtros) solo hace falta contarlo aparte si HAY filtros: sin
  // ninguno es el mismo número que el total de la consulta.
  const hayFiltros =
    TIPOS.includes(tipo) || ESTADOS.includes(estado) || IVAS.includes(iva) || !!producto ||
    !!sucursal || !!punto || !!filtroMetodo || metodo === "mixto" ||
    RE_FECHA.test(desde) || RE_FECHA.test(hasta) || hayBusqueda(busqueda);
  // (el builder no sale a la base hasta que se lo espera)
  let general = ctx.db.select("ventas", "id", { count: "exact", head: true });
  if (cajaId) general = general.eq("caja_id", cajaId);

  const [res, gen] = await Promise.all([
    paginarConPrimeros(armar, primerosDe(busqueda), desdeFila, porPagina),
    contar && hayFiltros ? general : null,
  ]);
  // Página fuera de rango (p. ej. tras filtrar) → PostgREST da 416: se devuelve vacía.
  if (res.error && (res.error as { code?: string }).code !== "PGRST103") return ERR.server();

  const rows = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((v) => {
    // Los embebidos de filtro (fi, fp) no viajan al navegador.
    const { fi, fp, fm, ...resto } = v;
    void fi;
    void fp;
    void fm;
    return resto;
  });
  if (!contar) return ok({ rows, total: null, total_general: null });
  const total = res.count ?? 0;
  // Sin filtros, el general es el mismo total (salvo página fuera de rango: ahí no vino).
  const totalGeneral = gen ? (gen.count ?? 0) : res.error ? ((await general).count ?? 0) : total;
  return ok({ rows, total, total_general: totalGeneral });
});
