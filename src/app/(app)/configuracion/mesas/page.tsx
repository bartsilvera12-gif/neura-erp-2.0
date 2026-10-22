"use client";

/**
 * /configuracion/mesas — Configuración › Mesas y QR (receta 68). Nivel ADMIN + "Configuración
 * del sistema".
 *   · Mesas por sucursal (nombre, zona, orden, activa). Alta / edición en un modal; eliminar solo
 *     si nunca tuvo pedidos (si no, desactivarla).
 *   · QR de cada mesa (se genera en el navegador con `qrcode`): ver, copiar el link, abrir el menú,
 *     imprimir, y regenerar el token (el QR impreso viejo deja de andar).
 *   · "Imprimir QR": una hoja con el QR + nombre de cada mesa (de la sucursal elegida).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Copy, ExternalLink, Loader2, Pencil, Plus, Printer, QrCode, RefreshCw, Trash2, X } from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante, invalidar } from "@/lib/api/cache-cliente";
import { clienteConfig } from "@/cliente.config";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { linkMesa, type Mesa, type MesasConfig } from "@/modules/mesas/tipos";

const URL_MESAS = "/api/mesas";
const COLOR = clienteConfig.color;

const svgQr = (texto: string) => QRCode.toString(texto, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } });

export default function MesasConfigPage() {
  const [datos, setDatos] = useState<MesasConfig | null>(() => guardadoAlInstante<MesasConfig>(URL_MESAS) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetchSWR<MesasConfig>(URL_MESAS, (d) => { setDatos(d); setError(null); }, { fresco: recarga > 0, signal: ctrl.signal })
      .catch((e) => { if (!ctrl.signal.aborted) setError((e as Error).message); });
    return () => ctrl.abort();
  }, [recarga]);
  const refrescar = useCallback(() => { invalidar(URL_MESAS); setRecarga((k) => k + 1); }, []);

  const [suc, setSuc] = useState<string>("");
  const sucursales = datos?.sucursales ?? [];
  const mesas = useMemo(() => (datos?.mesas ?? []).filter((m) => !suc || m.sucursal_id === suc), [datos, suc]);
  const variasSucursales = sucursales.length > 1;

  const [editar, setEditar] = useState<Mesa | "nueva" | null>(null);
  const [verQr, setVerQr] = useState<Mesa | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [imprimiendo, setImprimiendo] = useState(false);

  async function imprimir(lista: Mesa[]) {
    const activas = lista.filter((m) => m.activa);
    if (!activas.length) { setAviso("No hay mesas activas para imprimir."); return; }
    // La ventana se abre YA (dentro del click) para que el navegador no la bloquee.
    const w = window.open("", "_blank");
    if (!w) { setAviso("El navegador bloqueó la ventana de impresión: permití las ventanas emergentes para este sitio."); return; }
    setImprimiendo(true);
    try {
      const qrs = await Promise.all(activas.map((m) => svgQr(linkMesa(m.token))));
      w.document.open();
      w.document.write(hojaQr(datos?.empresa ?? clienteConfig.nombre, activas, qrs));
      w.document.close();
    } catch {
      w.close();
      setAviso("No se pudieron generar los QR.");
    } finally {
      setImprimiendo(false);
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <EncabezadoPagina
        volver={{ href: "/configuracion", label: "Configuración" }}
        kicker="Configuración"
        titulo="Mesas y QR"
        subtitulo="Cada mesa tiene un QR que abre el menú en el celular del cliente. Los pedidos llegan a Caja › Pedidos de mesas."
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void imprimir(mesas)} disabled={imprimiendo || !mesas.length} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`}>
              {imprimiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" aria-hidden />} Imprimir QR
            </button>
            <button type="button" onClick={() => setEditar("nueva")} disabled={!sucursales.length} className={`${BOTON_PRIMARIO} min-h-11 lg:min-h-0`} style={{ backgroundColor: COLOR }}>
              <Plus className="h-4 w-4" aria-hidden /> Nueva mesa
            </button>
          </div>
        }
      />

      {variasSucursales ? (
        <div className="max-w-xs">
          <Select block etiqueta="Sucursal" value={suc} onChange={setSuc} options={[["", "Todas las sucursales"], ...sucursales.map((s) => [s.id, s.nombre] as [string, string])]} />
        </div>
      ) : null}
      {aviso ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{aviso}</p> : null}
      {error && !datos ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {!datos ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
      ) : mesas.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
          <QrCode className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
          <p className="mt-3 text-sm font-medium text-slate-700">Todavía no hay mesas{suc ? " en esta sucursal" : ""}.</p>
          <p className="mt-1 text-sm text-slate-500">Creá una mesa e imprimí su QR. Los productos del menú se eligen en Inventario con el tilde “En el menú QR”.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {mesas.map((m) => (
            <li key={m.id} className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm ${m.activa ? "border-slate-200" : "border-dashed border-slate-300 opacity-70"}`}>
              <button type="button" onClick={() => setVerQr(m)} aria-label={`Ver el QR de ${m.nombre}`} className="shrink-0 rounded-xl border border-slate-200 p-1 transition hover:border-[var(--brand)]">
                <QrMini texto={linkMesa(m.token)} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-slate-900">{m.nombre}</p>
                <p className="truncate text-xs text-slate-500">{[m.zona, variasSucursales ? m.sucursal_nombre : null].filter(Boolean).join(" · ") || "Sin zona"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {!m.activa ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactiva</span> : null}
                  {m.cuenta_abierta ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Cuenta abierta</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button type="button" onClick={() => setVerQr(m)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Ver QR"><QrCode className="h-4 w-4" /></button>
                <button type="button" onClick={() => setEditar(m)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Editar mesa"><Pencil className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editar ? (
        <EditarMesa
          mesa={editar === "nueva" ? null : editar}
          sucursales={sucursales}
          sucursalInicial={suc || sucursales[0]?.id || ""}
          onClose={() => setEditar(null)}
          onGuardada={() => { setEditar(null); refrescar(); }}
        />
      ) : null}
      {verQr ? (
        <VerQr
          mesa={datos?.mesas.find((m) => m.id === verQr.id) ?? verQr}
          empresa={datos?.empresa ?? clienteConfig.nombre}
          onClose={() => setVerQr(null)}
          onImprimir={(m) => void imprimir([m])}
          onCambio={refrescar}
        />
      ) : null}
    </div>
  );
}

function QrMini({ texto }: { texto: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => { let vivo = true; svgQr(texto).then((s) => { if (vivo) setSvg(s); }).catch(() => {}); return () => { vivo = false; }; }, [texto]);
  return svg ? <span className="block h-16 w-16 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="block h-16 w-16 animate-pulse rounded bg-slate-100" />;
}

function EditarMesa({ mesa, sucursales, sucursalInicial, onClose, onGuardada }: {
  mesa: Mesa | null;
  sucursales: { id: string; nombre: string }[];
  sucursalInicial: string;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [f, setF] = useState({
    sucursal_id: mesa?.sucursal_id ?? sucursalInicial,
    nombre: mesa?.nombre ?? "",
    zona: mesa?.zona ?? "",
    orden: String(mesa?.orden ?? 0),
    activa: mesa?.activa ?? true,
  });
  const [busy, setBusy] = useState<"" | "guardar" | "eliminar">("");
  const [error, setError] = useState<string | null>(null);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !f.nombre.trim()) return;
    setBusy("guardar");
    setError(null);
    try {
      await apiFetch(URL_MESAS, {
        method: "POST",
        body: JSON.stringify({ id: mesa?.id ?? null, sucursal_id: f.sucursal_id, nombre: f.nombre.trim(), zona: f.zona.trim() || null, orden: Number(f.orden) || 0, activa: f.activa }),
      });
      onGuardada();
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }
  async function eliminar() {
    if (!mesa || busy) return;
    setBusy("eliminar");
    setError(null);
    try {
      await apiFetch(`${URL_MESAS}/${mesa.id}`, { method: "DELETE" });
      onGuardada();
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
      setConfirmarBorrar(false);
    }
  }

  return (
    <CapaModal onClose={busy ? undefined : onClose}>
      <form onSubmit={guardar} className={`flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{mesa ? `Editar ${mesa.nombre}` : "Nueva mesa"}</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={!!busy} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {sucursales.length > 1 ? (
            <div>
              <span className={ET}>Sucursal *</span>
              <Select block etiqueta="Sucursal" value={f.sucursal_id} onChange={(v) => setF({ ...f, sucursal_id: v })} options={sucursales.map((s) => [s.id, s.nombre] as [string, string])} />
            </div>
          ) : null}
          <label className="block">
            <span className={ET}>Nombre *</span>
            <input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={60} placeholder="Ej.: Mesa 1, Barra, Terraza 3" className={INPUT} />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <label className="block">
              <span className={ET}>Zona <span className="font-normal text-slate-400">(opcional)</span></span>
              <input value={f.zona} onChange={(e) => setF({ ...f, zona: e.target.value })} maxLength={60} placeholder="Ej.: Salón, Patio" className={INPUT} />
            </label>
            <label className="block">
              <span className={ET}>Orden</span>
              <input value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" className={INPUT} />
            </label>
          </div>
          <button type="button" role="switch" aria-checked={f.activa} onClick={() => setF({ ...f, activa: !f.activa })}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:bg-slate-50">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">Recibe pedidos por QR</span>
              <span className="block text-[11px] text-slate-400">Inactiva: el QR muestra que la mesa no toma pedidos.</span>
            </span>
            <span className="relative h-5 w-9 shrink-0 rounded-full transition-colors" style={{ backgroundColor: f.activa ? COLOR : "#cbd5e1" }}>
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: f.activa ? 18 : 2 }} />
            </span>
          </button>
          {mesa ? (
            confirmarBorrar ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                <p>¿Eliminar {mesa.nombre}? Si ya tuvo pedidos no se puede: desactivala.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmarBorrar(false)} className={`${BOTON_SECUNDARIO} flex-1`}>No</button>
                  <button type="button" onClick={() => void eliminar()} disabled={!!busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white">
                    {busy === "eliminar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Eliminar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmarBorrar(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600">
                <Trash2 className="h-4 w-4" aria-hidden /> Eliminar mesa
              </button>
            )
          ) : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={!!busy} className={`${BOTON_SECUNDARIO} flex-1`}>Cancelar</button>
          <button type="submit" disabled={!!busy || !f.nombre.trim() || !f.sucursal_id} className={`${BOTON_PRIMARIO} flex-1`} style={{ backgroundColor: COLOR }}>
            {busy === "guardar" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </button>
        </div>
      </form>
    </CapaModal>
  );
}

function VerQr({ mesa, empresa, onClose, onImprimir, onCambio }: {
  mesa: Mesa; empresa: string; onClose: () => void; onImprimir: (m: Mesa) => void; onCambio: () => void;
}) {
  const [token, setToken] = useState(mesa.token);
  const link = linkMesa(token);
  const [svg, setSvg] = useState("");
  useEffect(() => { let vivo = true; svgQr(link).then((s) => { if (vivo) setSvg(s); }).catch(() => {}); return () => { vivo = false; }; }, [link]);
  const [copiado, setCopiado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sin portapapeles */ }
  }
  async function regenerar() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ token: string }>(`${URL_MESAS}/${mesa.id}`, { method: "POST", body: JSON.stringify({ accion: "token" }) });
      setToken(r.token);
      setConfirmar(false);
      onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CapaModal onClose={onClose}>
      <div className={`flex w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ${ALTO_MAX_MODAL}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">{mesa.nombre}</h3>
            <p className="truncate text-xs text-slate-500">{[mesa.zona, mesa.sucursal_nombre].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="mx-auto w-full max-w-[260px] rounded-2xl border border-slate-200 p-3">
            {svg ? <div className="aspect-square [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="aspect-square animate-pulse rounded bg-slate-100" />}
            <p className="mt-2 text-center text-sm font-semibold text-slate-900">{mesa.nombre}</p>
            <p className="text-center text-[11px] text-slate-500">{empresa} · Escaneá para pedir</p>
          </div>
          {!mesa.activa ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">La mesa está inactiva: el QR abre un aviso de que no toma pedidos.</p> : null}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-600">{link}</span>
            <button type="button" onClick={() => void copiar()} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--brand)]">
              <Copy className="h-3.5 w-3.5" aria-hidden /> {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a href={link} target="_blank" rel="noopener noreferrer" className={`${BOTON_SECUNDARIO} min-h-11 no-underline lg:min-h-0`}><ExternalLink className="h-4 w-4" aria-hidden /> Abrir menú</a>
            <button type="button" onClick={() => onImprimir({ ...mesa, token })} className={`${BOTON_SECUNDARIO} min-h-11 lg:min-h-0`}><Printer className="h-4 w-4" aria-hidden /> Imprimir</button>
          </div>
          {confirmar ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p>Se genera un QR nuevo y <strong>el impreso deja de andar</strong>. Útil si alguien se llevó el QR o pide desde afuera.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setConfirmar(false)} className={`${BOTON_SECUNDARIO} flex-1`}>Cancelar</button>
                <button type="button" onClick={() => void regenerar()} disabled={busy} className={`${BOTON_PRIMARIO} flex-1`} style={{ backgroundColor: COLOR }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Generar nuevo
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmar(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
              <RefreshCw className="h-4 w-4" aria-hidden /> Generar un QR nuevo
            </button>
          )}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p> : null}
        </div>
      </div>
    </CapaModal>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Hoja imprimible A4: una tarjeta por mesa (QR + nombre + "Escaneá para pedir"). */
function hojaQr(empresa: string, mesas: Mesa[], qrs: string[]): string {
  const tarjetas = mesas.map((m, i) => `
    <div class="t">
      <p class="e">${esc(empresa)}</p>
      <div class="q">${qrs[i]}</div>
      <p class="m">${esc(m.nombre)}</p>
      ${m.zona ? `<p class="z">${esc(m.zona)}</p>` : ""}
      <p class="c">Escaneá el código para ver el menú y pedir</p>
    </div>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR de mesas · ${esc(empresa)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }
  .g { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
  .t { border: 1.5px dashed #94a3b8; border-radius: 6mm; padding: 6mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .e { margin: 0 0 3mm; font-size: 11pt; font-weight: 600; color: #475569; }
  .q { width: 62mm; height: 62mm; margin: 0 auto; }
  .q svg { width: 100%; height: 100%; }
  .m { margin: 3mm 0 0; font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; }
  .z { margin: 1mm 0 0; font-size: 11pt; color: #475569; }
  .c { margin: 2mm 0 0; font-size: 10pt; color: #64748b; }
  .barra { padding: 12px; text-align: center; font-size: 14px; }
  .barra button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; }
  @media print { .barra { display: none; } }
</style></head><body>
<div class="barra"><button onclick="window.print()">Imprimir</button></div>
<div class="g">${tarjetas}</div>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 250); });</script>
</body></html>`;
}
