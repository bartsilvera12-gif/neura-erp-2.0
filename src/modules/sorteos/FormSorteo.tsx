"use client";

/**
 * Alta y edición de un sorteo (receta 123): datos, imagen, precio, números, combos con descuento,
 * cuentas para cobrar y opciones de la venta web. El rango y el modo de los números se bloquean
 * cuando ya se generaron (al activar).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Banknote, Hash, ImagePlus, Loader2, Plus, Settings2, Tag, Ticket, Trash2 } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import type { Combo, CuentaPago, Sorteo } from "@/modules/sorteos/tipos";
import { descuentoCombo } from "@/modules/sorteos/tipos";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, gs, INPUT, Interruptor, Tarjeta } from "@/modules/sorteos/ui";

/** "2026-11-20T20:00" (hora de Paraguay) ↔ ISO. Paraguay es UTC−3 todo el año. */
const aLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
};
const aIso = (local: string) => (local ? `${local}:00-03:00` : null);

const CUENTA_VACIA: CuentaPago = { banco: "", titular: "", cuenta: "", documento: "", alias: "" };

export function FormSorteo({ inicial }: { inicial?: Sorteo }) {
  const router = useRouter();
  const generados = !!inicial?.numeros_generados;
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [imagen, setImagen] = useState(inicial?.imagen_url ?? "");
  const [precio, setPrecio] = useState(inicial?.precio ?? 0);
  const [desde, setDesde] = useState(String(inicial?.numero_desde ?? 1));
  const [hasta, setHasta] = useState(String(inicial?.numero_hasta ?? 10000));
  const [modo, setModo] = useState<"aleatorio" | "correlativo">(inicial?.modo_numeros ?? "aleatorio");
  const [elegir, setElegir] = useState(inicial?.permite_elegir ?? false);
  const [maximo, setMaximo] = useState(inicial?.max_por_compra ? String(inicial.max_por_compra) : "");
  const [fecha, setFecha] = useState(aLocal(inicial?.fecha_sorteo ?? null));
  const [combos, setCombos] = useState<Combo[]>(inicial?.combos ?? []);
  const [cuentas, setCuentas] = useState<CuentaPago[]>(inicial?.datos_pago?.length ? inicial.datos_pago : [{ ...CUENTA_VACIA }]);
  const [reserva, setReserva] = useState(String(inicial?.reserva_minutos ?? 30));
  const [auto, setAuto] = useState(inicial?.confirmacion_auto ?? false);
  const [mensaje, setMensaje] = useState(inicial?.mensaje_ticket ?? "");
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const total = Math.max(0, (Number(hasta) || 0) - (Number(desde) || 0) + 1);

  async function subirImagen(f: File) {
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const { url } = await apiForm<{ url: string }>("/api/sorteos/imagen", form);
      setImagen(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  const setCombo = (i: number, c: Partial<Combo>) => setCombos((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const setCuenta = (i: number, c: Partial<CuentaPago>) => setCuentas((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));

  async function guardar() {
    setError(null);
    if (nombre.trim().length < 3) return setError("Poné un nombre al sorteo.");
    if (precio <= 0) return setError("Poné el precio por boleta.");
    if (!generados && total < 1) return setError("El número final tiene que ser mayor o igual al inicial.");
    if (combos.some((c) => c.cantidad < 2 || c.precio <= 0)) return setError("Cada combo necesita 2 o más boletas y un precio.");
    const cuentasLlenas = cuentas.filter((c) => c.banco.trim() || c.cuenta.trim() || c.titular.trim());
    if (cuentasLlenas.some((c) => !c.banco.trim() || !c.cuenta.trim() || !c.titular.trim())) return setError("Cada cuenta para cobrar necesita banco, titular y número de cuenta.");
    setGuardando(true);
    try {
      const cuerpo = {
        nombre: nombre.trim(), descripcion, imagen_url: imagen || null, precio,
        ...(generados ? {} : { numero_desde: Number(desde) || 0, numero_hasta: Number(hasta) || 0, modo_numeros: modo }),
        permite_elegir: elegir, max_por_compra: Number(maximo) || 0, fecha_sorteo: aIso(fecha),
        combos: combos.map((c) => ({ cantidad: c.cantidad, precio: c.precio, etiqueta: c.etiqueta || null, activo: c.activo !== false })),
        datos_pago: cuentasLlenas.map((c) => ({ banco: c.banco.trim(), titular: c.titular.trim(), cuenta: c.cuenta.trim(), documento: c.documento?.trim() || undefined, alias: c.alias?.trim() || undefined })),
        reserva_minutos: Number(reserva), confirmacion_auto: auto, mensaje_ticket: mensaje,
      };
      const s = await apiFetch<Sorteo>(inicial ? `/api/sorteos/${inicial.id}` : "/api/sorteos", { method: inicial ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
      router.push(`/sorteos/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  }

  return (
    <div className="grid gap-4 pb-28 lg:grid-cols-2 lg:pb-10">
      <Tarjeta icono={<Ticket className="h-4 w-4" />} titulo="El sorteo" detalle="Lo que ve el comprador en la página y en el ticket.">
        <div className="space-y-3">
          <Campo label="Nombre"><input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Sorteo de 2 motos" maxLength={120} /></Campo>
          <Campo label="Descripción" ayuda="Opcional: premios, condiciones, cómo se sortea.">
            <textarea className={`${INPUT} min-h-24`} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={2000} />
          </Campo>
          <Campo label="Imagen" ayuda="JPG, PNG o WEBP de hasta 5 MB. Se usa en la página pública.">
            <div className="flex items-center gap-3">
              <span className="grid h-20 w-32 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {imagen ? <img src={imagen} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-slate-300" aria-hidden />}
              </span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BOTON} disabled={subiendo} onClick={() => archivo.current?.click()}>
                  {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {imagen ? "Cambiar" : "Subir imagen"}
                </button>
                {imagen ? <button type="button" className={BOTON} onClick={() => setImagen("")}>Quitar</button> : null}
              </div>
              <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirImagen(f); e.target.value = ""; }} />
            </div>
          </Campo>
          <Campo label="Fecha y hora del sorteo" ayuda="Opcional. Se muestra en la página y en el ticket.">
            <SelectorFecha value={fecha} onChange={setFecha} conHora block etiqueta="Fecha del sorteo" placeholder="Elegí la fecha" />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta icono={<Hash className="h-4 w-4" />} titulo="Precio y números" detalle={generados ? "Los números ya se generaron: el rango y el modo no se cambian." : "Los números se generan al activar el sorteo."}>
        <div className="space-y-3">
          <Campo label="Precio por boleta (Gs.)"><CampoMonto valor={precio} onChange={setPrecio} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Desde el número"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={desde} disabled={generados} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))} /></Campo>
            <Campo label="Hasta el número"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={hasta} disabled={generados} onChange={(e) => setHasta(e.target.value.replace(/\D/g, ""))} /></Campo>
          </div>
          <p className="text-xs text-slate-500">{total.toLocaleString("es-PY")} boletas en total{total > 1_000_000 ? " · el máximo es 1.000.000" : ""}.</p>
          <Campo label="Cómo se entregan los números" ayuda={modo === "aleatorio" ? "Cada compra recibe números al azar del rango." : "Se entregan en orden: el primero, el segundo…"}>
            <Select value={modo} onChange={(v) => setModo(v as "aleatorio" | "correlativo")} options={[["aleatorio", "Al azar"], ["correlativo", "En orden"]]} block disabled={generados} etiqueta="Cómo se entregan los números" />
          </Campo>
          <Interruptor valor={elegir} onChange={setElegir} label="En la página web el comprador puede elegir sus números" ayuda="Si no, se le asignan como en la venta por WhatsApp." />
          <Campo label="Máximo de boletas por compra" ayuda="Vacío = sin máximo.">
            <input className={`${INPUT} tabular-nums`} inputMode="numeric" value={maximo} onChange={(e) => setMaximo(e.target.value.replace(/\D/g, ""))} placeholder="Sin máximo" />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta icono={<Tag className="h-4 w-4" />} titulo="Combos con descuento" detalle="Ej. 5 boletas a Gs. 20.000. Se cobran solos al vender esa cantidad, en todos los canales.">
        <div className="space-y-2.5">
          {combos.map((c, i) => {
            const desc = precio > 0 ? descuentoCombo(precio, c) : 0;
            return (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-[0.8fr_1.2fr_1.4fr_auto]">
                <Campo label="Boletas"><input className={`${INPUT} tabular-nums`} inputMode="numeric" value={c.cantidad || ""} onChange={(e) => setCombo(i, { cantidad: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></Campo>
                <Campo label="Precio"><CampoMonto valor={c.precio} onChange={(n) => setCombo(i, { precio: n })} /></Campo>
                <Campo label="Texto (opcional)" className="col-span-3 sm:col-span-1 sm:row-start-1 sm:col-start-3">
                  <input className={INPUT} value={c.etiqueta ?? ""} onChange={(e) => setCombo(i, { etiqueta: e.target.value })} placeholder="Ej. El más elegido" maxLength={40} />
                </Campo>
                <button type="button" aria-label="Quitar combo" className="col-start-3 row-start-1 grid h-11 w-11 place-items-center self-end rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:col-start-4 sm:h-10 sm:w-10" onClick={() => setCombos((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
                {c.cantidad > 1 && c.precio > 0 ? (
                  <p className="col-span-full text-xs text-slate-500">
                    {gs(Math.round(c.precio / c.cantidad))} cada boleta{desc ? <> · <b className="text-emerald-700">{desc}% menos</b> que {gs(precio * c.cantidad)}</> : precio * c.cantidad < c.precio ? <> · <b className="text-amber-700">más caro</b> que comprarlas sueltas</> : null}
                  </p>
                ) : null}
              </div>
            );
          })}
          <button type="button" className={BOTON} onClick={() => setCombos((l) => [...l, { cantidad: 0, precio: 0, etiqueta: "" }])}><Plus className="h-4 w-4" /> Agregar combo</button>
        </div>
      </Tarjeta>

      <Tarjeta icono={<Banknote className="h-4 w-4" />} titulo="Cuentas para cobrar" detalle="Se muestran al comprador para que transfiera. Hace falta al menos una para activar.">
        <div className="space-y-2.5">
          {cuentas.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-slate-200 p-2.5 sm:grid-cols-2">
              <Campo label="Banco o billetera"><input className={INPUT} value={c.banco} onChange={(e) => setCuenta(i, { banco: e.target.value })} placeholder="Ej. Banco Itaú, Tigo Money" /></Campo>
              <Campo label="Titular"><input className={INPUT} value={c.titular} onChange={(e) => setCuenta(i, { titular: e.target.value })} /></Campo>
              <Campo label="Número de cuenta"><input className={INPUT} value={c.cuenta} onChange={(e) => setCuenta(i, { cuenta: e.target.value })} /></Campo>
              <Campo label="CI o RUC del titular (opcional)"><input className={INPUT} value={c.documento ?? ""} onChange={(e) => setCuenta(i, { documento: e.target.value })} /></Campo>
              <Campo label="Alias (opcional)" className="sm:col-span-2"><input className={INPUT} value={c.alias ?? ""} onChange={(e) => setCuenta(i, { alias: e.target.value })} placeholder="Ej. alias para transferir por celular" /></Campo>
              {cuentas.length > 1 ? (
                <button type="button" className={`${BOTON} sm:col-span-2 sm:justify-self-end`} onClick={() => setCuentas((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /> Quitar cuenta</button>
              ) : null}
            </div>
          ))}
          <button type="button" className={BOTON} onClick={() => setCuentas((l) => [...l, { ...CUENTA_VACIA }])}><Plus className="h-4 w-4" /> Agregar cuenta</button>
        </div>
      </Tarjeta>

      <Tarjeta icono={<Settings2 className="h-4 w-4" />} titulo="Venta por la web y WhatsApp" className="lg:col-span-2">
        <div className="grid gap-3 lg:grid-cols-2">
          <Campo label="Cuánto se guardan los números sin pagar" ayuda="En la página web, mientras el comprador sube el comprobante. Después se liberan solos.">
            <Select value={reserva} onChange={setReserva} block etiqueta="Tiempo de reserva"
              options={[["15", "15 minutos"], ["30", "30 minutos"], ["60", "1 hora"], ["120", "2 horas"], ["1440", "1 día"]]} />
          </Campo>
          <div className="space-y-1.5">
            <Interruptor valor={auto} onChange={setAuto} label="Confirmar solo los comprobantes que se leen bien" ayuda="Cuando el monto, la cuenta y el número de operación coinciden. Si no, quedan para revisar." />
          </div>
          <Campo label="Mensaje del ticket" ayuda="Opcional. Va con el ticket que recibe el comprador." className="lg:col-span-2">
            <textarea className={`${INPUT} min-h-20`} value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={500} placeholder="Ej. ¡Gracias por participar! El sorteo es en vivo por nuestra página." />
          </Campo>
        </div>
      </Tarjeta>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 lg:col-span-2">{error}</p> : null}

      <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-slate-200 max-lg:bg-white/95 max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:backdrop-blur lg:col-span-2 lg:flex lg:justify-end">
        <div className="flex gap-2 max-lg:[&>*]:flex-1">
          <button type="button" className={BOTON} disabled={guardando} onClick={() => router.back()}>Cancelar</button>
          <button type="button" className={BOTON_PRIMARIO} disabled={guardando || subiendo} onClick={guardar}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {inicial ? "Guardar cambios" : "Crear sorteo"}
          </button>
        </div>
      </div>
    </div>
  );
}
