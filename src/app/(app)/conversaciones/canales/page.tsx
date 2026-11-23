"use client";

/**
 * /conversaciones/canales — Canales de WhatsApp (solo ADMIN, receta 126). Conectar el número del cliente
 * por YCloud, por la API de Meta o por QR (como WhatsApp Web, con el puente Baileys): claves, datos
 * para pegar en el proveedor o en el puente, vincular con QR, probar la conexión y prenderlo.
 * Un canal nuevo nace apagado. El canal de prueba (simulador) no se toca acá.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, MessageCircle, Plug, Plus, Power, QrCode, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Modal } from "@/components/Modal";
import { BOTON, BOTON_PRIMARIO, Campo, INPUT } from "@/modules/rrhh/ui";

type Proveedor = "ycloud" | "meta" | "baileys";
type Puente = { url: string | null; entrada: string; secreto: string | null; canal_id: string; empresa_id: string };
type EstadoQr = { ok: true; conexion: "conectado" | "qr" | "desconectado"; qr: string | null; numero: string | null } | { ok: false; detalle: string };
type Canal = {
  id: string; nombre: string; proveedor: string; identificador: string | null; numero: string | null; activo: boolean;
  ultimo_evento_at: string | null; ultimo_error: string | null; ultimo_error_at: string | null;
  claves: Record<string, "canal" | "entorno" | null>; webhook: string | null; verify_token: string | null; puente: Puente | null;
};

const NOMBRE_PROVEEDOR: Record<string, string> = { ycloud: "YCloud", meta: "Meta (API oficial)", baileys: "WhatsApp por QR", simulador: "Prueba (simulador)" };
const CAMPOS: Record<Proveedor, { clave: string; label: string; ayuda: string; visible?: boolean }[]> = {
  baileys: [
    { clave: "bridge_url", label: "URL del puente", ayuda: "La dirección del puente de este número, ej. https://baileys-cliente.neura.com.py.", visible: true },
    { clave: "bridge_secret", label: "Secreto del puente", ayuda: "Opcional: si lo dejás vacío se genera uno, y después lo copiás al puente." },
  ],
  ycloud: [
    { clave: "api_key", label: "API key", ayuda: "YCloud › Developers › API Keys." },
    { clave: "webhook_secret", label: "Secreto del webhook", ayuda: "Lo da YCloud al crear el webhook (Developers › Webhooks)." },
  ],
  meta: [
    { clave: "access_token", label: "Token de acceso permanente", ayuda: "Del usuario del sistema en Meta Business, con permiso whatsapp_business_messaging." },
    { clave: "app_secret", label: "Clave secreta de la app", ayuda: "Meta for Developers › tu app › Configuración › Básica." },
  ],
};
const hace = (iso: string | null) => {
  if (!iso) return null;
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 1 ? "recién" : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
};

function Copiable({ label, valor }: { label: string; valor: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium text-slate-500">{label}</p>
      <div className="flex items-center gap-1 rounded-xl bg-slate-50 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 break-all text-xs text-slate-700">{valor}</code>
        <button type="button" aria-label={`Copiar ${label}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white"
          onClick={() => { void navigator.clipboard?.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500); }}>
          {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function FormCanal({ canal, onClose, onListo }: { canal: Canal | null; onClose: () => void; onListo: (c: Canal) => void }) {
  const [proveedor, setProveedor] = useState<Proveedor>((canal?.proveedor as Proveedor) ?? "ycloud");
  const [nombre, setNombre] = useState(canal?.nombre ?? "WhatsApp");
  const [identificador, setIdentificador] = useState(canal?.identificador ?? "");
  const [numero, setNumero] = useState(canal?.numero ?? "");
  const [claves, setClaves] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      onListo(await apiFetch<Canal>("/api/conversaciones/canales", {
        method: "POST",
        body: JSON.stringify({ id: canal?.id ?? null, nombre, proveedor, identificador, numero: numero || null, claves }),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal titulo={canal ? `Editar ${canal.nombre}` : "Conectar un WhatsApp"} onClose={() => !busy && onClose()} size="lg">
      <div className="space-y-4">
        {!canal ? (
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Proveedor">
            {(["ycloud", "meta", "baileys"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={proveedor === p} onClick={() => setProveedor(p)}
                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${proveedor === p ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]" : "border-slate-200 text-slate-700"}`}>
                {NOMBRE_PROVEEDOR[p]}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Nombre" ayuda="Para reconocerlo en la bandeja.">
            <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
          </Campo>
          <Campo label="Número que ve el cliente" ayuda="Opcional. Ej. 0981 123 456.">
            <input className={INPUT} value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" maxLength={30} />
          </Campo>
          <Campo className="sm:col-span-2" label={proveedor === "ycloud" ? "Número de WhatsApp Business" : proveedor === "baileys" ? "Número de WhatsApp que se va a vincular" : "Phone number ID"}
            ayuda={proveedor === "meta" ? "Meta for Developers › WhatsApp › Configuración de la API › Identificador del número de teléfono." : "Con código de país y sin el 0: 595981123456."}>
            {/* autoComplete: sin esto el navegador le mete el email guardado (y la contraseña en la clave de abajo). */}
            <input className={INPUT} name="canal-identificador" autoComplete="off" value={identificador} onChange={(e) => setIdentificador(e.target.value)} inputMode="numeric" maxLength={30} />
          </Campo>
          {CAMPOS[proveedor].map((c) => {
            const estado = canal?.claves?.[c.clave];
            return (
              <Campo key={c.clave} className="sm:col-span-2" label={c.label} ayuda={estado === "canal" ? (c.visible ? "Guardada. Dejalo vacío para no cambiarla." : "Guardado. Dejalo vacío para no cambiarlo.") : estado === "entorno" ? "La pone el servidor para toda la app." : c.ayuda}>
                <input className={INPUT} name={`canal-${c.clave}`} type={c.visible ? "url" : "password"} autoComplete={c.visible ? "off" : "new-password"} value={claves[c.clave] ?? ""}
                  placeholder={c.visible ? (canal?.puente?.url ?? "https://") : estado === "canal" ? "••••••••" : ""}
                  onChange={(e) => setClaves((x) => ({ ...x, [c.clave]: e.target.value }))} />
              </Campo>
            );
          })}
        </div>
        {proveedor === "baileys" ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Por QR el número se vincula como WhatsApp Web: sirve para atender uno a uno, sin plantillas ni campañas. Con envíos masivos WhatsApp puede bloquear el número.
          </p>
        ) : null}
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className={BOTON} onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className={BOTON_PRIMARIO} onClick={() => void guardar()}
            disabled={busy || nombre.trim().length < 2 || identificador.replace(/\D/g, "").length < 8 || (proveedor === "baileys" && !canal && !(claves.bridge_url ?? "").trim())}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** `qrcode` se carga recién cuando hace falta dibujar el QR (no va en el bundle inicial de la página). */
