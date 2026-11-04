"use client";

/**
 * /sorteos/whatsapp — Bot de venta por WhatsApp (receta 125, Administrador).
 * A la izquierda: prender el bot, en qué canal atiende y el saludo. A la derecha: probarlo como si fuera
 * un cliente (canal simulador), incluso mandando un comprobante y, si el servidor no tiene el lector
 * automático, escribiendo lo que "diría" el comprobante para probar la confirmación sola.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, FileText, Loader2, MessageCircle, Paperclip, RefreshCw, ScanText, Send, UserRound } from "lucide-react";
import { apiFetch, apiForm } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { SelectorFecha } from "@/components/SelectorFecha";
import { BOTON, BOTON_PRIMARIO, Campo, CampoMonto, gs, INPUT, Interruptor, Tarjeta } from "@/modules/sorteos/ui";

type Config = {
  activo: boolean;
  canal_id: string | null;
  bienvenida: string | null;
  canales: { id: string; nombre: string; proveedor: string; activo: boolean }[];
  sorteos: { id: string; nombre: string; slug: string; confirmacion_auto: boolean; precio: number }[];
  lector: boolean;
};

type Mensaje = {
  id: string;
  from_me: boolean;
  tipo: string;
  contenido: string | null;
  media_url: string | null;
  media_mime: string | null;
  de_persona: boolean;
  created_at: string;
};
type Chat = { conversacion_id: string | null; paso: string | null; mensajes: Mensaje[]; respondio?: boolean };

const PASOS: Record<string, string> = {
  inicio: "Saludo", sorteo: "Eligiendo sorteo", cantidad: "Eligiendo cantidad", nombre: "Pidiendo el nombre", documento: "Pidiendo la cédula",
  ciudad: "Pidiendo la ciudad", confirmar: "Confirmando el pedido", pago: "Esperando el comprobante", revision: "Comprobante en revisión", humano: "Pasado a una persona",
};
const RAPIDAS = ["Hola", "1", "2", "MENU", "MIS NUMEROS", "CANCELAR", "ASESOR"];
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });

/** *negrita* de WhatsApp y links clickeables, sin HTML crudo. */
function TextoWa({ t }: { t: string }) {
  const partes = t.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b>
          : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline">{p}</a>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export default function SorteosWhatsappPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [activo, setActivo] = useState(false);
  const [canal, setCanal] = useState("");
  const [bienvenida, setBienvenida] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const [telefono, setTelefono] = useState("0981 000 111");
  const [nombre, setNombre] = useState("Cliente de prueba");
  const [chat, setChat] = useState<Chat | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorChat, setErrorChat] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const [simular, setSimular] = useState(false);
  const [lecMonto, setLecMonto] = useState(0);
  const [lecFecha, setLecFecha] = useState(hoy());
  const [lecRef, setLecRef] = useState("");
  const [lecCuenta, setLecCuenta] = useState("");
  const [lecTitular, setLecTitular] = useState("");
  const [lecEsComprobante, setLecEsComprobante] = useState(true);

  const aplicarCfg = (c: Config) => {
    setCfg(c);
    setActivo(c.activo);
    setCanal(c.canal_id ?? "");
    setBienvenida(c.bienvenida ?? "");
    if (!c.lector) setSimular(true);
  };

  useEffect(() => {
    apiFetch<Config>("/api/sorteos/whatsapp").then(aplicarCfg).catch((e) => setAviso({ ok: false, texto: (e as Error).message }));
  }, []);

  const guardar = async () => {
    setGuardando(true);
    setAviso(null);
    try {
      const c = await apiFetch<Config>("/api/sorteos/whatsapp", {
        method: "PUT",
        body: JSON.stringify({ activo, canal_id: canal || null, bienvenida: bienvenida.trim() || null }),
      });
      aplicarCfg(c);
      setAviso({ ok: true, texto: c.activo ? "Listo: el bot atiende los chats de WhatsApp." : "Listo: el bot quedó apagado." });
    } catch (e) {
      setAviso({ ok: false, texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  const cargarChat = useCallback(async () => {
    setErrorChat(null);
    if (telefono.replace(/\D/g, "").length < 8) return;
    try {
      setChat(await apiFetch<Chat>(`/api/sorteos/whatsapp/simular?telefono=${encodeURIComponent(telefono)}`));
    } catch (e) {
      setErrorChat((e as Error).message);
    }
  }, [telefono]);
  useEffect(() => { void cargarChat(); }, [cargarChat]);
  useEffect(() => { finRef.current?.scrollIntoView({ block: "end" }); }, [chat?.mensajes.length]);

  const mandar = async (contenido: string, archivo?: File) => {
    if (!contenido.trim() && !archivo) return;
    setEnviando(true);
    setErrorChat(null);
    const f = new FormData();
    f.set("telefono", telefono);
    f.set("nombre", nombre);
    if (contenido.trim()) f.set("texto", contenido.trim());
    if (archivo) {
      f.set("archivo", archivo);
      if (simular) {
        f.set("lectura", JSON.stringify({
          es_comprobante: lecEsComprobante, monto: lecMonto || null, moneda: "PYG", fecha: lecFecha || null, referencia: lecRef.trim() || null,
          banco_origen: null, titular_origen: nombre || null, cuenta_destino: lecCuenta.trim() || null, titular_destino: lecTitular.trim() || null,
          documento_destino: null, banco_destino: null,
        }));
      }
    }
    try {
      const r = await apiForm<Chat>("/api/sorteos/whatsapp/simular", f);
      setChat(r);
      setTexto("");
      if (archivo && simular) setLecRef(String(Math.floor(100000 + Math.random() * 900000)));
      if (!r.respondio) setErrorChat(cfg?.activo ? "El bot no contestó (una persona escribió en este chat hace poco, o lo pasaron a un asesor)." : "El bot está apagado: prendelo y guardá para que conteste.");
    } catch (e) {
      setErrorChat((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const nuevoCliente = () => {
    const n = String(Math.floor(1000000 + Math.random() * 8999999));
    setTelefono(`0981 ${n.slice(0, 3)} ${n.slice(3, 6)}`);
    setChat(null);
  };

  useEffect(() => { if (!lecRef) setLecRef(String(Math.floor(100000 + Math.random() * 900000))); }, [lecRef]);

  const canales = useMemo<[string, string][]>(
    () => [["", "Todos los WhatsApp de la empresa"], ...(cfg?.canales ?? []).map((c) => [c.id, `${c.nombre}${c.proveedor === "simulador" && !/simulador|prueba/i.test(c.nombre) ? " (prueba)" : ""}${c.activo ? "" : " · inactivo"}`] as [string, string])],
    [cfg],
  );

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Venta por WhatsApp"
        subtitulo="Un bot atiende los chats: ofrece el sorteo, toma los datos, reserva los números y lee el comprobante."
        volver={{ href: "/sorteos/panel", label: "Sorteos" }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="min-w-0 space-y-4">
          <Tarjeta icono={<Bot className="h-4 w-4" />} titulo="El bot" detalle="Si alguien de tu equipo escribe en un chat, o el cliente pide un asesor, el bot se calla 12 horas en ese chat.">
            {!cfg ? <div className="h-40 animate-pulse rounded-xl bg-slate-100" /> : (
              <div className="space-y-3">
                <Interruptor valor={activo} onChange={setActivo} label="Atender los chats de WhatsApp con el bot" ayuda="Apagado, los chats llegan a la bandeja como siempre." />
                <Select value={canal} onChange={setCanal} options={canales} block etiqueta="En qué WhatsApp atiende" />
                <Campo label="Saludo (opcional)" ayuda="Lo primero que lee el cliente. Si lo dejás vacío: «¡Hola! Gracias por escribirnos.»">
                  <textarea className={`${INPUT} min-h-[84px] py-2.5`} maxLength={1000} value={bienvenida} onChange={(e) => setBienvenida(e.target.value)}
                    placeholder="¡Hola! Gracias por escribir a Rifas del Sur 🎟️" />
                </Campo>
                {aviso ? <p className={`rounded-xl p-3 text-sm ${aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{aviso.texto}</p> : null}
                <div className="flex justify-end">
                  <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} disabled={guardando} onClick={() => void guardar()}>
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
                  </button>
                </div>
              </div>
            )}
          </Tarjeta>

          <Tarjeta icono={<ScanText className="h-4 w-4" />} titulo="Comprobantes" detalle="Qué pasa cuando el cliente manda la foto del comprobante.">
            <ul className="space-y-2 text-sm text-slate-600">
              <li className={`rounded-xl p-3 ${cfg?.lector ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
                {cfg?.lector
                  ? "La lectura automática está configurada: el sistema lee el monto, la fecha, la cuenta y el número de operación."
                  : "La lectura automática no está configurada en el servidor: los comprobantes quedan en «Por revisar» para que los confirme una persona."}
              </li>
              <li>Se confirma solo cuando el monto alcanza, la fecha es de estos días, la cuenta es una del sorteo y el número de operación no se usó, y el sorteo tiene prendido <b className="font-semibold">«Confirmar solo los comprobantes que se leen bien»</b>.</li>
              <li>Si algo no coincide queda en <b className="font-semibold">Por revisar</b> con el motivo. Al confirmarlo o rechazarlo, el cliente recibe el aviso en su chat.</li>
            </ul>
            {cfg?.sorteos.length ? (
              <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {cfg.sorteos.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                    <span className="min-w-0 font-medium text-slate-800">{s.nombre} <span className="font-normal text-slate-500">· {gs(s.precio)}</span></span>
                    <span className={`text-xs font-semibold ${s.confirmacion_auto ? "text-emerald-700" : "text-slate-500"}`}>{s.confirmacion_auto ? "Confirma solo" : "Revisión manual"}</span>
                  </div>
                ))}
              </div>
            ) : cfg ? <p className="mt-3 text-sm text-slate-500">No hay sorteos a la venta: el bot avisa que no hay sorteos por ahora.</p> : null}
          </Tarjeta>
        </div>

        <Tarjeta icono={<MessageCircle className="h-4 w-4" />} titulo="Probar el bot" detalle="Escribí como si fueras un cliente. Entra a la bandeja por el canal de prueba." className="min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Teléfono del cliente">
              <input className={INPUT} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} onBlur={() => void cargarChat()} />
            </Campo>
            <Campo label="Nombre en WhatsApp">
              <input className={INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Campo>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{chat?.paso ? <>Paso del bot: <b className="font-semibold text-slate-700">{PASOS[chat.paso] ?? chat.paso}</b></> : "Chat nuevo"}</span>
            <span className="flex gap-1.5">
              <button type="button" className={`${BOTON} !min-h-8 px-2.5 text-xs`} onClick={nuevoCliente}><UserRound className="h-3.5 w-3.5" /> Otro cliente</button>
              <button type="button" className={`${BOTON} !min-h-8 px-2.5 text-xs`} onClick={() => void cargarChat()} aria-label="Actualizar el chat"><RefreshCw className="h-3.5 w-3.5" /></button>
            </span>
          </div>

          <div className="mt-3 h-[min(58vh,520px)] overflow-y-auto rounded-2xl bg-[#efeae2] p-3">
            {!chat?.mensajes.length ? (
              <p className="mx-auto mt-10 max-w-[240px] rounded-xl bg-white/80 p-3 text-center text-xs text-slate-500">Mandá «Hola» para empezar la conversación.</p>
            ) : (
              <ul className="space-y-1.5">
                {chat.mensajes.map((m) => (
                  <li key={m.id} className={`flex ${m.from_me ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[13px] leading-snug shadow-sm ${m.from_me ? "bg-white text-slate-800" : "bg-[#d9fdd3] text-slate-900"}`}>
                      {m.from_me ? <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{m.de_persona ? "Persona del equipo" : "Bot"}</span> : null}
                      {m.media_url && m.media_mime?.startsWith("image/") ? (
                        <a href={m.media_url} target="_blank" rel="noopener noreferrer"><img src={m.media_url} alt="Comprobante enviado" className="mb-1 max-h-48 rounded-lg object-contain" /></a>
                      ) : m.media_url ? (
                        <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-1 text-sky-700 underline"><FileText className="h-4 w-4" /> PDF</a>
                      ) : null}
                      {m.contenido ? <TextoWa t={m.contenido} /> : null}
                      <span className="mt-0.5 block text-right text-[10px] text-slate-400">{new Date(m.created_at).toLocaleTimeString("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={finRef} />
          </div>

          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {RAPIDAS.map((r) => (
              <button key={r} type="button" disabled={enviando} onClick={() => void mandar(r)} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:opacity-50">{r}</button>
            ))}
          </div>

          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void mandar(texto); }}>
            <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void mandar(texto, f); }} />
            <button type="button" className={`${BOTON} shrink-0 px-3`} disabled={enviando} onClick={() => archivoRef.current?.click()} aria-label="Mandar la foto del comprobante" title="Mandar la foto del comprobante">
              <Paperclip className="h-4 w-4" />
            </button>
            <input className={INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribí un mensaje…" maxLength={4096} />
            <button type="submit" className={`${BOTON_PRIMARIO} shrink-0 px-3`} disabled={enviando || !texto.trim()} aria-label="Enviar">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          {errorChat ? <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">{errorChat}</p> : null}

          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <Interruptor valor={simular} onChange={setSimular} label="Simular lo que dice el comprobante"
              ayuda={cfg?.lector ? "Apagado, se lee la imagen de verdad." : "No hay lectura automática configurada: con esto probás la confirmación sola."} />
            {simular ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Campo label="Monto"><CampoMonto valor={lecMonto} onChange={setLecMonto} /></Campo>
                <SelectorFecha value={lecFecha} onChange={setLecFecha} block etiqueta="Fecha" placeholder="Elegí la fecha" />
                <Campo label="Nº de operación"><input className={INPUT} value={lecRef} onChange={(e) => setLecRef(e.target.value)} /></Campo>
                <Campo label="Cuenta de destino" ayuda="Alcanza con los últimos 4 números"><input className={INPUT} value={lecCuenta} onChange={(e) => setLecCuenta(e.target.value)} placeholder="****5678" /></Campo>
                <Campo label="Titular de destino" className="sm:col-span-2"><input className={INPUT} value={lecTitular} onChange={(e) => setLecTitular(e.target.value)} placeholder="Como figura en el comprobante" /></Campo>
                <div className="sm:col-span-2">
                  <Interruptor valor={lecEsComprobante} onChange={setLecEsComprobante} label="Es un comprobante de pago" ayuda="Apagalo para probar qué pasa si mandan otra foto." />
                </div>
              </div>
            ) : null}
            <p className="text-[11px] text-slate-500">Para mandar el comprobante tocá el clip <Paperclip className="inline h-3 w-3" /> y elegí cualquier foto o PDF.</p>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}
