"use client";

/**
 * /presupuestos/nuevo — alta y edición de un presupuesto.
 *   ?cliente=<id>  arranca con ese cliente (desde la ficha del cliente)
 *   ?editar=<id>   edita (borrador o enviado; editar uno enviado crea la revisión siguiente)
 * Cliente del ERP o prospecto (datos libres), validez en días o fecha, moneda, condición,
 * vendedor, líneas de productos del inventario (precio de lista e IVA del producto,
 * descuento por línea; si falta un producto se crea acá mismo, en un modal), descuento
 * general, condiciones comerciales (las ve el cliente) y notas internas (no salen del ERP).
 * Solo productos del inventario: no hay líneas libres (receta 64).
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, FileSignature, Loader2, Lock, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchCache, invalidar } from "@/lib/api/cache-cliente";
import { tienePermiso, useUsuario } from "@/lib/sesion/ContextoUsuario";
import { hoyPY } from "@/lib/fecha/paraguay";
import { clienteConfig } from "@/cliente.config";
import MontoInput from "@/components/ui/MontoInput";
import { Select } from "@/components/Select";
import { BuscadorCliente } from "@/modules/clientes/gestion/BuscadorCliente";
import { CamposCredito } from "@/modules/caja/CamposCredito";
import { MAX_CUOTAS, type CadaCuota } from "@/modules/caja/cuotas";
import { BuscadorProductos, Segmentado, Tarjeta } from "@/modules/compras/partes";
import { ProductoForm } from "@/modules/inventario/ProductoForm";
import type { ProductoInventario } from "@/modules/inventario/tipos";
import type { TipoIva } from "@/modules/caja/lib";
import { CLASE_ETIQUETA as ET, CLASE_INPUT as INPUT } from "@/modules/presupuestos/ui";
import {
  calcularLinea, calcularTotales, CONFIG_DEFECTO, decimales, diaCorto, monto, numeroConRevision, redondear,
  type ConfigPresupuestos, type Moneda, type Presupuesto,
} from "@/modules/presupuestos/tipos";
import { SelectorFecha } from "@/components/SelectorFecha";

const TEAL = clienteConfig.color;

type Linea = {
  key: string;
  /** null solo en líneas viejas (de antes de "solo productos del inventario"): hay que quitarlas */
  producto_id: string | null;
  sku: string | null;
  descripcion: string;
  detalle: string;
  verDetalle: boolean;
  unidad: string | null;
  cantidad: string;
  precio: number;
  descuento: string;
  tipo_iva: TipoIva;
  stock?: number | null;
  controla_stock?: boolean;
};
type ClienteSel = { id: string; nombre: string; ruc: string | null; telefono: string | null; email: string | null; direccion: string | null };