async function dibujarQr(texto: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(texto, { width: 560, margin: 2, errorCorrectionLevel: "L" });
}

/** Vincular el número: consulta el puente cada 3 s y muestra el QR hasta que el celular lo escanea. */
function ModalQr({ canal, onClose }: { canal: Canal; onClose: () => void }) {
  const [estado, setEstado] = useState<EstadoQr | null>(null);
  const [imagen, setImagen] = useState<{ qr: string; src: string } | null>(null);
  const qr = estado?.ok && estado.conexion === "qr" ? estado.qr : null;

  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout> | null = null;
    const consultar = async () => {
      try {
        const r = await apiFetch<EstadoQr>(`/api/conversaciones/canales/${canal.id}`, { method: "POST", body: JSON.stringify({ accion: "qr" }) });
        if (vivo) setEstado(r);
      } catch (e) {
        if (vivo) setEstado({ ok: false, detalle: (e as Error).message });
      }
      if (vivo) reloj = setTimeout(() => void consultar(), 3000);
    };
    void consultar();
    return () => {
      vivo = false;
      if (reloj) clearTimeout(reloj);
    };
  }, [canal.id]);

  useEffect(() => {
    if (!qr) return;
    let vivo = true;
    void dibujarQr(qr).then((src) => { if (vivo) setImagen({ qr, src }); });
    return () => { vivo = false; };
  }, [qr]);

  return (
    <Modal titulo={`Vincular ${canal.nombre}`} onClose={onClose} size="md">
      <div className="space-y-4">
        {!estado ? <div className="mx-auto h-64 w-64 animate-pulse rounded-2xl bg-slate-100" /> : null}
        {estado && !estado.ok ? <p className="flex gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><TriangleAlert className="h-4 w-4 shrink-0" /> {estado.detalle}</p> : null}
        {estado?.ok && estado.conexion === "conectado" ? (
          <p className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Número vinculado{estado.numero ? `: +${estado.numero}` : ""}. Ya podés cerrar esta ventana, probar la conexión y prender el canal.
          </p>
        ) : null}
        {estado?.ok && estado.conexion === "desconectado" ? (
          <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> El puente está reconectando con WhatsApp. En unos segundos aparece el QR o queda vinculado.</p>
        ) : null}
        {qr ? (
          <>
            {imagen?.qr === qr
              ? <img src={imagen.src} alt="Código QR para vincular el WhatsApp" className="mx-auto h-64 w-64 rounded-2xl border border-slate-200 bg-white" />
              : <div className="mx-auto h-64 w-64 animate-pulse rounded-2xl bg-slate-100" />}
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>En el celular del número, abrí WhatsApp.</li>
              <li>Entrá a Dispositivos vinculados y tocá Vincular un dispositivo.</li>
              <li>Escaneá este código. Se renueva solo cada pocos segundos.</li>
            </ol>
          </>
        ) : null}
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button type="button" className={BOTON} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </Modal>
  );
}

