"use client";

/**
 * /configuracion/empresa — Configuración › Datos de la empresa (nivel ADMIN + "Configuración
 * del sistema"). Identificación fiscal y contacto que salen en el encabezado de todos los
 * documentos (presupuesto con diseño de factura, recibos, remisiones, órdenes, reportes).
 *   · Tarjetas: Identificación fiscal · Contacto · Logo (se cambia acá: se sube y se guarda solo,
 *     aparte del formulario; al subirlo el servidor le quita el fondo liso y se puede volver a la
 *     imagen original o quitárselo de nuevo; "Quitar logo" vuelve al de la instalación).
 *   · Vista previa en vivo del encabezado (presupuesto y documentos generales). En celular se
 *     abre en una hoja (CapaModal) desde la barra de guardar.
 *   · RUC: el dígito verificador (módulo 11 de la SET) se controla mientras se escribe; la base
 *     rechaza un DV que no coincide.
 *   · Barra fija de guardar con Descartar; avisa si salís con cambios sin guardar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, BadgeCheck, Building2, Eraser, ImageIcon, Info, Loader2, MapPin, RotateCcw, Sparkles, Undo2, Upload,
} from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { CapaModal, ALTO_MAX_MODAL } from "@/components/CapaModal";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import {
  CAMPOS_EMPRESA, DEPARTAMENTOS_PY, LOGO_INSTALACION, LOGO_MAX_MB, LOGO_TIPOS, normalizarRuc, validarRuc,
  type DatosEmpresa, type FormEmpresa,
} from "@/modules/empresa/tipos";

const URL = "/api/configuracion/empresa";
const TEAL = clienteConfig.color;

const vacio: FormEmpresa = {
  razon_social: "", nombre_fantasia: "", ruc: "", actividad_economica: "", direccion: "", ciudad: "", departamento: "", telefono: "", email: "", web: "",
};
const deDatos = (d: DatosEmpresa): FormEmpresa =>
  Object.fromEntries(CAMPOS_EMPRESA.map((k) => [k, (d[k] as string | null) ?? ""])) as FormEmpresa;

const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function DatosEmpresaPage() {
  const [datos, setDatos] = useState<DatosEmpresa | null>(null);
  const [f, setF] = useState<FormEmpresa>(vacio);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [okGuardar, setOkGuardar] = useState<string | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  // Logo (se guarda solo, aparte del formulario)
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [quitandoLogo, setQuitandoLogo] = useState(false);
  const [cambiandoFondo, setCambiandoFondo] = useState(false);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [okLogo, setOkLogo] = useState<string | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    apiFetch<DatosEmpresa>(URL)
      .then((d) => {
        setDatos(d);
        setF(deDatos(d));
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);
  useEffect(cargar, [cargar]);

  const original = useMemo(() => (datos ? deDatos(datos) : vacio), [datos]);
  const sucio = CAMPOS_EMPRESA.some((k) => f[k].trim() !== original[k].trim());
  const soloLectura = datos ? datos.puede_editar === false : false;

  // Aviso del navegador si se va con cambios sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  const set = <K extends keyof FormEmpresa>(k: K, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setOkGuardar(null);
    setErrorGuardar(null);
  };

  const ruc = validarRuc(f.ruc);
  const emailMal = f.email.trim() !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(f.email.trim());
  const telMal = f.telefono.trim() !== "" && !/^[0-9 +()/-]{6,40}$/.test(f.telefono.trim());
  const faltaRazon = f.razon_social.trim().length < 2;
  const bloqueo = faltaRazon ? "Escribí la razón social." : ruc.estado === "incompleto" || ruc.estado === "dv" ? `RUC: ${ruc.mensaje}.` : emailMal ? "Revisá el email." : telMal ? "Revisá el teléfono." : null;

  const guardar = async () => {
    if (bloqueo || !sucio || guardando) return;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const d = await apiFetch<DatosEmpresa>(URL, {
        method: "PUT",
        body: JSON.stringify({ ...f, ruc: f.ruc ? normalizarRuc(f.ruc) : "" }),
      });
      setDatos(d);
      setF(deDatos(d));
      setOkGuardar("Datos guardados: los documentos nuevos ya salen así.");
      invalidar("/api/me");
    } catch (e) {
      setErrorGuardar((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  // El logo se guarda al elegirlo: no toca lo que esté escrito sin guardar en el formulario.
  const logoSrc = datos?.logo_url || LOGO_INSTALACION;
  const subirLogo = async (file: File) => {
    setErrorLogo(null);
    setOkLogo(null);
    if (!(LOGO_TIPOS as readonly string[]).includes(file.type)) { setErrorLogo("Formato no aceptado: subí un PNG, JPG o WEBP."); return; }
    if (file.size > LOGO_MAX_MB * 1024 * 1024) { setErrorLogo(`El logo no puede superar ${LOGO_MAX_MB} MB.`); return; }
    setSubiendoLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const d = await apiForm<DatosEmpresa>(`${URL}/logo`, fd);
      setDatos(d);
      setOkLogo(
        d.logo_fondo === "quitado" && d.logo_sin_fondo ? "Le quitamos el fondo automáticamente. Los PDF nuevos ya salen con este logo."
        : d.logo_fondo === "quitado" ? "Tu logo es claro: lo dejamos con su fondo para que se vea en los documentos (salen en hoja blanca). Si igual lo querés sin fondo, tocá «Quitar fondo»."
        : d.logo_fondo === "no_detectado" ? "No detectamos un fondo liso: se guardó tal cual."
        : d.logo_fondo === "transparente" ? "Tu logo ya venía sin fondo: se guardó tal cual."
        : "Logo actualizado: los PDF nuevos ya salen con él.",
      );
    } catch (e) {
      setErrorLogo((e as Error).message);
    } finally {
      setSubiendoLogo(false);
    }
  };
  // Alterna entre la imagen original (con fondo) y la versión sin fondo.
  const alternarFondo = async (sinFondo: boolean) => {
    setErrorLogo(null);
    setOkLogo(null);
    setCambiandoFondo(true);
    try {
      const d = await apiFetch<DatosEmpresa>(`${URL}/logo`, { method: "PATCH", body: JSON.stringify({ sin_fondo: sinFondo }) });
      setDatos(d);
      setOkLogo(sinFondo ? "Listo: le quitamos el fondo." : "Listo: se usa la imagen original, con su fondo.");
    } catch (e) {
      setErrorLogo((e as Error).message);
    } finally {
      setCambiandoFondo(false);
    }
  };
  const quitarLogo = async () => {
    setConfirmarQuitar(false);
    setErrorLogo(null);
    setOkLogo(null);
    setQuitandoLogo(true);
    try {
      const d = await apiFetch<DatosEmpresa>(`${URL}/logo`, { method: "DELETE" });
      setDatos(d);
      setOkLogo("Listo: los documentos vuelven a usar el logo por defecto.");
    } catch (e) {
      setErrorLogo((e as Error).message);
    } finally {
      setQuitandoLogo(false);
    }
  };

  if (cargando && !datos) {
    return (
      <div className="space-y-5 pb-10">
        <EncabezadoPagina kicker="Configuración" titulo="Datos de la empresa" />
        <div className="space-y-4">
          {[0, 1].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      </div>
    );
  }

  if (error && !datos) {
    return (
      <div className="space-y-5 pb-10">
        <EncabezadoPagina kicker="Configuración" titulo="Datos de la empresa" />
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={cargar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Reintentar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        volver={{ href: "/configuracion", label: "Configuración" }}
        kicker="Configuración"
        titulo="Datos de la empresa"
        subtitulo="Así te identificás en presupuestos, recibos, remisiones, órdenes y reportes."
      />

      {soloLectura ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> Podés ver estos datos, pero cambiarlos es solo para el Administrador.
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="min-w-0 space-y-4">
          {/* ── Identificación fiscal ─────────────────────────────────────── */}
          <Tarjeta icono={<BadgeCheck className="h-4 w-4" />} titulo="Identificación fiscal" detalle="Como figura en tu constancia de RUC de la SET.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Razón social" requerido className="sm:col-span-2" ayuda={faltaRazon && sucio ? <span className="text-rose-600">Es obligatoria.</span> : "El nombre legal de la empresa."}>
                <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} maxLength={160} placeholder="Ej. Comercial Demo S.A." disabled={soloLectura} className={INPUT} autoComplete="organization" />
              </Campo>
              <Campo etiqueta="Nombre de fantasía" opcional ayuda="Con el que te conocen los clientes. Va grande en los documentos.">
                <input value={f.nombre_fantasia} onChange={(e) => set("nombre_fantasia", e.target.value)} maxLength={120} placeholder="Ej. Empresa Demo" disabled={soloLectura} className={INPUT} />
              </Campo>
              <Campo
                etiqueta="RUC"
                opcional
                ayuda={
                  ruc.estado === "ok" ? <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> Dígito verificador correcto</span>
                  : ruc.estado === "vacio" ? "Con guion y dígito verificador, ej. 80012345-0."
                  : (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-rose-600">
                      <span>{ruc.mensaje}</span>
                      {ruc.dvSugerido !== null && !soloLectura ? (
                        <button type="button" onClick={() => set("ruc", `${normalizarRuc(f.ruc).split("-")[0]}-${ruc.dvSugerido}`)}
                          className="inline-flex min-h-7 items-center rounded-md bg-rose-50 px-2 font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 max-sm:min-h-9">
                          Corregir
                        </button>
                      ) : null}
                    </span>
                  )
                }
              >
                <input
                  value={f.ruc}
                  onChange={(e) => set("ruc", e.target.value.replace(/[^\d.\s-]/g, ""))}
                  onBlur={() => f.ruc && set("ruc", normalizarRuc(f.ruc))}
                  inputMode="numeric"
                  maxLength={14}
                  placeholder="80012345-0"
                  disabled={soloLectura}
                  aria-invalid={ruc.estado === "incompleto" || ruc.estado === "dv"}
                  className={`${INPUT} font-mono tabular-nums ${ruc.estado === "dv" || ruc.estado === "incompleto" ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ruc.estado === "ok" ? "border-emerald-300" : ""}`}
                />
              </Campo>
              <Campo etiqueta="Actividad económica" opcional className="sm:col-span-2" ayuda="La principal, como figura en el RUC.">
                <textarea value={f.actividad_economica} onChange={(e) => set("actividad_economica", e.target.value)} maxLength={200} rows={2}
                  placeholder="Ej. Comercio al por menor de productos alimenticios y bebidas" disabled={soloLectura} className={`${INPUT} resize-none`} />
              </Campo>
            </div>
          </Tarjeta>

          {/* ── Contacto ──────────────────────────────────────────────────── */}
          <Tarjeta icono={<MapPin className="h-4 w-4" />} titulo="Dirección y contacto" detalle="Casa matriz. Las sucursales usan sus propios datos cuando atienden ellas.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Dirección" opcional className="sm:col-span-2">
                <input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} maxLength={200} placeholder="Ej. Av. Mcal. López 1234 c/ Washington" disabled={soloLectura} className={INPUT} autoComplete="street-address" />
              </Campo>
              <Campo etiqueta="Ciudad" opcional>
                <input value={f.ciudad} onChange={(e) => set("ciudad", e.target.value)} maxLength={80} placeholder="Ej. Asunción" disabled={soloLectura} className={INPUT} autoComplete="address-level2" />
              </Campo>
              <Campo etiqueta="Departamento" opcional sinLabel>
                <Select value={f.departamento} onChange={(v) => set("departamento", v)} block etiqueta="Departamento" disabled={soloLectura}
                  options={[["", "Sin elegir"], ...DEPARTAMENTOS_PY.map((d): [string, string] => [d, d])]} />
              </Campo>
              <Campo etiqueta="Teléfono" opcional ayuda={telMal ? <span className="text-rose-600">Solo números, espacios y + ( ) - /</span> : undefined}>
                <input type="tel" inputMode="tel" value={f.telefono} onChange={(e) => set("telefono", e.target.value)} maxLength={40} placeholder="021 600 000" disabled={soloLectura}
                  aria-invalid={telMal} className={`${INPUT} ${telMal ? "border-rose-300" : ""}`} autoComplete="tel" />
              </Campo>
              <Campo etiqueta="Email" opcional ayuda={emailMal ? <span className="text-rose-600">Revisá el email.</span> : undefined}>
                <input type="email" inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={160} placeholder="ventas@tuempresa.com.py" disabled={soloLectura}
                  aria-invalid={emailMal} className={`${INPUT} ${emailMal ? "border-rose-300" : ""}`} autoComplete="email" />
              </Campo>
              <Campo etiqueta="Sitio web" opcional className="sm:col-span-2" ayuda="Sin https://, ej. www.tuempresa.com.py">
                <input inputMode="url" value={f.web} onChange={(e) => set("web", e.target.value)} maxLength={160} placeholder="www.tuempresa.com.py" disabled={soloLectura} className={INPUT} autoComplete="url" />
              </Campo>
            </div>
          </Tarjeta>

          {/* ── Logo ──────────────────────────────────────────────────────── */}
          <TarjetaLogo
            datos={datos}
            src={logoSrc}
            soloLectura={soloLectura}
            subiendo={subiendoLogo}
            quitando={quitandoLogo}
            cambiandoFondo={cambiandoFondo}
            error={errorLogo}
            exito={okLogo}
            onElegir={subirLogo}
            onFondo={alternarFondo}
            onQuitar={() => setConfirmarQuitar(true)}
          />
          {datos?.updated_at ? (
            <p className="px-1 text-xs text-slate-400">
              Última actualización: {fechaHora(datos.updated_at)}{datos.updated_by_nombre ? ` · ${datos.updated_by_nombre}` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Barra fija de guardar ─────────────────────────────────────────── */}
      <div className={`sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border bg-white/95 px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgba(2,48,71,0.18)] backdrop-blur transition-colors sm:gap-3 sm:px-4 sm:py-3 max-sm:[&>button]:min-h-11 max-sm:[&>button]:flex-1 ${sucio ? "border-[var(--brand-100)]" : "border-slate-200"}`}>
        <div className="min-w-0 flex-1 text-xs max-sm:basis-full" aria-live="polite">
          {errorGuardar ? <span className="flex items-start gap-1.5 text-rose-700"><AlertTriangle className="mt-px h-4 w-4 shrink-0" /> {errorGuardar}</span>
            : okGuardar && !sucio ? <span className="flex items-center gap-1.5 text-emerald-700"><Sparkles className="h-4 w-4 shrink-0" /> {okGuardar}</span>
            : sucio && bloqueo ? <span className="flex items-center gap-1.5 text-amber-700"><AlertTriangle className="h-4 w-4 shrink-0" /> {bloqueo}</span>
            : sucio ? <span className="flex items-center gap-1.5 text-slate-600"><Info className="h-4 w-4 shrink-0 text-[var(--brand)]" /> Tenés cambios sin guardar.</span>
            : <span className="text-slate-400">{soloLectura ? "Solo lectura." : "Sin cambios."}</span>}
        </div>
        {!soloLectura && sucio ? (
          <button type="button" onClick={() => setConfirmarDescarte(true)} disabled={guardando} className={BOTON_SECUNDARIO}>Descartar</button>
        ) : null}
        {!soloLectura ? (
          <button type="button" onClick={guardar} disabled={guardando || !sucio || !!bloqueo} className={BOTON_PRIMARIO} style={{ backgroundColor: TEAL }}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar cambios
          </button>
        ) : null}
      </div>

      {confirmarQuitar ? (
        <CapaModal onClose={() => setConfirmarQuitar(false)} z="z-[120]">
          <div role="alertdialog" aria-modal="true" className={`w-full max-w-sm ${ALTO_MAX_MODAL} overflow-hidden rounded-2xl bg-white p-5 shadow-2xl`}>
            <p className="text-base font-semibold text-slate-900">¿Quitar el logo propio?</p>
            <p className="mt-1 text-sm text-slate-500">Los documentos vuelven a salir con el logo por defecto de la instalación. Podés volver a subir uno cuando quieras.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmarQuitar(false)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>Cancelar</button>
              <button type="button" onClick={quitarLogo}
                className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98] max-sm:min-h-11">
                Quitar logo
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {confirmarDescarte ? (
        <CapaModal onClose={() => setConfirmarDescarte(false)} z="z-[120]">
          <div role="alertdialog" aria-modal="true" className={`w-full max-w-sm ${ALTO_MAX_MODAL} overflow-hidden rounded-2xl bg-white p-5 shadow-2xl`}>
            <p className="text-base font-semibold text-slate-900">¿Descartar los cambios?</p>
            <p className="mt-1 text-sm text-slate-500">Vuelven los datos guardados de la empresa.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setConfirmarDescarte(false)} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>Seguir editando</button>
              <button type="button" onClick={() => { setF(original); setConfirmarDescarte(false); setErrorGuardar(null); }}
                className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98] max-sm:min-h-11">
                Descartar
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </div>
  );
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function Tarjeta({ icono, titulo, detalle, children }: { icono: ReactNode; titulo: string; detalle?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]">{icono}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
          {detalle ? <p className="mt-0.5 text-xs text-slate-500">{detalle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function Campo({ etiqueta, requerido, opcional, ayuda, sinLabel = false, className = "", children }: {
  etiqueta: string; requerido?: boolean; opcional?: boolean; ayuda?: ReactNode; className?: string; children: ReactNode;
  /** el control no es un input (ej. Select: un botón con su lista en un portal) */
  sinLabel?: boolean;
}) {
  const Raiz = sinLabel ? "div" : "label";
  return (
    <Raiz className={`block min-w-0 ${className}`}>
      <span className={ET}>
        {etiqueta}
        {requerido ? <span className="text-rose-500"> *</span> : null}
        {opcional ? <span className="font-normal text-slate-400"> (opcional)</span> : null}
      </span>
      {children}
      {ayuda ? <span className="mt-1 block text-[11px] leading-snug text-slate-400">{ayuda}</span> : null}
    </Raiz>
  );
}

/** El logo de los documentos (el propio o el de la instalación); si no carga, un ícono. Usar con key={src}. */
function Logo({ src, className }: { src: string; className?: string }) {
  const [falla, setFalla] = useState(false);
  if (falla) return <Building2 className="h-8 w-8 text-slate-300" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Logo de los documentos" className={className} onError={() => setFalla(true)} />;
}

/** Tarjeta "Logo de los documentos": el logo sobre blanco (como en el PDF), cambiar / quitar fondo / quitar. */
function TarjetaLogo({ datos, src, soloLectura, subiendo, quitando, cambiandoFondo, error, exito, onElegir, onQuitar, onFondo }: {
  datos: DatosEmpresa | null; src: string; soloLectura: boolean;
  subiendo: boolean; quitando: boolean; cambiandoFondo: boolean; error: string | null; exito: string | null;
  onElegir: (f: File) => void; onQuitar: () => void; onFondo: (sinFondo: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const propio = !!datos?.logo_url;
  const ocupado = subiendo || quitando || cambiandoFondo;
  const sinFondo = propio && !!datos?.logo_sin_fondo;
  // Alternar con / sin fondo: solo si se guardó el original y se detectó un fondo liso.
  const alternable = propio && !!datos?.logo_original_path && datos?.logo_fondo === "quitado";
  const estadoFondo = !propio ? null
    : sinFondo ? "Sin fondo (se lo quitamos)"
    : datos?.logo_fondo === "quitado" ? "Con su fondo original"
    : datos?.logo_fondo === "no_detectado" ? "Con fondo: no detectamos un fondo liso para quitar"
    : datos?.logo_fondo === "transparente" ? "Ya venía sin fondo"
    : null;
  return (
    <Tarjeta icono={<ImageIcon className="h-4 w-4" />} titulo="Logo de los documentos" detalle="Sale arriba a la izquierda en todos los PDF: presupuestos, recibos, remisiones, órdenes, cierres de caja y reportes.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Sobre blanco, como sale en la hoja del PDF */}
        <div className="relative w-full shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white sm:w-52">
          <div className="flex h-28 items-center justify-center p-4">
            <Logo key={src} src={src} className="max-h-20 w-auto max-w-full object-contain" />
          </div>
          {ocupado ? (
            <span className="absolute inset-0 grid place-items-center bg-white/70" aria-live="polite">
              <span className="flex flex-col items-center gap-1 text-xs font-medium text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--brand)]" />
                {subiendo ? "Quitando el fondo…" : cambiandoFondo ? "Procesando…" : null}
              </span>
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-sm text-slate-700">
            {propio ? (
              <>
                <span className="font-semibold text-emerald-700">Logo propio</span>
                {datos?.logo_ancho && datos?.logo_alto ? <span className="text-slate-500"> · {datos.logo_ancho} × {datos.logo_alto} px</span> : null}
                {estadoFondo ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    {sinFondo ? <Eraser className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />} {estadoFondo}
                  </span>
                ) : null}
                {datos?.logo_actualizado ? <span className="block text-xs text-slate-400">Cargado el {fechaHora(datos.logo_actualizado)}</span> : null}
              </>
            ) : (
              <span className="font-semibold text-slate-700">Logo por defecto de la instalación</span>
            )}
          </p>
          {!soloLectura ? (
            <>
              <input
                ref={ref}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onElegir(f);
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" onClick={() => ref.current?.click()} disabled={ocupado} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                  {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {subiendo ? "Subiendo…" : "Cambiar logo"}
                </button>
                {alternable ? (
                  <button type="button" onClick={() => onFondo(!sinFondo)} disabled={ocupado} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                    {cambiandoFondo ? <Loader2 className="h-4 w-4 animate-spin" /> : sinFondo ? <Undo2 className="h-4 w-4" /> : <Eraser className="h-4 w-4" />}
                    {sinFondo ? "Usar la imagen original (con fondo)" : "Quitar fondo"}
                  </button>
                ) : null}
                {propio ? (
                  <button type="button" onClick={onQuitar} disabled={ocupado}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-50 max-sm:min-h-11">
                    {quitando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} {quitando ? "Quitando…" : "Quitar logo"}
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] leading-snug text-slate-400">
                PNG, JPG o WEBP, hasta {LOGO_MAX_MB} MB, mejor horizontal. Se guarda al elegirlo: si tiene un fondo liso (blanco o de un color) se lo quitamos solos, y se achica para que los PDF no pesen.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">Cambiar el logo es solo para el Administrador.</p>
          )}
          {error ? <p className="flex items-start gap-1.5 text-xs text-rose-700" role="alert"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}</p> : null}
          {exito && !error ? <p className="flex items-start gap-1.5 text-xs text-emerald-700" aria-live="polite"><Sparkles className="mt-px h-3.5 w-3.5 shrink-0" /> {exito}</p> : null}
        </div>
      </div>
    </Tarjeta>
  );
}
