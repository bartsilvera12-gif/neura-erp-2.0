"use client";

/**
 * Pantallas de la cuenta en el celular (receta 88): Ver consumo, Separar cuenta y Datos de
 * facturación. Todo lo que se muestra viene de /api/publico/mesas/<token>/cuenta; los montos
 * por persona son una vista previa con la misma cuenta que hace la base (redondeo por línea).
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChefHat, Clock3, FileText, Loader2, Minus, Pencil, Plus, Search, Split, Trash2, UserPlus, Users, X } from "lucide-react";
import type { CuentaPublica, DivisionEnviar, ItemCuentaPublica } from "@/modules/mesas/publico";
import { cant, gs } from "@/modules/mesas/tipos";
import { normalizarRuc, rucSugerido, validarRuc } from "@/modules/empresa/tipos";
import { AVISO_ALERTA, AVISO_ERROR, AVISO_INFO, AVISO_OK, BOTON_SEC, DIVIDE, INPUT, LINEA, SUAVE, TARJETA, TENUE, TEXTO } from "./estilos";

export type CuentaAbierta = Extract<CuentaPublica, { abierta: true }>;
/** POST a /cuenta: devuelve lo que contesta la base (la cuenta actualizada o el resultado). */
export type AccionCuenta = <T = CuentaPublica>(body: Record<string, unknown>) => Promise<T>;

