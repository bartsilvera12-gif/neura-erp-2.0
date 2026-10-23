"use client";

/**
 * /configuracion/facturacion-electronica — Facturación electrónica (SIFEN). Portada de
 * sistemas-propio con los componentes del 2.0. Nivel ADMIN + "Configuración del sistema".
 *   · Config completa (datos + activo + .p12 + contraseña) → tarjeta "Configuración SIFEN lista
 *     para operar" con el resumen y "Editar configuración". Si no, el formulario directo.
 *   · Formulario: Estado · Datos del emisor (RUC, razón social, dirección fiscal y actividad se
 *     PRECARGAN de Datos de la empresa) · Certificado digital (.p12) · Personalización KuDE.
 *   · Secretos (contraseña del .p12 y CSC): se escriben y nunca se vuelven a mostrar; el servidor
 *     los cifra y la base no los deja leer. Del certificado solo se ve nombre, titular y vencimiento.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, CheckCircle2, FileKey2, ImageIcon, KeyRound, Loader2, Palette, ShieldCheck, Store,
} from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";
import { invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { ColorPicker } from "@/components/ColorPicker";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, INPUT } from "@/modules/inventario/ui";
import { LOGO_INSTALACION, normalizarRuc, validarRuc } from "@/modules/empresa/tipos";
import { Aviso, Campo, Chip, Interruptor, Tarjeta, fechaCorta, fechaHora } from "@/modules/facturacion/ui";
import { sifenCompleta, type AmbienteSifen, type SifenLectura } from "@/modules/facturacion/tipos";

const URL = "/api/configuracion/sifen";
const TEAL = clienteConfig.color;
type Lectura = SifenLectura & { clave_servidor?: boolean; aviso?: string | null };

type Form = {
  ambiente: AmbienteSifen; activo: boolean; plazo_cancelacion_horas: string;
  ruc: string; razon_social: string; direccion_fiscal: string;
  timbrado_numero: string; timbrado_fecha_inicio_vigencia: string;
  actividad_economica_codigo: string; actividad_economica_descripcion: string;
  establecimiento: string; punto_expedicion: string; csc_id: string;
  certificado_vencimiento: string;
};

/** Del guardado, o (sin configuración) precargado de Datos de la empresa. */
function formDesde(d: SifenLectura): Form {
  const c = d.config;
  const e = d.empresa;
  return {
    ambiente: c?.ambiente ?? "test",
    activo: c?.activo ?? true,
    plazo_cancelacion_horas: String(c?.plazo_cancelacion_horas ?? 48),
    ruc: c?.ruc ?? e.ruc ?? "",
    razon_social: c?.razon_social ?? e.razon_social ?? "",
    direccion_fiscal: c ? c.direccion_fiscal ?? "" : [e.direccion, e.ciudad].filter(Boolean).join(", "),
    timbrado_numero: c?.timbrado_numero ?? "",
    timbrado_fecha_inicio_vigencia: c?.timbrado_fecha_inicio_vigencia?.slice(0, 10) ?? "",
    actividad_economica_codigo: c?.actividad_economica_codigo ?? "",
    actividad_economica_descripcion: c ? c.actividad_economica_descripcion ?? "" : e.actividad_economica ?? "",
    establecimiento: c?.establecimiento ?? "001",
    punto_expedicion: c?.punto_expedicion ?? "001",
    csc_id: c?.csc_id ?? "",
    certificado_vencimiento: c?.certificado_vencimiento?.slice(0, 10) ?? "",
  };
}

const isHex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());

