"use client";

/**
 * La mesa en el celular del cliente (mobile-first). Inicio con la tarjeta de la mesa, el avance
 * de "Tus pedidos" y tarjetas grandes: Hacer pedido · Ver la carta · Ver consumo · Separar cuenta ·
 * Datos de facturación · Pedir la cuenta (receta 88). Cada una abre su pantalla con "Volver"
 * (y el botón atrás del celular, por el #hash).
 *   · Hacer pedido: categorías desplegables (todas cerradas; "Otros" al final; al buscar se abren
 *     las que tienen resultados), carrito con nota por producto y general, nombre opcional.
 *     Receta 73: un plato con modificadores abre una hoja; cada combinación es una línea propia.
 *   · Ver la carta: lo mismo para mirar (sin botones de agregar), con "Hacer pedido" abajo.
 *   · "Tus pedidos": estado de cada uno (cada 5 s mientras haya alguno en curso); los códigos de
 *     seguimiento se guardan en este celular (localStorage).
 *   · La cuenta (consumo, separar, facturación, pedir la cuenta) es de la MESA: la ven todos los
 *     celulares de la mesa (/api/publico/mesas/<token>/cuenta, cada 5 s).
 * Claro / oscuro: sigue al celular; el sol/luna de la cabecera lo cambia y queda guardado.
 * Precios y total los pone el servidor: lo que se ve acá es solo una vista previa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, BookOpen, CheckCircle2, ChefHat, ChevronDown, ChevronRight, Clock3, FileText, Loader2, MessageSquareText, Minus, Moon, Plus,
  Receipt, ReceiptText, Search, ShoppingBag, Split, Sun, Trash2, X, XCircle,
} from "lucide-react";
import { ALTO_MAX_MODAL, CapaModal } from "@/components/CapaModal";
import type { CuentaPublica, EstadoPedidoPublico, MenuMesa, ProductoMenu } from "@/modules/mesas/publico";
import { ESTADOS_PEDIDO, gs, haceCuanto, horaCorta } from "@/modules/mesas/tipos";
import { HojaModificadores, type ResultadoMods } from "@/modules/mesas/HojaModificadores";
import { ModsDetalle } from "@/modules/mesas/ModsDetalle";
import { modsParaEnviar, partesSel, tieneMods, type ModsSeleccion } from "@/modules/mesas/modificadores";
import { SinConsumo, VistaConsumo, VistaFacturacion, VistaSeparar, type AccionCuenta } from "./CuentaVistas";
import { AVISO_ERROR, AVISO_INFO, AVISO_OK, FONDO, INPUT, LINEA, PANEL_MODAL, SUAVE, TARJETA, TENUE, TEXTO } from "./estilos";

type Menu = Extract<MenuMesa, { activa: true }>;
/** Línea del carrito. Clave = `${producto_id}|${clave de modificadores}` (misma combinación = misma línea). */
type Linea = { producto_id: string; cantidad: number; nota: string; sel?: ModsSeleccion; precio_mods?: number };
const claveLinea = (id: string, clave = "") => `${id}|${clave}`;

const CLAVE = (token: string) => `neura.mesa.${token.slice(0, 16)}.pedidos`;
const CLAVE_TEMA = "neura.qr.tema";
const FINALES = new Set(["entregado", "rechazado"]);

type Vista = "inicio" | "pedir" | "carta" | "consumo" | "separar" | "facturacion";
const VISTAS: Vista[] = ["pedir", "carta", "consumo", "separar", "facturacion"];
const TITULOS: Record<Exclude<Vista, "inicio">, string> = {
  pedir: "Hacer pedido", carta: "La carta", consumo: "Consumo de la mesa", separar: "Separar cuenta", facturacion: "Datos de facturación",
};
const vistaDeHash = (): Vista => {
  const h = (typeof window !== "undefined" ? window.location.hash.slice(1) : "") as Vista;
  return VISTAS.includes(h) ? h : "inicio";
};

function leerSeguimientos(token: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE(token)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
}
function guardarSeguimientos(token: string, segs: string[]) {
  try {
    localStorage.setItem(CLAVE(token), JSON.stringify(segs.slice(-20)));
  } catch { /* sin storage: el estado se ve mientras la página siga abierta */ }
}

/** Tema del menú QR: data-tema en <html> (lo pone antes de pintar el script de page.tsx). */
function useTema() {
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  useEffect(() => {
    const raiz = document.documentElement;
    let guardado: string | null = null;
    try { guardado = localStorage.getItem(CLAVE_TEMA); } catch { /* sin storage */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const aplicar = (t: "claro" | "oscuro") => {
      raiz.setAttribute("data-tema", t);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "oscuro" ? "#020617" : "#ffffff");
      setTema(t);
    };
    aplicar(guardado === "oscuro" || guardado === "claro" ? guardado : mq.matches ? "oscuro" : "claro");
    const alCambiar = () => {
      let g: string | null = null;
      try { g = localStorage.getItem(CLAVE_TEMA); } catch { /* sin storage */ }
      if (!g) aplicar(mq.matches ? "oscuro" : "claro");
    };
    mq.addEventListener("change", alCambiar);
    return () => { mq.removeEventListener("change", alCambiar); raiz.removeAttribute("data-tema"); };
  }, []);
  const alternar = useCallback(() => {
    const t = tema === "oscuro" ? "claro" : "oscuro";
    document.documentElement.setAttribute("data-tema", t);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "oscuro" ? "#020617" : "#ffffff");
    try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* sin storage: vale mientras siga abierta */ }
    setTema(t);
  }, [tema]);
  return { tema, alternar };
}

