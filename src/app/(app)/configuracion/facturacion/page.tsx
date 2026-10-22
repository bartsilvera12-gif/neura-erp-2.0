"use client";

/**
 * /configuracion/facturacion — Configuración › Facturación (portada de sistemas-propio, mismo
 * contenido y comportamiento, con los componentes del 2.0). Nivel ADMIN + "Configuración del sistema".
 *   · Modo de facturación (3 tarjetas) con aviso según el modo (a SIFEN se entra solo desde su tarjeta);
 *     tipo de impresión por defecto y "Pedir datos del comprador al confirmar venta": se guardan
 *     al tocarlos (como el original). Modo autoimpresor → tarjeta con los datos del timbrado.
 *   · SIFEN / Facturación electrónica → /configuracion/facturacion-electronica.
 *   · Clientes — perfil tributario: interruptor (solo Administrador), se guarda al tocarlo.
 *   · Numeración de documentos y Condiciones de pago: formulario con "Guardar configuración".
 *   · Resumen actual con lo guardado.
 * Todo en la base (receta 61): la caja, la ficha del cliente y las suscripciones numeran con el
 * prefijo/numeración de acá; las ventas a crédito sin plazo usan los días por defecto.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ClipboardList, Hash, Landmark, Loader2, Percent, Printer, ReceiptText, Sparkles, Stamp, Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT } from "@/modules/inventario/ui";
import { Aviso, Campo, Chip, Cifra, Interruptor, Tarjeta, fechaHora } from "@/modules/facturacion/ui";
import {
  IMPRESIONES, MODOS, esTicket, numeroFactura,
  type Autoimpresor, type ConfigFacturacion, type ModoFacturacion, type TipoImpresion,
} from "@/modules/facturacion/tipos";

const URL = "/api/configuracion/facturacion";
const TEAL = clienteConfig.color;

type FormNum = { prefijo_factura: string; numeracion_inicial: string; dias_vencimiento_default: string; interes_moratorio: string };
const deConfig = (c: ConfigFacturacion): FormNum => ({
  prefijo_factura: c.prefijo_factura,
  numeracion_inicial: String(c.numeracion_inicial),
  dias_vencimiento_default: String(c.dias_vencimiento_default),
  interes_moratorio: String(c.interes_moratorio).replace(".", ","),
});
const aNumero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const pct = (n: number) => n.toLocaleString("es-PY", { maximumFractionDigits: 2 });

export default function FacturacionPage() {
  const [cfg, setCfg] = useState<ConfigFacturacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  // Guardado inmediato (modo / impresión / pedir datos / gestión tributaria)
  const [guardandoModo, setGuardandoModo] = useState(false);
  const [okModo, setOkModo] = useState<string | null>(null);
  const [errModo, setErrModo] = useState<string | null>(null);
  const [guardandoTrib, setGuardandoTrib] = useState(false);
  const [errTrib, setErrTrib] = useState<string | null>(null);

  // Formulario de numeración y condiciones
  const [f, setF] = useState<FormNum>({ prefijo_factura: "", numeracion_inicial: "1", dias_vencimiento_default: "30", interes_moratorio: "0" });
  const [guardando, setGuardando] = useState(false);
  const [errGuardar, setErrGuardar] = useState<string | null>(null);
  const [okGuardar, setOkGuardar] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setCargando(true);
    apiFetch<ConfigFacturacion>(URL)
      .then((d) => { setCfg(d); setF(deConfig(d)); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);
  useEffect(cargar, [cargar]);

  const soloLectura = cfg ? !cfg.puede_editar : true;
  const original = useMemo(() => (cfg ? deConfig(cfg) : f), [cfg, f]);
  const sucio = (Object.keys(f) as (keyof FormNum)[]).some((k) => f[k].trim() !== original[k].trim());

  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  async function guardarAlTocar(patch: Partial<ConfigFacturacion>) {
    if (!cfg || soloLectura) return;
    setGuardandoModo(true); setErrModo(null); setOkModo(null);
    const antes = cfg;
    setCfg({ ...cfg, ...patch }); // se ve al instante; si falla, vuelve
    try {
      const d = await apiFetch<ConfigFacturacion>(URL, { method: "PUT", body: JSON.stringify(patch) });
      setCfg(d);
      invalidar(URL);
      setOkModo("Guardado");
      setTimeout(() => setOkModo(null), 1800);
    } catch (e) {
      setCfg(antes);
      setErrModo((e as Error).message);
    } finally {
      setGuardandoModo(false);
    }
  }

  async function cambiarGestionTributaria(v: boolean) {
    if (!cfg || soloLectura || guardandoTrib) return;
    setGuardandoTrib(true); setErrTrib(null);
    try {
      const d = await apiFetch<ConfigFacturacion>(URL, { method: "PUT", body: JSON.stringify({ gestion_tributaria_clientes: v }) });
      setCfg(d);
    } catch (e) {
      setErrTrib((e as Error).message);
    } finally {
      setGuardandoTrib(false);
    }
  }

  // Validación del formulario (la base vuelve a validar)
  const prefijo = f.prefijo_factura.replace(/\s+/g, "").toUpperCase();
  const nIni = aNumero(f.numeracion_inicial);
  const dias = aNumero(f.dias_vencimiento_default);
  const interes = aNumero(f.interes_moratorio);
  const bloqueo =
    !prefijo ? "Escribí el prefijo de factura."
    : !/^[A-Z0-9][A-Z0-9/_.-]{0,11}$/.test(prefijo) ? "Prefijo: hasta 12 letras o números y - / _ ."
    : !Number.isInteger(nIni) || nIni < 1 ? "La numeración inicial es un entero desde 1."
    : !Number.isInteger(dias) || dias < 0 || dias > 365 ? "Los días de vencimiento van de 0 a 365."
    : !Number.isFinite(interes) || interes < 0 || interes > 100 ? "El interés moratorio va de 0 a 100 %."
    : null;

  async function guardar() {
    if (!cfg || bloqueo || !sucio || guardando) return;
    setGuardando(true); setErrGuardar(null);
    try {
      const d = await apiFetch<ConfigFacturacion>(URL, {
        method: "PUT",
        body: JSON.stringify({ prefijo_factura: prefijo, numeracion_inicial: nIni, dias_vencimiento_default: dias, interes_moratorio: interes }),
      });
      setCfg(d);
      setF(deConfig(d));
      invalidar(URL);
      setOkGuardar("Configuración guardada correctamente.");
      setTimeout(() => setOkGuardar(null), 4000);
    } catch (e) {
      setErrGuardar((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const set = (k: keyof FormNum, v: string) => { setF((x) => ({ ...x, [k]: v })); setOkGuardar(null); setErrGuardar(null); };

  if (cargando && !cfg) {
    return (
      <div className="space-y-5 pb-10">
        <EncabezadoPagina kicker="Configuración" titulo="Facturación" />
        {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    );
  }
  if (error && !cfg) {
    return (
      <div className="space-y-5 pb-10">
        <EncabezadoPagina kicker="Configuración" titulo="Facturación" />
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={cargar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!cfg) return null;

  const vistaPrevia = numeroFactura(prefijo || "FAC-", Number.isInteger(nIni) && nIni > 0 ? nIni : 1);
  const vistaSiguiente = numeroFactura(prefijo || "FAC-", (Number.isInteger(nIni) && nIni > 0 ? nIni : 1) + 1);

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        volver={{ href: "/configuracion", label: "Configuración" }}
        kicker="Configuración"
        titulo="Facturación"
        subtitulo="SIFEN, numeración, condiciones de cobro, y (en tarjeta propia) la opción de gestión tributaria de clientes."
      />

      {soloLectura ? (
        <Aviso tono="alerta">Podés ver esta configuración, pero cambiarla es solo para el Administrador.</Aviso>
      ) : null}

      {/* ── Modo de facturación ─────────────────────────────────────────── */}
      <Tarjeta
        icono={<ReceiptText className="h-4 w-4" />}
        titulo="Modo de facturación"
        acciones={
          guardandoModo ? <span className="inline-flex items-center gap-1 text-xs text-slate-400 max-sm:justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…</span>
          : okModo ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 max-sm:justify-center"><Sparkles className="h-3.5 w-3.5" /> {okModo}</span>
          : null
        }
      >
        {errModo ? <Aviso tono="error" className="mb-3">{errModo}</Aviso> : null}
        <div role="radiogroup" aria-label="Modo de facturación" className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          {MODOS.map((m) => {
            const sel = cfg.modo === m.key;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={sel}
                disabled={soloLectura || guardandoModo}
                onClick={() => !sel && guardarAlTocar({ modo: m.key as ModoFacturacion })}
                className={`min-h-11 rounded-xl border p-3.5 text-left transition disabled:cursor-not-allowed ${sel ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] ring-2 ring-[var(--brand-100)]" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"} ${soloLectura && !sel ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${sel ? "border-[var(--brand)]" : "border-slate-300"}`}>
                    {sel ? <span className="h-2 w-2 rounded-full bg-[var(--brand)]" /> : null}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{m.titulo}</span>
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{m.resumen}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          {cfg.modo === "sin_factura_fiscal" ? (
            <Aviso>Al confirmar una venta solo se registra internamente. No se emite documento fiscal.</Aviso>
          ) : cfg.modo === "sifen" ? (
            <div className="rounded-xl border border-[var(--brand-100)] bg-[var(--brand-50,#eef7f7)] px-3 py-3 text-xs leading-relaxed text-slate-600 sm:text-[13px]">
              Las ventas confirmadas se emiten como Documentos Electrónicos al SIFEN. El timbrado, el certificado y el KuDE se configuran en la tarjeta <b className="font-semibold text-slate-700">SIFEN</b> de abajo.
              <span className="mt-1 block text-slate-500">Por ahora este sistema todavía no envía a la SET: la caja sigue imprimiendo el ticket.</span>
            </div>
          ) : (
            <Aviso tono="alerta">Configurá abajo timbrado autorizado, establecimiento, punto de expedición y rango de numeración. Sin estos datos no se podrán emitir facturas impresas.</Aviso>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
          <Campo
            etiqueta="Tipo de impresión por defecto"
            sinLabel
            ayuda={
              <>
                {esTicket(cfg.impresion_tipo_default)
                  ? "Ticket térmico: formato optimizado para impresoras 58/80 mm. La impresión usa la ventana del navegador."
                  : "PDF: imprime usando el navegador. Apto para impresoras tradicionales."}
                {!esTicket(cfg.impresion_tipo_default) ? <span className="block text-amber-700">Todavía la caja no tiene PDF A4 ni media hoja: mientras tanto imprime el ticket de 80 mm.</span> : null}
              </>
            }
          >
            <Select
              value={cfg.impresion_tipo_default}
              onChange={(v) => guardarAlTocar({ impresion_tipo_default: v as TipoImpresion })}
              options={IMPRESIONES}
              block
              etiqueta="Tipo de impresión por defecto"
              disabled={soloLectura || guardandoModo}
            />
          </Campo>
          <div className="md:pt-5">
            <Interruptor
              activo={cfg.preguntar_datos_al_confirmar}
              onChange={(v) => guardarAlTocar({ preguntar_datos_al_confirmar: v })}
              etiqueta="Pedir datos del comprador al confirmar venta"
              descripcion="En la caja, antes de cobrar sin cliente, pregunta a nombre de quién va (o consumidor final)."
              disabled={soloLectura || guardandoModo}
            />
          </div>
        </div>
      </Tarjeta>

      {cfg.modo === "autoimpresor" ? (
        <AutoimpresorTarjeta valor={cfg.autoimpresor} soloLectura={soloLectura} onGuardado={(d) => setCfg(d)} />
      ) : null}

      {/* ── SIFEN ───────────────────────────────────────────────────────── */}
      <Tarjeta
        icono={<Landmark className="h-4 w-4" />}
        titulo="SIFEN / Facturación electrónica"
        detalle={
          <>
            Timbrado, CSC, certificado .p12 y ambiente SET. Opcional: las empresas sin SIFEN no se ven afectadas.
            <span className="mt-2 flex flex-wrap gap-1.5">
              {!cfg.sifen.configurada ? <Chip tono="neutro">Sin configurar</Chip>
                : cfg.sifen.completa ? <Chip tono="ok">Lista para operar</Chip>
                : <Chip tono="alerta">Configuración incompleta</Chip>}
              {cfg.sifen.configurada ? <Chip tono={cfg.sifen.activo ? "marca" : "neutro"}>{cfg.sifen.activo ? "Activo" : "Inactivo"}</Chip> : null}
              {cfg.sifen.ambiente ? <Chip tono="neutro">Ambiente {cfg.sifen.ambiente === "produccion" ? "Producción" : "Test"}</Chip> : null}
            </span>
          </>
        }
        acciones={
          <Link href="/configuracion/facturacion-electronica" className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            Configurar SIFEN
          </Link>
        }
      />

      {/* ── Clientes — perfil tributario ───────────────────────────────── */}
      <Tarjeta
        icono={<Users className="h-4 w-4" />}
        titulo="Clientes — perfil tributario"
        detalle={
          <>
            Activá acá el módulo opcional: en la <strong className="font-semibold text-slate-600">ficha del cliente (pestaña Información)</strong> podrás asignar obligaciones
            (IVA, IRE, etc.) y honorarios, sin mezclar con la ficha comercial. Solo un administrador de la empresa puede encender o apagar esta opción.
          </>
        }
      >
        <div className="max-w-md">
          <Interruptor
            activo={cfg.gestion_tributaria_clientes}
            onChange={cambiarGestionTributaria}
            etiqueta="Activar gestión tributaria de clientes"
            disabled={soloLectura || guardandoTrib}
            descripcion={guardandoTrib ? "Guardando…" : undefined}
          />
          {errTrib ? <p className="mt-2 text-xs text-rose-600">{errTrib}</p> : null}
          {soloLectura ? <p className="mt-2 text-xs text-amber-700">Iniciá sesión como administrador de la empresa para cambiar esta opción.</p> : null}
        </div>
      </Tarjeta>

      {/* ── Numeración de documentos ─────────────────────────────────────── */}
      <Tarjeta icono={<Hash className="h-4 w-4" />} titulo="Numeración de documentos">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Prefijo de factura" ayuda="Prefijo que antecede al número correlativo (ej: FAC-, FT-, VTA-).">
            <input value={f.prefijo_factura} onChange={(e) => set("prefijo_factura", e.target.value.toUpperCase())} maxLength={12} placeholder="FAC-"
              disabled={soloLectura} className={`${INPUT} font-mono uppercase`} autoComplete="off" />
          </Campo>
          <Campo etiqueta="Numeración inicial" ayuda="Número desde el cual comienza la secuencia de facturas.">
            <input value={f.numeracion_inicial} onChange={(e) => set("numeracion_inicial", e.target.value.replace(/\D/g, "").slice(0, 9))} inputMode="numeric"
              disabled={soloLectura} className={`${INPUT} tabular-nums`} />
          </Campo>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <span className="text-xs text-slate-500">Vista previa:</span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-mono text-sm font-bold text-slate-800 [overflow-wrap:anywhere]">{vistaPrevia}</span>
          <span className="text-xs text-slate-400">→</span>
          <span className="font-mono text-xs text-slate-500 [overflow-wrap:anywhere]">{vistaSiguiente}</span>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-slate-400">
          Lo usan las ventas de la caja, la factura al contado de la ficha del cliente y las cuotas de suscripción. Nunca se repite un número: si ya hay ventas con ese prefijo, sigue desde la última.
          {" "}Próxima venta con lo guardado: <span className="font-mono font-semibold text-slate-600">{cfg.proximo_numero}</span>
          {cfg.ultimo_numero ? <> · última emitida: <span className="font-mono">{cfg.ultimo_numero}</span></> : null}.
        </p>
      </Tarjeta>

      {/* ── Condiciones de pago ──────────────────────────────────────────── */}
      <Tarjeta icono={<Percent className="h-4 w-4" />} titulo="Condiciones de pago">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Días de vencimiento por defecto" ayuda="Plazo aplicado automáticamente a facturas a crédito sin plazo definido.">
            <div className="relative">
              <input value={f.dias_vencimiento_default} onChange={(e) => set("dias_vencimiento_default", e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric"
                disabled={soloLectura} className={`${INPUT} pr-14 tabular-nums`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">días</span>
            </div>
          </Campo>
          <Campo etiqueta="Interés moratorio" ayuda="Porcentaje mensual aplicado sobre el saldo vencido impago.">
            <div className="relative">
              <input value={f.interes_moratorio} onChange={(e) => set("interes_moratorio", e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))} inputMode="decimal"
                disabled={soloLectura} className={`${INPUT} pr-20 tabular-nums`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">% mens.</span>
            </div>
          </Campo>
        </div>
      </Tarjeta>

      {/* ── Resumen actual ───────────────────────────────────────────────── */}
      <Tarjeta icono={<ClipboardList className="h-4 w-4" />} titulo="Resumen actual">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Cifra etiqueta="Prefijo" valor={cfg.prefijo_factura} mono />
          <Cifra etiqueta="Nro. inicial" valor={cfg.numeracion_inicial} mono />
          <Cifra etiqueta="Vencimiento" valor={`${cfg.dias_vencimiento_default} días`} />
          <Cifra etiqueta="Interés mora" valor={`${pct(cfg.interes_moratorio)}% mens.`} />
        </div>
        {cfg.updated_at ? (
          <p className="mt-3 text-[11px] text-slate-400">Última actualización: {fechaHora(cfg.updated_at)}{cfg.updated_by_nombre ? ` · ${cfg.updated_by_nombre}` : ""}</p>
        ) : null}
      </Tarjeta>

      {/* ── Guardar ──────────────────────────────────────────────────────── */}
      {!soloLectura ? (
        <div className={`sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border bg-white/95 px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgba(2,48,71,0.18)] backdrop-blur sm:gap-3 sm:px-4 sm:py-3 ${sucio ? "border-[var(--brand-100)]" : "border-slate-200"}`}>
          <div className="min-w-0 flex-1 text-xs max-sm:basis-full" aria-live="polite">
            {errGuardar ? <span className="flex items-start gap-1.5 text-rose-700"><AlertTriangle className="mt-px h-4 w-4 shrink-0" /> {errGuardar}</span>
              : okGuardar && !sucio ? <span className="flex items-center gap-1.5 text-emerald-700"><Sparkles className="h-4 w-4 shrink-0" /> {okGuardar}</span>
              : sucio && bloqueo ? <span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" /> {bloqueo}</span>
              : <span className="text-slate-400">Los cambios se aplican de inmediato en todo el sistema.</span>}
          </div>
          {sucio ? (
            <button type="button" onClick={() => setF(original)} disabled={guardando} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Descartar</button>
          ) : null}
          <button type="button" onClick={guardar} disabled={guardando || !sucio || !!bloqueo} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar configuración
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Autoimpresor / timbrado (modo "autoimpresor") ────────────────────────────

type FormAuto = Record<
  "ruc_emisor" | "razon_social_emisor" | "nombre_fantasia" | "direccion_matriz" | "telefono" | "timbrado_numero" | "timbrado_inicio_vigencia" |
  "timbrado_fin_vigencia" | "establecimiento_codigo" | "punto_expedicion_codigo" | "numero_actual" | "numero_inicial" | "numero_final" |
  "leyenda_papel_termico" | "observaciones", string
> & { activo: boolean; formato_impresion_default: TipoImpresion };

const deAuto = (a: Autoimpresor): FormAuto => ({
  activo: a.activo,
  ruc_emisor: a.ruc_emisor ?? "", razon_social_emisor: a.razon_social_emisor ?? "", nombre_fantasia: a.nombre_fantasia ?? "",
  direccion_matriz: a.direccion_matriz ?? "", telefono: a.telefono ?? "", timbrado_numero: a.timbrado_numero ?? "",
  timbrado_inicio_vigencia: a.timbrado_inicio_vigencia ?? "", timbrado_fin_vigencia: a.timbrado_fin_vigencia ?? "",
  establecimiento_codigo: a.establecimiento_codigo ?? "", punto_expedicion_codigo: a.punto_expedicion_codigo ?? "",
  numero_actual: a.numero_actual != null ? String(a.numero_actual) : "", numero_inicial: a.numero_inicial != null ? String(a.numero_inicial) : "",
  numero_final: a.numero_final != null ? String(a.numero_final) : "",
  formato_impresion_default: a.formato_impresion_default, leyenda_papel_termico: a.leyenda_papel_termico ?? "", observaciones: a.observaciones ?? "",
});

function AutoimpresorTarjeta({ valor, soloLectura, onGuardado }: { valor: Autoimpresor; soloLectura: boolean; onGuardado: (c: ConfigFacturacion) => void }) {
  const [f, setF] = useState<FormAuto>(() => deAuto(valor));
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { setF(deAuto(valor)); }, [valor]);
  const set = <K extends keyof FormAuto>(k: K, v: FormAuto[K]) => { setF((x) => ({ ...x, [k]: v })); setOk(null); setErr(null); };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (soloLectura || guardando) return;
    setGuardando(true); setErr(null); setOk(null);
    try {
      const num = (s: string) => (s.trim() ? Number(s) : null);
      const d = await apiFetch<ConfigFacturacion>("/api/configuracion/facturacion/autoimpresor", {
        method: "PUT",
        body: JSON.stringify({
          ...f,
          numero_actual: num(f.numero_actual), numero_inicial: num(f.numero_inicial), numero_final: num(f.numero_final),
          timbrado_inicio_vigencia: f.timbrado_inicio_vigencia || null, timbrado_fin_vigencia: f.timbrado_fin_vigencia || null,
        }),
      });
      onGuardado(d);
      setOk("Guardado");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const digitos = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);

  return (
    <Tarjeta
      icono={<Stamp className="h-4 w-4" />}
      titulo="Datos del autoimpresor / timbrado"
      detalle={!valor.guardado ? "Lo vacío viene precargado de Datos de la empresa: revisalo y guardá." : undefined}
    >
      <form onSubmit={guardar} className="space-y-4">
        {err ? <Aviso tono="error">{err}</Aviso> : null}
        <div className="max-w-sm">
          <Interruptor activo={f.activo} onChange={(v) => set("activo", v)} etiqueta="Autoimpresor activo" disabled={soloLectura} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="RUC emisor"><input className={`${INPUT} font-mono`} value={f.ruc_emisor} onChange={(e) => set("ruc_emisor", e.target.value.replace(/[^\d-]/g, ""))} maxLength={10} placeholder="80012345-0" disabled={soloLectura} /></Campo>
          <Campo etiqueta="Razón social"><input className={`${INPUT} uppercase`} value={f.razon_social_emisor} onChange={(e) => set("razon_social_emisor", e.target.value)} maxLength={160} disabled={soloLectura} /></Campo>
          <Campo etiqueta="Nombre fantasía"><input className={`${INPUT} uppercase`} value={f.nombre_fantasia} onChange={(e) => set("nombre_fantasia", e.target.value)} maxLength={120} disabled={soloLectura} /></Campo>
          <Campo etiqueta="Dirección" className="sm:col-span-2 lg:col-span-2"><input className={`${INPUT} uppercase`} value={f.direccion_matriz} onChange={(e) => set("direccion_matriz", e.target.value)} maxLength={200} disabled={soloLectura} /></Campo>
          <Campo etiqueta="Teléfono"><input type="tel" inputMode="tel" className={INPUT} value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} disabled={soloLectura} /></Campo>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Timbrado N°"><input inputMode="numeric" className={`${INPUT} font-mono`} value={f.timbrado_numero} onChange={(e) => set("timbrado_numero", digitos(e.target.value, 15))} disabled={soloLectura} /></Campo>
          <Campo etiqueta="Inicio vigencia" sinLabel>
            <SelectorFecha value={f.timbrado_inicio_vigencia} onChange={(v) => set("timbrado_inicio_vigencia", v)} block etiqueta="Inicio de vigencia del timbrado" disabled={soloLectura} claseBoton="min-h-[42px] rounded-xl px-3" />
          </Campo>
          <Campo etiqueta="Fin vigencia" sinLabel>
            <SelectorFecha value={f.timbrado_fin_vigencia} onChange={(v) => set("timbrado_fin_vigencia", v)} block etiqueta="Fin de vigencia del timbrado" min={f.timbrado_inicio_vigencia || undefined} disabled={soloLectura} claseBoton="min-h-[42px] rounded-xl px-3" />
          </Campo>
          <Campo etiqueta="Establecimiento"><input inputMode="numeric" className={`${INPUT} font-mono`} placeholder="001" value={f.establecimiento_codigo} onChange={(e) => set("establecimiento_codigo", digitos(e.target.value, 3))} disabled={soloLectura} /></Campo>
          <Campo etiqueta="Punto de expedición"><input inputMode="numeric" className={`${INPUT} font-mono`} placeholder="001" value={f.punto_expedicion_codigo} onChange={(e) => set("punto_expedicion_codigo", digitos(e.target.value, 3))} disabled={soloLectura} /></Campo>
          <div className="hidden lg:block" />
          <Campo etiqueta="N° inicial"><input inputMode="numeric" className={`${INPUT} tabular-nums`} value={f.numero_inicial} onChange={(e) => set("numero_inicial", digitos(e.target.value, 10))} disabled={soloLectura} /></Campo>
          <Campo etiqueta="N° actual"><input inputMode="numeric" className={`${INPUT} tabular-nums`} value={f.numero_actual} onChange={(e) => set("numero_actual", digitos(e.target.value, 10))} disabled={soloLectura} /></Campo>
          <Campo etiqueta="N° final"><input inputMode="numeric" className={`${INPUT} tabular-nums`} value={f.numero_final} onChange={(e) => set("numero_final", digitos(e.target.value, 10))} disabled={soloLectura} /></Campo>
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Campo etiqueta={<span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5" /> Formato de impresión</span>} sinLabel>
            <Select value={f.formato_impresion_default} onChange={(v) => set("formato_impresion_default", v as TipoImpresion)} options={IMPRESIONES} block etiqueta="Formato de impresión" disabled={soloLectura} />
          </Campo>
          {esTicket(f.formato_impresion_default) ? (
            <Campo etiqueta="Leyenda papel térmico (pie)">
              <input className={`${INPUT} uppercase`} placeholder="GRACIAS POR SU COMPRA" value={f.leyenda_papel_termico} onChange={(e) => set("leyenda_papel_termico", e.target.value)} maxLength={120} disabled={soloLectura} />
            </Campo>
          ) : null}
          <Campo etiqueta="Observaciones" className="sm:col-span-2">
            <textarea className={`${INPUT} min-h-[64px] resize-y uppercase`} value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} maxLength={500} rows={2} disabled={soloLectura} />
          </Campo>
        </div>

        {!soloLectura ? (
          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {ok ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 max-sm:justify-center"><Sparkles className="h-3.5 w-3.5" /> {ok}</span> : null}
            <button type="submit" disabled={guardando} className={`${BOTON_PRIMARIO} max-sm:min-h-11`} style={{ backgroundColor: TEAL }}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {guardando ? "Guardando…" : "Guardar autoimpresor"}
            </button>
          </div>
        ) : null}
      </form>
    </Tarjeta>
  );
}
