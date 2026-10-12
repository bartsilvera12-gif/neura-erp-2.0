"use client";

/**
 * /soporte/configuracion — parámetros y catálogos del módulo (solo ADMIN).
 * Pestañas: Estados, Tipos, Prioridades, SLA (clasificaciones), Equipo (tildes de
 * cada usuario: Técnico, QA, usa Soporte), Notificaciones y General (revisión de QA,
 * responsable por defecto y horario laboral del SLA). Los cambios de las tablas se
 * guardan al salir de cada campo.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Bell, Check, CircleDot, Flag, Plus, Settings2, SlidersHorizontal, Tags, Timer, Users, type LucideIcon } from "lucide-react";
import { apiSoporte, invalidarCatalogos, obtenerCatalogos, type CatalogosConEquipo } from "@/modules/soporte/api";
import { Aviso, Avatar, Boton, Cargando, Desplegable, Encabezado, Interruptor, Pagina, SelectorBuscable, TONOS, TONO_AREA, Tarjeta, claseInput, type Tono } from "@/modules/soporte/ui";

type Catalogo = "estados" | "tipos" | "clasificaciones" | "prioridades";

const PESTANAS: readonly { id: string; etiqueta: string; icono: LucideIcon; tono: Tono }[] = [
  { id: "estados", etiqueta: "Estados", icono: CircleDot, tono: "celeste" },
  { id: "tipos", etiqueta: "Tipos de solicitud", icono: Tags, tono: "violeta" },
  { id: "prioridades", etiqueta: "Prioridades", icono: Flag, tono: "ambar" },
  { id: "sla", etiqueta: "SLA", icono: Timer, tono: "verde" },
  { id: "equipo", etiqueta: "Equipo", icono: Users, tono: "turquesa" },
  { id: "notificaciones", etiqueta: "Notificaciones", icono: Bell, tono: "rosa" },
  { id: "general", etiqueta: "General", icono: SlidersHorizontal, tono: "pizarra" },
];

function useGuardar(recargar: () => Promise<void>) {
  const [guardado, setGuardado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guardar = useCallback(
    async (catalogo: Catalogo, codigo: string | null, campos: Record<string, unknown>, extra?: Record<string, unknown>) => {
      setError(null);
      try {
        await apiSoporte("/api/soporte/catalogos", { method: "PUT", json: { catalogo, codigo, ...campos, ...extra } });
        invalidarCatalogos();
        await recargar();
        setGuardado(codigo ?? "nuevo");
        window.setTimeout(() => setGuardado(null), 1500);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
        return false;
      }
    },
    [recargar],
  );
  return { guardar, guardado, error, setError };
}

function CeldaTexto({ valor, onGuardar, tipo = "text", ancho = "" }: { valor: string | number | null; onGuardar: (v: string) => void; tipo?: string; ancho?: string }) {
  const [v, setV] = useState(valor == null ? "" : String(valor));
  useEffect(() => setV(valor == null ? "" : String(valor)), [valor]);
  return (
    <input
      type={tipo}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (valor == null ? "" : String(valor)) && onGuardar(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={`${claseInput} py-1.5 ${ancho}`}
    />
  );
}

function Tabla({ columnas, children }: { columnas: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-slate-100 text-[11.5px] text-slate-500">
            {columnas.map((c) => (
              <th key={c} className="px-3 py-2.5 font-medium first:pl-0">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const HORAS = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

function General({ cat, recargar }: { cat: CatalogosConEquipo; recargar: () => Promise<void> }) {
  const [v, setV] = useState(() => ({ ...cat.config }));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  useEffect(() => setV({ ...cat.config }), [cat.config]);

  const guardar = async () => {
    setGuardando(true);
    setMsg(null);
    try {
      await apiSoporte("/api/soporte/config", { method: "PUT", json: v });
      invalidarCatalogos();
      await recargar();
      setMsg({ tipo: "ok", texto: "Configuración guardada." });
    } catch (e) {
      setMsg({ tipo: "error", texto: e instanceof Error ? e.message : "No se pudo guardar" });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Tarjeta titulo="General" icono={SlidersHorizontal} tono="pizarra">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Revisión de QA</p>
            <p className="mt-0.5 max-w-xl text-[12.5px] text-slate-500">
              Encendida: el técnico entrega en “Listo para revisión”, QA revisa (subtarea) y aprueba o pide cambios. Apagada: de En proceso / Re-abierto se pasa directo a Resuelto y no se ofrece “Listo para revisión”.
            </p>
          </div>
          <Interruptor etiqueta="Revisión de QA" activo={v.qa_activo} onCambio={(x) => setV((p) => ({ ...p, qa_activo: x }))} />
        </div>

        <div className="grid gap-4 rounded-xl border border-slate-100 p-4 md:grid-cols-[1fr_320px] md:items-center">
          <div>
            <p className="text-sm font-semibold text-slate-800">Responsable por defecto</p>
            <p className="mt-0.5 text-[12.5px] text-slate-500">Queda a cargo de cada ticket nuevo que llegue sin responsable desde la tipificación.</p>
          </div>
          <SelectorBuscable
            avatares
            ariaLabel="Responsable por defecto"
            value={v.responsable_defecto_id ?? ""}
            onChange={(x) => setV((p) => ({ ...p, responsable_defecto_id: x || null }))}
            opciones={[{ value: "", label: "Nadie (queda sin asignar)" }, ...cat.personas.map((p) => ({ value: p.id, label: p.nombre, detalle: p.area, tono: TONO_AREA[p.area] }))]}
            placeholder="Nadie (queda sin asignar)"
            buscarPlaceholder="Buscar persona…"
            vacio="Nadie coincide"
          />
        </div>

        <div className="rounded-xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-800">Horario laboral (SLA)</p>
          <p className="mt-0.5 text-[12.5px] text-slate-500">El SLA se mide en horas laborales: de lunes a viernes entre la hora de inicio y la de fin; el sábado, desde la hora de inicio hasta la indicada. Domingo no se trabaja.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-[12px] font-semibold text-slate-600">
              Hora de inicio
              <Desplegable value={String(v.hora_inicio)} onChange={(x) => setV((p) => ({ ...p, hora_inicio: Number(x) }))} options={HORAS.slice(0, 24)} />
            </label>
            <label className="text-[12px] font-semibold text-slate-600">
              Hora de fin (lun a vie)
              <Desplegable value={String(v.hora_fin)} onChange={(x) => setV((p) => ({ ...p, hora_fin: Number(x) }))} options={HORAS.slice(1)} />
            </label>
            <label className="text-[12px] font-semibold text-slate-600">
              Sábado hasta
              <Desplegable
                value={String(v.sabado_hasta)}
                onChange={(x) => setV((p) => ({ ...p, sabado_hasta: Number(x) }))}
                options={[{ value: "0", label: "No se trabaja" }, ...HORAS.slice(1)]}
              />
            </label>
          </div>
        </div>

        {msg ? <Aviso tipo={msg.tipo}>{msg.texto}</Aviso> : null}
        <div className="flex justify-end">
          <Boton onClick={() => void guardar()} cargando={guardando}>
            <Check className="h-4 w-4" aria-hidden /> Guardar configuración
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

function Equipo({ cat, recargar }: { cat: CatalogosConEquipo; recargar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cambiar = async (usuario_id: string, campo: "es_tecnico" | "es_qa" | "usa_soporte", valor: boolean) => {
    setOcupado(`${usuario_id}-${campo}`);
    setError(null);
    try {
      await apiSoporte("/api/soporte/equipo", { method: "PATCH", json: { usuario_id, [campo]: valor } });
      invalidarCatalogos();
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setOcupado(null);
    }
  };
  return (
    <Tarjeta titulo="Equipo" icono={Users} tono="turquesa" accion={<span className="text-[12px] text-slate-400">Quién trabaja los tickets</span>}>
      {error ? (
        <div className="mb-3">
          <Aviso>{error}</Aviso>
        </div>
      ) : null}
      <Tabla columnas={["Usuario", "Rol", "Usa Soporte", "Técnico", "QA"]}>
        {cat.personas.map((p) => {
          const admin = (p.rol ?? "").toUpperCase() === "ADMIN";
          return (
            <tr key={p.id} className="border-b border-slate-100 last:border-0">
              <td className="py-2.5 pr-3">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <Avatar nombre={p.nombre} tam={26} tono={TONO_AREA[p.area]} /> {p.nombre}
                </span>
              </td>
              <td className="px-3 py-2.5 text-slate-500">{p.rol ?? "—"}</td>
              <td className="px-3 py-2.5">
                {admin ? (
                  <span className="text-[12px] text-slate-400">Siempre (admin)</span>
                ) : (
                  <Interruptor etiqueta="Usa Soporte" activo={p.usa_soporte} disabled={ocupado != null} onCambio={(v) => void cambiar(p.id, "usa_soporte", v)} />
                )}
              </td>
              <td className="px-3 py-2.5">
                <Interruptor etiqueta="Técnico" activo={p.es_tecnico} disabled={ocupado != null} onCambio={(v) => void cambiar(p.id, "es_tecnico", v)} />
              </td>
              <td className="px-3 py-2.5">
                <Interruptor etiqueta="QA" activo={p.es_qa} disabled={ocupado != null} onCambio={(v) => void cambiar(p.id, "es_qa", v)} />
              </td>
            </tr>
          );
        })}
      </Tabla>
      <p className="mt-5 border-t border-slate-100 pt-4 text-[12.5px] text-slate-500">
        Técnico y QA pueden quedar a cargo de un ticket (y “Tomar” uno); QA recibe las revisiones. Si nadie tiene esos tildes, puede quedar a cargo un administrador. “Usa Soporte” deja entrar al módulo a quien no es administrador; la configuración es siempre sólo de administradores.
      </p>
    </Tarjeta>
  );
}

function Contenido() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = PESTANAS.find((p) => p.id === params.get("tab"))?.id ?? "estados";
  const [cat, setCat] = useState<CatalogosConEquipo | null>(null);
  const [cargaError, setCargaError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setCat(await obtenerCatalogos(true));
    } catch (e) {
      setCargaError(e instanceof Error ? e.message : "No se pudo cargar la configuración");
    }
  }, []);
  useEffect(() => {
    void recargar();
  }, [recargar]);

  const { guardar, guardado, error } = useGuardar(recargar);
  const [nuevo, setNuevo] = useState({ nombre: "", tipo_codigo: "error", sla_horas: "" });

  if (cargaError) return <Aviso>{cargaError}</Aviso>;
  if (!cat) return <Cargando />;
  if (!cat.puede_configurar) return <Aviso>Sólo un administrador puede configurar Soporte.</Aviso>;

  const ok = (codigo: string) => (guardado === codigo ? <Check className="h-4 w-4 text-emerald-500" aria-label="Guardado" /> : null);
  const agregar = async (catalogo: Catalogo, campos: Record<string, unknown>) => {
    if (await guardar(catalogo, null, campos)) setNuevo({ nombre: "", tipo_codigo: "error", sla_horas: "" });
  };

  return (
    <>
      <nav className="mb-5 flex gap-1.5 overflow-x-auto pb-1" aria-label="Secciones de configuración">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.replace(`${pathname}?tab=${p.id}`, { scroll: false })}
            aria-current={tab === p.id ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
              tab === p.id ? `${TONOS[p.tono].suave} ${TONOS[p.tono].texto} ${TONOS[p.tono].borde} shadow-sm` : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
            }`}
          >
            <p.icono className="h-3.5 w-3.5" aria-hidden />
            {p.etiqueta}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="mb-4">
          <Aviso>{error}</Aviso>
        </div>
      ) : null}

      {tab === "estados" ? (
        <Tarjeta titulo="Estados de ticket" icono={CircleDot} tono="celeste" accion={<span className="text-[12px] text-slate-400">Los cambios se guardan al salir de cada campo</span>}>
          <Tabla columnas={["Nombre", "Tipo", "Área de la próxima acción", "Color", "Orden", "Detiene SLA", "Activo", ""]}>
            {cat.estados.map((e) => (
              <tr key={e.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3">
                  <CeldaTexto valor={e.nombre} onGuardar={(v) => void guardar("estados", e.codigo, { nombre: v })} />
                </td>
                <td className="w-36 px-3 py-2">
                  <Desplegable value={e.tipo} onChange={(v) => void guardar("estados", e.codigo, { tipo: v })} options={[{ value: "abierto", label: "Abierto" }, { value: "cerrado", label: "Cerrado" }]} />
                </td>
                <td className="px-3 py-2">
                  <CeldaTexto valor={e.area} onGuardar={(v) => void guardar("estados", e.codigo, { area: v })} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="color"
                    defaultValue={e.color}
                    onBlur={(ev) => ev.target.value !== e.color && void guardar("estados", e.codigo, { color: ev.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                    aria-label={`Color de ${e.nombre}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <CeldaTexto tipo="number" ancho="w-20" valor={e.sort_order} onGuardar={(v) => void guardar("estados", e.codigo, { sort_order: Number(v) })} />
                </td>
                <td className="px-3 py-2">
                  <Interruptor etiqueta="Detiene SLA" activo={e.detiene_sla} onCambio={(v) => void guardar("estados", e.codigo, { detiene_sla: v })} />
                </td>
                <td className="px-3 py-2">
                  <Interruptor etiqueta="Activo" activo={e.activo} onCambio={(v) => void guardar("estados", e.codigo, { activo: v })} />
                </td>
                <td className="w-6 py-2">{ok(e.codigo)}</td>
              </tr>
            ))}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre del nuevo estado" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <Boton onClick={() => void agregar("estados", { nombre: nuevo.nombre, tipo: "abierto", color: "#94a3b8", sort_order: cat.estados.length + 1, activo: true })} disabled={!nuevo.nombre.trim()}>
              <Plus className="h-4 w-4" aria-hidden /> Nuevo estado
            </Boton>
            <p className="w-full text-[12px] text-slate-400">
              Un estado nuevo no tiene reglas de flujo propias: se puede pasar libremente desde y hacia él. Los estados del proceso conservan sus transiciones. “Listo para revisión” se usa sólo con la revisión de QA encendida (pestaña General).
            </p>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "tipos" ? (
        <Tarjeta titulo="Tipos de solicitud" icono={Tags} tono="violeta">
          <Tabla columnas={["Nombre", "SLA propio (h)", "Orden", "Activo", ""]}>
            {cat.tipos.map((t) => {
              const tieneClasif = cat.clasificaciones.some((c) => c.tipo_codigo === t.codigo);
              return (
                <tr key={t.codigo} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3">
                    <CeldaTexto valor={t.nombre} onGuardar={(v) => void guardar("tipos", t.codigo, { nombre: v })} />
                  </td>
                  <td className="w-40 px-3 py-2">
                    {tieneClasif ? (
                      <span className="text-[12px] text-slate-400">Por clasificación</span>
                    ) : (
                      <CeldaTexto tipo="number" valor={t.sla_horas} onGuardar={(v) => void guardar("tipos", t.codigo, { sla_horas: v === "" ? null : Number(v) })} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <CeldaTexto tipo="number" ancho="w-20" valor={t.sort_order} onGuardar={(v) => void guardar("tipos", t.codigo, { sort_order: Number(v) })} />
                  </td>
                  <td className="px-3 py-2">
                    <Interruptor etiqueta="Activo" activo={t.activo} onCambio={(v) => void guardar("tipos", t.codigo, { activo: v })} />
                  </td>
                  <td className="w-6 py-2">{ok(t.codigo)}</td>
                </tr>
              );
            })}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre del nuevo tipo" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <Boton onClick={() => void agregar("tipos", { nombre: nuevo.nombre, sort_order: cat.tipos.length + 1, activo: true })} disabled={!nuevo.nombre.trim()}>
              <Plus className="h-4 w-4" aria-hidden /> Nuevo tipo
            </Boton>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "prioridades" ? (
        <Tarjeta titulo="Prioridades" icono={Flag} tono="ambar">
          <Tabla columnas={["Nombre", "Color", "Orden", "Activo", ""]}>
            {cat.prioridades.map((p) => (
              <tr key={p.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3">
                  <CeldaTexto valor={p.nombre} onGuardar={(v) => void guardar("prioridades", p.codigo, { nombre: v })} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="color"
                    defaultValue={p.color}
                    onBlur={(ev) => ev.target.value !== p.color && void guardar("prioridades", p.codigo, { color: ev.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                    aria-label={`Color de ${p.nombre}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <CeldaTexto tipo="number" ancho="w-20" valor={p.sort_order} onGuardar={(v) => void guardar("prioridades", p.codigo, { sort_order: Number(v) })} />
                </td>
                <td className="px-3 py-2">
                  <Interruptor etiqueta="Activo" activo={p.activo} onCambio={(v) => void guardar("prioridades", p.codigo, { activo: v })} />
                </td>
                <td className="w-6 py-2">{ok(p.codigo)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      ) : null}

      {tab === "sla" ? (
        <Tarjeta titulo="Clasificaciones y service level" icono={Timer} tono="verde" accion={<span className="text-[12px] text-slate-400">Horas laborales</span>}>
          <Tabla columnas={["Tipo", "Clasificación", "SLA (horas)", "Prioridad sugerida", "Activo", ""]}>
            {cat.clasificaciones.map((c) => (
              <tr key={c.codigo} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 text-slate-600">{cat.tipos.find((t) => t.codigo === c.tipo_codigo)?.nombre ?? c.tipo_codigo}</td>
                <td className="px-3 py-2">
                  <CeldaTexto valor={c.nombre} onGuardar={(v) => void guardar("clasificaciones", c.codigo, { nombre: v })} />
                </td>
                <td className="px-3 py-2">
                  <CeldaTexto tipo="number" ancho="w-24" valor={c.sla_horas} onGuardar={(v) => void guardar("clasificaciones", c.codigo, { sla_horas: Number(v) })} />
                </td>
                <td className="w-44 px-3 py-2">
                  <Desplegable
                    value={c.prioridad_sugerida ?? ""}
                    onChange={(v) => void guardar("clasificaciones", c.codigo, { prioridad_sugerida: v || null })}
                    options={[{ value: "", label: "Ninguna" }, ...cat.prioridades.map((p) => ({ value: p.codigo, label: p.nombre }))]}
                  />
                </td>
                <td className="px-3 py-2">
                  <Interruptor etiqueta="Activo" activo={c.activo} onCambio={(v) => void guardar("clasificaciones", c.codigo, { activo: v })} />
                </td>
                <td className="w-6 py-2">{ok(c.codigo)}</td>
              </tr>
            ))}
          </Tabla>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <div className="w-44">
              <Desplegable value={nuevo.tipo_codigo} onChange={(v) => setNuevo((n) => ({ ...n, tipo_codigo: v }))} options={cat.tipos.map((t) => ({ value: t.codigo, label: t.nombre }))} />
            </div>
            <input className={`${claseInput} max-w-xs`} placeholder="Nombre de la clasificación" value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
            <input type="number" className={`${claseInput} w-28`} placeholder="Horas" value={nuevo.sla_horas} onChange={(e) => setNuevo((n) => ({ ...n, sla_horas: e.target.value }))} />
            <Boton
              onClick={() =>
                void guardar("clasificaciones", null, { nombre: nuevo.nombre, sla_horas: Number(nuevo.sla_horas), sort_order: cat.clasificaciones.length + 1, activo: true }, { tipo_codigo: nuevo.tipo_codigo }).then(
                  (r) => r && setNuevo({ nombre: "", tipo_codigo: "error", sla_horas: "" }),
                )
              }
              disabled={!nuevo.nombre.trim() || !(Number(nuevo.sla_horas) > 0)}
            >
              <Plus className="h-4 w-4" aria-hidden /> Nueva clasificación
            </Boton>
            <p className="w-full text-[12px] text-slate-400">Cambiar un SLA afecta a los tickets nuevos. Los tickets existentes conservan el SLA con el que se crearon.</p>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "equipo" ? <Equipo cat={cat} recargar={recargar} /> : null}

      {tab === "notificaciones" ? (
        <Tarjeta titulo="Notificaciones" icono={Bell} tono="rosa">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-100 text-rose-500">
              <Bell className="h-4 w-4" aria-hidden />
            </span>
            <div className="text-[13px] leading-relaxed text-slate-600">
              <p className="font-medium text-slate-800">Avisos automáticos en la campanita (bandeja Soporte)</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Al responsable, cuando le asignan un ticket.</li>
                {cat.config.qa_activo ? <li>A QA, cuando un ticket queda listo para revisión (o vuelve corregido).</li> : null}
                {cat.config.qa_activo ? <li>Al responsable, cuando QA pide cambios o aprueba.</li> : null}
                <li>A quien cargó el ticket, cuando pasa a Resuelto o a Falta información.</li>
              </ul>
              <p className="mt-2 text-slate-500">Nunca se avisa a quien hizo el cambio.</p>
            </div>
          </div>
        </Tarjeta>
      ) : null}

      {tab === "general" ? <General cat={cat} recargar={recargar} /> : null}
    </>
  );
}

export default function SoporteConfiguracionPage() {
  return (
    <Pagina>
      <Encabezado titulo="Configuración de Soporte" subtitulo="Parámetros y catálogos del módulo" icono={Settings2} tono="pizarra" />
      <Suspense fallback={<Cargando />}>
        <Contenido />
      </Suspense>
    </Pagina>
  );
}
