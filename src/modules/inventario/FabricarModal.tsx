"use client";

/**
 * Fabricar por tanda (receta 97), en un CapaModal (hoja a todo el ancho en celular):
 *   · qué fabricar (Fabricados y preparaciones por tanda), en qué depósito y cuánto;
 *   · "salió de verdad": si salió menos, la diferencia es merma de producción (su costo se
 *     reparte en lo que salió);
 *   · vista previa EN VIVO de las materias primas que se van a usar (con merma de la receta y
 *     sub-preparaciones), cuánto hay en el depósito y cuánto falta; si falta algo no se fabrica;
 *   · lote y vencimiento si el producto controla lotes (lote por defecto = número de la producción).
 * La base vuelve a validar todo y descuenta con el costo real de cada compra (PEPS).
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Factory, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { hayVariosDepositos, opcionesDepositos, useDepositos } from "@/modules/inventario/depositos";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT, ModalDocumento, TEAL } from "@/modules/inventario/ui";
import { cant, gs, numero, unidadCorta } from "@/modules/inventario/recetas";
import { decimalesDe, type DetalleProduccion, type Fabricable, type PreviaFabricar } from "@/modules/inventario/produccion";

const NUM = `${INPUT} text-right tabular-nums`;
const soloDecimal = (v: string) => v.replace(/[^\d.,]/g, "");
const aTexto = (n: number) => String(n).replace(".", ",");

export function FabricarModal({ productoInicial, onClose, onHecho }: {
  /** producto ya elegido (desde la receta o "Fabricar" de una fila) */
  productoInicial?: string | null;
  onClose: () => void;
  onHecho: (p: DetalleProduccion) => void;
}) {
  const deps = useDepositos();
  const [deposito, setDeposito] = useState("");
  const dep = deposito || deps.datos?.mi_deposito_id || "";
  const [lista, setLista] = useState<Fabricable[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [productoId, setProductoId] = useState(productoInicial ?? "");
  const [cantidad, setCantidad] = useState("");
  const [obtenida, setObtenida] = useState("");
  const [lote, setLote] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [notas, setNotas] = useState("");
  const [previa, setPrevia] = useState<PreviaFabricar | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(() => crypto.randomUUID());

  // Productos fabricables (con el stock y lo que alcanza en el depósito elegido).
  useEffect(() => {
    if (!dep) return;
    let vivo = true;
    apiFetch<{ items: Fabricable[] }>(`/api/inventario/produccion/fabricables?deposito=${dep}`)
      .then((d) => { if (vivo) { setLista(d.items); setErrorLista(null); } })
      .catch((e) => { if (vivo) setErrorLista((e as Error).message); });
    return () => { vivo = false; };
  }, [dep]);

  const prod = lista?.find((p) => p.id === productoId) ?? null;
  const unidad = prod?.unidad_medida ?? "Unidad";
  const dec = decimalesDe(unidad);
  // Al elegir el producto: arranca con lo que rinde una tanda de su receta.
  const elegido = useRef<string | null>(null);
  useEffect(() => {
    if (!prod || elegido.current === prod.id) return;
    elegido.current = prod.id;
    setCantidad(aTexto(Number(prod.rendimiento) || 1));
    setObtenida("");
  }, [prod]);

  const cant_ = numero(cantidad);
  const obt = obtenida.trim() ? numero(obtenida) : cant_;

  // Vista previa (con una pausa corta mientras se tipea).
  useEffect(() => {
    if (!productoId || !dep || cant_ <= 0) { setPrevia(null); return; }
    let vivo = true;
    setCargandoPrevia(true);
    const t = setTimeout(() => {
      apiFetch<PreviaFabricar>(`/api/inventario/produccion/previa?producto=${productoId}&cantidad=${cant_}&deposito=${dep}`)
        .then((d) => { if (vivo) { setPrevia(d); setErrorPrevia(null); } })
        .catch((e) => { if (vivo) { setPrevia(null); setErrorPrevia((e as Error).message); } })
        .finally(() => { if (vivo) setCargandoPrevia(false); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [productoId, dep, cant_]);

  const merma = cant_ - obt;
  const conLotes = !!prod?.controla_lotes;
  const costoEst = previa?.ver_costos && previa.costo_estimado != null ? Number(previa.costo_estimado) : null;
  const problema = useMemo((): string | null => {
    if (!prod) return null;
    if (cant_ <= 0) return "Cargá cuánto vas a fabricar.";
    if (obt <= 0) return "Lo que salió tiene que ser mayor a 0 (si no salió nada, cargalo como pérdida de las materias primas).";
    if (unidad === "Unidad" && !Number.isInteger(obt)) return `«${prod.nombre}» se cuenta por unidad: lo que salió tiene que ser un número entero.`;
    if (conLotes && !vencimiento) return "Cargá el vencimiento de lo fabricado (controla lotes).";
    if (previa && previa.faltantes > 0) return "No alcanza la materia prima: bajá la cantidad o cargá la compra antes.";
    return null;
  }, [prod, cant_, obt, unidad, conLotes, vencimiento, previa]);
  const puede = !!prod && !problema && !!previa && !cargandoPrevia && !busy;

  async function fabricar() {
    if (!puede || !prod) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch<DetalleProduccion>("/api/inventario/produccion", {
        method: "POST",
        body: JSON.stringify({
          producto_id: prod.id, deposito_id: dep, cantidad: cant_, obtenida: obt,
          lote: conLotes ? lote.trim() || null : null, vencimiento: conLotes ? vencimiento : null,
          notas: notas.trim() || null, idempotency_key: idem,
        }),
      });
      onHecho(d);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const opciones: [string, string][] = [
    ["", lista === null ? "Cargando…" : "Elegí qué fabricar"],
    ...(lista ?? []).map((p): [string, string] => [p.id, `${p.nombre} · hay ${cant(p.stock, decimalesDe(p.unidad_medida))} ${unidadCorta(p.unidad_medida)}`]),
  ];

  return (
    <ModalDocumento
      ancho="max-w-2xl"
      titulo={<><Factory className="h-5 w-5 shrink-0" style={{ color: TEAL }} /> Fabricar</>}
      subtitulo="Descuenta las materias primas de la receta y suma lo que salió al stock"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {error ? <p className="mr-auto text-xs font-medium text-rose-600 max-sm:basis-full">{error}</p> : null}
          <button type="button" onClick={onClose} disabled={busy} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar</button>
          <button type="button" onClick={() => void fabricar()} disabled={!puede} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-[2]`} style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Factory className="h-4 w-4" />}
            {prod && obt > 0 ? `Fabricar ${cant(obt, dec)} ${unidadCorta(unidad)}` : "Fabricar"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {errorLista ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{errorLista}</p> : null}
        {lista && lista.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-600">
            <p className="font-medium text-slate-700">Todavía no hay nada para fabricar</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              Creá el producto en <Link href="/inventario" className="font-semibold text-[var(--brand)] hover:underline">Productos</Link> con el tipo «Fabricado»
              (ej. Bolsa de maní 250 g) y cargale su receta en <Link href="/inventario/recetas" className="font-semibold text-[var(--brand)] hover:underline">Recetas</Link>.
            </p>
          </div>
        ) : null}

        <div className={`grid gap-3 ${hayVariosDepositos(deps.datos) ? "sm:grid-cols-[1fr_220px]" : ""}`}>
          {/* div y no label: un <label> con el botón del Select adentro le repite el click (abre y cierra). */}
          <div className="min-w-0">
            <span className={ET}>Qué fabricás *</span>
            <Select block value={productoId} onChange={setProductoId} options={opciones} etiqueta="Qué fabricás" disabled={!lista?.length} />
          </div>
          {hayVariosDepositos(deps.datos) ? (
            <div className="min-w-0">
              <span className={ET}>Depósito *</span>
              <Select block value={dep} onChange={(v) => setDeposito(v)} options={opcionesDepositos(deps.datos)} etiqueta="Depósito" />
            </div>
          ) : null}
        </div>

        {prod ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className={ET}>Vas a fabricar *</span>
                <div className="relative">
                  <input inputMode="decimal" enterKeyHint="next" value={cantidad} onChange={(e) => setCantidad(soloDecimal(e.target.value))} className={`${NUM} pr-12`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unidadCorta(unidad)}</span>
                </div>
              </label>
              <label className="block min-w-0">
                <span className={ET}>Salió de verdad</span>
                <div className="relative">
                  <input inputMode="decimal" enterKeyHint="done" value={obtenida} onChange={(e) => setObtenida(soloDecimal(e.target.value))}
                    placeholder={cant_ > 0 ? aTexto(cant_) : ""} className={`${NUM} pr-12`} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{unidadCorta(unidad)}</span>
                </div>
              </label>
            </div>
            <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {previa?.alcanza != null ? (
                <span>
                  Con la materia prima de {previa.deposito.nombre} alcanza para <strong className="text-slate-700">{cant(previa.alcanza, dec)} {unidadCorta(unidad)}</strong>
                  {previa.alcanza > 0 && previa.alcanza !== cant_ ? (
                    <button type="button" onClick={() => setCantidad(aTexto(previa.alcanza!))} className="ml-1.5 inline-flex min-h-8 items-center font-semibold text-[var(--brand)] hover:underline">Usar el máximo</button>
                  ) : null}
                </span>
              ) : null}
              <span>Hay {cant(prod.stock, dec)} {unidadCorta(unidad)} en stock.</span>
            </div>
            {merma > 0 && obt > 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Merma de producción: <strong>{cant(merma, dec)} {unidadCorta(unidad)}</strong> ({cant((merma / cant_) * 100, 1)} %). Las materias primas se descuentan por {cant(cant_, dec)} y su costo se reparte en las {cant(obt, dec)} que salieron.
              </p>
            ) : merma < 0 ? (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Salió más de lo planeado (+{cant(-merma, dec)} {unidadCorta(unidad)}): el costo de la tanda se reparte en las {cant(obt, dec)}.
              </p>
            ) : null}

            {conLotes ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block min-w-0">
                  <span className={ET}>Lote</span>
                  <input value={lote} onChange={(e) => setLote(e.target.value.toUpperCase().slice(0, 40))} placeholder="El número de la producción" className={INPUT} />
                </label>
                <div className="min-w-0">
                  <span className={ET}>Vence *</span>
                  <SelectorFecha value={vencimiento} onChange={setVencimiento} etiqueta="Vencimiento" className="w-full" claseBoton="h-[42px] w-full rounded-xl px-3" />
                </div>
              </div>
            ) : null}

            {/* Materias primas */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Materias primas que se usan</h3>
                {cargandoPrevia ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
              </div>
              {errorPrevia ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorPrevia}</p> : null}
              {previa ? (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {previa.items.map((i) => {
                    const d = decimalesDe(i.unidad_medida);
                    const falta = i.falta != null && Number(i.falta) > 0;
                    return (
                      <li key={i.insumo_id} className={`flex items-start justify-between gap-3 px-3 py-2.5 ${falta ? "bg-rose-50/60" : ""}`}>
                        <div className="min-w-0">
                          <p className="font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">{i.nombre}</p>
                          <p className="text-[11px] text-slate-500">
                            {i.controla_stock ? <>hay {cant(i.hay ?? 0, d)} {unidadCorta(i.unidad_medida)}{i.reservado ? ` · ${cant(i.reservado, d)} reservado en mesas` : ""}</> : "no controla stock"}
                            {i.costo != null ? <> · {gs(i.costo)}</> : null}
                          </p>
                          {falta ? (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                              <AlertTriangle className="h-3 w-3" /> Falta {cant(i.falta ?? 0, d)} {unidadCorta(i.unidad_medida)}
                            </p>
                          ) : null}
                        </div>
                        <p className={`shrink-0 text-right font-semibold tabular-nums ${falta ? "text-rose-700" : "text-slate-900"}`}>
                          {cant(i.cantidad, d === 0 ? 2 : 3)} <span className="text-xs font-normal text-slate-500">{unidadCorta(i.unidad_medida)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : !errorPrevia ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
                  {cargandoPrevia ? "Calculando…" : "Cargá la cantidad para ver qué se usa."}
                </div>
              ) : null}
              {costoEst != null && obt > 0 ? (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
                  <span className="text-slate-500">Costo estimado <strong className="tabular-nums text-slate-900">{gs(costoEst)}</strong></span>
                  <span className="text-slate-500">÷ {cant(obt, dec)} = <strong className="tabular-nums text-slate-900">{gs(costoEst / obt)}</strong> por {unidadCorta(unidad)}</span>
                </div>
              ) : null}
              {costoEst != null ? <p className="mt-1 text-right text-[10px] text-slate-400">Estimado con el costo promedio; al fabricar se usa el costo real de cada compra.</p> : null}
            </section>

            <label className="block">
              <span className={ET}>Notas <span className="font-normal text-slate-400">(opcional)</span></span>
              <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} className={`${INPUT} resize-none`} />
            </label>

            {problema && !(cant_ <= 0 && !cantidad) ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{problema}</p> : null}
          </>
        ) : null}
      </div>
    </ModalDocumento>
  );
}