const num = (s: string) => Number(String(s).replace(",", ".")) || 0;
const nuevaKey = () => `l_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const sumarDias = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("en-CA");
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

export default function NuevoPresupuestoPage() {
  return (
    <Suspense>
      <Formulario />
    </Suspense>
  );
}

function Formulario() {
  const sp = useSearchParams();
  const router = useRouter();
  const editarId = sp.get("editar");
  const clienteInicial = sp.get("cliente");
  const me = useUsuario();
  const hoy = hoyPY();

  const [cfg, setCfg] = useState<ConfigPresupuestos>(CONFIG_DEFECTO);
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);
  const [cargandoEdicion, setCargandoEdicion] = useState(!!editarId);
  const [editando, setEditando] = useState<Presupuesto | null>(null);

  // Cliente
  const [modo, setModo] = useState<"cliente" | "prospecto">("cliente");
  const [cliente, setCliente] = useState<ClienteSel | null>(null);
  const [pNombre, setPNombre] = useState("");
  const [pRuc, setPRuc] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [direccion, setDireccion] = useState("");

  // Condiciones
  const [fecha, setFecha] = useState(hoy);
  const [modoValidez, setModoValidez] = useState<"dias" | "fecha">("dias");
  const [validezDias, setValidezDias] = useState(String(CONFIG_DEFECTO.validez_dias));
  const [validoHasta, setValidoHasta] = useState(sumarDias(hoy, CONFIG_DEFECTO.validez_dias));
  const [moneda, setMoneda] = useState<Moneda>("GS");
  const [cambio, setCambio] = useState(0);
  const [condicion, setCondicion] = useState<"contado" | "credito">("contado");
  const [plazo, setPlazo] = useState("30");
  const [cuotas, setCuotas] = useState("1");
  const [cuotasCada, setCuotasCada] = useState<CadaCuota>("mes");
  const [vendedorId, setVendedorId] = useState("");

  // Líneas y cierre
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [descGlobal, setDescGlobal] = useState("");
  const [condiciones, setCondiciones] = useState("");
  const [notas, setNotas] = useState("");
  const [avisoMoneda, setAvisoMoneda] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(() => crypto.randomUUID());
  const puedeCrearProducto = tienePermiso(me, "editar_productos");
  const [creandoProd, setCreandoProd] = useState<string | null>(null);

  // Ajustes de la empresa (validez y condiciones por defecto) y vendedores.
  useEffect(() => {
    apiFetchCache<ConfigPresupuestos>("/api/presupuestos/config").then((c) => {
      setCfg(c);
      if (!editarId) {
        setValidezDias(String(c.validez_dias));
        setValidoHasta(sumarDias(hoyPY(), c.validez_dias));
        setCondiciones((v) => v || c.condiciones || "");
      }
    }).catch(() => {});
    apiFetchCache<{ id: string; nombre: string }[]>("/api/usuarios").then(setVendedores).catch(() => {});
  }, [editarId]);
  useEffect(() => { if (!vendedorId && me?.usuarioId && !editarId) setVendedorId(me.usuarioId); }, [me?.usuarioId, vendedorId, editarId]);

  async function elegirCliente(id: string) {
    try {
      const { cliente: c } = await apiFetch<{ cliente: { id: string; nombre: string; razon_social?: string | null; ruc?: string | null; documento?: string | null; telefono?: string | null; email?: string | null; direccion?: string | null; ciudad?: string | null } }>(`/api/clientes/${encodeURIComponent(id)}`);
      const sel: ClienteSel = {
        id: c.id,
        nombre: c.razon_social?.trim() || c.nombre,
        ruc: c.ruc || c.documento || null,
        telefono: c.telefono ?? null,
        email: c.email ?? null,
        direccion: [c.direccion, c.ciudad].filter((x) => x && String(x).trim()).join(", ") || null,
      };
      setCliente(sel);
      setTelefono(sel.telefono ?? "");
      setEmail(sel.email ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ?cliente=<id> (desde la ficha).
  useEffect(() => {
    if (clienteInicial && !editarId && /^[0-9a-f-]{36}$/i.test(clienteInicial)) void elegirCliente(clienteInicial);
  }, [clienteInicial, editarId]);

  // ?editar=<id>
  useEffect(() => {
    if (!editarId) return;
    let vivo = true;
    apiFetch<Presupuesto>(`/api/presupuestos/${editarId}`)
      .then((p) => {
        if (!vivo) return;
        setEditando(p);
        if (p.cliente_id) {
          setModo("cliente");
          setCliente({ id: p.cliente_id, nombre: p.cliente_nombre, ruc: p.cliente_ruc, telefono: p.cliente_telefono, email: p.cliente_email, direccion: p.cliente_direccion });
        } else {
          setModo("prospecto");
          setPNombre(p.cliente_nombre);
          setPRuc(p.cliente_ruc ?? "");
          setDireccion(p.cliente_direccion ?? "");
        }
        setTelefono(p.cliente_telefono ?? "");
        setEmail(p.cliente_email ?? "");
        setFecha(p.fecha);
        setModoValidez("fecha");
        setValidoHasta(p.valido_hasta);
        setValidezDias(String(p.validez_dias));
        setMoneda(p.moneda);
        setCambio(p.moneda === "USD" ? Number(p.tipo_cambio) : 0);
        setCondicion(p.condicion);
        if (p.plazo_dias) setPlazo(String(p.plazo_dias));
        setCuotas(String(p.cuotas ?? 1));
        setCuotasCada((p.cuotas_cada as CadaCuota) ?? "mes");
        setVendedorId(p.vendedor_id ?? "");
        setDescGlobal(Number(p.descuento_pct) ? String(Number(p.descuento_pct)) : "");
        setCondiciones(p.condiciones ?? "");
        setNotas(p.notas_internas ?? "");
        setLineas(p.items.map((i) => ({
          key: i.id, producto_id: i.producto_id, sku: i.sku, descripcion: i.descripcion, detalle: i.detalle ?? "", verDetalle: !!i.detalle,
          unidad: i.unidad, cantidad: String(Number(i.cantidad)), precio: Number(i.precio_unitario),
          descuento: Number(i.descuento_pct) ? String(Number(i.descuento_pct)) : "", tipo_iva: i.tipo_iva,
        })));
      })
      .catch((e) => vivo && setError((e as Error).message))
      .finally(() => vivo && setCargandoEdicion(false));
    return () => { vivo = false; };
  }, [editarId]);

  const factor = moneda === "USD" ? cambio : 1;
  function agregarProducto(p: ProductoInventario) {
    const ex = lineas.find((l) => l.producto_id === p.id);
    if (ex) {
      setLineas((ls) => ls.map((l) => (l.key === ex.key ? { ...l, cantidad: String(num(l.cantidad) + 1) } : l)));
      return;
    }
    const precio = moneda === "USD" ? (cambio > 0 ? redondear(Number(p.precio_venta) / cambio, 2) : 0) : Math.round(Number(p.precio_venta) || 0);
    setLineas((ls) => [...ls, {
      key: nuevaKey(), producto_id: p.id, sku: p.sku, descripcion: p.nombre, detalle: "", verDetalle: false, unidad: p.unidad_medida,
      cantidad: "1", precio, descuento: Number(p.descuento_pct) ? String(Number(p.descuento_pct)) : "", tipo_iva: p.tipo_iva,
      stock: Number(p.stock_actual), controla_stock: p.controla_stock,
    }]);
  }
  const editar = (key: string, patch: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function mover(key: string, d: -1 | 1) {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const j = i + d;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const c = [...ls];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  // Cambiar de moneda con líneas cargadas: se convierten los precios con la cotización.
  function cambiarMoneda(m: Moneda) {
    if (m === moneda) return;
    setMoneda(m);
    if (!lineas.length) return;
    if (cambio > 0) {
      setLineas((ls) => ls.map((l) => ({ ...l, precio: m === "USD" ? redondear(l.precio / cambio, 2) : Math.round(l.precio * cambio) })));
      setAvisoMoneda(`Pasamos los precios a ${m === "USD" ? "dólares" : "guaraníes"} con 1 US$ = Gs. ${cambio.toLocaleString("es-PY")}. Revisalos.`);
    } else {
      setAvisoMoneda("Cargá la cotización y revisá los precios: estaban en otra moneda.");
    }
  }

  const dg = num(descGlobal);
  const tot = useMemo(
    () => calcularTotales(lineas.map((l) => ({ cantidad: num(l.cantidad), precio_unitario: l.precio, descuento_pct: num(l.descuento), tipo_iva: l.tipo_iva })), dg, moneda),
    [lineas, dg, moneda],
  );
  const hasta = modoValidez === "dias" ? sumarDias(fecha, Math.max(0, parseInt(validezDias) || 0)) : validoHasta;
  const diasValidez = diasEntre(fecha, hasta);

  const faltan = [
    modo === "cliente" && !cliente && "el cliente",
    modo === "prospecto" && !pNombre.trim() && "el nombre del prospecto",
    moneda === "USD" && !(cambio > 0) && "la cotización del dólar",
    !(diasValidez >= 0 && diasValidez <= 365) && "una validez entre 0 y 365 días",
    fecha > hoy && "una fecha que no sea futura",
    condicion === "credito" && !(parseInt(plazo) >= 1) && "el plazo del crédito",
    condicion === "credito" && !(parseInt(cuotas) >= 1 && parseInt(cuotas) <= MAX_CUOTAS) && `cuotas entre 1 y ${MAX_CUOTAS}`,
    lineas.length === 0 && "al menos una línea",
    lineas.some((l) => !l.producto_id) && "quitar las líneas sin producto del inventario",
    lineas.some((l) => !(num(l.cantidad) > 0)) && "la cantidad de alguna línea",
    lineas.some((l) => !(l.precio > 0)) && "el precio de alguna línea",
    (lineas.some((l) => num(l.descuento) < 0 || num(l.descuento) >= 100) || dg < 0 || dg >= 100) && "descuentos entre 0 y 99,99 %",
  ].filter(Boolean) as string[];

  async function guardar() {
    if (faltan.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        idempotency_key: editarId ? null : idem,
        cliente_id: modo === "cliente" ? cliente?.id : null,
        cliente_nombre: modo === "prospecto" ? pNombre.trim() : null,
        cliente_ruc: modo === "prospecto" ? pRuc.trim() || null : null,
        cliente_telefono: telefono.trim() || null,
        cliente_email: email.trim() || null,
        cliente_direccion: modo === "prospecto" ? direccion.trim() || null : null,
        fecha,
        valido_hasta: hasta,
        moneda,
        tipo_cambio: moneda === "USD" ? cambio : null,
        condicion,
        plazo_dias: condicion === "credito" ? parseInt(plazo) : null,
        cuotas: condicion === "credito" ? parseInt(cuotas) : 1,
        cuotas_cada: condicion === "credito" && parseInt(cuotas) > 1 ? cuotasCada : "mes",
        vendedor_id: vendedorId || null,
        descuento_pct: dg,
        condiciones: condiciones.trim() || null,
        notas_internas: notas.trim() || null,
        items: lineas.map((l) => ({
          producto_id: l.producto_id,
          descripcion: l.descripcion.trim() || null,
          detalle: l.detalle.trim() || null,
          cantidad: num(l.cantidad),
          precio_unitario: l.precio,
          descuento_pct: num(l.descuento),
        })),
      });
      const r = editarId
        ? await apiFetch<{ id: string }>(`/api/presupuestos/${editarId}`, { method: "PATCH", body })
        : await apiFetch<{ id: string }>("/api/presupuestos", { method: "POST", body });
      invalidar("/api/presupuestos");
      invalidar(`/api/presupuestos/${r.id}`);
      router.push(`/presupuestos/${r.id}?${editarId ? "guardado" : "creado"}=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const bloqueado = editando && !["borrador", "enviado", "vencido"].includes(editando.estado);
  if (cargandoEdicion) {
    return <p className="flex items-center gap-2 py-16 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando presupuesto…</p>;
  }
  if (bloqueado && editando) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Lock className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">{editando.numero} ya no se edita</h1>
        <p className="mt-1 text-sm text-slate-500">Está {editando.estado}. Duplicalo desde su ficha para armar uno nuevo.</p>
        <Link href={`/presupuestos/${editando.id}`} className="mt-5 inline-block rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: TEAL }}>Volver al presupuesto</Link>
      </div>
    );
  }
  const dec = decimales(moneda);
  const enviado = editando?.estado_guardado === "enviado";

  const etiquetaGuardar = busy ? "Guardando…" : editando ? (enviado ? `Guardar revisión ${editando.revision + 1}` : "Guardar cambios") : "Crear presupuesto";

  return (
    <div className="space-y-5 pb-10 max-lg:pb-28 sm:space-y-6">
      <header className="flex items-start gap-3">
        <Link href={editando ? `/presupuestos/${editando.id}` : "/presupuestos"} aria-label="Volver" className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 sm:h-9 sm:w-9">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: TEAL }}>Comercial · Presupuestos</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            {editando ? `Editar ${numeroConRevision(editando.numero, editando.revision)}` : "Nuevo presupuesto"}
          </h1>
          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
            {enviado ? `Ya se mandó: al guardar queda como revisión ${editando!.revision + 1} (descargá el PDF nuevo y mandáselo al cliente).` : "Armalo, guardalo y después descargá el PDF para mandarlo."}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Tarjeta numero={1} titulo="Para quién" extra={
            <div className="w-full sm:w-56"><Segmentado valor={modo} onChange={(v) => setModo(v as "cliente" | "prospecto")} opciones={[["cliente", "Cliente"], ["prospecto", "Prospecto"]]} /></div>
          }>
            {modo === "cliente" ? (
              <div className="space-y-3">
                <div>
                  <span className={ET}>Cliente *</span>
                  {cliente ? (
                    <BuscadorCliente variant="toolbar" seleccionado={`${cliente.nombre}${cliente.ruc ? ` · ${cliente.ruc}` : ""}`}
                      onSelect={(c) => void elegirCliente(c.id)} onClear={() => { setCliente(null); setTelefono(""); setEmail(""); }} />
                  ) : (
                    <BuscadorCliente variant="toolbar" onSelect={(c) => void elegirCliente(c.id)} />
                  )}
                  <p className="mt-1 text-[11px] text-slate-500">¿Todavía no es cliente? Usá <button type="button" onClick={() => setModo("prospecto")} className="font-semibold text-[var(--brand)] hover:underline [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:py-3">Prospecto</button> y cargá sus datos a mano.</p>
                </div>
                {cliente ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className={ET}>Teléfono</span>
                      <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="0981 123 456" className={INPUT} /></label>
                    <label className="block"><span className={ET}>Email</span>
                      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={INPUT} /></label>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2"><span className={ET}>Nombre o razón social *</span>
                  <input value={pNombre} onChange={(e) => setPNombre(e.target.value)} maxLength={200} placeholder="Ej: Constructora Las Lomas" className={INPUT} /></label>
                <label className="block"><span className={ET}>RUC / CI</span>
                  <input value={pRuc} onChange={(e) => setPRuc(e.target.value)} maxLength={40} className={INPUT} /></label>
                <label className="block"><span className={ET}>Teléfono</span>
                  <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="0981 123 456" className={INPUT} /></label>
                <label className="block"><span className={ET}>Email</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={INPUT} /></label>
                <label className="block"><span className={ET}>Dirección</span>
                  <input value={direccion} onChange={(e) => setDireccion(e.target.value)} maxLength={300} className={INPUT} /></label>
              </div>
            )}
          </Tarjeta>

          <Tarjeta numero={2} titulo="Condiciones de la propuesta">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="block"><span className={ET}>Fecha</span>
                <SelectorFecha block etiqueta="Fecha del presupuesto" value={fecha} max={hoy} onChange={(v) => setFecha(v || hoy)} /></div>
              <div>
                <span className={ET}>Validez</span>
                <div className="flex items-center gap-2">
                  <div className="w-36 shrink-0 sm:w-40"><Segmentado valor={modoValidez} onChange={(v) => { setModoValidez(v as "dias" | "fecha"); if (v === "fecha") setValidoHasta(hasta); else setValidezDias(String(Math.max(0, diasValidez))); }} opciones={[["dias", "Días"], ["fecha", "Fecha"]]} /></div>
                  {modoValidez === "dias" ? (
                    <div className="flex items-center gap-1.5">
                      <input inputMode="numeric" value={validezDias} onChange={(e) => setValidezDias(e.target.value.replace(/\D/g, "").slice(0, 3))} className={`${INPUT} w-20 py-2 text-right tabular-nums`} />
                      <span className="text-sm text-slate-500">días</span>
                    </div>
                  ) : (
                    <SelectorFecha block etiqueta="Válido hasta" value={validoHasta} min={fecha} onChange={setValidoHasta} claseBoton="rounded-xl px-3 py-2 text-slate-800" className="min-w-0" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Vence el <b className="font-semibold text-slate-700">{diaCorto(hasta)}</b>{modoValidez === "fecha" && diasValidez >= 0 ? ` (${diasValidez} días)` : ""}. Por defecto: {cfg.validez_dias} días.</p>
              </div>
              <div>
                <span className={ET}>Moneda</span>
                <Segmentado valor={moneda} onChange={(v) => cambiarMoneda(v as Moneda)} opciones={[["GS", "Guaraníes"], ["USD", "Dólares"]]} />
                {moneda === "USD" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm text-slate-500">1 US$ =</span>
                    <MontoInput value={cambio} onChange={setCambio} decimals={false} placeholder="7.300" className={`${INPUT} w-28 py-2 text-right tabular-nums`} />
                    <span className="text-sm text-slate-500">Gs.</span>
                  </div>
                ) : null}
              </div>
              <div>
                <span className={ET}>Condición propuesta</span>
                <Segmentado valor={condicion} onChange={(v) => setCondicion(v as "contado" | "credito")} opciones={[["contado", "Contado"], ["credito", "Crédito"]]} />
                {condicion === "credito" ? (
                  <CamposCredito propuesta total={tot.total} cuotas={cuotas} setCuotas={setCuotas} plazoDias={plazo} setPlazoDias={setPlazo}
                    cada={cuotasCada} setCada={setCuotasCada} monto={moneda === "GS" ? (v) => monto(v, "GS") : null} />
                ) : null}
              </div>
              <div className="sm:col-span-2 sm:max-w-sm">
                <span className={ET}>Vendedor</span>
                <Select value={vendedorId} onChange={setVendedorId} block compacto etiqueta="Vendedor"
                  options={vendedores.length ? vendedores.map((u): [string, string] => [u.id, u.nombre]) : [["", "Yo"]]} />
              </div>
            </div>
            {avisoMoneda ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoMoneda}</p> : null}
          </Tarjeta>

          <Tarjeta numero={3} titulo="Qué se cotiza" extra={lineas.length ? <span className="text-xs text-slate-500">{lineas.length} {lineas.length === 1 ? "línea" : "líneas"}</span> : null}>
            <BuscadorProductos mostrarPrecio onElegir={agregarProducto} onCrear={puedeCrearProducto ? (t) => setCreandoProd(t) : undefined} />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Solo productos del inventario.{puedeCrearProducto ? " Si falta uno, crealo con el botón + y queda cargado en el inventario." : " Si falta uno, pedí que lo carguen en el inventario."}
            </p>
            {creandoProd !== null ? (
              <ProductoForm modal inicial={{ nombre: creandoProd }}
                onClose={() => setCreandoProd(null)}
                onSaved={async (c) => {
                  setCreandoProd(null);
                  // El producto recién creado entra solo al presupuesto.
                  if (c?.id) { try { agregarProducto(await apiFetch<ProductoInventario>(`/api/productos/${c.id}`)); } catch { /* lo busca a mano */ } }
                }} />
            ) : null}
            {moneda === "USD" && !(cambio > 0) ? <p className="mt-2 text-[11px] text-amber-700">Cargá la cotización para que los productos entren con su precio en dólares.</p> : null}

            {lineas.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
                <FileSignature className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Buscá los productos del inventario que vas a cotizar.</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {lineas.map((l, idx) => {
                  const c = calcularLinea({ cantidad: num(l.cantidad), precio_unitario: l.precio, descuento_pct: num(l.descuento), tipo_iva: l.tipo_iva }, 0, moneda);
                  const sinStock = l.controla_stock && l.stock != null && num(l.cantidad) > l.stock;
                  return (
                    <li key={l.key} className="rounded-xl border border-slate-200 p-3">
                      {/* Celular: descripción arriba (con quitar), cantidad / precio / desc. / IVA en
                          2 columnas y abajo ordenar + total. Desde sm: todo en una fila, como siempre. */}
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="hidden flex-col pt-1 sm:flex">
                          <button type="button" onClick={() => mover(l.key, -1)} disabled={idx === 0} aria-label="Subir" className="rounded p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => mover(l.key, 1)} disabled={idx === lineas.length - 1} aria-label="Bajar" className="rounded p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="min-w-0 flex-1 max-sm:basis-full sm:min-w-[200px]">
                          <div className="flex items-center gap-2">
                            {l.producto_id ? (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{l.sku}</span>
                            ) : (
                              <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">Sin producto</span>
                            )}
                            <input value={l.descripcion} onChange={(e) => editar(l.key, { descripcion: e.target.value })} maxLength={300}
                              aria-label="Descripción"
                              className="min-w-0 flex-1 rounded-lg border border-transparent px-1.5 py-1 text-sm font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-[var(--brand)] max-sm:min-h-11 max-sm:border-slate-200" />
                            <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.descripcion || "línea"}`}
                              className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:hidden"><Trash2 className="h-4 w-4" /></button>
                          </div>
                          {l.verDetalle ? (
                            <textarea value={l.detalle} onChange={(e) => editar(l.key, { detalle: e.target.value })} rows={2} maxLength={1000} placeholder="Detalle que verá el cliente (opcional)"
                              className="mt-1.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-[var(--brand)]" />
                          ) : (
                            <button type="button" onClick={() => editar(l.key, { verDetalle: true })} className="mt-0.5 px-1.5 text-[11px] font-medium text-slate-400 hover:text-[var(--brand)] max-sm:min-h-10 max-sm:text-xs">+ detalle</button>
                          )}
                          {sinStock ? <p className="mt-1 px-1.5 text-[11px] font-medium text-amber-700">Hoy hay {l.stock?.toLocaleString("es-PY")} en stock.</p> : null}
                          {!l.producto_id ? <p className="mt-1 px-1.5 text-[11px] font-medium text-rose-700">No es un producto del inventario: quitala y agregá el producto con el buscador.</p> : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-sm:w-full sm:contents">
                          <label className="sm:w-20"><span className={ET}>Cant.</span>
                            <input inputMode="decimal" enterKeyHint="next" value={l.cantidad} onChange={(e) => editar(l.key, { cantidad: e.target.value.replace(/[^\d.,]/g, "") })} className={`${INPUT} px-2 py-2 text-right tabular-nums`} /></label>
                          <label className="sm:w-32"><span className={ET}>Precio {moneda === "USD" ? "US$" : "Gs."}</span>
                            <MontoInput value={l.precio} onChange={(v) => editar(l.key, { precio: v })} decimals={moneda === "USD"} placeholder="0" className={`${INPUT} px-2 py-2 text-right tabular-nums`} /></label>
                          <label className="sm:w-[4.5rem]"><span className={ET}>Desc. %</span>
                            <input inputMode="decimal" enterKeyHint="done" value={l.descuento} onChange={(e) => editar(l.key, { descuento: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) })} placeholder="0" className={`${INPUT} px-2 py-2 text-right tabular-nums`} /></label>
                          <div className="sm:w-28">
                            <span className={ET}>IVA</span>
                            <p className="rounded-xl border border-transparent px-1 py-2 text-sm text-slate-600" title="El IVA del producto">{l.tipo_iva === "EXENTA" ? "Exenta" : l.tipo_iva}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 max-sm:w-full max-sm:border-t max-sm:border-slate-100 max-sm:pt-2 sm:block sm:w-28 sm:pt-5 sm:text-right">
                          <div className="flex gap-1 sm:hidden">
                            <button type="button" onClick={() => mover(l.key, -1)} disabled={idx === 0} aria-label="Subir" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                            <button type="button" onClick={() => mover(l.key, 1)} disabled={idx === lineas.length - 1} aria-label="Bajar" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                          </div>
                          <div className="text-right">
                            {num(l.descuento) > 0 ? <p className="text-[10px] tabular-nums text-slate-400 line-through">{monto(c.bruto, moneda)}</p> : null}
                            <p className="text-base font-bold tabular-nums text-slate-900 sm:text-sm">{monto(c.total, moneda)}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.descripcion || "línea"}`}
                          className="mt-5 hidden rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:block"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta numero={4} titulo="Condiciones y notas">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block"><span className={ET}>Condiciones comerciales <span className="font-normal text-slate-400">(las ve el cliente)</span></span>
                <textarea value={condiciones} onChange={(e) => setCondiciones(e.target.value)} rows={5} maxLength={4000} placeholder="Entrega, forma de pago, garantía…" className={INPUT} /></label>
              <label className="block"><span className={ET}>Notas internas <span className="font-normal text-slate-400">(no salen del ERP)</span></span>
                <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={5} maxLength={4000} placeholder="Margen, competencia, próximos pasos…" className={`${INPUT} bg-amber-50/30`} /></label>
            </div>
          </Tarjeta>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Resumen</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Fila l="Subtotal" v={monto(tot.subtotal_bruto, moneda)} />
              {tot.descuento_lineas > 0 ? <Fila l="Descuentos por línea" v={`− ${monto(tot.descuento_lineas, moneda)}`} verde /> : null}
              <div className="flex items-center justify-between gap-2 text-slate-600">
                <dt>Descuento general</dt>
                <dd className="flex items-center gap-1">
                  <input inputMode="decimal" value={descGlobal} onChange={(e) => setDescGlobal(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} placeholder="0"
                    aria-label="Descuento general (%)" className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-[var(--brand)] max-lg:h-11 max-lg:w-20" />
                  <span className="text-xs">%</span>
                </dd>
              </div>
              {tot.descuento_global > 0 ? <Fila l="" v={`− ${monto(tot.descuento_global, moneda)}`} verde /> : null}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-semibold text-slate-800">Total</span>
              <span className="text-2xl font-extrabold tabular-nums text-slate-900">{monto(tot.total, moneda)}</span>
            </div>
            {moneda === "USD" && cambio > 0 ? <p className="text-right text-xs text-slate-500">≈ {monto(redondear(tot.total * factor, 0))}</p> : null}
            <dl className="mt-2 space-y-0.5 text-[11px] text-slate-500">
              {tot.total_10 ? <Fila l="IVA 10% incluido" v={monto(tot.iva_10, moneda)} chico /> : null}
              {tot.total_5 ? <Fila l="IVA 5% incluido" v={monto(tot.iva_5, moneda)} chico /> : null}
              {tot.total_exenta ? <Fila l="Exento" v={monto(tot.total_exenta, moneda)} chico /> : null}
            </dl>
            {dec === 2 ? <p className="mt-2 text-[11px] text-slate-400">En dólares se redondea a centavos.</p> : null}

            {faltan.length ? <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Falta: {faltan.join(", ")}.</p> : null}
            {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
            {/* Celular / tablet: el botón va en el pie fijo (abajo). */}
            <button type="button" onClick={() => void guardar()} disabled={!!faltan.length || busy}
              className="mt-4 hidden w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40 lg:inline-flex" style={{ backgroundColor: TEAL }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {etiquetaGuardar}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">{editando ? "Queda registrado en el historial." : "Se guarda como borrador. Después lo mandás."}</p>
          </div>
        </aside>
      </div>

      {/* Celular / tablet: total y guardar en un pie fijo (safe-area) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-12px_rgba(15,23,42,0.28)] backdrop-blur pb-safe lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-slate-500">{faltan.length ? `Falta: ${faltan[0]}${faltan.length > 1 ? ` y ${faltan.length - 1} más` : ""}` : `Total · ${lineas.length} línea${lineas.length === 1 ? "" : "s"}`}</p>
            <p className="truncate text-xl font-bold leading-tight tabular-nums text-slate-900">{monto(tot.total, moneda)}</p>
          </div>
          <button type="button" onClick={() => void guardar()} disabled={!!faltan.length || busy}
            className="inline-flex h-12 max-w-[60%] shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40" style={{ backgroundColor: TEAL }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            <span className="truncate">{etiquetaGuardar}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Fila({ l, v, verde, chico }: { l: string; v: string; verde?: boolean; chico?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${chico ? "" : "text-slate-600"}`}>
      <dt>{l}</dt>
      <dd className={`tabular-nums ${verde ? "text-emerald-700" : ""}`}>{v}</dd>
    </div>
  );
}
