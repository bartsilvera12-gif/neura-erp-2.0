"use client";

/**
 * Pestaña "Información" de la ficha: vista de lectura en tarjetas compactas y un botón
 * "Editar información" que abre el modal (estilo del sistema actual) con las secciones — identificación (+ datos para factura), contacto
 * (+ receptor SIFEN avanzado), presencia digital y datos comerciales. "Guardar cambios"
 * manda solo lo de este formulario; la Actividad registra cada cambio sola.
 */
import { useEffect, useState } from "react";
import { Briefcase, Globe, IdCard, Loader2, Pencil, Phone, Plus, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";
import MontoInput from "@/components/ui/MontoInput";
import type { Categoria, ClienteCompleto } from "@/modules/clientes/esquema";
import type { UsuarioMin } from "@/modules/clientes/ficha/tipos";
import { TEAL, fechaCorta } from "@/modules/clientes/ui";

const INPUT = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition-colors hover:border-[var(--brand)]/60 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-100)]";
const LABEL = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span aria-hidden="true" className="block h-5 w-1 rounded-full bg-[var(--brand)]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{children}</p>
    </div>
  );
}

function Campo({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
    </label>
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

export function TabInformacion({ cliente, esAdmin, onGuardado }: { cliente: ClienteCompleto; esAdmin: boolean; onGuardado: () => void }) {
  const [f, setF] = useState<Form>(() => formDesde(cliente));
  const [usuarios, setUsuarios] = useState<UsuarioMin[] | null>(null);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [nuevaCat, setNuevaCat] = useState<string | null>(null);
  const [creandoCat, setCreandoCat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [abierto, setAbierto] = useState(false);
  // Al abrir, el formulario arranca con los datos actuales (descarta lo que quedó sin guardar).
  const abrir = () => { setF(formDesde(cliente)); setError(null); setNuevaCat(null); setGuardado(false); setAbierto(true); };

  useEffect(() => { setF(formDesde(cliente)); }, [cliente]);
  useEffect(() => {
    apiFetchCache<UsuarioMin[]>("/api/usuarios?min=1").then(setUsuarios).catch((e) => { setUsuarios([]); setErrorUsuarios((e as Error).message); });
    apiFetchCache<Categoria[]>("/api/clientes/categorias").then(setCategorias).catch(() => {});
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setGuardado(false); };
  const inp = (k: keyof Form) => ({
    value: String(f[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never),
  });
  const empresa = f.tipo_cliente === "empresa";
  const pais = f.sifen_pais_iso3.trim().toUpperCase();
  const errorPais = f.sifen_extranjero && (!pais || pais === "PRY") ? "Para un receptor extranjero, el país tiene que ser distinto de PRY (ej. ARG, BRA)." : null;
  const avisoB2F = f.sifen_ti_ope === "B2F" && !f.sifen_extranjero ? "La operación B2F (con el exterior) es para receptores extranjeros." : null;

  // Categoría elegida que ya no está activa: igual se muestra.
  const opcionesCat: [string, string][] = [["", "— Ninguna —"], ...categorias.map((c) => [c.id, c.nombre] as [string, string])];
  if (cliente.categoria_id && !categorias.some((c) => c.id === cliente.categoria_id)) {
    opcionesCat.push([cliente.categoria_id, `${cliente.categoria_nombre ?? "Categoría"} (inactiva)`]);
  }

  async function crearCategoria() {
    const nombre = (nuevaCat ?? "").trim();
    if (!nombre) return;
    setCreandoCat(true);
    setError(null);
    try {
      const c = await apiFetch<Categoria>("/api/clientes/categorias", { method: "POST", body: JSON.stringify({ nombre }) });
      invalidar("/api/clientes/categorias");
      setCategorias((p) => [...p, c]);
      set("categoria_id", c.id);
      setNuevaCat(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreandoCat(false);
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nombre.trim()) { setError("El nombre es obligatorio."); return; }
    if (errorPais) { setError(errorPais); return; }
    setBusy(true);
    setError(null);
    setGuardado(false);
    try {
      const credito = f.condicion_pago === "CREDITO";
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
      setAbierto(false);
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const vendedor = cliente.vendedor_usuario_id ? usuarios?.find((u) => u.id === cliente.vendedor_usuario_id)?.nombre ?? null : null;
  const credito = cliente.condicion_pago === "CREDITO";
  const usd = cliente.moneda_preferida === "USD";
  const sifen = [
    cliente.sifen_naturaleza === "contribuyente" ? "Contribuyente" : cliente.sifen_naturaleza === "no_contribuyente" ? "No contribuyente" : null,
    cliente.sifen_ti_ope ?? null,
    cliente.sifen_extranjero ? `Extranjero (${cliente.sifen_pais_iso3 ?? "—"})` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      {cliente.baja_at ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Baja registrada</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <div><span className="text-amber-700">Fecha de baja:</span><span className="ml-2 font-medium text-amber-900">{fechaCorta(cliente.baja_at)}</span></div>
            <div><span className="text-amber-700">Usuario:</span><span className="ml-2 font-medium text-amber-900">{cliente.baja_por_nombre ?? "—"}</span></div>
            <div className="col-span-2"><span className="text-amber-700">Motivo:</span><span className="ml-2 font-medium text-amber-900">{cliente.baja_motivo ?? "—"}</span></div>
          </div>
        </div>
      ) : null}

      {/* Vista de lectura: tarjetas compactas; para cambiar algo se abre el modal. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Datos del cliente. Para cambiarlos usá <b className="font-semibold text-slate-700">Editar información</b>.</p>
        <div className="flex items-center gap-3">
          {guardado ? <span className="text-xs font-medium text-emerald-600">Cambios guardados</span> : null}
          <button type="button" onClick={abrir}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition hover:brightness-95"
            style={{ backgroundColor: TEAL }}>
            <Pencil className="h-4 w-4" /> Editar información
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Identificación" icono={IdCard}>
          <Dato label="Tipo">{cliente.tipo_cliente === "empresa" ? "Empresa" : "Persona"}</Dato>
          <Dato label="Categoría">{cliente.categoria_nombre ?? null}</Dato>
          <Dato label={cliente.tipo_cliente === "empresa" ? "Nombre de empresa" : "Nombre completo"} ancho>{cliente.nombre}</Dato>
          <Dato label={cliente.tipo_cliente === "empresa" ? "RUC" : "CI / Documento"} mono>{cliente.documento}</Dato>
          {cliente.tipo_cliente === "empresa" ? <Dato label="Persona de contacto">{cliente.nombre_contacto}</Dato> : null}
          <Dato label="Factura a nombre de">{cliente.razon_social}</Dato>
          <Dato label="RUC para factura" mono>{cliente.ruc}</Dato>
        </Tarjeta>

        <Tarjeta titulo="Contacto" icono={Phone}>
          <Dato label="Teléfono">{cliente.telefono ? <a href={`tel:${cliente.telefono.replace(/\s+/g, "")}`} className="hover:text-[var(--brand)] hover:underline">{cliente.telefono}</a> : null}</Dato>
          <Dato label="Teléfono secundario">{cliente.telefono_secundario}</Dato>
          <Dato label="Email">{cliente.email ? <a href={`mailto:${cliente.email}`} className="break-all hover:text-[var(--brand)] hover:underline">{cliente.email}</a> : null}</Dato>
          <Dato label="Email secundario">{cliente.email_secundario}</Dato>
          <Dato label="Dirección" ancho>{[cliente.direccion, cliente.ciudad, cliente.pais].filter(Boolean).join(", ") || null}</Dato>
          {sifen ? <Dato label="SIFEN del receptor" ancho>{sifen}</Dato> : null}
        </Tarjeta>

        <Tarjeta titulo="Datos comerciales" icono={Briefcase}>
          <Dato label="Condición de pago">{credito ? `Crédito · ${cliente.plazo_dias ?? 30} días` : "Contado"}</Dato>
          {credito ? <Dato label="Límite de crédito">{Number(cliente.limite_credito ?? 0) > 0 ? `Gs. ${Number(cliente.limite_credito).toLocaleString("es-PY")}` : "Sin límite"}</Dato> : null}
          <Dato label="Moneda">{usd ? "Dólares (US$)" : "Guaraníes (Gs.)"}</Dato>
          <Dato label="Valor anual estimado">{Number(cliente.valor_anual ?? 0) > 0 ? `${usd ? "US$" : "Gs."} ${Number(cliente.valor_anual).toLocaleString("es-PY")}` : null}</Dato>
          <Dato label="Vendedor">{vendedor ?? cliente.vendedor_texto ?? null}</Dato>
          <Dato label="Estado">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${cliente.activo !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              <i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${cliente.activo !== false ? "bg-emerald-500" : "bg-slate-400"}`} />
              {cliente.activo !== false ? "Activo" : "Inactivo"}
            </span>
          </Dato>
        </Tarjeta>

        <Tarjeta titulo="Presencia digital" icono={Globe}>
          <Dato label="Sitio web" ancho>{cliente.sitio_web ? <a href={/^https?:\/\//i.test(cliente.sitio_web) ? cliente.sitio_web : `https://${cliente.sitio_web}`} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--brand)] hover:underline">{cliente.sitio_web}</a> : null}</Dato>
          <Dato label="Instagram">{cliente.instagram}</Dato>
          <Dato label="LinkedIn">{cliente.linkedin}</Dato>
        </Tarjeta>
      </div>

      {abierto ? (
        <CapaModal onClose={busy ? undefined : () => setAbierto(false)} fondo="bg-slate-900/55 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="cli-info-titulo"
            className={`relative flex w-full max-w-4xl ${ALTO_MAX_MODAL} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-[#4FAEB2]/10 ring-1 ring-[#4FAEB2]/15`}
            style={{ animation: "modal-pop 0.18s cubic-bezier(0.16,1,0.3,1)" }}>
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40" />
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-br from-white via-white to-[#4FAEB2]/5 px-6 pb-5 pt-6">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4FAEB2] shadow-[0_0_0_3px_rgba(79,174,178,0.18)]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4FAEB2]">Editar</p>
                </div>
                <h2 id="cli-info-titulo" className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">{cliente.nombre}</h2>
                <p className="mt-1 text-sm text-slate-500">Todos los datos del cliente. La Actividad registra cada cambio.</p>
              </div>
              <button type="button" onClick={() => setAbierto(false)} disabled={busy} aria-label="Cerrar"
                className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form id="cli-info-form" onSubmit={guardar} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/50 px-6 py-5">
      {/* Identificación */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle>Datos de identificación</SectionTitle>
        <div>
          <span className={LABEL}>Tipo de cliente</span>
          <div className="flex w-fit overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            {(["empresa", "persona"] as const).map((t) => (
              <button key={t} type="button" onClick={() => set("tipo_cliente", t)}
                className={`px-5 py-2.5 text-sm font-semibold transition-colors ${f.tipo_cliente === t ? "text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                style={f.tipo_cliente === t ? { backgroundColor: TEAL } : undefined}>
                {t === "empresa" ? "Empresa" : "Persona"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={LABEL}>Categoría</span>
          <div className="flex items-center gap-2">
            <div className="flex-1"><Select value={f.categoria_id} onChange={(v) => set("categoria_id", v)} block options={opcionesCat} /></div>
            {esAdmin && nuevaCat === null ? (
              <button type="button" onClick={() => setNuevaCat("")} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" /> Nueva
              </button>
            ) : null}
          </div>
          {nuevaCat !== null ? (
            <div className="mt-2 flex items-center gap-2">
              <input autoFocus value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} maxLength={60} placeholder="Nombre de la categoría"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void crearCategoria(); } if (e.key === "Escape") setNuevaCat(null); }}
                className={INPUT} />
              <button type="button" onClick={crearCategoria} disabled={creandoCat || !nuevaCat.trim()} className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: TEAL }}>
                {creandoCat ? "Creando…" : "Crear"}
              </button>
              <button type="button" onClick={() => setNuevaCat(null)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancelar</button>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label={empresa ? "Nombre de empresa *" : "Nombre completo *"}><input {...inp("nombre")} maxLength={200} className={INPUT} required /></Campo>
          <Campo label={empresa ? "RUC" : "CI / Documento"}><input {...inp("documento")} maxLength={40} placeholder={empresa ? "00000000-0" : undefined} className={INPUT} /></Campo>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {empresa ? <Campo label="Persona de contacto"><input {...inp("nombre_contacto")} maxLength={200} className={INPUT} /></Campo> : null}
          <Campo label="Teléfono de contacto"><input type="tel" {...inp("telefono")} maxLength={40} placeholder="0981 123 456" className={INPUT} /></Campo>
          <Campo label="Teléfono secundario"><input type="tel" {...inp("telefono_secundario")} maxLength={40} className={INPUT} /></Campo>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Datos para factura</p>
          <p className="mb-3 text-xs text-slate-500">
            Lo que sale en el documento tributario (SIFEN). Si lo dejás vacío, se factura con el nombre y documento del cliente.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label={empresa ? "Razón social" : "Nombre para factura"}><input {...inp("razon_social")} maxLength={200} className={INPUT} /></Campo>
            <Campo label="RUC"><input {...inp("ruc")} maxLength={40} placeholder="00000000-0" className={INPUT} /></Campo>
          </div>
        </div>
      </section>

      {/* Contacto */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle>Contacto</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Email"><input type="email" {...inp("email")} maxLength={120} className={INPUT} /></Campo>
          <Campo label="Email secundario"><input type="email" {...inp("email_secundario")} maxLength={120} className={INPUT} /></Campo>
        </div>
        <Campo label="Dirección"><input {...inp("direccion")} maxLength={200} className={INPUT} /></Campo>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Ciudad"><input {...inp("ciudad")} maxLength={80} className={INPUT} /></Campo>
          <Campo label="País"><input {...inp("pais")} maxLength={80} placeholder="Paraguay" className={INPUT} /></Campo>
        </div>

        <details className="rounded-xl border border-slate-200 bg-slate-50/40 open:bg-white" open={!!(cliente.sifen_naturaleza || cliente.sifen_ti_ope || cliente.sifen_extranjero || cliente.sifen_tipo_documento) || undefined}>
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Datos SIFEN del receptor (avanzado)
          </summary>
          <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
            <p className="text-[11px] leading-snug text-slate-500">
              Solo para factura electrónica. Si lo dejás vacío, se arma solo con el RUC o el documento del cliente.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Naturaleza del receptor">
                <Select value={f.sifen_naturaleza} onChange={(v) => set("sifen_naturaleza", v)} block
                  options={[["", "— Automática —"], ["contribuyente", "Contribuyente (tiene RUC)"], ["no_contribuyente", "No contribuyente"]]} />
              </Campo>
              <Campo label="Tipo de operación">
                <Select value={f.sifen_ti_ope} onChange={(v) => set("sifen_ti_ope", v)} block
                  options={[["", "— Automática —"], ["B2B", "B2B (a empresa)"], ["B2C", "B2C (a consumidor)"], ["B2G", "B2G (al Estado)"], ["B2F", "B2F (con el exterior)"]]} />
              </Campo>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={f.sifen_extranjero} onChange={(e) => set("sifen_extranjero", e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[var(--brand)]" />
              Receptor extranjero
            </label>
            {f.sifen_extranjero ? (
              <Campo label="País (código ISO de 3 letras)">
                <input value={f.sifen_pais_iso3} onChange={(e) => set("sifen_pais_iso3", e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                  placeholder="Ej. ARG" maxLength={3} className={`${INPUT} uppercase`} />
              </Campo>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Tipo de documento">
                <Select value={f.sifen_tipo_documento} onChange={(v) => set("sifen_tipo_documento", v)} block
                  options={[["", "— Según naturaleza —"], ["cedula", "Cédula paraguaya"], ["pasaporte", "Pasaporte"], ["carnet_extranjero", "Cédula / carnet extranjero"], ["otro", "Otro"]]} />
              </Campo>
              <Campo label="Número de documento"><input {...inp("sifen_num_id")} maxLength={40} placeholder="Si está vacío, se usa el del cliente" className={INPUT} /></Campo>
              <Campo label="Dirección"><input {...inp("sifen_direccion")} maxLength={200} placeholder="Si está vacía, se usa la del cliente" className={INPUT} /></Campo>
              <Campo label="Número de casa"><input {...inp("sifen_numero_casa")} maxLength={20} placeholder="0 si no tiene" className={INPUT} /></Campo>
            </div>
            {errorPais || avisoB2F ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
                <div className="mb-1 font-semibold">Combinación inválida para SIFEN</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {errorPais ? <li>{errorPais}</li> : null}
                  {avisoB2F ? <li>{avisoB2F}</li> : null}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      </section>

      {/* Comercial */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle>Datos comerciales</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Condición de pago">
            <Select value={f.condicion_pago} onChange={(v) => set("condicion_pago", v as Form["condicion_pago"])} block options={[["CONTADO", "Contado"], ["CREDITO", "Crédito (cuenta corriente)"]]} />
          </Campo>
          <Campo label={`Valor anual estimado (${f.moneda_preferida === "USD" ? "US$" : "Gs."})`}>
            <MontoInput value={f.valor_anual || ""} onChange={(n) => set("valor_anual", n)} decimals={f.moneda_preferida === "USD"} className={`${INPUT} text-right tabular-nums`} />
          </Campo>
        </div>
        {f.condicion_pago === "CREDITO" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Campo label="Plazo para pagar (días)">
              <input inputMode="numeric" value={f.plazo_dias} onChange={(e) => set("plazo_dias", e.target.value.replace(/\D/g, "").slice(0, 4))} className={`${INPUT} text-right tabular-nums`} />
            </Campo>
            <Campo label="Límite de crédito (Gs.)">
              <MontoInput value={f.limite_credito || ""} onChange={(n) => set("limite_credito", n)} decimals={false} placeholder="Sin límite" className={`${INPUT} text-right tabular-nums`} />
              <span className="mt-1 block text-[11px] text-slate-400">La caja no deja vender a crédito por encima de esto.</span>
            </Campo>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Moneda">
            <Select value={f.moneda_preferida} onChange={(v) => set("moneda_preferida", v as Form["moneda_preferida"])} block options={[["GS", "Guaraníes (Gs.)"], ["USD", "Dólares (US$)"]]} />
          </Campo>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Vendedor responsable (usuario del sistema)</span>
            <Select value={f.vendedor_usuario_id} onChange={(v) => set("vendedor_usuario_id", v)} block
              options={[["", "— Sin asignar —"], ...(usuarios ?? []).map((u) => [u.id, u.nombre] as [string, string])]} />
            {errorUsuarios ? <p className="mt-1 text-xs text-rose-600">{errorUsuarios}</p>
              : usuarios && usuarios.length === 0 ? <p className="mt-1 text-xs text-slate-500">No hay usuarios activos para asignar.</p> : null}
          </div>
          <Campo label="Vendedor asignado (texto libre)"><input {...inp("vendedor_texto")} maxLength={120} className={INPUT} /></Campo>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL}>Estado</span>
            <Select value={f.activo ? "activo" : "inactivo"} onChange={(v) => set("activo", v === "activo")} block options={[["activo", "Activo"], ["inactivo", "Inactivo"]]} />
            {cliente.baja_at && f.activo ? <p className="mt-1 text-[11px] text-amber-700">Al guardar se levanta la baja y vuelve a ser cliente activo.</p> : null}
          </div>
        </div>
      </section>

      {/* Digital */}
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <SectionTitle>Presencia digital</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Sitio web"><input {...inp("sitio_web")} maxLength={200} placeholder="https://" className={INPUT} /></Campo>
          <Campo label="Instagram"><input {...inp("instagram")} maxLength={120} placeholder="@usuario" className={INPUT} /></Campo>
          <Campo label="LinkedIn"><input {...inp("linkedin")} maxLength={200} placeholder="URL o perfil" className={INPUT} /></Campo>
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>⚠</span><span className="font-medium">{error}</span>
        </div>
      ) : null}
            </form>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4">
              <button type="button" onClick={() => setAbierto(false)} disabled={busy}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#4FAEB2]/60 hover:text-[#4FAEB2] disabled:opacity-50">
                Cancelar
              </button>
              <button type="submit" form="cli-info-form" disabled={busy}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition hover:brightness-95 disabled:opacity-50"
                style={{ backgroundColor: TEAL }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </CapaModal>
      ) : null}
    </div>
  );
}

function Tarjeta({ titulo, icono: Icono, children }: { titulo: string; icono: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-3.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4FAEB2]/12 text-[#3F8E91]"><Icono className="h-3.5 w-3.5" /></span>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">{titulo}</h3>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 px-5 py-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Dato({ label, children, ancho = false, mono = false }: { label: string; children: React.ReactNode; ancho?: boolean; mono?: boolean }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${vacio ? "text-slate-300" : "font-medium text-slate-800"} ${mono && !vacio ? "font-mono" : ""}`}>{vacio ? "—" : children}</dd>
    </div>
  );
}