const ESTADO_ITEM: Record<ItemCuentaPublica["estado"], { texto: string; clase: string; Icono: typeof Clock3 }> = {
  aceptado: { texto: "Confirmado", clase: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300", Icono: Clock3 },
  en_preparacion: { texto: "En preparación", clase: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300", Icono: ChefHat },
  listo: { texto: "Listo", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300", Icono: CheckCircle2 },
  entregado: { texto: "Entregado", clase: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", Icono: Check },
};

/** Sin cuenta abierta todavía (o sin nada confirmado). */
export function SinConsumo({ texto, onPedir, color }: { texto: string; onPedir: () => void; color: string }) {
  return (
    <div className={`${TARJETA} mt-3 px-6 py-10 text-center`}>
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><FileText className="h-6 w-6" aria-hidden /></span>
      <p className={`mt-3 text-sm ${SUAVE}`}>{texto}</p>
      <button type="button" onClick={onPedir} className="mt-4 inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Hacer pedido</button>
    </div>
  );
}

// ── Ver consumo ──────────────────────────────────────────────────────────────
export function VistaConsumo({ cuenta, color, onSeparar, onPedirCuenta, pidiendo }: {
  cuenta: CuentaAbierta; color: string; onSeparar: () => void; onPedirCuenta: () => void; pidiendo: boolean;
}) {
  const porPedido = useMemo(() => {
    const m = new Map<number, ItemCuentaPublica[]>();
    for (const it of cuenta.items) m.set(it.pedido, [...(m.get(it.pedido) ?? []), it]);
    return [...m.entries()];
  }, [cuenta.items]);
  const unidades = cuenta.items.reduce((a, i) => a + Number(i.cantidad), 0);
  const falta = Math.max(0, cuenta.total - cuenta.cobrado);
  return (
    <div className="mt-3 space-y-3">
      <section className={`${TARJETA} px-4 py-4`}>
        <p className={`text-xs font-semibold uppercase tracking-wider ${SUAVE}`}>Consumo de la mesa</p>
        <p className={`mt-1 text-3xl font-bold tabular-nums ${TEXTO}`}>{gs(cuenta.total)}</p>
        <p className={`text-sm ${SUAVE}`}>{cant(unidades)} producto{unidades === 1 ? "" : "s"} · {porPedido.length} pedido{porPedido.length === 1 ? "" : "s"}</p>
        {cuenta.cobrado > 0 ? (
          <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${AVISO_OK}`}>Ya se pagó {gs(cuenta.cobrado)} · falta {gs(falta)}</p>
        ) : null}
      </section>
      {cuenta.pendientes > 0 ? (
        <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${AVISO_ALERTA}`}>
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {cuenta.pendientes === 1 ? "Hay un pedido esperando que la caja lo confirme: se suma cuando lo acepten." : `Hay ${cuenta.pendientes} pedidos esperando que la caja los confirme: se suman cuando los acepten.`}
        </p>
      ) : null}
      {cuenta.items.length === 0 ? (
        <p className={`${TARJETA} px-4 py-8 text-center text-sm ${SUAVE}`}>Todavía no hay productos confirmados en la cuenta.</p>
      ) : (
        <section className={`${TARJETA} overflow-hidden`}>
          {porPedido.map(([n, items], gi) => (
            <div key={n} className={gi ? `border-t ${LINEA}` : ""}>
              <p className={`bg-slate-50/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider dark:bg-slate-800/40 ${SUAVE}`}>Pedido #{n}</p>
              <ul className={`divide-y ${DIVIDE}`}>
                {items.map((it) => {
                  const e = ESTADO_ITEM[it.estado] ?? ESTADO_ITEM.aceptado;
                  return (
                    <li key={it.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className={`w-8 shrink-0 pt-0.5 text-sm font-bold tabular-nums ${TEXTO}`}>{cant(it.cantidad)}×</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium ${TEXTO}`}>{it.nombre}</p>
                        {it.modificadores_texto ? <p className={`text-xs ${SUAVE}`}>{it.modificadores_texto}</p> : null}
                        <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}><e.Icono className="h-3 w-3" aria-hidden />{e.texto}</span>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${TEXTO}`}>{gs(it.total)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className={`flex items-baseline justify-between border-t px-4 py-3 ${LINEA}`}>
            <span className={`text-sm ${SUAVE}`}>Total</span>
            <span className={`text-lg font-bold tabular-nums ${TEXTO}`}>{gs(cuenta.total)}</span>
          </div>
        </section>
      )}
      {cuenta.division ? <ResumenDivision cuenta={cuenta} /> : null}
      {cuenta.items.length ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onSeparar} className={BOTON_SEC}><Split className="h-4 w-4" aria-hidden /> {cuenta.division ? "Ver división" : "Separar cuenta"}</button>
          {!cuenta.solicitada_at && !cuenta.en_caja ? (
            <button type="button" onClick={onPedirCuenta} disabled={pidiendo} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>
              {pidiendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />} Pedir la cuenta
            </button>
          ) : (
            <span className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-center text-sm font-semibold ${AVISO_OK}`}><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Cuenta pedida</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** "Cuenta separada: Ana Gs. 30.000 · Beto Gs. 15.500 · Resto …" */
function ResumenDivision({ cuenta }: { cuenta: CuentaAbierta }) {
  const d = cuenta.division!;
  return (
    <section className={`${TARJETA} px-4 py-3`}>
      <p className={`flex items-center gap-2 text-sm font-semibold ${TEXTO}`}><Users className="h-4 w-4" aria-hidden /> Cuenta separada {d.modo === "iguales" ? "en partes iguales" : "por productos"}</p>
      <ul className="mt-2 space-y-1">
        {d.partes.map((p) => (
          <li key={p.numero} className="flex items-center gap-2 text-sm">
            <span className={`min-w-0 flex-1 truncate ${TEXTO}`}>{p.nombre}</span>
            {p.cobrada ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Pagada</span> : null}
            {p.facturacion ? <span className={`text-[11px] ${SUAVE}`}>Factura</span> : null}
            <span className={`shrink-0 font-semibold tabular-nums ${TEXTO}`}>{gs(p.total)}</span>
          </li>
        ))}
        {d.resto ? (
          <li className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-amber-700 dark:text-amber-300">Sin asignar (se paga aparte)</span>
            <span className="shrink-0 font-semibold tabular-nums text-amber-700 dark:text-amber-300">{gs(d.resto.total)}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

// ── Separar cuenta ───────────────────────────────────────────────────────────
type Asig = { modo: "unidades"; por: number[] } | { modo: "compartido"; entre: number[] };

/** Reparte `q` unidades entre `k` con 3 decimales (los milésimos que sobran, a los primeros). */
function repartoMilesimos(q: number, k: number, desde = 0): number[] {
  const milli = Math.round(q * 1000);
  const base = Math.floor(milli / k);
  const rem = milli - base * k;
  return Array.from({ length: k }, (_, i) => (base + ((((i - desde) % k) + k) % k < rem ? 1 : 0)) / 1000);
}

const esEntero = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

function asigInicial(cuenta: CuentaAbierta): { nombres: string[]; asig: Record<string, Asig>; modo: "productos" | "iguales"; n: number } {
  const d = cuenta.division;
  const partes = (d?.partes ?? []).filter((p) => !p.es_resto);
  const nombres = partes.length >= 2 ? partes.map((p) => p.nombre) : ["Persona 1", "Persona 2"];
  const asig: Record<string, Asig> = {};
  if (d && d.modo === "productos") {
    for (const it of cuenta.items) {
      const tiene = partes.map((p) => Number(p.items.find((x) => x.item_id === it.id)?.cantidad ?? 0));
      const con = tiene.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
      if (!con.length) continue;
      if (tiene.every(esEntero) && !(Number(it.cantidad) === 1 && con.length > 1)) {
        asig[it.id] = Number(it.cantidad) === 1 ? { modo: "compartido", entre: con } : { modo: "unidades", por: tiene.map((c) => Math.round(c)) };
      } else {
        asig[it.id] = { modo: "compartido", entre: con };
      }
    }
  }
  return { nombres, asig, modo: d?.modo ?? "productos", n: d?.modo === "iguales" ? d.personas : Math.max(2, nombres.length) };
}

/** Cantidad de cada persona para un ítem (misma cuenta que se manda a la base). */
function cantidadesDe(a: Asig | undefined, q: number, n: number): number[] {
  const out = Array.from({ length: n }, () => 0);
  if (!a) return out;
  if (a.modo === "unidades") { a.por.forEach((c, i) => { if (i < n) out[i] = c; }); return out; }
  const entre = a.entre.filter((i) => i < n);
  if (!entre.length) return out;
  const r = repartoMilesimos(q, entre.length);
  entre.forEach((p, j) => { out[p] = r[j]; });
  return out;
}

export function VistaSeparar({ cuenta, color, accion, onListo, aviso }: {
  /** `onListo(c, aviso)`: la pantalla se vuelve a armar con la división nueva; el aviso lo guarda el padre. */
  cuenta: CuentaAbierta; color: string; accion: AccionCuenta; onListo: (c: CuentaPublica, aviso?: string) => void; aviso?: string | null;
}) {
  const ini = useMemo(() => asigInicial(cuenta), [cuenta.division?.actualizada_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [modo, setModo] = useState<"productos" | "iguales">(ini.modo);
  const [nombres, setNombres] = useState<string[]>(ini.nombres);
  const [nIguales, setNIguales] = useState(ini.modo === "iguales" ? ini.n : 2);
  const [asig, setAsig] = useState<Record<string, Asig>>(ini.asig);
  const [conResto, setConResto] = useState(!!cuenta.division?.resto);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(aviso ?? null);
  const [editando, setEditando] = useState<number | null>(null);

  const bloqueada = !!cuenta.division?.partes.some((p) => p.cobrada);
  const items = cuenta.items;
  const n = modo === "iguales" ? nIguales : nombres.length;
  const nombreDe = (i: number) => (nombres[i]?.trim() || `Persona ${i + 1}`);

  // Montos por persona (vista previa): redondeo por línea, igual que la base.
  const { montos, sinAsignar, faltan } = useMemo(() => {
    const m = Array.from({ length: n }, () => 0);
    let sin = 0;
    const falt: { it: ItemCuentaPublica; q: number }[] = [];
    if (modo === "iguales") {
      let idx = 0;
      for (const it of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const r = repartoMilesimos(Number(it.cantidad), n, idx);
        r.forEach((c, i) => { m[i] += Math.round(c * it.precio_unitario); });
        idx += Math.round(Number(it.cantidad) * 1000) - Math.floor(Math.round(Number(it.cantidad) * 1000) / n) * n;
      }
    } else {
      for (const it of items) {
        const c = cantidadesDe(asig[it.id], Number(it.cantidad), n);
        c.forEach((x, i) => { m[i] += Math.round(x * it.precio_unitario); });
        const resto = Number(it.cantidad) - c.reduce((a, b) => a + b, 0);
        if (resto > 0.0005) { sin += Math.round(resto * it.precio_unitario); falt.push({ it, q: resto }); }
      }
    }
    return { montos: m, sinAsignar: sin, faltan: falt };
  }, [modo, n, items, asig]);

  const vacias = modo === "productos" ? montos.map((v, i) => (v <= 0 ? i : -1)).filter((i) => i >= 0) : [];

  function setAsigItem(id: string, a: Asig | null) {
    setAsig((s) => { const c = { ...s }; if (a) c[id] = a; else delete c[id]; return c; });
    setOk(null);
  }
  function agregarPersona() {
    if (nombres.length >= 20) return;
    setNombres((x) => [...x, `Persona ${x.length + 1}`]);
  }
  function quitarPersona(j: number) {
    if (nombres.length <= 2) return;
    setNombres((x) => x.filter((_, i) => i !== j));
    setAsig((s) => {
      const c: Record<string, Asig> = {};
      for (const [k, a] of Object.entries(s)) {
        if (a.modo === "unidades") c[k] = { modo: "unidades", por: a.por.filter((_, i) => i !== j) };
        else {
          const entre = a.entre.filter((i) => i !== j).map((i) => (i > j ? i - 1 : i));
          if (entre.length) c[k] = { modo: "compartido", entre };
        }
      }
      return c;
    });
    setEditando(null);
  }

  async function guardar() {
    setError(null);
    setOk(null);
    let division: DivisionEnviar;
    if (modo === "iguales") {
      division = { modo: "iguales", personas: nIguales, partes: Array.from({ length: nIguales }, (_, i) => ({ nombre: nombreDe(i) })) };
    } else {
      if (vacias.length) { setError(`"${nombreDe(vacias[0])}" no tiene nada asignado: asignale algo o sacala de la lista.`); return; }
      if (faltan.length && !conResto) { setError("Falta asignar productos: asignalos o marcá que lo que falta se paga aparte."); return; }
      division = {
        modo: "productos",
        partes: nombres.map((_, i) => ({ nombre: nombreDe(i) })),
        asignaciones: items.flatMap((it) => {
          const c = cantidadesDe(asig[it.id], Number(it.cantidad), n);
          const reparto = c.map((x, i) => ({ parte: i + 1, cantidad: x })).filter((r) => r.cantidad > 0);
          return reparto.length ? [{ item_id: it.id, reparto }] : [];
        }),
      };
    }
    setGuardando(true);
    try {
      const c = await accion({ accion: "dividir", division });
      setOk("¡Listo! La caja ya ve cómo se separa la cuenta.");
      onListo(c, "¡Listo! La caja ya ve cómo se separa la cuenta.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function dejarDeSeparar() {
    setError(null);
    setGuardando(true);
    try {
      const c = await accion({ accion: "dividir", division: null });
      setOk("La cuenta ya no está separada.");
      onListo(c, "La cuenta ya no está separada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (!items.length) return <p className={`${TARJETA} mt-3 px-4 py-8 text-center text-sm ${SUAVE}`}>Cuando la caja confirme tu pedido vas a poder separar la cuenta.</p>;

  if (bloqueada) {
    return (
      <div className="mt-3 space-y-3">
        <p className={`rounded-xl px-3 py-2.5 text-sm ${AVISO_INFO}`}>La caja ya cobró una parte: la división no se puede cambiar desde acá. Si hay que corregir algo, pedile al mozo.</p>
        <ResumenDivision cuenta={cuenta} />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 pb-28">
      {/* Modo */}
      <div className={`${TARJETA} grid grid-cols-2 gap-1 p-1`} role="tablist" aria-label="Cómo separar">
        {([["productos", "Por productos"], ["iguales", "Partes iguales"]] as const).map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={modo === v} onClick={() => { setModo(v); setError(null); setOk(null); }}
            className={`min-h-11 rounded-xl text-sm font-semibold transition ${modo === v ? "text-white shadow-sm" : `${SUAVE}`}`}
            style={modo === v ? { backgroundColor: color } : undefined}>
            {t}
          </button>
        ))}
      </div>

      {modo === "iguales" ? (
        <section className={`${TARJETA} px-4 py-4`}>
          <p className={`text-sm ${SUAVE}`}>¿Entre cuántas personas?</p>
          <div className="mt-2 flex items-center justify-center gap-4">
            <button type="button" aria-label="Una persona menos" disabled={nIguales <= 2} onClick={() => { setNIguales((x) => Math.max(2, x - 1)); setOk(null); }}
              className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"><Minus className="h-5 w-5" /></button>
            <span className={`min-w-16 text-center text-4xl font-bold tabular-nums ${TEXTO}`}>{nIguales}</span>
            <button type="button" aria-label="Una persona más" disabled={nIguales >= 20} onClick={() => { setNIguales((x) => Math.min(20, x + 1)); setOk(null); }}
              className="grid h-12 w-12 place-items-center rounded-full text-white disabled:opacity-40" style={{ backgroundColor: color }}><Plus className="h-5 w-5" /></button>
          </div>
          <p className={`mt-3 text-center text-sm ${SUAVE}`}>Total {gs(cuenta.total)} · cada uno paga aprox. <b className={TEXTO}>{gs(cuenta.total / nIguales)}</b></p>
        </section>
      ) : (
        <>
          {/* Personas */}
          <section className={`${TARJETA} px-4 py-3`}>
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-semibold ${TEXTO}`}>¿Quiénes pagan?</p>
              <button type="button" onClick={agregarPersona} disabled={nombres.length >= 20} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold disabled:opacity-40" style={{ color }}>
                <UserPlus className="h-4 w-4" aria-hidden /> Agregar
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {nombres.map((nm, i) => (
                <li key={i}>
                  {editando === i ? (
                    <span className="flex items-center gap-1">
                      <input autoFocus value={nm} maxLength={40} onChange={(e) => setNombres((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                        onKeyDown={(e) => { if (e.key === "Enter") setEditando(null); }}
                        // Se cierra un instante después: así el tacho (al lado) llega a recibir el toque.
                        onBlur={() => setTimeout(() => setEditando((x) => (x === i ? null : x)), 200)}
                        aria-label={`Nombre de la persona ${i + 1}`} className={`${INPUT} h-10 w-36 px-3`} />
                      {nombres.length > 2 ? (
                        <button type="button" onClick={() => quitarPersona(i)} aria-label={`Sacar a ${nombreDe(i)}`}
                          className="grid h-10 w-10 place-items-center rounded-lg text-rose-600 dark:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                      ) : null}
                    </span>
                  ) : (
                    <button type="button" onClick={() => setEditando(i)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: color }}>{i + 1}</span>
                      <span className="max-w-[9rem] truncate">{nombreDe(i)}</span>
                      <Pencil className="h-3 w-3 opacity-50" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className={`mt-2 text-xs ${TENUE}`}>Tocá un nombre para cambiarlo.</p>
          </section>

          {/* Productos */}
          <ul className="space-y-2">
            {items.map((it) => (
              <ItemAsignable key={it.id} it={it} a={asig[it.id]} nombres={nombres.map((_, i) => nombreDe(i))} color={color}
                onCambiar={(a) => setAsigItem(it.id, a)} />
            ))}
          </ul>

          {faltan.length ? (
            <section className={`rounded-2xl px-4 py-3 text-sm ${AVISO_ALERTA}`}>
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden /> Falta asignar {gs(sinAsignar)}</p>
              <p className="mt-1 text-xs">{faltan.map((f) => `${cant(f.q)} × ${f.it.nombre}`).join(" · ")}</p>
              <label className="mt-2 flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={conResto} onChange={(e) => setConResto(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
                <span>Lo que falta se paga aparte (queda como “Resto”)</span>
              </label>
            </section>
          ) : null}
        </>
      )}

      {/* Resultado */}
      <section className={`${TARJETA} px-4 py-3`}>
        <p className={`text-sm font-semibold ${TEXTO}`}>Cuánto paga cada uno</p>
        <ul className="mt-2 space-y-1.5">
          {montos.map((v, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: color }}>{i + 1}</span>
              <span className={`min-w-0 flex-1 truncate ${TEXTO}`}>{modo === "iguales" ? `Persona ${i + 1}` : nombreDe(i)}</span>
              <span className={`shrink-0 font-bold tabular-nums ${v > 0 ? TEXTO : "text-rose-600 dark:text-rose-400"}`}>{gs(v)}</span>
            </li>
          ))}
          {modo === "productos" && sinAsignar > 0 ? (
            <li className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-amber-400 text-[11px] font-bold">?</span>
              <span className="min-w-0 flex-1">Resto</span><span className="font-bold tabular-nums">{gs(sinAsignar)}</span>
            </li>
          ) : null}
        </ul>
        <p className={`mt-2 border-t pt-2 text-xs ${LINEA} ${SUAVE}`}>Total de la cuenta {gs(cuenta.total)}. Cada parte se cobra por separado en la caja, con su ticket o factura.</p>
      </section>

      {error ? <p className={`rounded-xl px-3 py-2 text-sm ${AVISO_ERROR}`} role="alert">{error}</p> : null}
      {ok ? <p className={`rounded-xl px-3 py-2 text-sm ${AVISO_OK}`} role="status">{ok}</p> : null}

      {/* Pie fijo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-2xl gap-2">
          {cuenta.division ? (
            <button type="button" onClick={() => void dejarDeSeparar()} disabled={guardando} className={`${BOTON_SEC} h-12 shrink-0`}>
              <X className="h-4 w-4" aria-hidden /> No separar
            </button>
          ) : null}
          <button type="button" onClick={() => void guardar()} disabled={guardando || (modo === "productos" && (vacias.length > 0 || (faltan.length > 0 && !conResto)))}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-base font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: color }}>
            {guardando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />}
            {cuenta.division ? "Guardar cambios" : "Separar cuenta"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Un producto de la cuenta: a quién se le asigna (por unidades o compartido). */
function ItemAsignable({ it, a, nombres, color, onCambiar }: {
  it: ItemCuentaPublica; a: Asig | undefined; nombres: string[]; color: string; onCambiar: (a: Asig | null) => void;
}) {
  const q = Number(it.cantidad);
  const n = nombres.length;
  const compartido = q === 1 || a?.modo === "compartido";
  const por = a?.modo === "unidades" ? Array.from({ length: n }, (_, i) => a.por[i] ?? 0) : Array.from({ length: n }, () => 0);
  const entre = a?.modo === "compartido" ? a.entre.filter((i) => i < n) : [];
  const asignadas = compartido ? (entre.length ? q : 0) : por.reduce((x, y) => x + y, 0);
  const completo = asignadas >= q - 0.0005;

  function alternar(i: number) {
    const s = new Set(entre);
    if (s.has(i)) s.delete(i); else s.add(i);
    const lista = [...s].sort((x, y) => x - y);
    onCambiar(lista.length ? { modo: "compartido", entre: lista } : null);
  }
  function sumar(i: number, d: number) {
    const nuevo = [...por];
    const libre = q - asignadas;
    if (d > 0 && libre < 1) return;
    nuevo[i] = Math.max(0, nuevo[i] + d);
    onCambiar(nuevo.some((x) => x > 0) ? { modo: "unidades", por: nuevo } : null);
  }

  const leyenda = compartido
    ? entre.length === 0 ? "Sin asignar: tocá quién lo paga"
      : entre.length === 1 ? `Lo paga ${nombres[entre[0]]}`
        : `Compartido entre ${entre.length} · ${gs((q * it.precio_unitario) / entre.length)} c/u`
    : completo ? "Repartido" : `Faltan ${cant(q - asignadas)} de ${cant(q)}`;

  return (
    <li className={`${TARJETA} px-3.5 py-3 ${completo ? "" : "ring-1 ring-amber-300 dark:ring-amber-700"}`}>
      <div className="flex items-start gap-3">
        <span className={`w-8 shrink-0 pt-0.5 text-sm font-bold tabular-nums ${TEXTO}`}>{cant(q)}×</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${TEXTO}`}>{it.nombre}</p>
          {it.modificadores_texto ? <p className={`text-xs ${SUAVE}`}>{it.modificadores_texto}</p> : null}
        </div>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${TEXTO}`}>{gs(it.total)}</span>
      </div>
      {compartido ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {nombres.map((nm, i) => {
            const sel = entre.includes(i);
            return (
              <button key={i} type="button" onClick={() => alternar(i)} aria-pressed={sel}
                className={`inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm font-medium transition ${sel ? "border-transparent text-white" : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"}`}
                style={sel ? { backgroundColor: color } : undefined}>
                {sel ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}<span className="max-w-[8rem] truncate">{nm}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-2">
          {nombres.map((nm, i) => (
            <li key={i} className="flex items-center gap-1 rounded-xl border border-slate-200 py-0.5 pr-0.5 pl-3 dark:border-slate-700">
              <span className={`min-w-0 flex-1 truncate text-sm ${TEXTO}`}>{nm}</span>
              <button type="button" aria-label={`Una menos para ${nm}`} disabled={por[i] <= 0} onClick={() => sumar(i, -1)}
                className="grid h-9 w-9 place-items-center rounded-full text-slate-600 disabled:opacity-30 dark:text-slate-300"><Minus className="h-4 w-4" /></button>
              <span className={`w-5 text-center text-sm font-bold tabular-nums ${TEXTO}`}>{por[i]}</span>
              <button type="button" aria-label={`Una más para ${nm}`} disabled={q - asignadas < 1} onClick={() => sumar(i, 1)}
                className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-30" style={{ backgroundColor: color }}><Plus className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${completo ? SUAVE : "font-medium text-amber-700 dark:text-amber-300"}`}>{leyenda}</p>
        {q > 1 ? (
          <button type="button" onClick={() => onCambiar(compartido ? null : (entre.length ? { modo: "compartido", entre } : { modo: "compartido", entre: [] }))}
            className="min-h-9 text-xs font-semibold" style={{ color }}>
            {compartido ? "Repartir por unidades" : "Compartir entre varios"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

// ── Datos de facturación ─────────────────────────────────────────────────────
type Destino = "cuenta" | number;

export function VistaFacturacion({ cuenta, color, accion, onListo }: {
  cuenta: CuentaAbierta; color: string; accion: AccionCuenta; onListo: (c: CuentaPublica) => void;
}) {
  const partes = (cuenta.division?.partes ?? []).filter((p) => !p.es_resto);
  const [destino, setDestino] = useState<Destino>("cuenta");
  const datosDe = (d: Destino) => (d === "cuenta" ? cuenta.facturacion : partes.find((p) => p.numero === d)?.facturacion ?? null);
  const [ruc, setRuc] = useState(datosDe("cuenta")?.ruc ?? "");
  const [razon, setRazon] = useState(datosDe("cuenta")?.razon_social ?? "");
  const [email, setEmail] = useState("");
  const [tocado, setTocado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [info, setInfo] = useState<{ tipo: "ok" | "info" | "error"; texto: string } | null>(null);

  const v = validarRuc(ruc);
  const sugerido = rucSugerido(ruc);
  const mensajeRuc = tocado && v.estado !== "ok" && v.estado !== "vacio" ? v.mensaje : null;

  function elegir(d: Destino) {
    setDestino(d);
    const f = datosDe(d);
    setRuc(f?.ruc ?? "");
    setRazon(f?.razon_social ?? "");
    setEmail("");
    setTocado(false);
    setInfo(null);
  }

  async function buscar() {
    setInfo(null);
    const t = normalizarRuc(ruc);
    if (!/^\d{3,10}(-\d)?$/.test(t)) { setInfo({ tipo: "error", texto: "Escribí el RUC (con o sin dígito verificador) o el número de cédula." }); return; }
    setBuscando(true);
    try {
      const r = await accion<{ encontrado: boolean; razon_social?: string; ruc?: string | null }>({ accion: "buscar_ruc", documento: t });
      if (r.encontrado) {
        if (r.razon_social) setRazon(r.razon_social);
        if (r.ruc) setRuc(r.ruc);
        setTocado(true);
        setInfo({ tipo: "ok", texto: `Encontramos: ${r.razon_social}. Revisá y guardá.` });
      } else {
        const s = rucSugerido(t);
        if (s) setRuc(s);
        setInfo({ tipo: "info", texto: "No lo encontramos entre los clientes: escribí la razón social o tu nombre para la factura." });
      }
    } catch (e) {
      setInfo({ tipo: "error", texto: (e as Error).message });
    } finally {
      setBuscando(false);
    }
  }

  async function guardar() {
    setTocado(true);
    setInfo(null);
    if (v.estado !== "ok") { setInfo({ tipo: "error", texto: v.estado === "vacio" ? "Escribí el RUC para la factura." : v.mensaje }); return; }
    if (razon.trim().length < 2) { setInfo({ tipo: "error", texto: "Escribí la razón social o el nombre para la factura." }); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setInfo({ tipo: "error", texto: "El email no es válido." }); return; }
    setGuardando(true);
    try {
      const c = await accion({ accion: "facturacion", parte: destino === "cuenta" ? null : destino, ruc: normalizarRuc(ruc), razon_social: razon.trim(), email: email.trim() || null });
      onListo(c);
      setInfo({ tipo: "ok", texto: "Guardado. La caja lo usa cuando cobre." });
      setEmail("");
    } catch (e) {
      setInfo({ tipo: "error", texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(d: Destino) {
    setInfo(null);
    try {
      const c = await accion({ accion: "facturacion", parte: d === "cuenta" ? null : d, ruc: null, razon_social: null, email: null });
      onListo(c);
      if (d === destino) { setRuc(""); setRazon(""); setEmail(""); setTocado(false); }
      setInfo({ tipo: "ok", texto: "Datos quitados: esa parte sale con ticket." });
    } catch (e) {
      setInfo({ tipo: "error", texto: (e as Error).message });
    }
  }

  const registrados: { d: Destino; titulo: string; f: NonNullable<CuentaAbierta["facturacion"]>; cobrada?: boolean }[] = [
    ...(cuenta.facturacion ? [{ d: "cuenta" as Destino, titulo: partes.length ? "Toda la cuenta (si se paga junta)" : "Toda la cuenta", f: cuenta.facturacion }] : []),
    ...partes.filter((p) => p.facturacion).map((p) => ({ d: p.numero as Destino, titulo: p.nombre, f: p.facturacion!, cobrada: p.cobrada })),
  ];
  const opciones: { d: Destino; t: string; off?: boolean }[] = [
    { d: "cuenta", t: "Toda la cuenta" },
    ...partes.map((p) => ({ d: p.numero as Destino, t: p.nombre, off: p.cobrada })),
  ];

  return (
    <div className="mt-3 space-y-3">
      <section className={`${TARJETA} px-4 py-4`}>
        <h2 className={`text-lg font-bold ${TEXTO}`}>Datos para facturación</h2>
        <p className={`text-sm ${SUAVE}`}>Cargá los datos con los que querés que salga la factura.</p>

        {partes.length ? (
          <div className="mt-3">
            <p className={`mb-1.5 text-xs font-medium ${SUAVE}`}>¿Para quién es la factura?</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Para quién es la factura">
              {opciones.map((o) => {
                const sel = destino === o.d;
                return (
                  <button key={String(o.d)} type="button" role="radio" aria-checked={sel} disabled={o.off} onClick={() => elegir(o.d)}
                    className={`inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm font-medium transition disabled:opacity-40 ${sel ? "border-transparent text-white" : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"}`}
                    style={sel ? { backgroundColor: color } : undefined}>
                    {sel ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}<span className="max-w-[9rem] truncate">{o.t}</span>{o.off ? " · pagada" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <label className="mt-4 block">
          <span className={`mb-1 block text-xs font-medium ${SUAVE}`}>RUC o cédula <span className="text-rose-600">*</span></span>
          <span className="flex gap-2">
            <input value={ruc} onChange={(e) => { setRuc(e.target.value.slice(0, 20)); setInfo(null); }} onBlur={() => setTocado(true)}
              inputMode="numeric" autoComplete="off" placeholder="Ej.: 80012345-0 o 1234567" aria-invalid={!!mensajeRuc}
              className={`${INPUT} h-12 min-w-0 flex-1 px-3 ${mensajeRuc ? "border-rose-300 dark:border-rose-700" : ""}`} />
            <button type="button" onClick={() => void buscar()} disabled={buscando || normalizarRuc(ruc).length < 3}
              className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Buscar
            </button>
          </span>
        </label>
        {mensajeRuc ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
            {mensajeRuc}
            {sugerido ? <button type="button" onClick={() => setRuc(sugerido)} className="min-h-8 font-semibold underline underline-offset-2">Usar {sugerido}</button> : null}
          </p>
        ) : (
          <p className={`mt-1.5 text-xs ${TENUE}`}>Con la cédula sola no se puede facturar: va el RUC con su dígito verificador.</p>
        )}

        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-medium ${SUAVE}`}>Razón social o nombre <span className="text-rose-600">*</span></span>
          <input value={razon} onChange={(e) => setRazon(e.target.value.slice(0, 150))} autoComplete="organization" placeholder="Como tiene que salir en la factura"
            className={`${INPUT} h-12 px-3`} />
        </label>
        <label className="mt-3 block">
          <span className={`mb-1 block text-xs font-medium ${SUAVE}`}>Email <span className={`font-normal ${TENUE}`}>(opcional)</span></span>
          <input value={email} onChange={(e) => setEmail(e.target.value.slice(0, 120))} type="email" inputMode="email" autoComplete="email" placeholder="Para mandarte la factura"
            className={`${INPUT} h-12 px-3`} />
        </label>

        {info ? (
          <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${info.tipo === "ok" ? AVISO_OK : info.tipo === "info" ? AVISO_INFO : AVISO_ERROR}`} role={info.tipo === "error" ? "alert" : "status"}>{info.texto}</p>
        ) : null}
        <button type="button" onClick={() => void guardar()} disabled={guardando}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: color }}>
          {guardando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />} Guardar datos
        </button>
        <p className={`mt-2 text-center text-[11px] ${TENUE}`}>Sin RUC sale ticket. La caja confirma los datos al cobrar.</p>
      </section>

      <section className={`${TARJETA} px-4 py-3`}>
        <h3 className={`text-sm font-semibold ${TEXTO}`}>Datos registrados para la mesa</h3>
        {registrados.length === 0 ? (
          <div className="py-6 text-center">
            <p className={`text-sm font-medium ${TEXTO}`}>Todavía no hay datos cargados</p>
            <p className={`mt-0.5 text-xs ${SUAVE}`}>Los datos de facturación de la mesa van a aparecer acá.</p>
          </div>
        ) : (
          <ul className={`mt-1 divide-y ${DIVIDE}`}>
            {registrados.map((r) => (
              <li key={String(r.d)} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><FileText className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-semibold uppercase tracking-wider ${SUAVE}`}>{r.titulo}</p>
                  <p className={`text-sm font-semibold ${TEXTO} [overflow-wrap:anywhere]`}>{r.f.razon_social}</p>
                  <p className={`text-xs ${SUAVE}`}>RUC {r.f.ruc}{r.f.email ? ` · ${r.f.email}` : ""}</p>
                </div>
                {r.cobrada ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Pagada</span>
                ) : (
                  <span className="flex shrink-0 gap-0.5">
                    <button type="button" onClick={() => { elegir(r.d); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-label={`Editar datos de ${r.titulo}`}
                      className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 dark:text-slate-400"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => void quitar(r.d)} aria-label={`Quitar datos de ${r.titulo}`}
                      className="grid h-10 w-10 place-items-center rounded-lg text-rose-600 dark:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