export function MenuCliente({ token, menu, color, logoInstalacion }: { token: string; menu: Menu; color: string; logoInstalacion: string }) {
  const { tema, alternar: alternarTema } = useTema();
  const [vista, setVista] = useState<Vista>("inicio");
  const [carrito, setCarrito] = useState<Record<string, Linea>>({});
  const [verCarrito, setVerCarrito] = useState(false);
  const [q, setQ] = useState("");
  const [nota, setNota] = useState("");
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<number | null>(null);
  const [segs, setSegs] = useState<string[]>([]);
  const [pedidos, setPedidos] = useState<EstadoPedidoPublico[]>([]);
  const enviandoRef = useRef(false);
  // Hoja de modificadores: el plato y, si se está cambiando una línea, su clave.
  const [hoja, setHoja] = useState<{ p: ProductoMenu; editar?: string } | null>(null);

  // ── Navegación entre pantallas (#hash: el botón atrás del celular vuelve al inicio) ──
  useEffect(() => {
    setVista(vistaDeHash());
    const alVolver = () => setVista(vistaDeHash());
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, []);
  const ir = useCallback((v: Vista) => {
    const url = v === "inicio" ? window.location.pathname + window.location.search : `#${v}`;
    if (v !== "inicio" && vistaDeHash() === "inicio") window.history.pushState({ qr: 1 }, "", url);
    else window.history.replaceState(v === "inicio" ? null : { qr: 1 }, "", url);
    setVista(v);
    setQ("");
    setAvisoSeparar(null);
    window.scrollTo({ top: 0 });
  }, []);
  const volver = useCallback(() => {
    if (window.history.state?.qr) window.history.back();
    else ir("inicio");
  }, [ir]);

  const porId = useMemo(() => new Map(menu.productos.map((p) => [p.id, p])), [menu.productos]);
  const buscando = q.trim() !== "";
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!t) return menu.productos;
    return menu.productos.filter((p) =>
      `${p.nombre} ${p.descripcion ?? ""} ${p.categoria}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(t));
  }, [menu.productos, q]);
  // Grupos por categoría en el orden del servidor; "Otros" (sin categoría) siempre al final.
  const grupos = useMemo(() => {
    const m = new Map<string, ProductoMenu[]>();
    for (const p of filtrados) m.set(p.categoria, [...(m.get(p.categoria) ?? []), p]);
    return [...m.entries()].sort((a, b) => Number(a[0] === "Otros") - Number(b[0] === "Otros"));
  }, [filtrados]);
  // Acordeón: todas las categorías arrancan cerradas (pedido del dueño).
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const alternar = (c: string) => setAbiertas((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  const lineas = Object.entries(carrito).filter(([, l]) => l.cantidad > 0 && porId.has(l.producto_id));
  const unidades = lineas.reduce((a, [, l]) => a + l.cantidad, 0);
  const total = lineas.reduce((a, [, l]) => a + l.cantidad * ((porId.get(l.producto_id)?.precio ?? 0) + (l.precio_mods ?? 0)), 0);
  /** Unidades de un plato en el pedido (sumando todas sus combinaciones). */
  const cantidadDe = (id: string) => lineas.reduce((a, [, l]) => a + (l.producto_id === id ? l.cantidad : 0), 0);

  const cambiar = (clave: string, delta: number, productoId?: string) =>
    setCarrito((c) => {
      const actual = c[clave]?.cantidad ?? 0;
      const n = Math.max(0, Math.min(50, actual + delta));
      const sig = { ...c };
      if (n === 0) delete sig[clave];
      else sig[clave] = { ...(c[clave] ?? { producto_id: productoId ?? clave.split("|")[0], nota: "" }), cantidad: n };
      return sig;
    });
  const notaLinea = (clave: string, v: string) => setCarrito((c) => (c[clave] ? { ...c, [clave]: { ...c[clave], nota: v.slice(0, 200) } } : c));
  function confirmarHoja(p: ProductoMenu, r: ResultadoMods, editar?: string) {
    setCarrito((c) => {
      const sig = { ...c };
      const previa = editar ? sig[editar] : undefined;
      if (editar) delete sig[editar];
      const k = claveLinea(p.id, r.clave);
      const ya = sig[k];
      sig[k] = {
        producto_id: p.id,
        cantidad: Math.min(50, (ya?.cantidad ?? 0) + r.cantidad),
        nota: r.nota || ya?.nota || previa?.nota || "",
        sel: r.sel,
        precio_mods: r.precio_mods,
      };
      return sig;
    });
    setHoja(null);
  }

  // ── La cuenta de la mesa (receta 88): consumo, división, facturación, "pedí la cuenta" ──
  const [cuenta, setCuenta] = useState<CuentaPublica | null>(null);
  const [cuentaCerrada, setCuentaCerrada] = useState(false);
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [avisoSeparar, setAvisoSeparar] = useState<string | null>(null);
  const abiertaAntes = useRef(false);
  const recibirCuenta = useCallback((c: CuentaPublica) => {
    setCuenta(c);
    if (c.abierta) { abiertaAntes.current = true; setCuentaCerrada(false); }
    else if (abiertaAntes.current) { abiertaAntes.current = false; setCuentaCerrada(true); }
  }, []);
  const cargarCuenta = useCallback(async () => {
    try {
      const r = await fetch(`/api/publico/mesas/${token}/cuenta`, { cache: "no-store" });
      const b = await r.json().catch(() => null);
      if (r.ok && b?.ok) recibirCuenta(b.data as CuentaPublica);
    } catch { /* sin red: se reintenta en el próximo ciclo */ }
  }, [token, recibirCuenta]);
  const accion: AccionCuenta = useCallback(async <T,>(body: Record<string, unknown>) => {
    const r = await fetch(`/api/publico/mesas/${token}/cuenta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await r.json().catch(() => null);
    if (!r.ok || !b?.ok) throw new Error(b?.error?.message || "No se pudo guardar. Probá de nuevo.");
    return b.data as T;
  }, [token]) as AccionCuenta;
  const abierta = cuenta?.abierta ? cuenta : null;
  const cuentaRef = useRef(abierta);
  cuentaRef.current = abierta;
  useEffect(() => {
    void cargarCuenta();
    let n = 0;
    const id = setInterval(() => {
      n++;
      // Con cuenta abierta cada 5 s; sin cuenta, cada 15 s.
      if (document.visibilityState === "visible" && (cuentaRef.current || n % 3 === 0)) void cargarCuenta();
    }, 5000);
    const alVolver = () => { if (document.visibilityState === "visible") void cargarCuenta(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [cargarCuenta]);

  async function pedirCuenta(pedir: boolean) {
    setPidiendo(true);
    setErrorCuenta(null);
    try {
      recibirCuenta(await accion({ accion: "pedir_cuenta", pedir }));
    } catch (e) {
      setErrorCuenta((e as Error).message);
    } finally {
      setPidiendo(false);
    }
  }

  // ── Estado de mis pedidos (polling cada 5 s mientras haya alguno en curso) ──
  useEffect(() => { setSegs(leerSeguimientos(token)); }, [token]);
  const consultar = useCallback(async (lista: string[]) => {
    if (!lista.length) { setPedidos([]); return; }
    try {
      const r = await fetch(`/api/publico/mesas/${token}/estado`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seguimientos: lista }), cache: "no-store",
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) return;
      const data = b.data as EstadoPedidoPublico[];
      const vigentes = data.filter((p) => !p.cuenta_cerrada);
      setPedidos(vigentes);
      const siguen = new Set(vigentes.map((p) => p.seguimiento));
      if (lista.some((s) => !siguen.has(s))) {
        setSegs((cur) => {
          const nuevos = cur.filter((s) => !lista.includes(s) || siguen.has(s));
          guardarSeguimientos(token, nuevos);
          return nuevos;
        });
      }
    } catch { /* sin red: se reintenta en el próximo ciclo */ }
  }, [token]);
  const enCurso = pedidos.some((p) => !FINALES.has(p.estado) || !p.cuenta_cerrada) || (segs.length > 0 && pedidos.length === 0);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const enCursoRef = useRef(enCurso);
  enCursoRef.current = enCurso;
  useEffect(() => { void consultar(segs); }, [segs, consultar]);
  const hayQueSeguir = segs.length > 0;
  useEffect(() => {
    if (!hayQueSeguir) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && enCursoRef.current) void consultar(segsRef.current);
    }, 5000);
    return () => clearInterval(id);
  }, [hayQueSeguir, consultar]);

  async function enviar() {
    if (enviandoRef.current || !lineas.length) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`/api/publico/mesas/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lineas.map(([, l]) => ({ producto_id: l.producto_id, cantidad: l.cantidad, nota: l.nota.trim() || null, mods: modsParaEnviar(l.sel) })),
          nota: nota.trim() || null,
          nombre: nombre.trim() || null,
        }),
      });
      const b = await r.json().catch(() => null);
      if (!r.ok || !b?.ok) throw new Error(b?.error?.message || "No se pudo enviar el pedido. Probá de nuevo.");
      const ped = b.data as { seguimiento: string; numero: number; total: number };
      const nuevos = [...segs.filter((s) => s !== ped.seguimiento), ped.seguimiento];
      guardarSeguimientos(token, nuevos);
      setSegs(nuevos);
      setCarrito({});
      setNota("");
      setVerCarrito(false);
      setEnviado(ped.numero);
      setCuentaCerrada(false);
      ir("inicio");
      void cargarCuenta();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const subtitulo = [menu.zona, menu.sucursal].filter(Boolean).join(" · ");
  const conBarraCarrito = unidades > 0 && (vista === "inicio" || vista === "pedir");
  const soloVer = vista === "carta";
  const ahora = cuenta ? Date.parse(cuenta.ahora) : Date.now();
  const nPartes = abierta?.division?.partes.filter((p) => !p.es_resto).length ?? 0;
  const nFact = abierta ? (abierta.facturacion ? 1 : 0) + (abierta.division?.partes.filter((p) => p.facturacion).length ?? 0) : 0;
  const pedidosVivos = pedidos.filter((p) => p.estado !== "entregado");

  return (
    <div className={`min-h-dvh ${FONDO} ${conBarraCarrito || soloVer ? "pb-[calc(6rem+env(safe-area-inset-bottom))]" : "pb-[calc(2rem+env(safe-area-inset-bottom))]"}`} style={{ ["--brand" as string]: color }}>
      {/* Cabecera */}
      <header className="pt-safe bg-white dark:bg-slate-900">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 pt-3 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={menu.logo_url || logoInstalacion} alt="" className="h-9 w-auto max-w-[120px] shrink-0 object-contain dark:rounded-md dark:bg-white dark:px-1" />
          <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${TEXTO}`}>{menu.empresa}</p>
          <button type="button" onClick={alternarTema} aria-label={tema === "oscuro" ? "Usar modo claro" : "Usar modo oscuro"} title={tema === "oscuro" ? "Modo claro" : "Modo oscuro"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800">
            {tema === "oscuro" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
          </button>
        </div>
        <div className="mx-auto max-w-2xl px-4 pb-3">
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-white" style={{ backgroundColor: color }}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20 text-base font-bold">
              {menu.mesa.replace(/^mesa\s*/i, "").slice(0, 3) || "•"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight">{menu.mesa}</p>
              <p className="truncate text-xs text-white/85">{subtitulo || "Pedí desde tu celular"}</p>
            </div>
            {abierta && abierta.total > 0 ? (
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/75">Cuenta</p>
                <p className="text-sm font-bold tabular-nums">{gs(abierta.total)}</p>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {vista !== "inicio" ? (
        <div className={`sticky top-0 z-10 border-b ${LINEA} bg-white/95 backdrop-blur dark:bg-slate-900/95`}>
          <div className="mx-auto flex max-w-2xl items-center gap-2 px-2 py-1.5">
            <button type="button" onClick={volver} className={`inline-flex h-11 items-center gap-1 rounded-xl px-2.5 text-sm font-semibold ${TEXTO} active:bg-slate-100 dark:active:bg-slate-800`}>
              <ArrowLeft className="h-5 w-5" aria-hidden /> Volver
            </button>
            <h1 className={`min-w-0 flex-1 truncate text-base font-bold ${TEXTO}`}>{TITULOS[vista]}</h1>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-2xl px-4">
        {vista === "inicio" ? (
          <>
            {/* Avisos y "Tus pedidos" (la barra de avance queda a la vista) */}
            <section className="mt-3 space-y-2" aria-live="polite">
              {enviado != null ? (
                <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${AVISO_OK}`}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="min-w-0 flex-1">Pedido #{enviado} enviado. La caja lo confirma en un momento.</p>
                  <button type="button" onClick={() => setEnviado(null)} aria-label="Cerrar aviso" className="-m-1 p-1"><X className="h-4 w-4" /></button>
                </div>
              ) : null}
              {cuentaCerrada ? (
                <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${AVISO_INFO}`}>
                  <Receipt className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p className="min-w-0 flex-1"><b>La cuenta se cerró.</b> ¡Gracias por venir!</p>
                  <button type="button" onClick={() => setCuentaCerrada(false)} aria-label="Cerrar aviso" className="-m-1 p-1"><X className="h-4 w-4" /></button>
                </div>
              ) : null}
              {pedidosVivos.length ? <h2 className={`pt-1 text-xs font-semibold uppercase tracking-wider ${SUAVE}`}>Tus pedidos</h2> : null}
              {pedidosVivos.map((p) => <TarjetaEstado key={p.seguimiento} p={p} />)}
            </section>

            {/* Tarjetas grandes */}
            <div className="mt-3 space-y-2.5">
              <button type="button" onClick={() => ir("pedir")}
                className="flex w-full items-center gap-4 rounded-2xl px-4 py-4 text-left text-white shadow-sm transition active:scale-[0.99]" style={{ backgroundColor: color }}>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20"><ShoppingBag className="h-6 w-6" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold leading-tight">Hacer pedido</span>
                  <span className="block text-sm text-white/85">{unidades ? `Tenés ${unidades} producto${unidades === 1 ? "" : "s"} sin enviar` : "Elegí de la carta y mandalo a la cocina"}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-white/80" aria-hidden />
              </button>
              <div className="grid grid-cols-2 gap-2.5">
                <TarjetaInicio icono={BookOpen} titulo="Ver la carta" texto="Platos, fotos y precios" color={color} onClick={() => ir("carta")} />
                <TarjetaInicio icono={ReceiptText} titulo="Ver consumo" color={color} onClick={() => ir("consumo")}
                  texto={abierta && abierta.items.length ? `${gs(abierta.total)} · ${abierta.items.length} ítem${abierta.items.length === 1 ? "" : "s"}` : "Lo que va de la cuenta"} />
                <TarjetaInicio icono={Split} titulo="Separar cuenta" color={color} onClick={() => ir("separar")}
                  texto={nPartes ? `Separada entre ${nPartes}` : "Por productos o en partes iguales"} />
                <TarjetaInicio icono={FileText} titulo="Datos de facturación" color={color} onClick={() => ir("facturacion")}
                  texto={nFact ? `${nFact} dato${nFact === 1 ? "" : "s"} cargado${nFact === 1 ? "" : "s"}` : "RUC y razón social"} />
              </div>
              <PedirCuenta cuenta={abierta} ahora={ahora} pidiendo={pidiendo} onPedir={(v) => void pedirCuenta(v)} />
              {errorCuenta ? <p className={`rounded-xl px-3 py-2 text-sm ${AVISO_ERROR}`} role="alert">{errorCuenta}</p> : null}
            </div>
            <p className={`mt-8 text-center text-[11px] ${TENUE}`}>Precios con IVA incluido. Se paga en la caja al final.</p>
          </>
        ) : vista === "pedir" || vista === "carta" ? (
          <>
            {/* Buscador chico */}
            <div className={`sticky top-[57px] z-10 -mx-4 ${FONDO} px-4 pt-2 pb-2`}>
              <label className="relative block">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la carta" enterKeyHint="search"
                  className={`${INPUT} h-11 pr-10 pl-9`} />
                {q ? (
                  <button type="button" onClick={() => setQ("")} aria-label="Limpiar búsqueda"
                    className="absolute top-1/2 right-0.5 grid h-10 w-10 -translate-y-1/2 place-items-center text-slate-400"><X className="h-4 w-4" /></button>
                ) : null}
              </label>
            </div>

            {/* Productos por categoría (acordeón) */}
            {menu.productos.length === 0 ? (
              <p className={`${TARJETA} mt-8 px-6 py-12 text-center text-sm ${SUAVE}`}>Todavía no hay productos en el menú. Pedile a quien te atiende.</p>
            ) : grupos.length === 0 ? (
              <p className={`mt-8 text-center text-sm ${SUAVE}`}>No encontramos “{q}” en la carta.</p>
            ) : (
              <div className="mt-2 space-y-2.5">
                {grupos.map(([nombreCat, prods]) => {
                  const abiertaCat = buscando || abiertas.has(nombreCat);
                  const enPedido = prods.reduce((a, p) => a + cantidadDe(p.id), 0);
                  const idPanel = `cat-${nombreCat.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
                  return (
                    <section key={nombreCat} className={`${TARJETA} overflow-hidden`}>
                      <h2>
                        <button type="button" onClick={() => alternar(nombreCat)} disabled={buscando} aria-expanded={abiertaCat} aria-controls={idPanel}
                          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50 disabled:cursor-default dark:active:bg-slate-800">
                          <span className="min-w-0 flex-1">
                            <span className={`block text-base font-bold leading-snug ${TEXTO} [overflow-wrap:anywhere]`}>{nombreCat}</span>
                            <span className={`block text-xs ${SUAVE}`}>{prods.length} producto{prods.length === 1 ? "" : "s"}</span>
                          </span>
                          {enPedido > 0 && !soloVer ? (
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white tabular-nums" style={{ backgroundColor: color }}>{enPedido} en tu pedido</span>
                          ) : null}
                          <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 motion-reduce:transition-none ${abiertaCat ? "rotate-180" : ""}`} aria-hidden />
                        </button>
                      </h2>
                      <div id={idPanel} inert={!abiertaCat}
                        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${abiertaCat ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                        <div className="min-h-0 overflow-hidden">
                          <ul className={`grid grid-cols-1 gap-2.5 border-t ${LINEA} bg-slate-50/60 p-2.5 min-[480px]:grid-cols-2 dark:bg-slate-950/40`}>
                            {prods.map((p) => (
                              <TarjetaProducto key={p.id} p={p} soloVer={soloVer} cantidad={tieneMods(p.mods) ? cantidadDe(p.id) : carrito[claveLinea(p.id)]?.cantidad ?? 0} color={color}
                                onCambiar={(d) => cambiar(claveLinea(p.id), d, p.id)} onElegir={tieneMods(p.mods) ? () => setHoja({ p }) : undefined} />
                            ))}
                          </ul>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            <p className={`mt-8 text-center text-[11px] ${TENUE}`}>Precios con IVA incluido. Se paga en la caja al final.</p>
          </>
        ) : !abierta ? (
          cuenta ? <SinConsumo color={color} onPedir={() => ir("pedir")}
            texto={vista === "facturacion" ? "Los datos de facturación se cargan sobre la cuenta de la mesa: hacé tu pedido primero." : "Todavía no hay una cuenta abierta en esta mesa. Hacé tu pedido y la vas a ver acá."} />
            : <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Cargando" /></div>
        ) : vista === "consumo" ? (
          <VistaConsumo cuenta={abierta} color={color} pidiendo={pidiendo} onSeparar={() => ir("separar")} onPedirCuenta={() => { void pedirCuenta(true); }} />
        ) : vista === "separar" ? (
          <VistaSeparar key={abierta.division?.actualizada_at ?? "sin"} cuenta={abierta} color={color} accion={accion} aviso={avisoSeparar}
            onListo={(c, a) => { setAvisoSeparar(a ?? null); recibirCuenta(c); }} />
        ) : (
          <VistaFacturacion cuenta={abierta} color={color} accion={accion} onListo={recibirCuenta} />
        )}
      </main>

      {/* Barra del carrito */}
      {conBarraCarrito ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <button type="button" onClick={() => { setError(null); setVerCarrito(true); }}
            className="mx-auto flex h-12 w-full max-w-2xl items-center gap-3 rounded-xl px-4 text-white shadow-sm active:scale-[0.99]" style={{ backgroundColor: color }}>
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/25 px-1.5 text-sm font-bold">{unidades}</span>
            <span className="flex-1 text-left text-base font-semibold">Ver pedido</span>
            <span className="text-base font-bold tabular-nums">{gs(total)}</span>
          </button>
        </div>
      ) : soloVer ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <button type="button" onClick={() => ir("pedir")}
            className="mx-auto flex h-12 w-full max-w-2xl items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold text-white shadow-sm active:scale-[0.99]" style={{ backgroundColor: color }}>
            <ShoppingBag className="h-5 w-5" aria-hidden /> Hacer pedido
          </button>
        </div>
      ) : null}

      {/* Carrito */}
      {verCarrito ? (
        <CapaModal onClose={() => !enviando && setVerCarrito(false)}>
          <div className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl ${PANEL_MODAL} shadow-xl ${ALTO_MAX_MODAL}`}>
            <div className={`flex shrink-0 items-center justify-between gap-3 border-b ${LINEA} px-4 py-3`}>
              <div className="min-w-0">
                <p className={`text-base font-semibold ${TEXTO}`}>Tu pedido</p>
                <p className={`truncate text-xs ${SUAVE}`}>{menu.mesa}{subtitulo ? ` · ${subtitulo}` : ""}</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setVerCarrito(false)} disabled={enviando} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {lineas.length === 0 ? (
                <p className={`py-8 text-center text-sm ${SUAVE}`}>No hay productos en el pedido.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lineas.map(([clave, l]) => {
                    const p = porId.get(l.producto_id)!;
                    const unit = p.precio + (l.precio_mods ?? 0);
                    const conMods = tieneMods(p.mods);
                    return (
                      <li key={clave} className="py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${TEXTO}`}>{p.nombre}</p>
                            {conMods && l.sel ? <ModsDetalle mods={partesSel(p.mods!, l.sel)} className="mt-0.5" /> : null}
                            <p className={`text-xs tabular-nums ${SUAVE}`}>{gs(unit)} c/u · <span className="font-semibold text-slate-700 dark:text-slate-200">{gs(unit * l.cantidad)}</span></p>
                            {conMods ? (
                              <button type="button" onClick={() => setHoja({ p, editar: clave })} className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold" style={{ color }}>
                                Cambiar
                              </button>
                            ) : null}
                          </div>
                          <Contador cantidad={l.cantidad} color={color} onCambiar={(d) => cambiar(clave, d)} />
                        </div>
                        <NotaLinea valor={l.nota} onCambiar={(v) => notaLinea(clave, v)} />
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className={`mt-3 space-y-3 border-t ${LINEA} pt-3`}>
                <label className="block">
                  <span className={`mb-1 block text-xs font-medium ${SUAVE}`}>Nota para el pedido <span className={`font-normal ${TENUE}`}>(opcional)</span></span>
                  <textarea value={nota} onChange={(e) => setNota(e.target.value.slice(0, 500))} rows={2} placeholder="Ej.: traer todo junto, sin cubiertos…"
                    className={`${INPUT} resize-none px-3 py-2`} />
                </label>
                <label className="block">
                  <span className={`mb-1 block text-xs font-medium ${SUAVE}`}>Tu nombre <span className={`font-normal ${TENUE}`}>(opcional)</span></span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value.slice(0, 60))} placeholder="Para saber de quién es" autoComplete="given-name"
                    className={`${INPUT} h-11 px-3`} />
                </label>
              </div>
            </div>
            <div className={`shrink-0 border-t ${LINEA} px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]`}>
              {error ? <p className={`mb-2 rounded-lg px-3 py-2 text-sm ${AVISO_ERROR}`} role="alert">{error}</p> : null}
              <div className="mb-2 flex items-baseline justify-between">
                <span className={`text-sm ${SUAVE}`}>Total estimado</span>
                <span className={`text-xl font-bold tabular-nums ${TEXTO}`}>{gs(total)}</span>
              </div>
              <button type="button" onClick={() => void enviar()} disabled={enviando || !lineas.length}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: color }}>
                {enviando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <ShoppingBag className="h-5 w-5" aria-hidden />}
                {enviando ? "Enviando…" : "Enviar pedido"}
              </button>
              <p className={`mt-2 text-center text-[11px] ${TENUE}`}>La caja confirma el pedido. Se suma a la cuenta de la mesa y se paga al final.</p>
            </div>
          </div>
        </CapaModal>
      ) : null}

      {/* Modificadores del plato (receta 73) */}
      {hoja && tieneMods(hoja.p.mods) ? (
        <HojaModificadores
          producto={{ nombre: hoja.p.nombre, precio: hoja.p.precio, precio_lista: hoja.p.precio_lista, imagen_url: hoja.p.imagen_url, descripcion: hoja.p.descripcion }}
          catalogo={hoja.p.mods}
          inicial={hoja.editar && carrito[hoja.editar]?.sel ? { sel: carrito[hoja.editar].sel!, cantidad: carrito[hoja.editar].cantidad, nota: carrito[hoja.editar].nota } : undefined}
          color={color}
          conNota
          ocultarSinStock
          textoBoton={hoja.editar ? "Guardar" : "Agregar"}
          z="z-[60]"
          onConfirmar={(r) => confirmarHoja(hoja.p, r, hoja.editar)}
          onClose={() => setHoja(null)}
        />
      ) : null}
    </div>
  );
}

function TarjetaInicio({ icono: Icono, titulo, texto, color, onClick }: { icono: typeof BookOpen; titulo: string; texto: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${TARJETA} flex min-h-[7.5rem] flex-col items-start gap-2 px-3.5 py-3.5 text-left transition active:scale-[0.98]`}>
      <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}><Icono className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0">
        <span className={`block text-[15px] font-bold leading-tight ${TEXTO}`}>{titulo}</span>
        <span className={`mt-0.5 block text-xs leading-snug ${SUAVE} [overflow-wrap:anywhere]`}>{texto}</span>
      </span>
    </button>
  );
}

/** "Pedir la cuenta" → "¡Cuenta solicitada! Tocá para cancelar la solicitud" → "Tu cuenta está en caja". */
function PedirCuenta({ cuenta, ahora, pidiendo, onPedir }: {
  cuenta: Extract<CuentaPublica, { abierta: true }> | null; ahora: number; pidiendo: boolean; onPedir: (pedir: boolean) => void;
}) {
  const hayAlgo = !!cuenta && cuenta.items.length > 0;
  if (cuenta?.en_caja) {
    return (
      <div className="flex w-full items-center gap-4 rounded-2xl bg-emerald-600 px-4 py-4 text-white shadow-sm dark:bg-emerald-700">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20"><Receipt className="h-6 w-6" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold leading-tight">Tu cuenta está en caja</span>
          <span className="block text-sm text-white/90">Acercate a la caja o esperá al mozo para pagar.</span>
        </span>
      </div>
    );
  }
  if (cuenta?.solicitada_at) {
    return (
      <button type="button" onClick={() => onPedir(false)} disabled={pidiendo}
        className="flex w-full items-center gap-4 rounded-2xl bg-emerald-600 px-4 py-4 text-left text-white shadow-sm transition active:scale-[0.99] disabled:opacity-70 dark:bg-emerald-700">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20">
          {pidiendo ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <CheckCircle2 className="h-6 w-6" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold leading-tight">¡Cuenta solicitada!</span>
          <span className="block text-sm text-white/90">Tocá para cancelar la solicitud · {haceCuanto(cuenta.solicitada_at, ahora)}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onPedir(true)} disabled={pidiendo || !hayAlgo}
      className={`${TARJETA} flex w-full items-center gap-4 px-4 py-4 text-left transition active:scale-[0.99] disabled:active:scale-100`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${hayAlgo ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"}`}>
        {pidiendo ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Receipt className="h-6 w-6" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-lg font-bold leading-tight ${hayAlgo ? TEXTO : "text-slate-400 dark:text-slate-500"}`}>Pedir la cuenta</span>
        <span className={`block text-sm ${SUAVE}`}>{hayAlgo ? "Avisamos a la caja que quieren pagar" : "Cuando confirmen tu pedido vas a poder pedirla"}</span>
      </span>
      {hayAlgo ? <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden /> : null}
    </button>
  );
}

function TarjetaProducto({ p, cantidad, color, onCambiar, onElegir, soloVer }: {
  p: ProductoMenu; cantidad: number; color: string; onCambiar: (d: number) => void; onElegir?: () => void; soloVer?: boolean;
}) {
  const [sinFoto, setSinFoto] = useState(!p.imagen_url);
  return (
    <li className={`flex gap-3 rounded-2xl border bg-white p-2.5 shadow-sm transition dark:bg-slate-900 dark:shadow-none ${cantidad && !soloVer ? "border-[var(--brand)]" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
        {sinFoto ? (
          <div className="grid h-full w-full place-items-center text-2xl font-bold text-slate-300 dark:text-slate-600">{p.nombre.slice(0, 1)}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imagen_url!} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setSinFoto(true)} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={`line-clamp-2 text-sm font-semibold leading-snug ${TEXTO}`}>{p.nombre}</p>
        {p.descripcion ? <p className={`mt-0.5 ${soloVer ? "line-clamp-4" : "line-clamp-2"} text-xs ${SUAVE}`}>{p.descripcion}</p> : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            {p.precio_lista ? <p className="text-[11px] tabular-nums text-slate-400 line-through">{gs(p.precio_lista)}</p> : null}
            <p className={`text-sm font-bold tabular-nums ${TEXTO}`}>{gs(p.precio)}</p>
          </div>
          {soloVer ? null : onElegir ? (
            <button type="button" onClick={onElegir} aria-label={`Elegir y agregar ${p.nombre}`}
              className="relative inline-flex h-10 shrink-0 items-center gap-1 rounded-full pl-3 pr-3.5 text-sm font-semibold text-white shadow-sm active:scale-95" style={{ backgroundColor: color }}>
              <Plus className="h-4 w-4" aria-hidden /> {cantidad > 0 ? "Otro" : "Elegir"}
              {cantidad > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-slate-900 px-1 text-[11px] font-bold tabular-nums dark:bg-white dark:text-slate-900">{cantidad}</span> : null}
            </button>
          ) : cantidad > 0 ? (
            <Contador cantidad={cantidad} color={color} onCambiar={onCambiar} />
          ) : (
            <button type="button" onClick={() => onCambiar(1)} aria-label={`Agregar ${p.nombre}`}
              className="grid h-10 w-10 place-items-center rounded-full text-white shadow-sm active:scale-95" style={{ backgroundColor: color }}>
              <Plus className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function Contador({ cantidad, color, onCambiar }: { cantidad: number; color: string; onCambiar: (d: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={() => onCambiar(-1)} aria-label={cantidad === 1 ? "Quitar" : "Uno menos"}
        className="grid h-9 w-9 place-items-center rounded-full text-slate-700 active:bg-slate-100 dark:text-slate-200 dark:active:bg-slate-800">
        {cantidad === 1 ? <Trash2 className="h-4 w-4" aria-hidden /> : <Minus className="h-4 w-4" aria-hidden />}
      </button>
      <span className={`min-w-6 text-center text-sm font-bold tabular-nums ${TEXTO}`}>{cantidad}</span>
      <button type="button" onClick={() => onCambiar(1)} aria-label="Uno más" disabled={cantidad >= 50}
        className="grid h-9 w-9 place-items-center rounded-full text-white disabled:opacity-40" style={{ backgroundColor: color }}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function NotaLinea({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }) {
  const [abierta, setAbierta] = useState(!!valor);
  if (!abierta) {
    return (
      <button type="button" onClick={() => setAbierta(true)} className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium ${SUAVE}`}>
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Agregar aclaración
      </button>
    );
  }
  return (
    <input value={valor} onChange={(e) => onCambiar(e.target.value)} placeholder="Ej.: sin cebolla, bien frío" autoFocus
      className={`${INPUT} mt-2 h-10 rounded-lg px-3`} />
  );
}

/**
 * Barra de progreso por segmentos (estilo apps de delivery): los pasos hechos y el actual quedan
 * llenos y fijos (al avanzar, el segmento nuevo se llena con una transición suave). Los pasos que
 * faltan tienen un brillo muy tenue y lento que los recorre en ola. Con "reducir movimiento" no hay brillo.
 */
function BarraProgreso({ total, actual }: { total: number; actual: number }) {
  return (
    <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }} aria-hidden>
      <style>{"@keyframes neuraEsperaPaso{0%{transform:translateX(-100%)}60%,100%{transform:translateX(100%)}}"}</style>
      {Array.from({ length: total }, (_, n) => {
        const lleno = n <= actual;
        return (
          <span key={n} className="relative h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand)] transition-[width] duration-1000 ease-out motion-reduce:transition-none"
              style={{ width: lleno ? "100%" : "0%" }} />
            {!lleno ? (
              <span className="absolute inset-0 motion-reduce:hidden"
                style={{
                  background: "linear-gradient(90deg, transparent, color-mix(in srgb, var(--brand) 22%, transparent), transparent)",
                  animation: "neuraEsperaPaso 3.2s ease-in-out infinite",
                  animationDelay: `${(n - actual - 1) * 0.35}s`,
                }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function TarjetaEstado({ p }: { p: EstadoPedidoPublico }) {
  const e = ESTADOS_PEDIDO[p.estado];
  const Icono = p.estado === "rechazado" ? XCircle : p.estado === "listo" || p.estado === "entregado" ? CheckCircle2 : p.estado === "en_preparacion" ? ChefHat : Clock3;
  const pasos = ["nuevo", "aceptado", "en_preparacion", "listo"] as const;
  const i = p.estado === "entregado" ? pasos.length : pasos.indexOf(p.estado as (typeof pasos)[number]);
  return (
    <div className={`${TARJETA} px-3.5 py-3`}>
      <div className="flex items-center gap-2">
        <Icono className={`h-5 w-5 shrink-0 ${p.estado === "rechazado" ? "text-rose-600" : p.estado === "nuevo" ? "text-amber-600" : "text-emerald-600"}`} aria-hidden />
        <p className={`min-w-0 flex-1 text-sm font-semibold ${TEXTO}`}>Pedido #{p.numero} <span className={`font-normal ${TENUE}`}>· {horaCorta(p.creado_at)}</span></p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.clase}`}>{e.texto}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{e.cliente}{p.estado === "rechazado" && p.motivo_rechazo ? `: ${p.motivo_rechazo}` : ""}</p>
      {p.estado === "rechazado" ? (
        <div className="mt-2 h-1.5 rounded-full bg-rose-400" aria-hidden />
      ) : i >= 0 ? <BarraProgreso total={pasos.length} actual={i} /> : null}
      <p className={`mt-2 text-xs ${SUAVE}`}>
        {p.items.map((it) => `${Number(it.cantidad)} × ${it.nombre}${it.modificadores_texto ? ` (${it.modificadores_texto})` : ""}`).join(" · ")} — <span className="font-semibold text-slate-700 dark:text-slate-200">{gs(p.total)}</span>
      </p>
    </div>
  );
}