export default function FacturacionElectronicaPage() {
  const [d, setD] = useState<Lectura | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [editar, setEditar] = useState(false);

  // Secretos: se escriben, nunca se leen.
  const [password, setPassword] = useState("");
  const [limpiarPassword, setLimpiarPassword] = useState(false);
  const [csc, setCsc] = useState("");
  const [limpiarCsc, setLimpiarCsc] = useState(false);

  // Certificado
  const certRef = useRef<HTMLInputElement>(null);
  const [subiendoCert, setSubiendoCert] = useState(false);
  const [nombreCert, setNombreCert] = useState<string | null>(null);

  // KuDE
  const logoRef = useRef<HTMLInputElement>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [quitandoLogo, setQuitandoLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // Sin logo propio del KuDE se usa el de la empresa (Datos de la empresa) o el de la instalación.
  const [logoEmpresa, setLogoEmpresa] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ logo_url?: string | null }>("/api/configuracion/empresa")
      .then((e) => setLogoEmpresa(e.logo_url || LOGO_INSTALACION))
      .catch(() => setLogoEmpresa(LOGO_INSTALACION));
  }, []);
  const [color, setColor] = useState("");
  const [colorFill, setColorFill] = useState("");
  const [derivarFill, setDerivarFill] = useState(true);
  const [guardandoColores, setGuardandoColores] = useState(false);

  const aplicar = useCallback((x: Lectura, reiniciarForm = true) => {
    setD(x);
    if (reiniciarForm) setF(formDesde(x));
    setColor(x.config?.kude_color_primario ?? "");
    setColorFill(x.config?.kude_color_primario_fill ?? "");
    setDerivarFill(!x.config?.kude_color_primario_fill);
  }, []);

  const cargar = useCallback(() => {
    setCargando(true);
    apiFetch<Lectura>(URL)
      .then((x) => { aplicar(x); setErrorCarga(null); })
      .catch((e: Error) => setErrorCarga(e.message))
      .finally(() => setCargando(false));
  }, [aplicar]);
  useEffect(cargar, [cargar]);

  // Vista previa del logo del KuDE (la ruta exige el token: se baja como blob).
  const logoCargado = !!d?.secretos.kude_logo;
  const logoVersion = d?.config?.kude_logo_subido_at ?? "";
  useEffect(() => {
    if (!logoCargado) { setLogoUrl(null); return; }
    let url: string | null = null;
    let vivo = true;
    (async () => {
      const { data } = await browserClient().auth.getSession();
      const t = data.session?.access_token;
      const r = await fetch(`${URL}/kude-logo`, { headers: t ? { Authorization: `Bearer ${t}` } : {} }).catch(() => null);
      if (!r?.ok || !vivo) return;
      url = window.URL.createObjectURL(await r.blob());
      setLogoUrl(url);
    })();
    return () => { vivo = false; if (url) window.URL.revokeObjectURL(url); };
  }, [logoCargado, logoVersion]);

  const completa = d ? sifenCompleta(d) : false;
  const mostrarFormulario = !d?.config || !completa || editar;
  const soloLectura = d ? !d.puede_editar : true;
  const cfg = d?.config ?? null;

  const ruc = validarRuc(f?.ruc ?? "");
  const datosMinimosOk = !!f && [f.ruc, f.razon_social, f.direccion_fiscal, f.timbrado_numero, f.timbrado_fecha_inicio_vigencia,
    f.actividad_economica_codigo, f.actividad_economica_descripcion, f.establecimiento, f.punto_expedicion].every((v) => v.trim() !== "");
  const tieneCert = !!d?.secretos.certificado;
  const tienePw = !!d?.secretos.password;

  // ¿Los datos del emisor difieren de Datos de la empresa? (para ofrecer copiarlos)
  const difiereEmpresa = useMemo(() => {
    if (!d || !f) return false;
    const e = d.empresa;
    return (!!e.ruc && e.ruc !== f.ruc) || (!!e.razon_social && e.razon_social !== f.razon_social);
  }, [d, f]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((x) => (x ? { ...x, [k]: v } : x)); setExito(null); setError(null); };

  function validar(): string | null {
    if (!f) return "Cargando…";
    if (!f.ruc.trim()) return "Escribí el RUC del emisor.";
    if (ruc.estado === "incompleto" || ruc.estado === "dv") return `RUC: ${ruc.mensaje}.`;
    if (!f.razon_social.trim()) return "Escribí la razón social.";
    if (!f.direccion_fiscal.trim()) return "Escribí la dirección fiscal (va al XML como dDirEmi).";
    if (!f.timbrado_numero.trim()) return "Escribí el número de timbrado.";
    if (!f.timbrado_fecha_inicio_vigencia) return "Elegí el inicio de vigencia del timbrado.";
    if (!/^\d{4,8}$/.test(f.actividad_economica_codigo)) return "El código de actividad económica tiene de 4 a 8 números.";
    if (!f.actividad_economica_descripcion.trim()) return "Escribí la descripción de la actividad económica.";
    if (!f.establecimiento.trim() || !f.punto_expedicion.trim()) return "Completá establecimiento y punto de expedición.";
    if (tieneCert && !f.certificado_vencimiento) return "Indicá la fecha de vencimiento del certificado .p12 cargado.";
    const h = Number(f.plazo_cancelacion_horas);
    if (!Number.isInteger(h) || h < 1 || h > 8760) return "El plazo de cancelación va de 1 a 8760 horas.";
    return null;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f || soloLectura || guardando) return;
    const problema = validar();
    if (problema) { setError(problema); return; }
    setGuardando(true); setError(null); setExito(null);
    try {
      const body: Record<string, unknown> = {
        ambiente: f.ambiente, activo: f.activo, plazo_cancelacion_horas: Number(f.plazo_cancelacion_horas),
        ruc: normalizarRuc(f.ruc), razon_social: f.razon_social, direccion_fiscal: f.direccion_fiscal || null,
        timbrado_numero: f.timbrado_numero, timbrado_fecha_inicio_vigencia: f.timbrado_fecha_inicio_vigencia,
        actividad_economica_codigo: f.actividad_economica_codigo, actividad_economica_descripcion: f.actividad_economica_descripcion,
        establecimiento: f.establecimiento, punto_expedicion: f.punto_expedicion, csc_id: f.csc_id || null,
        certificado_vencimiento: f.certificado_vencimiento || null,
      };
      if (limpiarPassword) body.limpiar_password = true;
      else if (password.trim()) body.certificado_password = password;
      if (limpiarCsc) body.limpiar_csc = true;
      else if (csc.trim()) body.csc = csc.trim();
      const x = await apiFetch<Lectura>(URL, { method: "PUT", body: JSON.stringify(body) });
      const creada = !cfg;
      aplicar(x);
      setPassword(""); setLimpiarPassword(false); setCsc(""); setLimpiarCsc(false);
      setExito(creada ? "Configuración SIFEN creada correctamente." : "Cambios guardados.");
      if (sifenCompleta(x)) setEditar(false);
      invalidar("/api/configuracion/facturacion");
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function subirCertificado(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file || soloLectura) return;
    setNombreCert(file.name);
    setError(null); setExito(null); setSubiendoCert(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (password.trim() && !limpiarPassword) fd.append("password", password);
      const x = await apiForm<Lectura & { certificado?: { titular: string; vencimiento: string } | null }>(`${URL}/certificado`, fd);
      aplicar(x, false);
      if (x.config?.certificado_vencimiento) set("certificado_vencimiento", x.config.certificado_vencimiento.slice(0, 10));
      if (x.certificado && password.trim()) setPassword("");
      setNombreCert(null);
      setExito(x.aviso ?? "Certificado .p12 cargado correctamente.");
      if (sifenCompleta(x)) setEditar(false);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setSubiendoCert(false);
    }
  }

  async function subirLogo(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file || soloLectura) return;
    if (file.type && file.type !== "image/png") { setError("Solo se acepta logo en formato PNG."); return; }
    if (file.size > 1024 * 1024) { setError("El logo supera el máximo permitido (1 MB)."); return; }
    setError(null); setExito(null); setSubiendoLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      aplicar(await apiForm<Lectura>(`${URL}/kude-logo`, fd), false);
      setExito("Logo KuDE actualizado. Solo afecta al PDF/KuDE.");
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setSubiendoLogo(false);
    }
  }

  async function restaurarLogo() {
    setError(null); setExito(null); setQuitandoLogo(true);
    try {
      aplicar(await apiFetch<Lectura>(`${URL}/kude-logo`, { method: "DELETE" }), false);
      setExito("Logo propio del KuDE eliminado. Se usará el logo de la empresa.");
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setQuitandoLogo(false);
    }
  }

  async function guardarColores() {
    setError(null); setExito(null);
    if (color.trim() && !isHex(color)) { setError("Color primario inválido. Formato esperado: #RRGGBB (ej. #0ea5e9)."); return; }
    if (!derivarFill && colorFill.trim() && !isHex(colorFill)) { setError("Color de acento inválido. Formato esperado: #RRGGBB."); return; }
    setGuardandoColores(true);
    try {
      const x = await apiFetch<Lectura>(URL, {
        method: "PUT",
        body: JSON.stringify({ kude_color_primario: color.trim() || null, kude_color_primario_fill: derivarFill ? null : colorFill.trim() || null }),
      });
      aplicar(x, false);
      setExito("Personalización KuDE guardada. Solo afecta al PDF/KuDE.");
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setGuardandoColores(false);
    }
  }

  function cancelarEdicion() {
    if (d) aplicar(d);
    setPassword(""); setLimpiarPassword(false); setCsc(""); setLimpiarCsc(false);
    setError(null); setExito(null); setEditar(false);
  }

  function usarDatosEmpresa() {
    if (!d) return;
    const e = d.empresa;
    setF((x) => x ? {
      ...x,
      ruc: e.ruc ?? x.ruc,
      razon_social: e.razon_social ?? x.razon_social,
      direccion_fiscal: [e.direccion, e.ciudad].filter(Boolean).join(", ") || x.direccion_fiscal,
      actividad_economica_descripcion: e.actividad_economica ?? x.actividad_economica_descripcion,
    } : x);
  }

  const encabezado = (
    <EncabezadoPagina
      volver={{ href: "/configuracion/facturacion", label: "Tickets y facturación" }}
      kicker="Configuración"
      titulo="Facturación electrónica (SIFEN)"
      subtitulo="Datos del emisor y certificado digital. Las empresas sin SIFEN siguen usando facturas normales."
    />
  );

  if (cargando && !d) {
    return (
      <div className="space-y-5 pb-10">
        {encabezado}
        {[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
      </div>
    );
  }
  if (errorCarga && !d) {
    return (
      <div className="space-y-5 pb-10">
        {encabezado}
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">{errorCarga}</span>
          <button type="button" onClick={cargar} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!d || !f) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-6">
      {encabezado}

      {error ? <Aviso tono="error">{error}</Aviso> : null}
      {exito ? <Aviso tono="ok">{exito}</Aviso> : null}
      {soloLectura ? <Aviso tono="alerta">Podés ver esta configuración, pero cambiarla es solo para el Administrador.</Aviso> : null}
      {d.clave_servidor === false && !soloLectura ? (
        <Aviso tono="alerta">
          El servidor todavía no tiene la clave de cifrado (<span className="font-mono">SIFEN_SECRETS_KEY</span>): podés guardar los datos y subir el .p12, pero no la contraseña del certificado ni el CSC.
        </Aviso>
      ) : null}

      {/* ── Lista para operar ──────────────────────────────────────────── */}
      {completa && !mostrarFormulario && cfg ? (
        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/90 to-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-emerald-950 sm:text-lg">Configuración SIFEN lista para operar</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-emerald-900/80">
                Ya completaste los datos del emisor, el certificado y la contraseña. Podés generar documentos electrónicos en el flujo de facturas cuando corresponda.
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-emerald-100 pt-4 text-sm sm:grid-cols-2">
            <Fila k="Ambiente" v={cfg.ambiente === "produccion" ? "Producción" : "Test"} />
            <Fila k="RUC" v={<span className="font-mono">{cfg.ruc}</span>} />
            <Fila k="Razón social" v={cfg.razon_social} />
            <Fila k="Dirección fiscal (SIFEN)" v={cfg.direccion_fiscal ?? "—"} />
            <Fila k="Timbrado" v={<span className="font-mono">{cfg.timbrado_numero} · {cfg.establecimiento}-{cfg.punto_expedicion}</span>} />
            <Fila k="Inicio vigencia timbrado (dFeIniT)" v={<span className="font-mono">{fechaCorta(cfg.timbrado_fecha_inicio_vigencia)}</span>} />
            <Fila k="Actividad económica (cActEco)" ancho v={<><span className="font-mono">{cfg.actividad_economica_codigo ?? "—"}</span>{cfg.actividad_economica_descripcion ? <span className="mt-0.5 block font-normal text-slate-600">{cfg.actividad_economica_descripcion}</span> : null}</>} />
            <Fila k="Certificado .p12" v={<span className="text-emerald-800">Cargado{cfg.certificado_vencimiento ? ` · vence ${fechaCorta(cfg.certificado_vencimiento)}` : ""}</span>} />
            <Fila k="Contraseña del certificado" v={<span className="text-emerald-800">Configurada</span>} />
            <Fila k="CSC" v={d.secretos.csc ? <span className="text-emerald-800">Configurado{cfg.csc_id ? ` · ID ${cfg.csc_id}` : ""}</span> : "No cargado"} />
            <Fila k="SIFEN" v={<span className="font-semibold text-emerald-800">Activo</span>} />
          </dl>
          {!soloLectura ? (
            <button type="button" onClick={() => { setEditar(true); setExito(null); }} className={`${BOTON_SECUNDARIO} mt-4 max-sm:min-h-11 max-sm:w-full`}>
              Editar configuración
            </button>
          ) : null}
        </section>
      ) : null}

      {mostrarFormulario ? (
        <form onSubmit={guardar} className="space-y-5">
          {/* ── Estado ─────────────────────────────────────────────────── */}
          <Tarjeta icono={<ShieldCheck className="h-4 w-4" />} titulo="Estado">
            <div className="flex flex-wrap gap-2">
              <Chip tono={datosMinimosOk ? "ok" : "alerta"}>{datosMinimosOk ? "Datos obligatorios completos" : "Configuración incompleta"}</Chip>
              <Chip tono={datosMinimosOk && f.activo ? "marca" : "neutro"}>
                {datosMinimosOk && f.activo ? "Lista para operar (activo)" : f.activo ? "Revisá campos obligatorios" : "Inactivo — no se generan DE"}
              </Chip>
              <Chip tono={tieneCert ? "marca" : "neutro"}>Certificado: {tieneCert ? "Cargado" : "No cargado"}</Chip>
              <Chip tono={tienePw ? "violeta" : "neutro"}>Contraseña .p12: {tienePw ? "Configurada" : "No configurada"}</Chip>
              <Chip tono={d.secretos.csc ? "violeta" : "neutro"}>CSC: {d.secretos.csc ? "Configurado" : "No cargado"}</Chip>
            </div>
            {cfg?.updated_at ? <p className="mt-3 text-[11px] text-slate-400">Última actualización: {fechaHora(cfg.updated_at)}{cfg.updated_by_nombre ? ` · ${cfg.updated_by_nombre}` : ""}</p> : null}
          </Tarjeta>

          {/* ── Datos del emisor ───────────────────────────────────────── */}
          <Tarjeta
            icono={<Store className="h-4 w-4" />}
            titulo="Datos del emisor"
            detalle={
              <>
                {!cfg ? "RUC, razón social, dirección y actividad vienen precargados de " : "RUC, razón social, dirección y actividad se toman de "}
                <Link href="/configuracion/empresa" className="inline-flex items-center gap-0.5 font-semibold text-[var(--brand)] hover:underline">Datos de la empresa <ArrowUpRight className="h-3 w-3" /></Link>
                {cfg ? " al crear; acá quedan los que van al XML." : ": revisalos antes de crear."}
              </>
            }
            acciones={difiereEmpresa && !soloLectura ? (
              <button type="button" onClick={usarDatosEmpresa} className={BOTON_SECUNDARIO}>Usar los de Datos de la empresa</button>
            ) : undefined}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Campo etiqueta="Ambiente" sinLabel>
                <Select value={f.ambiente} onChange={(v) => set("ambiente", v as AmbienteSifen)} options={[["test", "Test"], ["produccion", "Producción"]]} block etiqueta="Ambiente" disabled={soloLectura} />
              </Campo>
              <div className="sm:pt-5">
                <Interruptor activo={f.activo} onChange={(v) => set("activo", v)} etiqueta="SIFEN activo para esta empresa" disabled={soloLectura} />
              </div>
              <Campo etiqueta="Plazo cancelación DE (horas)" ayuda="Ventana desde la aprobación de la SET en la que se permite anular el DE en el ERP sin pagos registrados. Por defecto: 48 h.">
                <input inputMode="numeric" value={f.plazo_cancelacion_horas} onChange={(e) => set("plazo_cancelacion_horas", e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} tabular-nums`} disabled={soloLectura} />
              </Campo>
              <Campo
                etiqueta="RUC"
                requerido
                ayuda={ruc.estado === "ok" ? <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> Dígito verificador correcto</span>
                  : ruc.estado === "vacio" ? "Con guion y dígito verificador, ej. 80012345-0." : <span className="text-rose-600">{ruc.mensaje}</span>}
              >
                <input value={f.ruc} onChange={(e) => set("ruc", e.target.value.replace(/[^\d.\s-]/g, ""))} onBlur={() => f.ruc && set("ruc", normalizarRuc(f.ruc))}
                  inputMode="numeric" maxLength={14} placeholder="80012345-0" disabled={soloLectura}
                  className={`${INPUT} font-mono tabular-nums ${ruc.estado === "dv" || ruc.estado === "incompleto" ? "border-rose-300" : ruc.estado === "ok" ? "border-emerald-300" : ""}`} />
              </Campo>
              <Campo etiqueta="Razón social" requerido className="sm:col-span-2">
                <input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} maxLength={160} disabled={soloLectura} className={INPUT} />
              </Campo>
              <Campo etiqueta="Dirección fiscal (calle / domicilio)" requerido className="sm:col-span-2" ayuda={<>Va al XML SIFEN como <span className="font-mono">dDirEmi</span>. No uses la razón social aquí.</>}>
                <input value={f.direccion_fiscal} onChange={(e) => set("direccion_fiscal", e.target.value)} maxLength={255} placeholder="Ej: Av. España 1234, piso 2" disabled={soloLectura} className={INPUT} />
              </Campo>
              <Campo etiqueta="Timbrado (número)" requerido>
                <input inputMode="numeric" value={f.timbrado_numero} onChange={(e) => set("timbrado_numero", e.target.value.replace(/\D/g, "").slice(0, 15))} disabled={soloLectura} className={`${INPUT} font-mono`} />
              </Campo>
              <Campo etiqueta="Inicio vigencia del timbrado" requerido sinLabel
                ayuda={<>Misma fecha que <span className="font-medium">«Fecha Inicio Vigencia»</span> en la resolución DNIT del timbrado. Va al XML como <span className="font-mono">dFeIniT</span>. Si no coincide, SET devuelve error 1107.</>}>
                <SelectorFecha value={f.timbrado_fecha_inicio_vigencia} onChange={(v) => set("timbrado_fecha_inicio_vigencia", v)} block etiqueta="Inicio de vigencia del timbrado" disabled={soloLectura} alerta={!f.timbrado_fecha_inicio_vigencia} claseBoton="min-h-[42px] rounded-xl px-3" />
              </Campo>
              <Campo etiqueta="Código actividad económica (cActEco)" requerido>
                <input inputMode="numeric" placeholder="Ej: 70209" value={f.actividad_economica_codigo} onChange={(e) => set("actividad_economica_codigo", e.target.value.replace(/\D/g, "").slice(0, 8))} disabled={soloLectura} className={`${INPUT} font-mono`} />
              </Campo>
              <Campo etiqueta="Descripción actividad económica (dDesActEco)" requerido className="sm:col-span-2"
                ayuda={<>Debe ser la <span className="font-medium">actividad principal declarada para tu RUC</span>. Copiá código y descripción del catálogo en e-kuatia o de tu constancia. Si no coinciden con lo que tiene la SET, devuelve error <span className="font-mono">1261</span>.</>}>
                <textarea value={f.actividad_economica_descripcion} onChange={(e) => set("actividad_economica_descripcion", e.target.value)} rows={3} maxLength={600}
                  placeholder="Texto exacto del catálogo SET / e-kuatia para ese código" disabled={soloLectura} className={`${INPUT} min-h-[4rem] resize-y`} />
              </Campo>
              <Campo etiqueta="Establecimiento" requerido>
                <input inputMode="numeric" value={f.establecimiento} onChange={(e) => set("establecimiento", e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => f.establecimiento && set("establecimiento", f.establecimiento.padStart(3, "0"))} placeholder="001" disabled={soloLectura} className={`${INPUT} font-mono`} />
              </Campo>
              <Campo etiqueta="Punto de expedición" requerido>
                <input inputMode="numeric" value={f.punto_expedicion} onChange={(e) => set("punto_expedicion", e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => f.punto_expedicion && set("punto_expedicion", f.punto_expedicion.padStart(3, "0"))} placeholder="001" disabled={soloLectura} className={`${INPUT} font-mono`} />
              </Campo>
              <Campo etiqueta="CSC" opcional ayuda={d.secretos.csc ? "Ya hay un CSC guardado (cifrado). Dejá vacío para no cambiarlo." : "Código de seguridad del contribuyente (lo da la SET). Se guarda cifrado y no se vuelve a mostrar."}>
                <input type="password" value={csc} onChange={(e) => { setCsc(e.target.value); setLimpiarCsc(false); }} placeholder={d.secretos.csc ? "•••••••• (vacío = no cambiar)" : "Opcional"}
                  autoComplete="off" disabled={soloLectura || limpiarCsc || d.clave_servidor === false} className={`${INPUT} font-mono`} />
                {d.secretos.csc && !soloLectura ? (
                  <span className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={limpiarCsc} onChange={(e) => { setLimpiarCsc(e.target.checked); if (e.target.checked) setCsc(""); }} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                    Eliminar el CSC guardado
                  </span>
                ) : null}
              </Campo>
              <Campo etiqueta="ID del CSC" opcional ayuda="Número del CSC en la SET (ej. 0001). Va en el QR del KuDE.">
                <input inputMode="numeric" value={f.csc_id} onChange={(e) => set("csc_id", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0001" disabled={soloLectura} className={`${INPUT} font-mono`} />
              </Campo>
            </div>
          </Tarjeta>

          {/* ── Certificado digital ────────────────────────────────────── */}
          <Tarjeta icono={<FileKey2 className="h-4 w-4" />} titulo="Certificado digital (.p12)" detalle="El archivo se guarda de forma privada. No se muestra la contraseña ni datos cifrados.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Certificado guardado</p>
                {tieneCert && cfg ? (
                  <div className="mt-1 space-y-0.5 text-sm text-slate-700">
                    <p className="font-medium [overflow-wrap:anywhere]">{cfg.certificado_nombre ?? "certificado.p12"} <span className="font-normal text-slate-400">· {(d.secretos.certificado_bytes / 1024).toLocaleString("es-PY", { maximumFractionDigits: 1 })} KB</span></p>
                    {cfg.certificado_titular ? <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">Titular: {cfg.certificado_titular}</p> : <p className="text-xs text-amber-700">Sin validar: cargá la contraseña para leer titular y vencimiento.</p>}
                    {cfg.certificado_subido_at ? <p className="text-xs text-slate-400">Subido el {fechaHora(cfg.certificado_subido_at)}</p> : null}
                  </div>
                ) : <p className="mt-1 text-sm text-slate-500">—</p>}
              </div>
              <Campo etiqueta="Vencimiento del certificado" sinLabel
                ayuda={tieneCert ? <><span className="font-medium text-slate-600">Obligatorio</span> mientras tengas un .p12 cargado. Se completa solo al validar la contraseña.</> : "Opcional hasta que subas el certificado; podés guardar la configuración base antes."}>
                <SelectorFecha value={f.certificado_vencimiento} onChange={(v) => set("certificado_vencimiento", v)} block etiqueta="Vencimiento del certificado" disabled={soloLectura} alerta={tieneCert && !f.certificado_vencimiento} claseBoton="min-h-[42px] rounded-xl px-3" />
              </Campo>
              <Campo etiqueta="Contraseña del certificado" ayuda={tienePw ? "Ya hay una guardada. Escribí una nueva solo para cambiarla: se prueba contra el .p12 antes de guardar." : cfg ? "Se prueba contra el .p12 y se guarda cifrada." : "Opcional al crear."}>
                <input type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setLimpiarPassword(false); }}
                  placeholder={cfg ? "Nueva contraseña (dejar vacío para no cambiar)" : "Opcional al crear"} disabled={soloLectura || limpiarPassword || d.clave_servidor === false} className={INPUT} />
                {cfg && tienePw && !soloLectura ? (
                  <span className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={limpiarPassword} onChange={(e) => { setLimpiarPassword(e.target.checked); if (e.target.checked) setPassword(""); }} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                    Eliminar contraseña guardada en el servidor
                  </span>
                ) : null}
              </Campo>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-600">Subir / reemplazar .p12</span>
                <input ref={certRef} type="file" accept=".p12,.pfx,application/x-pkcs12" className="sr-only" onChange={subirCertificado} disabled={!cfg || subiendoCert || soloLectura} />
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <button type="button" onClick={() => certRef.current?.click()} disabled={!cfg || subiendoCert || soloLectura} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                    {subiendoCert ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {subiendoCert ? "Subiendo…" : "Seleccionar archivo"}
                  </button>
                  {nombreCert ? <span className="truncate text-xs text-slate-600">Archivo: <span className="font-mono font-medium text-slate-800">{nombreCert}</span></span> : null}
                  {password.trim() && cfg ? <span className="text-[11px] text-slate-400">Se valida con la contraseña escrita arriba.</span> : null}
                </div>
                {!cfg ? <p className="mt-2 text-xs text-amber-700">Guardá primero la configuración base para habilitar la subida del certificado.</p> : null}
              </div>
            </div>
          </Tarjeta>

          {/* ── Personalización KuDE ───────────────────────────────────── */}
          <Tarjeta
            icono={<Palette className="h-4 w-4" />}
            titulo="Personalización KuDE"
            detalle={<>Logo y color para la representación gráfica (KuDE/PDF) de la factura electrónica. <span className="font-medium text-slate-600">Esto solo afecta el PDF/KuDE; no cambia XML, firma ni envío a SET.</span> Si no configurás nada se usa el diseño por defecto.</>}
          >
            <div className="space-y-4">
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Logo (PNG, máx. 1 MB)</span>
                <input ref={logoRef} type="file" accept="image/png" className="sr-only" onChange={subirLogo} disabled={!cfg || subiendoLogo || quitandoLogo || soloLectura} />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex h-16 w-full shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-2 sm:w-40">
                    {logoUrl || logoEmpresa ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={(logoUrl || logoEmpresa)!} alt="Logo del KuDE" className={`max-h-12 w-auto max-w-full object-contain ${logoUrl ? "" : "opacity-70"}`} />
                    ) : <ImageIcon className="h-6 w-6 text-slate-300" />}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button type="button" onClick={() => logoRef.current?.click()} disabled={!cfg || subiendoLogo || quitandoLogo || soloLectura} className={`${BOTON_SECUNDARIO} max-sm:min-h-11`}>
                      {subiendoLogo ? "Subiendo…" : logoCargado ? "Reemplazar logo" : "Subir logo"}
                    </button>
                    {logoCargado ? (
                      <button type="button" onClick={restaurarLogo} disabled={!cfg || subiendoLogo || quitandoLogo || soloLectura}
                        className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-50 max-sm:min-h-11">
                        {quitandoLogo ? "Restaurando…" : "Usar el logo de la empresa"}
                      </button>
                    ) : null}
                    <span className="text-xs text-slate-500">Estado: <span className={`font-medium ${logoCargado ? "text-emerald-700" : "text-slate-700"}`}>{logoCargado ? "Logo propio del KuDE" : "Se usa el logo de la empresa (Datos de la empresa)"}</span></span>
                  </div>
                </div>
                {!cfg ? <p className="mt-2 text-xs text-amber-700">Guardá primero la configuración SIFEN base para habilitar la subida del logo.</p> : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo etiqueta="Color principal (bordes, acentos)" sinLabel ayuda="Dejá vacío para usar el color por defecto.">
                  <div className="flex items-center gap-2">
                    <ColorPicker value={isHex(color) ? color : TEAL} onChange={setColor} />
                    <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#0ea5e9 (vacío = por defecto)" maxLength={7} disabled={soloLectura} className={`${INPUT} font-mono`} />
                  </div>
                </Campo>
                <Campo etiqueta="Color de acento (fondo suave)" sinLabel>
                  <span className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={derivarFill} onChange={(e) => setDerivarFill(e.target.checked)} disabled={soloLectura} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
                    Derivar automáticamente del color principal
                  </span>
                  <div className={`flex items-center gap-2 ${derivarFill ? "pointer-events-none opacity-50" : ""}`}>
                    <ColorPicker value={isHex(colorFill) ? colorFill : "#eaf6fc"} onChange={setColorFill} />
                    <input value={colorFill} onChange={(e) => setColorFill(e.target.value)} placeholder="Solo si querés sobreescribir el acento" maxLength={7} disabled={derivarFill || soloLectura} className={`${INPUT} font-mono`} />
                  </div>
                </Campo>
              </div>
              {!soloLectura ? (
                <div>
                  <button type="button" onClick={guardarColores} disabled={!cfg || guardandoColores} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:w-full`} style={{ backgroundColor: TEAL }}>
                    {guardandoColores ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {guardandoColores ? "Guardando…" : "Guardar colores"}
                  </button>
                  <p className="mt-2 text-xs text-slate-500">El logo se guarda automáticamente al subirlo. Los colores se persisten al pulsar «Guardar colores».</p>
                </div>
              ) : null}
            </div>
          </Tarjeta>

          {!soloLectura ? (
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgba(2,48,71,0.18)] backdrop-blur sm:gap-3 sm:px-4 sm:py-3">
              <p className="min-w-0 flex-1 text-xs text-slate-400 max-sm:basis-full">{cfg ? "Guarda datos del emisor, contraseña y CSC." : "Crea la configuración; después se habilita el certificado y el logo."}</p>
              {completa && editar ? (
                <button type="button" onClick={cancelarEdicion} className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:flex-1`}>Cancelar edición</button>
              ) : null}
              <button type="submit" disabled={guardando} className={`${BOTON_PRIMARIO} max-sm:min-h-11 max-sm:flex-1`} style={{ backgroundColor: TEAL }}>
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {guardando ? "Guardando…" : cfg ? "Guardar cambios" : "Crear configuración SIFEN"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function Fila({ k, v, ancho = false }: { k: string; v: React.ReactNode; ancho?: boolean }) {
  return (
    <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800 [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}
