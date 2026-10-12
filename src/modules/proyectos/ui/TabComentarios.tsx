"use client";

/**
 * Pestaña Comentarios, como el actual: dos canales (Interno / Cliente) con switch,
 * @menciones (escribí "@" y elegí a la persona: le llega un aviso con sonido en la
 * campanita), adjuntos (quedan también en Archivos) y editar / eliminar los propios.
 * Se carga recién al abrir la pestaña; lo nuevo se agrega local, sin recargar la lista.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, FileText, ImageIcon, Loader2, MessageSquare, Paperclip, Pencil, Send, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import ZonaArchivos from "@/modules/soporte/detalle/ZonaArchivos";
import { CANALES, CANAL_LABEL, fechaHoraPY, type Canal, type Comentario, type UsuarioMin } from "@/modules/proyectos/tipos";
import { Avatar, INPUT, PANEL, TituloPanel, useUsuarios } from "./comun";
import { abrirArchivo, subirArchivos } from "./api";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** "@Nombre Apellido" de cada mencionado que sigue en el texto. */
function mencionesEn(texto: string, elegidas: Map<string, string>): string[] {
  return [...elegidas.entries()].filter(([, nombre]) => texto.includes(`@${nombre}`)).map(([id]) => id);
}

/** Texto con las menciones resaltadas. */
function ConMenciones({ texto, nombres }: { texto: string; nombres: string[] }) {
  if (!nombres.length) return <>{texto}</>;
  const esc = nombres.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const partes = texto.split(new RegExp(`(@(?:${esc.join("|")}))`, "g"));
  return (
    <>
      {partes.map((p, i) => (p.startsWith("@") && nombres.includes(p.slice(1))
        ? <span key={i} className="rounded bg-[var(--brand)]/10 px-1 font-semibold text-[var(--brand-600)]">{p}</span>
        : <span key={i}>{p}</span>))}
    </>
  );
}

