"use client";

/**
 * Configuración › Tickets y facturación: tarjetas "Ticket de venta" y "Comanda de cocina"
 * (receta 71). Controles a la izquierda y vista previa en vivo a la derecha (debajo en
 * celular), armada con la MISMA función que imprime la caja (htmlTicketVenta / htmlComanda)
 * y datos de ejemplo. Cada tarjeta guarda lo suyo con su botón (solo ADMIN).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChefHat, Eye, Loader2, Receipt, RotateCcw, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT } from "@/modules/inventario/ui";
import { LOGO_INSTALACION, membreteEmpresa, type DatosEmpresa } from "@/modules/empresa/tipos";
import { Aviso, Campo, Interruptor, Tarjeta } from "@/modules/facturacion/ui";
import type { ConfigFacturacion } from "@/modules/facturacion/tipos";
import {
  COMANDA_DEFAULT, EJEMPLO_COMANDA, LETRAS_COMANDA, LETRAS_TICKET, TICKET_VENTA_DEFAULT,
  comandaEfectiva, ejemploTicketVenta, htmlComanda, htmlTicketVenta, ticketVentaEfectivo,
  type AnchoTicket, type ConfigComanda, type ConfigTicketVenta, type EmpresaTicket,
} from "@/modules/facturacion/tickets";

const URL_CFG = "/api/configuracion/facturacion";
const TEAL = clienteConfig.color;
const COPIAS: [string, string][] = [1, 2, 3, 4, 5].map((n) => [String(n), n === 1 ? "1 copia" : `${n} copias`]);
const ANCHOS: [AnchoTicket, string][] = [[58, "58 mm"], [80, "80 mm"]];

/** Grupo de opciones tipo chip (role=radio): ancho de papel, tamaño de letra. */
function OpcionesChip<T extends string | number>({ valor, opciones, onChange, etiqueta, disabled }: {
  valor: T; opciones: [T, string][]; onChange: (v: T) => void; etiqueta: string; disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-1.5">
      {opciones.map(([v, label]) => {
        const sel = v === valor;
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={disabled}
            onClick={() => !sel && onChange(v)}
            className={`inline-flex min-h-11 items-center rounded-full px-3.5 text-xs font-semibold ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-9 ${sel ? "bg-[var(--brand-50,#eef7f7)] text-[var(--brand)] ring-[var(--brand)]" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Vista previa: el HTML real del ticket dentro de un iframe (se ajusta al alto del papel). */
function VistaPrevia({ html, titulo }: { html: string; titulo: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alto, setAlto] = useState(420);
  const medir = () => {
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.body) setAlto(Math.max(160, Math.ceil(doc.documentElement.scrollHeight)));
    } catch { /* mismo origen: no debería fallar */ }
  };
  useEffect(() => {
    const t = setTimeout(medir, 60); // el logo puede cargar después
    return () => clearTimeout(t);
  }, [html]);
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-100/80 p-2 sm:p-3 lg:sticky lg:top-4">
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Eye className="h-3.5 w-3.5" /> Vista previa · datos de ejemplo
      </p>
      <div className="overflow-x-auto">
        <iframe
          ref={ref}
          title={titulo}
          srcDoc={html}
          onLoad={medir}
          sandbox="allow-same-origin"
          className="mx-auto block w-full min-w-[230px] border-0 bg-transparent"
          style={{ height: alto }}
        />
      </div>
    </div>
  );
}

/** Pie de guardado de cada tarjeta. */
function PieGuardar({ sucio, guardando, ok, err, onGuardar, onDescartar, onDefaults, etiqueta }: {
  sucio: boolean; guardando: boolean; ok: string | null; err: string | null;
  onGuardar: () => void; onDescartar: () => void; onDefaults: () => void; etiqueta: string;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="min-w-0 flex-1 text-xs" aria-live="polite">
        {err ? <span className="text-rose-700">{err}</span>
          : ok && !sucio ? <span className="inline-flex items-center gap-1 font-medium text-emerald-600"><Sparkles className="h-3.5 w-3.5" /> {ok}</span>
          : sucio ? <span className="text-amber-700">Hay cambios sin guardar.</span>
          : null}
      </div>
      <button type="button" onClick={onDefaults} disabled={guardando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
        <RotateCcw className="h-4 w-4" /> Valores de fábrica
      </button>
      {sucio ? (
        <button type="button" onClick={onDescartar} disabled={guardando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>Descartar</button>
      ) : null}
      <button type="button" onClick={onGuardar} disabled={guardando || !sucio} className={`${BOTON_PRIMARIO} max-sm:min-h-11`} style={{ backgroundColor: TEAL }}>
        {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {etiqueta}
      </button>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{titulo}</legend>
      {children}
    </fieldset>
  );
}

function useGuardado<T extends object>(clave: "ticket_venta" | "ticket_comanda", guardado: T, onGuardado: (c: ConfigFacturacion) => void) {
  const [f, setF] = useState<T>(guardado);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const clave_json = JSON.stringify(guardado);
  useEffect(() => { setF(JSON.parse(clave_json) as T); }, [clave_json]);
  const cambios = useMemo(() => {
    const c: Partial<T> = {};
    for (const k of Object.keys(f) as (keyof T)[]) if (JSON.stringify(f[k]) !== JSON.stringify(guardado[k])) c[k] = f[k];
    return c;
  }, [f, guardado]);
  const sucio = Object.keys(cambios).length > 0;
  const set = <K extends keyof T>(k: K, v: T[K]) => { setF((x) => ({ ...x, [k]: v })); setOk(null); setErr(null); };
  async function guardar() {
    if (!sucio || guardando) return;
    setGuardando(true); setErr(null);
    try {
      const d = await apiFetch<ConfigFacturacion>(URL_CFG, { method: "PUT", body: JSON.stringify({ [clave]: cambios }) });
      invalidar(URL_CFG);
      onGuardado(d);
      setOk("Guardado");
      setTimeout(() => setOk(null), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }
  return { f, setF, set, sucio, guardando, ok, err, guardar, descartar: () => { setF(guardado); setErr(null); } };
}

// ── Empresa para la vista previa (Datos de la empresa) ──────────────────────
function useEmpresaEjemplo(): EmpresaTicket {
  const [d, setD] = useState<DatosEmpresa | null>(null);
  useEffect(() => {
    apiFetch<DatosEmpresa>("/api/configuracion/empresa").then(setD).catch(() => {});
  }, []);
  return useMemo(() => {
    const m = membreteEmpresa(d, { nombre: clienteConfig.nombre });
    return { nombre: m.nombre, razonSocial: m.razonSocial, ruc: m.ruc, ubicacion: m.ubicacion, telefono: m.telefono, logo: d?.logo_url || LOGO_INSTALACION };
  }, [d]);
}

// ── Ticket de venta ──────────────────────────────────────────────────────────
export function TarjetaTicketVenta({ cfg, soloLectura, onGuardado }: { cfg: ConfigFacturacion; soloLectura: boolean; onGuardado: (c: ConfigFacturacion) => void }) {
  const guardado = useMemo(() => ticketVentaEfectivo(cfg.ticket_venta, cfg.impresion_tipo_default), [cfg.ticket_venta, cfg.impresion_tipo_default]);
  const g = useGuardado<ConfigTicketVenta>("ticket_venta", guardado, onGuardado);
  const empresa = useEmpresaEjemplo();
  const html = useMemo(() => htmlTicketVenta(g.f, ejemploTicketVenta(empresa), { vistaPrevia: true }), [g.f, empresa]);
  const f = g.f;
  const dis = soloLectura || g.guardando;
  const sw = (k: keyof ConfigTicketVenta, etiqueta: ReactNode, descripcion?: ReactNode) => (
    <Interruptor activo={Boolean(f[k])} onChange={(v) => g.set(k, v as never)} etiqueta={etiqueta} descripcion={descripcion} disabled={dis} />
  );

  return (
    <Tarjeta
      icono={<Receipt className="h-4 w-4" />}
      titulo="Ticket de venta"
      detalle="Lo que imprime la caja al cobrar (y al reimprimir desde el detalle de la venta)."
    >
      {g.err ? <Aviso tono="error" className="mb-3">{g.err}</Aviso> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <Grupo titulo="Papel e impresión">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Ancho del papel" sinLabel ayuda={esTicketTipo(cfg.impresion_tipo_default) ? "Cambia también el tipo de impresión por defecto (ticket 58 / 80 mm)." : undefined}>
                <OpcionesChip valor={f.ancho_mm} opciones={ANCHOS} onChange={(v) => g.set("ancho_mm", v)} etiqueta="Ancho del papel" disabled={dis} />
              </Campo>
              <Campo etiqueta="Tamaño de letra" sinLabel>
                <OpcionesChip valor={f.letra} opciones={LETRAS_TICKET} onChange={(v) => g.set("letra", v)} etiqueta="Tamaño de letra" disabled={dis} />
              </Campo>
              <Campo etiqueta="Copias" sinLabel ayuda="Cuántos tickets salen por cada venta.">
                <Select value={String(f.copias)} onChange={(v) => g.set("copias", Number(v))} options={COPIAS} block etiqueta="Copias del ticket" disabled={dis} />
              </Campo>
              <div className="sm:pt-5">
                {sw("imprimir_al_cobrar", "Imprimir automáticamente al cobrar", "Si lo apagás, la caja muestra un botón «Imprimir ticket».")}
              </div>
            </div>
          </Grupo>

          <Grupo titulo="Encabezado">
            {sw("logo", "Logo", "El de Datos de la empresa (o el de la instalación si no cargaste uno).")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sw("enc_nombre_fantasia", "Nombre de fantasía")}
              {sw("enc_razon_social", "Razón social")}
              {sw("enc_ruc", "RUC")}
              {sw("enc_direccion", "Dirección")}
              {sw("enc_telefono", "Teléfono")}
              {sw("enc_sucursal", "Sucursal y caja")}
            </div>
            <Campo etiqueta="Texto de encabezado" opcional ayuda="Va debajo de los datos de la empresa (ej. horario, Instagram, WhatsApp).">
              <textarea value={f.encabezado_texto} onChange={(e) => g.set("encabezado_texto", e.target.value)} maxLength={300} rows={2}
                disabled={dis} className={`${INPUT} min-h-[64px] resize-y`} placeholder="Ej. Lun a Sáb de 8 a 20 h" />
            </Campo>
          </Grupo>

          <Grupo titulo="Contenido">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sw("mostrar_cajero", "Cajero")}
              {sw("mostrar_cliente", "Cliente")}
              {f.mostrar_cliente ? sw("mostrar_cliente_doc", "RUC / CI del cliente") : null}
              {sw("mostrar_iva", "Detalle de IVA", "Subtotal e IVA antes del total.")}
              {sw("mostrar_pago", "Forma de pago y vuelto")}
            </div>
          </Grupo>

          <Grupo titulo="Pie">
            <Campo etiqueta="Texto de pie" opcional ayuda="Abajo siempre va «Comprobante interno — no válido como factura legal».">
              <textarea value={f.pie_texto} onChange={(e) => g.set("pie_texto", e.target.value)} maxLength={300} rows={2}
                disabled={dis} className={`${INPUT} min-h-[64px] resize-y`} placeholder={TICKET_VENTA_DEFAULT.pie_texto} />
            </Campo>
          </Grupo>
        </div>
        <VistaPrevia html={html} titulo="Vista previa del ticket de venta" />
      </div>
      {!soloLectura ? (
        <PieGuardar
          sucio={g.sucio} guardando={g.guardando} ok={g.ok} err={null}
          onGuardar={g.guardar} onDescartar={g.descartar}
          onDefaults={() => g.setF({ ...TICKET_VENTA_DEFAULT, ancho_mm: f.ancho_mm })}
          etiqueta="Guardar ticket"
        />
      ) : null}
    </Tarjeta>
  );
}

const esTicketTipo = (t: string) => t === "ticket_58mm" || t === "ticket_80mm";

// ── Comanda de cocina ────────────────────────────────────────────────────────
export function TarjetaComanda({ cfg, soloLectura, onGuardado }: { cfg: ConfigFacturacion; soloLectura: boolean; onGuardado: (c: ConfigFacturacion) => void }) {
  const guardado = useMemo(() => comandaEfectiva(cfg.ticket_comanda), [cfg.ticket_comanda]);
  const g = useGuardado<ConfigComanda>("ticket_comanda", guardado, onGuardado);
  const html = useMemo(() => htmlComanda(g.f, EJEMPLO_COMANDA, { vistaPrevia: true }), [g.f]);
  const f = g.f;
  const dis = soloLectura || g.guardando;
  const sw = (k: keyof ConfigComanda, etiqueta: ReactNode, descripcion?: ReactNode) => (
    <Interruptor activo={Boolean(f[k])} onChange={(v) => g.set(k, v as never)} etiqueta={etiqueta} descripcion={descripcion} disabled={dis} />
  );

  return (
    <Tarjeta
      icono={<ChefHat className="h-4 w-4" />}
      titulo="Comanda de cocina"
      detalle="El papel que sale en la cocina con cada pedido (mesas y QR)."
    >
      {g.err ? <Aviso tono="error" className="mb-3">{g.err}</Aviso> : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <Grupo titulo="Papel e impresión">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Ancho del papel" sinLabel>
                <OpcionesChip valor={f.ancho_mm} opciones={ANCHOS} onChange={(v) => g.set("ancho_mm", v)} etiqueta="Ancho del papel de la comanda" disabled={dis} />
              </Campo>
              <Campo etiqueta="Tamaño de letra" sinLabel>
                <OpcionesChip valor={f.letra} opciones={LETRAS_COMANDA} onChange={(v) => g.set("letra", v)} etiqueta="Tamaño de letra de la comanda" disabled={dis} />
              </Campo>
              <Campo etiqueta="Copias" sinLabel>
                <Select value={String(f.copias)} onChange={(v) => g.set("copias", Number(v))} options={COPIAS} block etiqueta="Copias de la comanda" disabled={dis} />
              </Campo>
            </div>
          </Grupo>
          <Grupo titulo="Contenido">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sw("mostrar_cliente", "Nombre del cliente")}
              {sw("mostrar_notas", "Notas", "Las del pedido y las de cada plato.")}
              {sw("mostrar_precios", "Precios")}
            </div>
            <Campo etiqueta="Texto de pie" opcional>
              <textarea value={f.pie_texto} onChange={(e) => g.set("pie_texto", e.target.value)} maxLength={300} rows={2}
                disabled={dis} className={`${INPUT} min-h-[64px] resize-y`} placeholder="Ej. Revisar alergias" />
            </Campo>
          </Grupo>
        </div>
        <VistaPrevia html={html} titulo="Vista previa de la comanda" />
      </div>
      {!soloLectura ? (
        <PieGuardar
          sucio={g.sucio} guardando={g.guardando} ok={g.ok} err={null}
          onGuardar={g.guardar} onDescartar={g.descartar}
          onDefaults={() => g.setF({ ...COMANDA_DEFAULT })}
          etiqueta="Guardar comanda"
        />
      ) : null}
    </Tarjeta>
  );
}