function TarjetaCanal({ c, onEditar, onCambio }: { c: Canal; onEditar: () => void; onCambio: (c: Canal) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<{ ok: boolean; detalle: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verQr, setVerQr] = useState(false);
  const real = c.proveedor !== "simulador";
  const faltan = Object.entries(c.claves ?? {}).filter(([, v]) => !v).map(([k]) => k);

  async function accion(a: "probar" | "prender" | "apagar") {
    setBusy(a);
    setError(null);
    try {
      const r = await apiFetch<Canal | { ok: boolean; detalle: string }>(`/api/conversaciones/canales/${c.id}`, { method: "POST", body: JSON.stringify({ accion: a }) });
      if (a === "probar") setPrueba(r as { ok: boolean; detalle: string });
      else onCambio(r as Canal);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-semibold text-slate-900"><MessageCircle className="h-4 w-4 text-emerald-600" /> {c.nombre}</p>
          <p className="text-xs text-slate-500">{NOMBRE_PROVEEDOR[c.proveedor] ?? c.proveedor}{c.numero ? ` · ${c.numero}` : c.identificador ? ` · ${c.identificador}` : ""}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${c.activo ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
          {c.activo ? "Prendido" : "Apagado"}
        </span>
      </div>

      {real ? (
        <>
          <p className="text-sm text-slate-600">
            {c.ultimo_evento_at ? <>Último aviso {c.puente ? "del puente" : "del proveedor"}: <b className="font-semibold text-slate-800">{hace(c.ultimo_evento_at)}</b></> : "Todavía no llegó ningún aviso de este número."}
          </p>
          {c.ultimo_error ? <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><TriangleAlert className="h-4 w-4 shrink-0" /> {c.ultimo_error} ({hace(c.ultimo_error_at)})</p> : null}
          {faltan.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Faltan claves: {faltan.join(", ")}. Tocá Editar.</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {c.webhook ? <Copiable label="URL del webhook (pegala en el proveedor)" valor={c.webhook} /> : null}
            {c.verify_token ? <Copiable label="Verify token (Meta › Webhooks)" valor={c.verify_token} /> : null}
          </div>
          {c.puente ? (
            <details className="rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Variables para el puente de este número</summary>
              <p className="mt-2 text-xs text-slate-500">Se cargan en la app del puente{c.puente.url ? <> (<span className="break-all">{c.puente.url}</span>)</> : null} y se vuelve a desplegar. El secreto es una clave: no lo compartas.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Copiable label="ERP_INBOUND_URL" valor={c.puente.entrada} />
                {c.puente.secreto ? <Copiable label="ERP_SHARED_SECRET" valor={c.puente.secreto} /> : null}
                <Copiable label="ERP_CHANNEL_ID" valor={c.puente.canal_id} />
                <Copiable label="ERP_EMPRESA_ID" valor={c.puente.empresa_id} />
              </div>
            </details>
          ) : null}
          {prueba ? (
            <p className={`flex gap-2 rounded-xl p-3 text-sm ${prueba.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
              {prueba.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />}
              {prueba.ok ? `Conexión correcta: ${prueba.detalle}` : prueba.detalle}
            </p>
          ) : null}
          {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BOTON} max-sm:flex-1`} onClick={onEditar}>Editar</button>
            {c.puente ? <button type="button" className={`${BOTON} max-sm:flex-1`} onClick={() => setVerQr(true)}><QrCode className="h-4 w-4" /> Vincular con QR</button> : null}
            <button type="button" className={`${BOTON} max-sm:flex-1`} disabled={!!busy} onClick={() => void accion("probar")}>
              {busy === "probar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />} Probar conexión
            </button>
            <button type="button" className={`${c.activo ? BOTON : BOTON_PRIMARIO} max-sm:w-full`} disabled={!!busy || (!c.activo && faltan.length > 0)} onClick={() => void accion(c.activo ? "apagar" : "prender")}>
              {busy === "prender" || busy === "apagar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} {c.activo ? "Apagar" : "Prender"}
            </button>
          </div>
        </>
      ) : <p className="text-sm text-slate-500">Canal de prueba: los mensajes se simulan desde la bandeja o desde Sorteos › WhatsApp.</p>}
      {verQr ? <ModalQr canal={c} onClose={() => setVerQr(false)} /> : null}
    </section>
  );
}

export default function CanalesWhatsappPage() {
  const [canales, setCanales] = useState<Canal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ canal: Canal | null } | null>(null);

  useEffect(() => {
    apiFetch<Canal[]>("/api/conversaciones/canales").then(setCanales).catch((e: Error) => setError(e.message));
  }, []);

  const poner = (c: Canal) => setCanales((l) => (l ? (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]) : [c]));

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Canales de WhatsApp"
        subtitulo="Conectá el número de la empresa por YCloud, por la API oficial de Meta o por QR. Un canal nuevo queda apagado hasta que lo pruebes y lo prendas."
        volver={{ href: "/omnicanal", label: "Omnicanal" }}
        acciones={<button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} onClick={() => setForm({ canal: null })}><Plus className="h-4 w-4" /> Conectar un WhatsApp</button>}
      />
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!canales && !error ? <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {canales ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {canales.map((c) => <TarjetaCanal key={c.id} c={c} onEditar={() => setForm({ canal: c })} onCambio={poner} />)}
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Cómo se conecta</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Tocá Conectar un WhatsApp, elegí el proveedor y cargá el número y las claves.</li>
          <li>Copiá la URL del webhook y pegala en el proveedor (en Meta, también el verify token). Suscribí los avisos de mensajes y de estados.</li>
          <li>Tocá Probar conexión. Si sale bien, tocá Prender.</li>
          <li>Mandá un mensaje al número desde otro celular: tiene que aparecer en la bandeja.</li>
        </ol>
        <h2 className="mt-4 text-sm font-semibold text-slate-900">WhatsApp por QR</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Hace falta un puente desplegado para ese número (uno por número). Tocá Conectar un WhatsApp › WhatsApp por QR y cargá el número y la URL del puente.</li>
          <li>Copiá las cuatro variables de la tarjeta a la app del puente y volvé a desplegarla.</li>
          <li>Tocá Vincular con QR y escanealo desde el celular (WhatsApp › Dispositivos vinculados).</li>
          <li>Tocá Probar conexión y después Prender. Por QR no hay plantillas ni ventana de 24 h.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">Para mandar el ticket a un cliente que escribió hace más de 24 h, la cuenta de WhatsApp tiene que tener aprobada la plantilla <code>sorteo_ticket</code> (5 variables: nombre, compra, sorteo, números y link).</p>
      </section>
      {form ? <FormCanal canal={form.canal} onClose={() => setForm(null)} onListo={(c) => { poner(c); setForm(null); }} /> : null}
    </div>
  );
}
