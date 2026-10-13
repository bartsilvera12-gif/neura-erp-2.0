"use client";

/**
 * Pestaña "Información" de la ficha: el formulario editable en el lugar, igual que el
 * sistema actual (mismas secciones, orden y estilos): baja registrada, Datos de
 * identificación (tipo, categoría con "+ Nueva", nombre y documento, contacto, datos para
 * factura), Contacto (+ datos SIFEN del receptor), Datos comerciales (plan activo,
 * condición, valor anual, vendedor, estado, facturación al contado) y "Guardar cambios"
 * al final. Guardar manda todos los campos al PATCH; el Historial registra cada cambio solo.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import type { Categoria, ClienteCompleto } from "@/modules/clientes/esquema";
import type { UsuarioMin } from "@/modules/clientes/ficha/tipos";
import type { SuscripcionCliente } from "@/modules/clientes/suscripciones/tipos";
import { TEAL, fechaCorta } from "@/modules/clientes/ui";

// ── Estilos (los del sistema actual) ──────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#4FAEB2] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
      {children}
    </p>
  );
}

type Form = ReturnType<typeof formDesde>;

function formDesde(c: ClienteCompleto) {
  return {
    tipo_cliente: c.tipo_cliente ?? "persona",
    categoria_id: c.categoria_id ?? "",
    nombre: c.nombre ?? "",
    documento: c.documento ?? "",
    nombre_contacto: c.nombre_contacto ?? "",
    telefono: c.telefono ?? "",
    telefono_secundario: c.telefono_secundario ?? "",
    razon_social: c.razon_social ?? "",
    ruc: c.ruc ?? "",
    email: c.email ?? "",
    email_secundario: c.email_secundario ?? "",
    direccion: c.direccion ?? "",
    ciudad: c.ciudad ?? "",
    pais: c.pais ?? "",
    sifen_naturaleza: c.sifen_naturaleza ?? "",
    sifen_ti_ope: c.sifen_ti_ope ?? "",
    sifen_extranjero: !!c.sifen_extranjero,
    sifen_pais_iso3: c.sifen_pais_iso3 && c.sifen_pais_iso3 !== "PRY" ? c.sifen_pais_iso3 : "",
    sifen_tipo_documento: c.sifen_tipo_documento ?? "",
    sifen_num_id: c.sifen_num_id ?? "",
    sifen_direccion: c.sifen_direccion ?? "",
    sifen_numero_casa: c.sifen_numero_casa ?? "",
    sitio_web: c.sitio_web ?? "",
    instagram: c.instagram ?? "",
    linkedin: c.linkedin ?? "",
    condicion_pago: c.condicion_pago === "CREDITO" ? "CREDITO" : "CONTADO",
    plazo_dias: c.plazo_dias ? String(c.plazo_dias) : "30",
    limite_credito: Number(c.limite_credito ?? 0),
    valor_anual: Number(c.valor_anual ?? 0),
    moneda_preferida: c.moneda_preferida === "USD" ? "USD" : "GS",
    vendedor_usuario_id: c.vendedor_usuario_id ?? "",
    vendedor_texto: c.vendedor_texto ?? "",
    activo: c.activo !== false,
  };
}

export function TabInformacion({ cliente, esAdmin, suscripcionActiva, ventasCount, onGuardado }: {
  cliente: ClienteCompleto;
  esAdmin: boolean;
  /** la suscripción activa (recuadro "Plan mensual activo") */
  suscripcionActiva: SuscripcionCliente | null;
  /** cuántas ventas tiene (recuadro "Facturación al contado") */
  ventasCount: number;
  onGuardado: () => void;
}) {
  const [f, setF] = useState<Form>(() => formDesde(cliente));
  const [usuarios, setUsuarios] = useState<UsuarioMin[] | null>(null);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nuevaCat, setNuevaCat] = useState<string | null>(null);
  const [creandoCat, setCreandoCat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => { setF(formDesde(cliente)); }, [cliente]);
  useEffect(() => {
    apiFetchCache<UsuarioMin[]>("/api/usuarios?min=1").then(setUsuarios).catch((e) => { setUsuarios([]); setErrorUsuarios((e as Error).message); });
    apiFetchCache<Categoria[]>("/api/clientes/categorias").then(setCategorias).catch(() => {});
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setFormError(null); setGuardado(false); };
  const inp = (k: keyof Form) => ({
    value: String(f[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never),
  });
  const empresa = f.tipo_cliente === "empresa";
  const credito = f.condicion_pago === "CREDITO";
  const usdForm = f.moneda_preferida === "USD";

  // SIFEN: avisos de combinación inválida (como el sistema actual).
  const pais = f.sifen_pais_iso3.trim().toUpperCase();
  const errorPais = f.sifen_extranjero && (!pais || pais === "PRY") ? "Para un receptor extranjero, el país tiene que ser un código ISO3 distinto de PRY (ej. ARG, BRA)." : null;
  const avisoB2F = f.sifen_ti_ope === "B2F" && !f.sifen_extranjero ? "La operación B2F (con el exterior) es para receptores extranjeros." : null;
  const avisoLocal = f.sifen_extranjero && f.sifen_ti_ope && f.sifen_ti_ope !== "B2F" ? "Un receptor extranjero va con operación B2F; B2B/B2C/B2G son para receptores paraguayos." : null;
  const sifenAbierto = !!(cliente.sifen_naturaleza || cliente.sifen_ti_ope || cliente.sifen_extranjero || cliente.sifen_tipo_documento || cliente.sifen_num_id || cliente.sifen_direccion);

  // Categoría elegida que ya no está activa: igual se muestra.
  const opcionesCat: [string, string][] = [["", "— Ninguna —"], ...categorias.map((c) => [c.id, c.nombre] as [string, string])];
  if (cliente.categoria_id && !categorias.some((c) => c.id === cliente.categoria_id)) {
    opcionesCat.push([cliente.categoria_id, `${cliente.categoria_nombre ?? "Categoría"} (inactiva)`]);
  }

  async function crearCategoria() {
    const nombre = (nuevaCat ?? "").trim();
    if (!nombre) return;
    setCreandoCat(true);
    setFormError(null);
    try {
      const c = await apiFetch<Categoria>("/api/clientes/categorias", { method: "POST", body: JSON.stringify({ nombre }) });
      invalidar("/api/clientes/categorias");
      setCategorias((p) => [...p, c]);
      set("categoria_id", c.id);
      setNuevaCat(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setCreandoCat(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!f.nombre.trim()) return setFormError(empresa ? "El nombre de empresa es obligatorio." : "El nombre es obligatorio.");
    if (errorPais) return setFormError(`SIFEN receptor: ${errorPais}`);
    setBusy(true);
    setGuardado(false);
    try {
      await apiFetch(`/api/clientes/${cliente.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tipo_cliente: f.tipo_cliente,
          categoria_id: f.categoria_id || null,
          nombre: f.nombre.trim(),
          documento: f.documento.trim() || null,
          nombre_contacto: f.nombre_contacto.trim() || null,
          telefono: f.telefono.trim() || null,
          telefono_secundario: f.telefono_secundario.trim() || null,
          razon_social: f.razon_social.trim() || null,
          ruc: f.ruc.trim() || null,
          email: f.email.trim() || null,
          email_secundario: f.email_secundario.trim() || null,
          direccion: f.direccion.trim() || null,
          ciudad: f.ciudad.trim() || null,
          pais: f.pais.trim() || null,
          sifen_naturaleza: f.sifen_naturaleza || null,
          sifen_ti_ope: f.sifen_ti_ope || null,
          sifen_extranjero: f.sifen_extranjero,
          sifen_pais_iso3: f.sifen_extranjero ? pais : "PRY",
          sifen_tipo_documento: f.sifen_tipo_documento || null,
          sifen_num_id: f.sifen_num_id.trim() || null,
          sifen_direccion: f.sifen_direccion.trim() || null,
          sifen_numero_casa: f.sifen_numero_casa.trim() || null,
          sitio_web: f.sitio_web.trim() || null,
          instagram: f.instagram.trim() || null,
          linkedin: f.linkedin.trim() || null,
          condicion_pago: f.condicion_pago,
          plazo_dias: credito ? Number(f.plazo_dias) || null : null,
          limite_credito: credito ? f.limite_credito || 0 : 0,
          valor_anual: f.valor_anual || null,
          moneda_preferida: f.moneda_preferida,
          vendedor_usuario_id: f.vendedor_usuario_id || null,
          vendedor_texto: f.vendedor_texto.trim() || null,
          activo: f.activo,
        }),
      });
      setGuardado(true);
      onGuardado();
    } catch (err) {
      setFormError((err as Error).message || "No se pudo guardar el cliente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-8 max-w-2xl">

      {/* Trazabilidad de la baja */}
      {cliente.baja_at ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Baja registrada</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div>
              <span className="text-amber-700">Fecha de baja:</span>
              <span className="ml-2 font-medium text-amber-900">{fechaCorta(cliente.baja_at)}</span>
            </div>
            <div>
              <span className="text-amber-700">Usuario:</span>
              <span className="ml-2 font-medium text-amber-900">{cliente.baja_por_nombre ?? "—"}</span>
            </div>
            <div className="col-span-2">
              <span className="text-amber-700">Motivo:</span>
              <span className="ml-2 font-medium text-amber-900">{cliente.baja_motivo ?? "—"}</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Identificación */}
      <section className="space-y-4">
        <SectionTitle>Datos de identificación</SectionTitle>

        <div>
          <label className={labelClass}>Tipo de cliente</label>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
            {(["empresa", "persona"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("tipo_cliente", t)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  f.tipo_cliente === t ? "text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
                style={f.tipo_cliente === t ? { backgroundColor: TEAL } : undefined}
              >
                {t === "empresa" ? "Empresa" : "Persona"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>Categoría</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Select value={f.categoria_id} onChange={(v) => set("categoria_id", v)} block compacto options={opcionesCat} />
            </div>
            {esAdmin && nuevaCat === null ? (
              <button
                type="button"
                onClick={() => setNuevaCat("")}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                + Nueva
              </button>
            ) : null}
          </div>
          {nuevaCat !== null ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={nuevaCat}
                onChange={(e) => setNuevaCat(e.target.value)}
                maxLength={60}
                placeholder="Nombre de la categoría"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void crearCategoria(); } if (e.key === "Escape") setNuevaCat(null); }}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => void crearCategoria()}
                disabled={creandoCat || !nuevaCat.trim()}
                className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: TEAL }}
              >
                {creandoCat ? "Creando…" : "Crear"}
              </button>
              <button type="button" onClick={() => setNuevaCat(null)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
            </div>
          ) : null}
        </div>

        {/* Fila principal: nombre + documento (RUC empresa / CI persona) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{empresa ? "Nombre de empresa" : "Nombre completo"}</label>
            <input type="text" {...inp("nombre")} maxLength={200} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>{empresa ? "RUC" : "CI / Documento"}</label>
            <input type="text" {...inp("documento")} maxLength={40} className={inputClass} placeholder={empresa ? "00000000-0" : undefined} />
          </div>
        </div>

        {/* Contacto directo: persona de contacto (solo empresa) + teléfono */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {empresa ? (
            <div>
              <label className={labelClass}>Persona de contacto</label>
              <input
                type="text"
                value={f.nombre_contacto}
                // El nombre de una persona no lleva números (evita que se cuele un teléfono).
                onChange={(e) => set("nombre_contacto", e.target.value.replace(/[0-9]/g, ""))}
                maxLength={200}
                className={inputClass}
              />
            </div>
          ) : null}
          <div>
            <label className={labelClass}>Teléfono de contacto</label>
            <input type="tel" {...inp("telefono")} maxLength={40} placeholder="0981 123 456" className={inputClass} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Datos para factura</p>
          <p className="mb-3 text-xs text-slate-500">
            Lo que sale en el documento tributario (SIFEN). La factura siempre se emite contra un RUC. Si se deja
            vacío, se factura con el nombre y documento del cliente.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{empresa ? "Razón social" : "Nombre para factura"}</label>
              <input type="text" {...inp("razon_social")} maxLength={200} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>RUC</label>
              <input type="text" {...inp("ruc")} maxLength={40} className={inputClass} placeholder="00000000-0" />
            </div>
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section className="space-y-4">
        <SectionTitle>Contacto</SectionTitle>

        <div>
          <label className={labelClass}>Email</label>
          <input type="email" value={f.email} onChange={(e) => set("email", e.target.value.toLowerCase())} maxLength={120} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Dirección</label>
          <input type="text" {...inp("direccion")} maxLength={200} className={inputClass} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Ciudad</label>
            <input type="text" {...inp("ciudad")} maxLength={80} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>País</label>
            <input type="text" {...inp("pais")} maxLength={80} className={inputClass} />
          </div>
        </div>

        {/* Datos SIFEN del receptor (con los campos que tiene el 2.0) */}
        <details className="rounded-xl border border-slate-200 bg-slate-50/40 open:bg-white" open={sifenAbierto || undefined}>
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide select-none">
            Datos SIFEN del receptor (avanzado)
          </summary>
          <div className="px-4 pb-4 pt-0 space-y-4 border-t border-slate-100">
            <p className="text-[11px] text-slate-500 leading-snug pt-3">
              Solo aplica a facturación electrónica SIFEN. Si lo dejás en automático, el sistema usa la lógica
              automática (RUC / documento / bandera receptor extranjero).
            </p>
            <div>
              <label className={labelClass}>Naturaleza del receptor (SIFEN)</label>
              <Select value={f.sifen_naturaleza} onChange={(v) => set("sifen_naturaleza", v)} block compacto
                options={[["", "— Automática —"], ["contribuyente", "Contribuyente paraguayo (RUC)"], ["no_contribuyente", "No contribuyente (Paraguay)"]]} />
            </div>
            <div>
              <label className={labelClass}>Tipo de operación (iTiOpe)</label>
              <Select value={f.sifen_ti_ope} onChange={(v) => set("sifen_ti_ope", v)} block compacto
                options={[["", "— Automática —"], ["B2B", "B2B"], ["B2C", "B2C"], ["B2G", "B2G"], ["B2F", "B2F (operación con el exterior)"]]} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={f.sifen_extranjero}
                onChange={(e) => set("sifen_extranjero", e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Receptor extranjero / operación con el exterior</span>
            </label>
            <div>
              <label className={labelClass}>Tipo de documento del receptor (iTipIDRec)</label>
              <Select value={f.sifen_tipo_documento} onChange={(v) => set("sifen_tipo_documento", v)} block compacto
                options={[["", "— Por defecto según naturaleza —"], ["cedula", "Cédula paraguaya"], ["pasaporte", "Pasaporte"], ["carnet_extranjero", "Cédula extranjera"], ["otro", "Otro / identificación tributaria extranjera"]]} />
            </div>
            <div>
              <label className={labelClass}>Número de documento para el DE</label>
              <input type="text" {...inp("sifen_num_id")} maxLength={40} className={inputClass} placeholder="Si vacío, se usa documento o RUC del cliente" />
            </div>
            {f.sifen_extranjero ? (
              <div>
                <label className={labelClass}>Código país ISO3 (obligatorio si es extranjero)</label>
                <input
                  type="text"
                  className={`${inputClass} uppercase`}
                  value={f.sifen_pais_iso3}
                  onChange={(e) => set("sifen_pais_iso3", e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                  placeholder="Ej. PER"
                  maxLength={3}
                />
              </div>
            ) : null}
            <div>
              <label className={labelClass}>Dirección en el DE (gDatRec)</label>
              <input type="text" {...inp("sifen_direccion")} maxLength={200} className={inputClass} placeholder="Si vacío, se intenta con la dirección del cliente" />
            </div>
            {errorPais || avisoB2F || avisoLocal ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 leading-snug">
                <div className="font-semibold mb-1">Combinación inválida para SIFEN</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {errorPais ? <li>{errorPais}</li> : null}
                  {avisoB2F ? <li>{avisoB2F}</li> : null}
                  {avisoLocal ? <li>{avisoLocal}</li> : null}
                </ul>
              </div>
            ) : null}
            <div>
              <label className={labelClass}>Número de casa en el DE (dNumCasRec)</label>
              <input
                type="text"
                inputMode="numeric"
                value={f.sifen_numero_casa}
                onChange={(e) => set("sifen_numero_casa", e.target.value.replace(/\D/g, "").slice(0, 20))}
                className={inputClass}
                placeholder="0 si no aplica domicilio con número"
              />
            </div>
          </div>
        </details>
      </section>

      {/* Comercial */}
      <section className="space-y-4">
        <SectionTitle>Datos comerciales</SectionTitle>

        {suscripcionActiva ? (
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/90">
            <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Plan mensual activo</p>
            <p className="text-sm text-emerald-950 mt-1">
              <span className="font-semibold">{suscripcionActiva.plan}</span>
              {" · "}
              {suscripcionActiva.moneda === "USD" ? "U$S " : "Gs. "}
              {Number(suscripcionActiva.precio).toLocaleString("es-PY")}
              {" · facturación día "}
              {suscripcionActiva.dia_facturacion}
              {" · vencimiento día "}
              {suscripcionActiva.dia_vencimiento}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Condición de pago</label>
            <Select value={f.condicion_pago} onChange={(v) => set("condicion_pago", v as Form["condicion_pago"])} block compacto
              options={[["CONTADO", "Contado"], ["CREDITO", "Crédito (cuenta corriente)"]]} />
          </div>
          <div>
            <label className={labelClass}>Valor anual estimado ({usdForm ? "US$" : "Gs."})</label>
            <MontoInput value={f.valor_anual || ""} onChange={(n) => set("valor_anual", n)} className={inputClass} decimals={usdForm} />
          </div>
        </div>

        {credito ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Plazo para pagar (días)</label>
              <input inputMode="numeric" value={f.plazo_dias} onChange={(e) => set("plazo_dias", e.target.value.replace(/\D/g, "").slice(0, 4))} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Límite de crédito (Gs.)</label>
              <MontoInput value={f.limite_credito || ""} onChange={(n) => set("limite_credito", n)} decimals={false} placeholder="Sin límite" className={inputClass} />
              <p className="mt-1 text-[11px] text-slate-500">La caja no deja vender a crédito por encima de esto.</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Vendedor responsable (usuario ERP)</label>
            <Select value={f.vendedor_usuario_id} onChange={(v) => set("vendedor_usuario_id", v)} block compacto
              options={[["", "— Sin asignar —"], ...(usuarios ?? []).map((u) => [u.id, u.nombre] as [string, string])]} />
            {errorUsuarios ? (
              <p className="mt-1 text-xs text-red-600">{errorUsuarios}</p>
            ) : usuarios && usuarios.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">No hay usuarios activos disponibles para asignar.</p>
            ) : null}
          </div>
          <div>
            <label className={labelClass}>Vendedor asignado (texto libre)</label>
            <input type="text" {...inp("vendedor_texto")} maxLength={120} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Estado</label>
            <Select value={f.activo ? "activo" : "inactivo"} onChange={(v) => set("activo", v === "activo")} block compacto
              options={[["activo", "Activo"], ["inactivo", "Inactivo"]]} />
            {cliente.baja_at && f.activo ? <p className="mt-1 text-[11px] text-amber-700">Al guardar se levanta la baja y vuelve a ser cliente activo.</p> : null}
          </div>
          <div>
            <label className={labelClass}>Moneda</label>
            <Select value={f.moneda_preferida} onChange={(v) => set("moneda_preferida", v as Form["moneda_preferida"])} block compacto
              options={[["GS", "Guaraníes (Gs.)"], ["USD", "Dólares (US$)"]]} />
          </div>
        </div>

        {/* Facturación al contado: en el 2.0 la venta al contado se hace en Caja. */}
        {f.condicion_pago === "CONTADO" ? (
          <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <SectionTitle>Facturación al contado</SectionTitle>
            {ventasCount > 0 ? (
              <p className="text-sm text-slate-600">Este cliente ya tiene {ventasCount} venta(s).</p>
            ) : (
              <p className="text-sm text-slate-600">
                Todavía no tiene ventas.{" "}
                <Link href={`/caja/nueva?cliente=${encodeURIComponent(cliente.id)}`} className="font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline">
                  Hacer una venta al contado
                </Link>
              </p>
            )}
          </div>
        ) : null}
      </section>

      {formError ? (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <span>⚠</span><span className="font-medium">{formError}</span>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="text-white px-5 py-2.5 rounded-lg text-sm font-medium transition hover:brightness-95 shadow-sm active:scale-95 disabled:opacity-50"
          style={{ backgroundColor: TEAL }}
        >
          {busy ? "Guardando…" : "Guardar cambios"}
        </button>
        {guardado ? <span className="text-xs font-medium text-emerald-600">Cambios guardados</span> : null}
      </div>
    </form>
  );
}
