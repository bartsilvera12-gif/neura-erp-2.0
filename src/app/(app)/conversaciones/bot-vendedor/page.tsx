"use client";

/**
 * /conversaciones/bot-vendedor — Bot vendedor por WhatsApp (solo ADMIN, receta 172).
 * El cliente elige una categoría y el bot pasa a ser el vendedor de esa categoría: acá se carga cómo
 * vende cada "vendedor", qué categorías ofrece, la entrega, las formas de pago y las cuentas para
 * transferir. Los pedidos caen en Caja › Pedidos de WhatsApp.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { BOTON, BOTON_PRIMARIO, Campo, INPUT } from "@/modules/rrhh/ui";

type Cuenta = { banco: string | null; titular: string | null; cuenta: string | null; documento: string | null; alias: string | null };
type Config = {
  activo: boolean; canal_id: string | null; tienda: string | null; instrucciones: string | null;
  envio_activo: boolean; envio_texto: string | null; retiro_activo: boolean; retiro_texto: string | null;
  pago_al_recibir: boolean; pago_transferencia: boolean; cuentas: Cuenta[];
};
type Categoria = { id: string; nombre: string; bot_visible: boolean; bot_instrucciones: string | null; productos: number };
type Datos = { config: Config; categorias: Categoria[]; canales: { id: string; nombre: string; proveedor: string; activo: boolean }[]; ia_configurada: boolean };

const TEXTAREA = `${INPUT} min-h-24 resize-y py-2.5`;
const CUENTA_VACIA: Cuenta = { banco: null, titular: null, cuenta: null, documento: null, alias: null };

function Interruptor({ on, onChange, label, ayuda }: { on: boolean; onChange: (v: boolean) => void; label: string; ayuda?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
      <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--brand)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {ayuda ? <span className="block text-xs text-slate-500">{ayuda}</span> : null}
      </span>
    </label>
  );
}

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        {ayuda ? <p className="text-sm text-slate-500">{ayuda}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function BotVendedorPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [busy, setBusy] = useState(false);

  const cargar = (d: Datos) => {
    setDatos(d);
    setCfg({ ...d.config, cuentas: d.config.cuentas?.length ? d.config.cuentas : [] });
    setCats(d.categorias);
  };
  useEffect(() => {
    apiFetch<Datos>("/api/conversaciones/bot-vendedor").then(cargar).catch((e: Error) => setError(e.message));
  }, []);

  const cambios = useMemo(() => {
    if (!datos || !cfg) return false;
    return JSON.stringify({ c: datos.config, k: datos.categorias }) !== JSON.stringify({ c: cfg, k: cats });
  }, [datos, cfg, cats]);

  const poner = <K extends keyof Config>(k: K, v: Config[K]) => {
    setGuardado(false);
    setCfg((c) => (c ? { ...c, [k]: v } : c));
  };
  const ponerCat = (id: string, cambio: Partial<Categoria>) => {
    setGuardado(false);
    setCats((l) => l.map((c) => (c.id === id ? { ...c, ...cambio } : c)));
  };
  const ponerCuenta = (i: number, k: keyof Cuenta, v: string) =>
    poner("cuentas", (cfg?.cuentas ?? []).map((c, j) => (j === i ? { ...c, [k]: v || null } : c)));

  async function guardar() {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    try {
      cargar(await apiFetch<Datos>("/api/conversaciones/bot-vendedor", {
        method: "POST",
        body: JSON.stringify({ config: cfg, categorias: cats.map((c) => ({ id: c.id, bot_visible: c.bot_visible, bot_instrucciones: c.bot_instrucciones })) }),
      }));
      setGuardado(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visibles = cats.filter((c) => c.bot_visible).length;

  return (
    <div className="space-y-4 pb-6">
      <EncabezadoPagina
        titulo="Bot vendedor"
        subtitulo="El cliente elige una categoría por WhatsApp y el bot pasa a ser el vendedor de esa categoría: muestra productos con precio y stock, arma el carrito y toma el pedido."
        volver={{ href: "/omnicanal", label: "Omnicanal" }}
      />
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!cfg && !error ? <div className="h-64 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}
      {datos && cfg ? (
        <>
          {!datos.ia_configurada ? (
            <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <TriangleAlert className="h-4 w-4 shrink-0" /> Falta la clave de Claude en el servidor (variable ANTHROPIC_API_KEY): sin ella el bot no responde aunque esté prendido.
            </p>
          ) : null}

          <Seccion titulo="Estado">
            <Interruptor on={cfg.activo} onChange={(v) => poner("activo", v)} label="Bot prendido"
              ayuda="Atiende los chats nuevos. Si alguien del equipo escribe en un chat, el bot no se mete en ese chat por 12 horas, salvo que el chat se finalice: Finalizar se lo devuelve al bot. El cliente puede pedir hablar con una persona cuando quiera." />
            <Campo label="WhatsApp que atiende">
              <select className={INPUT} value={cfg.canal_id ?? ""} onChange={(e) => poner("canal_id", e.target.value || null)}>
                <option value="">Todos los WhatsApp de la empresa</option>
                {datos.canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? "" : " (apagado)"}</option>)}
              </select>
            </Campo>
          </Seccion>

          <Seccion titulo="La tienda" ayuda="Lo que el bot sabe de la tienda, valga para todas las categorías.">
            <Campo label="Nombre de la tienda">
              <input className={INPUT} value={cfg.tienda ?? ""} maxLength={120} onChange={(e) => poner("tienda", e.target.value || null)} />
            </Campo>
            <Campo label="Instrucciones generales" ayuda="Horarios, cómo saludar, promociones vigentes, qué no ofrecer. Escribilo como se lo dirías a un vendedor nuevo.">
              <textarea className={TEXTAREA} value={cfg.instrucciones ?? ""} maxLength={4000} onChange={(e) => poner("instrucciones", e.target.value || null)} />
            </Campo>
          </Seccion>

          <Seccion titulo={`Vendedores por categoría (${visibles} de ${cats.length})`}
            ayuda="Tildá las categorías que ofrece el bot. En cada una contale al vendedor cómo vende: qué preguntar, qué recomendar, talles, combos.">
            {!cats.length ? (
              <p className="text-sm text-slate-500">Todavía no hay categorías. Cargalas en <Link className="font-semibold text-[var(--brand)]" href="/inventario/categorias">Inventario › Categorías</Link> y asigná los productos.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {cats.map((c) => (
                  <div key={c.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" aria-label={`El bot ofrece ${c.nombre}`} className="h-5 w-5 accent-[var(--brand)]" checked={c.bot_visible} onChange={(e) => ponerCat(c.id, { bot_visible: e.target.checked })} />
                      <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 text-left" onClick={() => setAbierta(abierta === c.id ? null : c.id)} aria-expanded={abierta === c.id}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-800">{c.nombre}</span>
                          <span className="block text-xs text-slate-500">{c.productos} producto{c.productos === 1 ? "" : "s"}{c.bot_instrucciones ? " · con instrucciones" : ""}</span>
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${abierta === c.id ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                    {abierta === c.id ? (
                      <textarea className={`${TEXTAREA} mt-2`} maxLength={3000} value={c.bot_instrucciones ?? ""}
                        placeholder={`Ej.: Sos el vendedor de ${c.nombre}. Preguntá el talle y el color antes de recomendar. Si llevan 3, ofrecé el combo.`}
                        onChange={(e) => ponerCat(c.id, { bot_instrucciones: e.target.value || null })} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Seccion>

          <Seccion titulo="Entrega">
            <Interruptor on={cfg.envio_activo} onChange={(v) => poner("envio_activo", v)} label="Envío a domicilio" ayuda="El bot pide la dirección o la ubicación de WhatsApp." />
            {cfg.envio_activo ? (
              <Campo label="Costo y zonas de envío" ayuda="El bot lo dice tal cual; el envío no se suma al total del pedido.">
                <textarea className={TEXTAREA} maxLength={1000} value={cfg.envio_texto ?? ""} placeholder="Ej.: Asunción Gs 15.000, Gran Asunción Gs 25.000. Entregamos de lunes a sábado."
                  onChange={(e) => poner("envio_texto", e.target.value || null)} />
              </Campo>
            ) : null}
            <Interruptor on={cfg.retiro_activo} onChange={(v) => poner("retiro_activo", v)} label="Retiro en el local" />
            {cfg.retiro_activo ? (
              <Campo label="Dónde y cuándo se retira">
                <textarea className={TEXTAREA} maxLength={1000} value={cfg.retiro_texto ?? ""} placeholder="Ej.: Av. España 1234, de 8 a 18 h."
                  onChange={(e) => poner("retiro_texto", e.target.value || null)} />
              </Campo>
            ) : null}
          </Seccion>

          <Seccion titulo="Pago">
            <Interruptor on={cfg.pago_al_recibir} onChange={(v) => poner("pago_al_recibir", v)} label="Paga al recibir o al retirar" />
            <Interruptor on={cfg.pago_transferencia} onChange={(v) => poner("pago_transferencia", v)} label="Transferencia"
              ayuda="El bot pasa los datos de la cuenta y pide la foto del comprobante; queda en el pedido para que lo verifiques." />
            {cfg.pago_transferencia ? (
              <div className="space-y-3">
                {cfg.cuentas.map((c, i) => (
                  <div key={i} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                    {(["banco", "titular", "cuenta", "documento", "alias"] as const).map((k) => (
                      <Campo key={k} label={{ banco: "Banco o billetera", titular: "Titular", cuenta: "Número de cuenta", documento: "CI o RUC", alias: "Alias" }[k]}>
                        <input className={INPUT} value={c[k] ?? ""} maxLength={k === "titular" ? 120 : 80} onChange={(e) => ponerCuenta(i, k, e.target.value)} />
                      </Campo>
                    ))}
                    <button type="button" className={`${BOTON} self-end`} onClick={() => poner("cuentas", cfg.cuentas.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" /> Quitar cuenta
                    </button>
                  </div>
                ))}
                {cfg.cuentas.length < 6 ? (
                  <button type="button" className={BOTON} onClick={() => poner("cuentas", [...cfg.cuentas, { ...CUENTA_VACIA }])}><Plus className="h-4 w-4" /> Agregar cuenta</button>
                ) : null}
              </div>
            ) : null}
          </Seccion>

          <p className="text-sm text-slate-500">
            Los pedidos del bot llegan a <Link className="font-semibold text-[var(--brand)]" href="/caja/pedidos-whatsapp">Caja › Pedidos de WhatsApp</Link>. Para probarlo sin celular, usá Simular mensaje en Conversaciones.
          </p>

          <div className="pb-safe sticky bottom-0 z-20 -mx-1 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {guardado && !cambios ? <p className="text-sm font-semibold text-emerald-700 sm:mr-auto">Guardado</p> : null}
              {cambios ? <p className="text-sm text-slate-500 sm:mr-auto">Hay cambios sin guardar</p> : null}
              <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} disabled={busy || !cambios} onClick={() => void guardar()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Guardar
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
