"use client";

/**
 * /conversaciones/bot-vendedor/flujo — Editor de flujos del bot vendedor (solo ADMIN, receta 173).
 * Diagrama: cada caja es un paso de la conversación (se arrastra, se edita, se prende o apaga) y las
 * flechas marcan el orden. Varios flujos por empresa; el ACTIVO es el que sigue el bot. Abajo se ve el
 * guion tal como lo lee el bot. Sin flujos guardados el bot usa el de fábrica ("Venta con menús").
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge, Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CheckCircle2, Copy, LayoutGrid, Loader2, Plus, Power, Save, Trash2, TriangleAlert, Workflow, X } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { BOTON, BOTON_PRIMARIO, INPUT } from "@/modules/rrhh/ui";
import {
  ESTILOS, PLANTILLAS, TIPOS_PASO, acomodar, avisosDelFlujo, guionDelFlujo, ordenDelFlujo,
  type ConexionFlujo, type EstiloFlujo, type Flujo, type PasoFlujo, type TipoPaso,
} from "@/lib/bot-vendedor/flujo";

type FlujoGuardado = Flujo & { id: string; activo: boolean; updated_at: string };
/** numero: lugar en el recorrido (1, 2, 3…) · suelto: sin flechas que lleguen, se usa "en cualquier momento". */
type DatosPaso = { paso: PasoFlujo; numero?: number | null; suelto?: boolean };
type NodoPaso = Node<DatosPaso, "paso">;

