/**
 * Cálculo de comisiones (traído de sistemas-propio). Sin base de datos: recibe lo que devuelve
 * comisiones_datos y arma la vista previa del mes. No liquida ni guarda nada.
 *
 *   Comisión del vendedor = base comisionable × % del tramo + premio fijo del tramo.
 *   El tramo es el último cuyo "desde" alcanza la base. La comisión por línea reparte solo la parte
 *   variable, en proporción a cada monto; el premio fijo no se reparte.
 */
import { MESES } from "@/components/graficos/formato";
import type { ACobrarDatos, ACobrarVendedor, DatosComisiones, Escala, Linea, Origen, PreviewComisiones, ProgresoEscala, RecurrenciaDatos, VendedorFila } from "@/modules/comisiones/tipos";

const redondear = (n: number) => Math.round(n * 100) / 100;

export function ordenarEscalas(escalas: Escala[]): Escala[] {
  return [...escalas].sort((a, b) => Number(a.desde_monto) - Number(b.desde_monto) || a.orden - b.orden);
}

export function resolverTramo(base: number, escalas: Escala[]): Escala | null {
  let tramo: Escala | null = null;
  for (const e of ordenarEscalas(escalas)) if (base >= Number(e.desde_monto)) tramo = e;
  return tramo;
}

/** Reparte `total` en proporción a `montos`; lo que sobra del redondeo va a la última línea. */
export function repartoProporcional(total: number, montos: number[]): number[] {
  const suma = montos.reduce((a, b) => a + b, 0);
  if (suma <= 0 || total <= 0) return montos.map(() => 0);
  const partes = montos.map((m) => redondear((total * m) / suma));
  const resto = redondear(total - partes.reduce((a, b) => a + b, 0));
  if (partes.length && Math.abs(resto) >= 0.005) partes[partes.length - 1] = redondear(partes[partes.length - 1] + resto);
  return partes;
}

/** Excluir/incluir manual del mes → marca de la venta → toda venta que no sea de suscripción (receta 116). */
export function resolverComisionable(input: {
  override: "incluir" | "excluir" | null;
  comisionable: boolean | null;
  tieneSuscripcion: boolean;
}): { comisiona: boolean; origen: Origen } {
  if (input.override === "excluir") return { comisiona: false, origen: "override_excluir" };
  if (input.override === "incluir") return { comisiona: true, origen: "override_incluir" };
  if (input.comisionable !== null) return { comisiona: input.comisionable, origen: "factura" };
  return { comisiona: !input.tieneSuscripcion, origen: "auto" };
}

export function progresoEscala(base: number, escalas: Escala[]): ProgresoEscala {
  const orden = ordenarEscalas(escalas);
  if (!orden.length) {
    return { escala_actual_porcentaje: null, escala_actual_premio_fijo: null, siguiente_escala_desde: null, siguiente_escala_porcentaje: null, falta_para_siguiente_escala: null, progreso_hacia_siguiente_pct: null, max_escala_alcanzada: false };
  }
  let i = -1;
  orden.forEach((e, k) => { if (base >= Number(e.desde_monto)) i = k; });
  const actual = i >= 0 ? orden[i] : null;
  const siguiente = orden[i + 1] ?? null;
  const desdeSiguiente = siguiente ? Number(siguiente.desde_monto) : null;
  let progreso: number | null = null;
  if (desdeSiguiente !== null) {
    const piso = actual ? Number(actual.desde_monto) : 0;
    const tramo = desdeSiguiente - piso;
    progreso = Math.max(0, Math.min(100, Math.round(tramo > 0 ? ((base - piso) / tramo) * 100 : 100)));
  }
  return {
    escala_actual_porcentaje: actual ? Number(actual.porcentaje_comision) : null,
    escala_actual_premio_fijo: actual ? Number(actual.premio_fijo) || 0 : null,
    siguiente_escala_desde: desdeSiguiente,
    siguiente_escala_porcentaje: siguiente ? Number(siguiente.porcentaje_comision) : null,
    falta_para_siguiente_escala: desdeSiguiente === null ? null : Math.max(0, redondear(desdeSiguiente - base)),
    progreso_hacia_siguiente_pct: progreso,
    max_escala_alcanzada: !!actual && !siguiente,
  };
}