/** Caja de texto con autocompletado de @menciones (la lista va debajo: nunca queda cortada). */
function Redactor({ valor, onCambio, usuarios, elegidas, onElegir, onEnviar, placeholder, deshabilitado, autoFocus }: {
  valor: string;
  onCambio: (v: string) => void;
  usuarios: UsuarioMin[];
  elegidas: Map<string, string>;
  onElegir: (u: UsuarioMin) => void;
  onEnviar: () => void;
  placeholder: string;
  deshabilitado?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [consulta, setConsulta] = useState<{ q: string; desde: number } | null>(null);
  const [hi, setHi] = useState(0);
  const me = useUsuario();

  const sugeridos = useMemo(() => {
    if (!consulta) return [];
    const q = norm(consulta.q);
    return usuarios.filter((u) => u.id !== me?.usuarioId && (!q || norm(u.nombre).split(/\s+/).some((p) => p.startsWith(q)) || norm(u.nombre).includes(q))).slice(0, 6);
  }, [consulta, usuarios, me?.usuarioId]);

  function detectar(texto: string, caret: number) {
    const antes = texto.slice(0, caret);
    const m = /(^|\s)@([\p{L}\d._-]{0,30})$/u.exec(antes);
    if (m) {
      setConsulta({ q: m[2], desde: caret - m[2].length - 1 });
      setHi(0);
    } else setConsulta(null);
  }

  function elegir(u: UsuarioMin) {
    if (!consulta) return;
    const caret = ref.current?.selectionStart ?? valor.length;
    const nuevo = `${valor.slice(0, consulta.desde)}@${u.nombre} ${valor.slice(caret)}`;
    onCambio(nuevo);
    onElegir(u);
    setConsulta(null);
    const pos = consulta.desde + u.nombre.length + 2;
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); });
  }

  return (
    <div>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        className={`${INPUT} min-h-24 resize-y`}
        value={valor}
        disabled={deshabilitado}
        placeholder={placeholder}
        onChange={(e) => { onCambio(e.target.value); detectar(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
        onClick={(e) => detectar(valor, e.currentTarget.selectionStart ?? valor.length)}
        onKeyDown={(e) => {
          if (consulta && sugeridos.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % sugeridos.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + sugeridos.length) % sugeridos.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); elegir(sugeridos[hi] ?? sugeridos[0]); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConsulta(null); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onEnviar();
          }
        }}
      />
      {consulta && sugeridos.length ? (
        <ul className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg" role="listbox">
          {sugeridos.map((u, i) => (
            <li key={u.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(u)} onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${i === hi ? "bg-[var(--brand-50)] text-[var(--brand-700)]" : "text-slate-700"}`}>
                <Avatar nombre={u.nombre} tam={22} />
                <span className="truncate">{u.nombre}</span>
                {elegidas.has(u.id) ? <span className="ml-auto text-[10px] text-slate-400">ya mencionado</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TabComentarios({ proyectoId }: { proyectoId: string }) {
  const me = useUsuario();
  const usuarios = useUsuarios();
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [canal, setCanal] = useState<Canal>("interno");
  const [texto, setTexto] = useState("");
  const [elegidas, setElegidas] = useState<Map<string, string>>(() => new Map());
  const [archivos, setArchivos] = useState<File[]>([]);
  const [adjuntando, setAdjuntando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ id: string; texto: string; elegidas: Map<string, string> } | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const cargar = (vivo: { v: boolean } = { v: true }) =>
    apiFetch<Comentario[]>(`/api/proyectos/${proyectoId}/comentarios`)
      .then((c) => vivo.v && setLista(c))
      .catch((e) => vivo.v && setError((e as Error).message));

  useEffect(() => {
    const vivo = { v: true };
    void cargar(vivo);
    return () => { vivo.v = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);

  const nombrePorId = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nombre])), [usuarios]);
  const delCanal = (lista ?? []).filter((c) => c.canal === canal);
  const cuenta = (c: Canal) => (lista ?? []).filter((x) => x.canal === c).length;

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const creado = await apiFetch<Comentario>(`/api/proyectos/${proyectoId}/comentarios`, {
        method: "POST",
        body: JSON.stringify({ canal, contenido, menciones: mencionesEn(contenido, elegidas) }),
      });
      setLista((prev) => [...(prev ?? []), creado]);
      if (archivos.length) {
        const r = await subirArchivos(proyectoId, archivos, { comentarioId: creado.id });
        if (r.errores.length) setError(`El comentario se guardó, pero no se subieron: ${r.errores.join(" · ")}`);
        await cargar();
      }
      setTexto("");
      setElegidas(new Map());
      setArchivos([]);
      setAdjuntando(false);
      requestAnimationFrame(() => finRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function guardarEdicion() {
    if (!editando || !editando.texto.trim()) return;
    setAccion(editando.id);
    try {
      const r = await apiFetch<Comentario>(`/api/proyectos/${proyectoId}/comentarios/${editando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ contenido: editando.texto.trim(), menciones: mencionesEn(editando.texto, editando.elegidas) }),
      });
      setLista((prev) => (prev ?? []).map((c) => (c.id === r.id ? { ...r, adjuntos: c.adjuntos } : c)));
      setEditando(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccion(null);
    }
  }

  async function eliminar(c: Comentario) {
    setAccion(c.id);
    try {
      await apiFetch(`/api/proyectos/${proyectoId}/comentarios/${c.id}`, { method: "DELETE" });
      setLista((prev) => (prev ?? []).filter((x) => x.id !== c.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccion(null);
    }
  }

  return (
    <div className={`space-y-4 ${PANEL}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TituloPanel>Comentarios · {CANAL_LABEL[canal]}</TituloPanel>
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          {CANALES.map((c) => (
            <button key={c} type="button" onClick={() => setCanal(c)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${c === canal ? "bg-white text-[var(--brand-600)] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {CANAL_LABEL[c]}
              {lista && cuenta(c) ? <span className="ml-1 tabular-nums text-slate-400">{cuenta(c)}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <p className="-mt-2 text-[11px] text-slate-400">
        {canal === "interno" ? "Conversación del equipo sobre el proyecto." : "Lo que se habló / acordó con el cliente."} Escribí <strong>@</strong> para mencionar a alguien.
      </p>

      <div ref={finRef} className="space-y-3 rounded-2xl border border-[var(--brand)]/25 bg-gradient-to-br from-[var(--brand)]/[0.06] to-white p-4">
        <Redactor
          valor={texto}
          onCambio={setTexto}
          usuarios={usuarios}
          elegidas={elegidas}
          onElegir={(u) => setElegidas((prev) => new Map(prev).set(u.id, u.nombre))}
          onEnviar={() => void enviar()}
          placeholder={`Escribí un comentario ${canal === "interno" ? "interno" : "del cliente"}… (Shift+Enter para otro renglón)`}
          deshabilitado={enviando}
        />
        {adjuntando ? <ZonaArchivos archivos={archivos} onCambio={setArchivos} compacta deshabilitada={enviando} /> : null}
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">{error}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setAdjuntando((a) => !a)} disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100">
              <Paperclip className="h-4 w-4" /> {archivos.length ? `${archivos.length} adjunto(s)` : "Adjuntar archivo"}
            </button>
            {elegidas.size && mencionesEn(texto, elegidas).length ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><AtSign className="h-3 w-3" /> Avisa a {mencionesEn(texto, elegidas).length}</span>
            ) : null}
          </div>
          <button type="button" onClick={() => void enviar()} disabled={!texto.trim() || enviando}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--brand-600)] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Comentar
          </button>
        </div>
      </div>

      {lista === null ? (
        error ? null : <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando comentarios…</div>
      ) : delCanal.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          <MessageSquare className="h-5 w-5 text-slate-300" /> Aún no hay comentarios en esta sección.
        </div>
      ) : (
        <ul className="space-y-3">
          {[...delCanal].reverse().map((c) => {
            const esAutor = !!me?.usuarioId && c.usuario_id === me.usuarioId;
            const puedeBorrar = esAutor || me?.rol === "ADMIN";
            const enEdicion = editando?.id === c.id;
            const nombres = c.menciones.map((m) => nombrePorId.get(m)).filter((x): x is string => !!x);
            return (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  <Avatar nombre={c.usuario_nombre ?? "?"} tam={22} />
                  <span className="font-medium text-[var(--brand)]">{c.usuario_nombre ?? "Usuario"}</span>
                  <span className="text-slate-300">·</span>
                  <span>{fechaHoraPY(c.created_at)}</span>
                  {c.editado_at ? <span className="italic text-slate-400">(editado)</span> : null}
                  {(esAutor || puedeBorrar) && !enEdicion ? (
                    <span className="ml-auto flex items-center gap-0.5">
                      {esAutor ? (
                        <button type="button" disabled={accion === c.id} title="Editar" aria-label="Editar comentario"
                          onClick={() => setEditando({ id: c.id, texto: c.contenido, elegidas: new Map(c.menciones.map((m) => [m, nombrePorId.get(m) ?? ""]).filter(([, n]) => n) as [string, string][]) })}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[var(--brand)]/10 hover:text-[var(--brand-600)]">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {puedeBorrar ? (
                        <button type="button" disabled={accion === c.id} title="Eliminar" aria-label="Eliminar comentario" onClick={() => void eliminar(c)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600">
                          {accion === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {enEdicion && editando ? (
                  <div className="mt-2 space-y-2">
                    <Redactor
                      valor={editando.texto}
                      onCambio={(v) => setEditando((e) => (e ? { ...e, texto: v } : e))}
                      usuarios={usuarios}
                      elegidas={editando.elegidas}
                      onElegir={(u) => setEditando((e) => (e ? { ...e, elegidas: new Map(e.elegidas).set(u.id, u.nombre) } : e))}
                      onEnviar={() => void guardarEdicion()}
                      placeholder="Editá el comentario…"
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setEditando(null)} disabled={accion === c.id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
                      <button type="button" onClick={() => void guardarEdicion()} disabled={accion === c.id || !editando.texto.trim()}
                        className="rounded-xl bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[var(--brand-600)] disabled:bg-slate-200 disabled:text-slate-400">
                        {accion === c.id ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 space-y-2">
                    <div className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-700"><ConMenciones texto={c.contenido} nombres={nombres} /></div>
                    {c.adjuntos.length ? (
                      <div className="flex flex-wrap gap-2">
                        {c.adjuntos.map((a) => (
                          <button key={a.id} type="button"
                            onClick={() => void abrirArchivo(proyectoId, a.id).catch((e) => setError((e as Error).message))}
                            className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-[var(--brand)]/50 hover:text-[var(--brand-600)]">
                            {(a.mime ?? "").startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">{a.nombre}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