const nuevoId = () => `p-${Math.random().toString(36).slice(2, 9)}`;
const flecha = (c: ConexionFlujo): Edge => ({
  id: c.id, source: c.de, target: c.a, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, style: { strokeWidth: 2 },
});
const aNodos = (f: Flujo): NodoPaso[] => f.nodos.map((p) => ({ id: p.id, type: "paso", position: { x: p.x, y: p.y }, data: { paso: p } }));
const aFlujo = (base: { nombre: string; estilo: EstiloFlujo }, nodos: NodoPaso[], edges: Edge[]): Flujo => ({
  nombre: base.nombre,
  estilo: base.estilo,
  nodos: nodos.map((n) => ({ ...n.data.paso, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
  conexiones: edges.map((e) => ({ id: e.id, de: e.source, a: e.target })),
});

// ── La caja de un paso ───────────────────────────────────────────────────────
function CajaPaso({ data, selected }: NodeProps<NodoPaso>) {
  const p = data.paso;
  const t = TIPOS_PASO[p.tipo] ?? TIPOS_PASO.mensaje;
  return (
    <div className={`w-56 rounded-xl border bg-white shadow-sm transition ${selected ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/30" : "border-slate-200"} ${p.activo ? "" : "opacity-50"}`}>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-slate-400" />
      <div className="h-1.5 rounded-t-xl" style={{ background: t.color }} />
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {data.numero ? (
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: t.color }}>{data.numero}</span>
            ) : null}
            <span className="truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color: t.color }}>{t.nombre}</span>
          </span>
          {!p.activo ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">Apagado</span> : null}
          {p.activo && data.suelto ? <span className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">En cualquier momento</span> : null}
        </div>
        <p className="text-sm font-semibold leading-tight text-slate-900">{p.titulo || t.nombre}</p>
        <p className="line-clamp-3 text-xs leading-snug text-slate-500">{p.instruccion || "Sin instrucción"}</p>
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-[var(--brand)]" />
    </div>
  );
}
const TIPOS_NODO = { paso: CajaPaso };

// ── Editor de un flujo ───────────────────────────────────────────────────────
function Editor({ flujo, onGuardado, onCambios }: { flujo: FlujoGuardado; onGuardado: (f: FlujoGuardado) => void; onCambios: (hay: boolean) => void }) {
  const [nodos, setNodos, alCambiarNodos] = useNodesState<NodoPaso>(aNodos(flujo));
  const [flechas, setFlechas, alCambiarFlechas] = useEdgesState<Edge>(flujo.conexiones.map(flecha));
  const [nombre, setNombre] = useState(flujo.nombre);
  const [estilo, setEstilo] = useState<EstiloFlujo>(flujo.estilo);
  const [elegido, setElegido] = useState<string | null>(null);
  const [flechaElegida, setFlechaElegida] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verGuion, setVerGuion] = useState(false);
  const { screenToFlowPosition } = useReactFlow();

  const actual = useMemo(() => aFlujo({ nombre, estilo }, nodos, flechas), [nombre, estilo, nodos, flechas]);
  const original = useMemo(() => JSON.stringify(aFlujo(flujo, aNodos(flujo), flujo.conexiones.map(flecha))), [flujo]);
  const cambios = JSON.stringify(actual) !== original;
  useEffect(() => onCambios(cambios), [cambios, onCambios]);
  const avisos = useMemo(() => avisosDelFlujo(actual), [actual]);
  // Número de cada paso en el recorrido (lo que sigue el bot) y cuáles quedan sueltos.
  const nodosVista = useMemo(() => {
    const { orden, sueltos } = ordenDelFlujo(actual);
    const num = new Map(orden.map((n, i) => [n.id, i + 1]));
    const suelto = new Set(sueltos.map((n) => n.id));
    return nodos.map((n) => ({ ...n, data: { ...n.data, numero: num.get(n.id) ?? null, suelto: suelto.has(n.id) } }));
  }, [nodos, actual]);
  const { fitView } = useReactFlow();
  const ordenarCajas = () => {
    const a = acomodar(actual);
    const pos = new Map(a.nodos.map((n) => [n.id, { x: n.x, y: n.y }]));
    setNodos((l) => l.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 50);
  };
  const paso = nodos.find((n) => n.id === elegido)?.data.paso ?? null;

  const conectar = useCallback(
    (c: Connection) => setFlechas((l) => addEdge(flecha({ id: `c-${c.source}-${c.target}`, de: c.source, a: c.target }), l)),
    [setFlechas],
  );
  const editarPaso = (cambio: Partial<PasoFlujo>) =>
    setNodos((l) => l.map((n) => (n.id === elegido ? { ...n, data: { paso: { ...n.data.paso, ...cambio } } } : n)));
  const borrarPaso = () => {
    setNodos((l) => l.filter((n) => n.id !== elegido));
    setFlechas((l) => l.filter((e) => e.source !== elegido && e.target !== elegido));
    setElegido(null);
  };
  const agregar = (tipo: TipoPaso) => {
    const centro = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = nuevoId();
    const t = TIPOS_PASO[tipo];
    setNodos((l) => [...l, { id, type: "paso", position: { x: centro.x - 110, y: centro.y - 50 }, data: { paso: { id, tipo, titulo: t.nombre, instruccion: t.instruccion, activo: true, x: 0, y: 0 } } }]);
    setElegido(id);
  };

  async function guardar() {
    setBusy(true);
    setError(null);
    try {
      const g = await apiFetch<FlujoGuardado>(`/api/conversaciones/bot-vendedor/flujos/${flujo.id}`, { method: "PUT", body: JSON.stringify(actual) });
      onGuardado(g);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Nombre del flujo</span>
          <input className={INPUT} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="min-w-48">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">Estilo de conversación</span>
          <select className={INPUT} value={estilo} onChange={(e) => setEstilo(e.target.value as EstiloFlujo)}>
            {(Object.keys(ESTILOS) as EstiloFlujo[]).map((k) => <option key={k} value={k}>{ESTILOS[k].nombre}</option>)}
          </select>
        </label>
        <button type="button" className={`${BOTON} max-sm:flex-1`} onClick={ordenarCajas} title="Acomoda las cajas en el orden de las flechas, de izquierda a derecha">
          <LayoutGrid className="h-4 w-4" /> Ordenar cajas
        </button>
        <button type="button" className={`${BOTON_PRIMARIO} max-sm:w-full`} disabled={busy || !cambios || !nombre.trim()} onClick={() => void guardar()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="self-center pr-1 text-xs font-semibold text-slate-500">Agregar paso:</span>
        {(Object.keys(TIPOS_PASO) as TipoPaso[]).map((t) => (
          <button key={t} type="button" onClick={() => agregar(t)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ background: TIPOS_PASO[t].color }} /> {TIPOS_PASO[t].nombre}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="h-[560px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 max-lg:h-[460px]">
          <ReactFlow<NodoPaso, Edge>
            nodes={nodosVista}
            edges={flechas.map((e) => (e.id === flechaElegida ? { ...e, style: { strokeWidth: 3, stroke: "#dc2626" } } : e))}
            nodeTypes={TIPOS_NODO}
            onNodesChange={alCambiarNodos}
            onEdgesChange={alCambiarFlechas}
            onConnect={conectar}
            onNodeClick={(_, n) => { setElegido(n.id); setFlechaElegida(null); }}
            onEdgeClick={(_, e) => { setFlechaElegida(e.id); setElegido(null); }}
            onPaneClick={() => { setElegido(null); setFlechaElegida(null); }}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            // La rueda mueve la página (no hace zoom sin querer); el zoom va con los botones o el pellizco.
            zoomOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {paso ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TIPOS_PASO[paso.tipo].color }}>{TIPOS_PASO[paso.tipo].nombre}</p>
                <button type="button" aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" onClick={() => setElegido(null)}><X className="h-4 w-4" /></button>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">Título</span>
                <input className={INPUT} value={paso.titulo} maxLength={60} onChange={(e) => editarPaso({ titulo: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">Qué hace el bot en este paso</span>
                <textarea className={`${INPUT} min-h-36 resize-y py-2.5`} value={paso.instruccion} maxLength={1500} onChange={(e) => editarPaso({ instruccion: e.target.value })} />
              </label>
              {TIPOS_PASO[paso.tipo].regla ? (
                <p className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-500"><b className="font-semibold text-slate-600">Regla fija (no se edita):</b> {TIPOS_PASO[paso.tipo].regla}</p>
              ) : null}
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" className="h-5 w-5 accent-[var(--brand)]" checked={paso.activo} onChange={(e) => editarPaso({ activo: e.target.checked })} />
                Paso prendido
              </label>
              <button type="button" className={`${BOTON} w-full border-rose-200 text-rose-700`} onClick={borrarPaso}><Trash2 className="h-4 w-4" /> Borrar paso</button>
            </>
          ) : flechaElegida ? (
            <>
              <p className="text-sm text-slate-600">Flecha elegida (en rojo).</p>
              <button type="button" className={`${BOTON} w-full border-rose-200 text-rose-700`} onClick={() => { setFlechas((l) => l.filter((e) => e.id !== flechaElegida)); setFlechaElegida(null); }}>
                <Trash2 className="h-4 w-4" /> Borrar flecha
              </button>
            </>
          ) : (
            <div className="space-y-2 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Cómo se usa</p>
              <ul className="list-disc space-y-1 pl-4">
                <li>Arrastrá las cajas para acomodarlas.</li>
                <li>Para unir dos pasos, arrastrá desde el punto de la derecha de una caja hasta otra.</li>
                <li>Tocá una caja para editar lo que hace el bot, o una flecha para borrarla.</li>
                <li>Un paso apagado se saltea, pero sus flechas siguen valiendo.</li>
                <li>Las cajas sin flechas que lleguen el bot las usa en cualquier momento (ej. Pasar a una persona).</li>
              </ul>
            </div>
          )}
          {avisos.length ? (
            <div className="space-y-1 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">
              {avisos.map((a) => <p key={a} className="flex gap-1.5"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}</p>)}
            </div>
          ) : null}
        </aside>
      </div>

      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {cambios ? <p className="text-sm text-amber-700">Hay cambios sin guardar.</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <button type="button" className="text-sm font-semibold text-slate-800" onClick={() => setVerGuion((v) => !v)} aria-expanded={verGuion}>
          {verGuion ? "▾" : "▸"} Así lo lee el bot
        </button>
        {verGuion ? <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{guionDelFlujo(actual)}</pre> : null}
      </section>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function FlujoBotPage() {
  const [flujos, setFlujos] = useState<FlujoGuardado[] | null>(null);
  const [actualId, setActualId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sinGuardar, setSinGuardar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await apiFetch<{ flujos: FlujoGuardado[] }>("/api/conversaciones/bot-vendedor/flujos");
      setFlujos(r.flujos);
      setActualId((id) => (id && r.flujos.some((f) => f.id === id) ? id : (r.flujos.find((f) => f.activo) ?? r.flujos[0])?.id ?? null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const actual = flujos?.find((f) => f.id === actualId) ?? null;
  const elegir = (id: string) => {
    if (sinGuardar && !window.confirm("Hay cambios sin guardar en este flujo. ¿Salir igual?")) return;
    setActualId(id);
  };

  async function crear(base: Flujo, nombre: string) {
    setBusy("crear");
    setError(null);
    try {
      const f = await apiFetch<FlujoGuardado>("/api/conversaciones/bot-vendedor/flujos", { method: "POST", body: JSON.stringify({ ...base, nombre }) });
      setFlujos((l) => [...(l ?? []), f]);
      setActualId(f.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function accion(a: "activar" | "desactivar") {
    if (!actual) return;
    setBusy(a);
    setError(null);
    try {
      setFlujos((await apiFetch<{ flujos: FlujoGuardado[] }>(`/api/conversaciones/bot-vendedor/flujos/${actual.id}`, { method: "POST", body: JSON.stringify({ accion: a }) })).flujos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function borrar() {
    if (!actual || !window.confirm(`¿Borrar el flujo "${actual.nombre}"? No se puede deshacer.`)) return;
    setBusy("borrar");
    try {
      await apiFetch(`/api/conversaciones/bot-vendedor/flujos/${actual.id}`, { method: "DELETE" });
      setFlujos((l) => (l ?? []).filter((f) => f.id !== actual.id));
      setActualId(null);
      void cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const activo = flujos?.find((f) => f.activo) ?? null;

  return (
    <div className="space-y-4 pb-10">
      <EncabezadoPagina
        titulo="Flujo de la conversación"
        subtitulo="El guion que sigue el bot vendedor: cada caja es un paso y las flechas marcan el orden. El flujo activo es el que usa el bot."
        volver={{ href: "/conversaciones/bot-vendedor", label: "Bot vendedor" }}
      />
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!flujos && !error ? <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" /> : null}

      {flujos ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {flujos.map((f) => (
              <button key={f.id} type="button" onClick={() => elegir(f.id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${f.id === actualId ? "border-[var(--brand)] bg-[var(--brand-50,#eef7f7)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-700"}`}>
                <Workflow className="h-4 w-4" /> {f.nombre}
                {f.activo ? <span className="rounded-full bg-emerald-100 px-2 text-[11px] text-emerald-800">Activo</span> : null}
              </button>
            ))}
            {PLANTILLAS.map((p) => (
              <button key={p.clave} type="button" className={BOTON} disabled={!!busy} title={p.descripcion} onClick={() => void crear(p.flujo, p.flujo.nombre)}>
                <Plus className="h-4 w-4" /> {p.flujo.nombre}
              </button>
            ))}
            {actual ? (
              <button type="button" className={BOTON} disabled={!!busy} onClick={() => void crear(actual, `${actual.nombre} (copia)`)}><Copy className="h-4 w-4" /> Duplicar</button>
            ) : null}
          </div>

          {!flujos.length ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Todavía no guardaste ningún flujo: el bot usa el de fábrica (<b>Venta con menús</b>). Tocá una de las plantillas de arriba para editarla.
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              {activo ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> El bot sigue <b>{activo.nombre}</b>.</> : <>Ningún flujo activo: el bot usa el de fábrica (<b>Venta con menús</b>).</>}
              {actual && !actual.activo ? (
                <button type="button" className={`${BOTON_PRIMARIO} min-h-9`} disabled={!!busy || sinGuardar} title={sinGuardar ? "Guardá antes de activarlo" : undefined} onClick={() => void accion("activar")}>
                  {busy === "activar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} Usar este flujo
                </button>
              ) : null}
              {actual?.activo ? (
                <button type="button" className={`${BOTON} min-h-9`} disabled={!!busy} onClick={() => void accion("desactivar")}>Volver al de fábrica</button>
              ) : null}
              {actual && !actual.activo ? (
                <button type="button" className={`${BOTON} min-h-9 border-rose-200 text-rose-700`} disabled={!!busy} onClick={() => void borrar()}><Trash2 className="h-4 w-4" /> Borrar flujo</button>
              ) : null}
            </p>
          )}

          {actual ? (
            <ReactFlowProvider key={`${actual.id}-${actual.updated_at}`}>
              <Editor flujo={actual} onCambios={setSinGuardar} onGuardado={(g) => setFlujos((l) => (l ?? []).map((f) => (f.id === g.id ? g : f)))} />
            </ReactFlowProvider>
          ) : null}
          <p className="text-xs text-slate-500">
            Las categorías, la entrega, los pagos y las instrucciones generales se cargan en <Link className="font-semibold text-[var(--brand)]" href="/conversaciones/bot-vendedor">Bot vendedor</Link>; el flujo solo define el orden y lo que dice el bot en cada paso.
          </p>
        </>
      ) : null}
    </div>
  );
}