export function etiquetaMes(mes: string): string {
  const [a, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? ""} de ${a}`;
}

export function armarPreview(datos: DatosComisiones, mes: string): PreviewComisiones {
  const vacia = { es_admin: datos.es_admin, mes, periodo: etiquetaMes(mes) };
  if (datos.estado !== "ok") return { ...vacia, estado: datos.estado, politica_nombre: null, base_calculo: null, kpis: null, por_vendedor: [] };

  const nombre = (id: string) => datos.nombres[id] ?? "Sin nombre";
  const overrides = new Map(datos.overrides.map((o) => [o.pago_id, o]));
  // RR HH: marcado "Comisiona: no" (receta 118).
  const noComisionan = new Set(datos.no_comisionan ?? []);

  // Líneas con su decisión; las que no tienen vendedor solo cuentan para el aviso.
  let sinVendedor = 0;
  const porVendedor = new Map<string, Linea[]>();
  for (const l of datos.lineas) {
    if (!l.vendedor_usuario_id) { sinVendedor++; continue; }
    if (noComisionan.has(l.vendedor_usuario_id)) continue;
    const ov = l.pago_id ? overrides.get(l.pago_id) ?? null : null;
    const { comisiona, origen } = resolverComisionable({ override: ov?.decision ?? null, comisionable: l.comisionable, tieneSuscripcion: l.tiene_suscripcion });
    const lista = porVendedor.get(l.vendedor_usuario_id) ?? [];
    lista.push({
      tipo: l.tipo, cliente_id: l.cliente_id, cliente_label: l.cliente_label, factura_id: l.factura_id, numero_factura: l.numero_factura,
      pago_id: l.pago_id, fecha: l.fecha, monto_base: Number(l.monto_base), cobrado_periodo: Number(l.cobrado_periodo), saldo_pendiente: Number(l.saldo_pendiente),
      pendiente_por_comisionar: Number(l.pendiente_por_comisionar), cliente_alta: l.cliente_alta, factura_monto_total: Number(l.factura_monto_total),
      vendedor_usuario_id: l.vendedor_usuario_id, monto_suscripcion: l.monto_suscripcion === null ? null : Number(l.monto_suscripcion),
      comisiona, origen, comision_estimada_linea: 0, override_motivo: ov?.motivo ?? null, override_por: ov?.decidido_por ?? null,
    });
    porVendedor.set(l.vendedor_usuario_id, lista);
  }

  // A cobrar: solo lo comisionable (sin excluir/incluir: esa decisión es por pago, y acá no hay pago).
  const aCobrar = new Map<string, ACobrarVendedor>();
  for (const f of datos.a_cobrar) {
    if (noComisionan.has(f.vendedor_usuario_id)) continue;
    const { comisiona } = resolverComisionable({ override: null, comisionable: f.comisionable, tieneSuscripcion: f.tiene_suscripcion });
    if (!comisiona) continue;
    const g: ACobrarVendedor = aCobrar.get(f.vendedor_usuario_id) ?? { vendedor_usuario_id: f.vendedor_usuario_id, vendedor_nombre: nombre(f.vendedor_usuario_id), total_a_cobrar: 0, facturas: [] as ACobrarDatos[] };
    g.total_a_cobrar = redondear(g.total_a_cobrar + Number(f.saldo_pendiente));
    g.facturas.push(f);
    aCobrar.set(f.vendedor_usuario_id, g);
  }

  const recurrencia = new Map<string, RecurrenciaDatos[]>();
  let recurrenciaTotal = 0;
  for (const r of datos.recurrencia) {
    recurrenciaTotal += Number(r.monto);
    if (!r.vendedor_usuario_id || noComisionan.has(r.vendedor_usuario_id)) continue;
    recurrencia.set(r.vendedor_usuario_id, [...(recurrencia.get(r.vendedor_usuario_id) ?? []), r]);
  }

  // Quien solo tiene deuda o recurrencia, sin movimientos del mes, en la vista propia también se ve.
  const ids = new Set(porVendedor.keys());
  if (!datos.es_admin) { for (const k of aCobrar.keys()) ids.add(k); for (const k of recurrencia.keys()) ids.add(k); }

  const filas: VendedorFila[] = [...ids].map((id) => {
    const lineas = porVendedor.get(id) ?? [];
    const comisionables = lineas.filter((l) => l.comisiona);
    const base = comisionables.reduce((s, l) => s + l.monto_base, 0);
    const tramo = resolverTramo(base, datos.escalas);
    const pct = tramo ? Number(tramo.porcentaje_comision) : 0;
    const variable = (base * pct) / 100;
    const premio = tramo && base > 0 ? Number(tramo.premio_fijo) || 0 : 0;
    const partes = repartoProporcional(variable, comisionables.map((l) => l.monto_base));
    comisionables.forEach((l, i) => { l.comision_estimada_linea = partes[i] ?? 0; });
    const items = recurrencia.get(id) ?? [];
    const ac = aCobrar.get(id) ?? null;
    return {
      ...progresoEscala(base, datos.escalas),
      vendedor_usuario_id: id,
      vendedor_nombre: nombre(id),
      cantidad_movimientos: lineas.length,
      revenue_base: redondear(base),
      porcentaje_tramo: pct,
      comision_variable: redondear(variable),
      premio_fijo_aplicado: redondear(premio),
      comision_estimada: redondear(variable + premio),
      a_cobrar_total: ac?.total_a_cobrar ?? 0,
      recurrencia_mes: items.reduce((s, r) => s + Number(r.monto), 0),
      lineas,
      a_cobrar: ac,
      recurrencia_items: items,
    };
  }).sort((a, b) => b.revenue_base - a.revenue_base);

  return {
    ...vacia,
    estado: "ok",
    politica_nombre: datos.politica.nombre,
    base_calculo: datos.politica.base_calculo,
    por_vendedor: filas,
    kpis: {
      revenue_base_total: redondear(filas.reduce((s, f) => s + f.revenue_base, 0)),
      comision_variable_total: redondear(filas.reduce((s, f) => s + f.comision_variable, 0)),
      premio_fijo_total: redondear(filas.reduce((s, f) => s + f.premio_fijo_aplicado, 0)),
      comision_estimada_total: redondear(filas.reduce((s, f) => s + f.comision_estimada, 0)),
      a_cobrar_total: redondear([...aCobrar.values()].reduce((s, a) => s + a.total_a_cobrar, 0)),
      lineas_excluidas: filas.reduce((s, f) => s + f.lineas.filter((l) => !l.comisiona).length, 0),
      recurrencia_total: recurrenciaTotal,
      fuentes_sin_vendedor: datos.es_admin ? sinVendedor : 0,
    },
  };
}
