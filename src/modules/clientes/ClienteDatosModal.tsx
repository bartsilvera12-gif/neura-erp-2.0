"use client";

/**
 * Datos del cliente (lo que abre la fila de /clientes): el MISMO diseño y bloques que el
 * formulario ClienteForm (Datos, Datos para facturación, Contacto y dirección), pero de solo
 * lectura. Pie: Cerrar, Editar (pasa al formulario y al guardar vuelve acá con los datos
 * nuevos) y Dar de baja / Reactivar.
 * Permisos (los de la ficha y la API): editar y reactivar → ADMIN o VENDEDOR (PATCH);
 * dar de baja con motivo → ADMIN (POST …/baja: activo=false + baja_at/por/motivo, no borra
 * nada); VENDEDOR → "Desactivar" (PATCH activo=false), como en la ficha.
 * La ficha completa (estado de cuenta, suscripciones…) sigue en /clientes/<id>.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { useUsuario } from "@/lib/sesion/ContextoUsuario";
import { BTN_SECUNDARIO, Bloque, CUERPO, ClienteForm, ET, MarcoCliente } from "@/modules/clientes/ClienteForm";
import { ModalBaja } from "@/modules/clientes/ficha/Modales";
import { urlFicha } from "@/modules/clientes/ficha/url";
import type { Detalle } from "@/modules/clientes/ficha/tipos";
import { BadgeEstado, CategoriaChip, CodigoChip, TEAL, codigoCliente, estadoDe, fechaCorta } from "@/modules/clientes/ui";

export function ClienteDatosModal({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => void }) {
  const me = useUsuario();
  const esAdmin = me?.rol === "ADMIN";
  const puedeEditar = esAdmin || me?.rol === "VENDEDOR";
  // Si la lista ya la precargó (hover sobre la fila), se pinta en el primer render.
  const [data, setData] = useState<Detalle | null>(() => guardadoAlInstante<Detalle>(urlFicha(id)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  const vigente = useRef<AbortController | null>(null);
  const cargar = useCallback(async (fresco: boolean) => {
    vigente.current?.abort();
    const ctrl = new AbortController();
    vigente.current = ctrl;
    try {
      await apiFetchSWR<Detalle>(urlFicha(id), (d) => { setData(d); setError(null); }, { fresco, maxEdadMs: fresco ? 0 : 15_000, signal: ctrl.signal });
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { void cargar(false); return () => vigente.current?.abort(); }, [cargar]);

  /** Algo se guardó: datos frescos acá y la lista se refresca. */
  async function cambio(mensaje: string) {
    setAviso(mensaje);
    onCambio();
    await cargar(true);
  }

  async function cambiarActivo(activo: boolean) {
    setCambiando(true);
    setError(null);
    try {
      await apiFetch(`/api/clientes/${id}`, { method: "PATCH", body: JSON.stringify({ activo }) });
      await cambio(activo ? "Cliente reactivado" : "Cliente desactivado");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCambiando(false);
    }
  }

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const c = data?.cliente;

  // Editar: el mismo formulario del alta, con este cliente; al guardar vuelve a los datos.
  if (editando && c) {
    return (
      <ClienteForm
        cliente={{ ...c, limite_credito: Number(c.limite_credito ?? 0) }}
        onClose={() => setEditando(false)}
        onSaved={() => { setEditando(false); void cambio("Cambios guardados"); }}
      />
    );
  }

  const estado = c ? estadoDe(c) : "activo";
  const empresa = c?.tipo_cliente === "empresa";

  const pie = (
    <>
      {c && puedeEditar ? (
        estado === "activo" ? (
          esAdmin ? (
            <button type="button" onClick={() => setBajando(true)}
              className="rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 sm:mr-auto">
              Dar de baja
            </button>
          ) : (
            <button type="button" onClick={() => void cambiarActivo(false)} disabled={cambiando}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:opacity-50 sm:mr-auto">
              {cambiando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Desactivar
            </button>
          )
        ) : (
          <button type="button" onClick={() => void cambiarActivo(true)} disabled={cambiando}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100 disabled:opacity-50 sm:mr-auto">
            {cambiando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {cambiando ? "Reactivando…" : "Reactivar"}
          </button>
        )
      ) : null}
      <button type="button" onClick={onCerrar} className={BTN_SECUNDARIO}>Cerrar</button>
      {c && puedeEditar ? (
        <button type="button" onClick={() => setEditando(true)}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#4FAEB2]/20 transition hover:brightness-95"
          style={{ backgroundColor: TEAL }}>
          <Pencil className="h-4 w-4" /> Editar
        </button>
      ) : null}
    </>
  );

  return (
    <>
      <MarcoCliente
        // Con la confirmación de baja abierta, Escape cierra solo esa capa (CapaModal apila).
        onClose={onCerrar}
        kicker="Cliente"
        titulo={c?.nombre ?? "Cargando…"}
        extra={c ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CodigoChip codigo={codigoCliente(c)} fondo="bg-white" />
            <BadgeEstado estado={estado} />
            <span className="text-[11px] text-slate-500">Desde <span className="font-medium text-slate-700">{fechaCorta(c.creado_at)}</span></span>
            <Link href={`/clientes/${encodeURIComponent(c.id)}`}
              className="inline-flex min-h-11 items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[var(--brand)] hover:underline sm:min-h-0">
              Ver ficha completa <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : null}
        pie={pie}
      >
        <div className={CUERPO}>
          {!c ? (
            error ? <p className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">{error}</p> : <Esqueleto />
          ) : (
            <>
              {aviso ? (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">
                  <span>✓</span> {aviso}
                </p>
              ) : null}
              {error ? <p className="rounded-lg bg-rose-50 p-2.5 text-sm text-rose-700">{error}</p> : null}
              {c.baja_at ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm sm:p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Dado de baja</p>
                  <p className="mt-1 text-amber-900">
                    {fechaCorta(c.baja_at)}{c.baja_por_nombre ? ` · ${c.baja_por_nombre}` : ""}
                    {c.baja_motivo ? <> · <span className="font-medium">{c.baja_motivo}</span></> : null}
                  </p>
                </div>
              ) : null}

              <Bloque titulo="Datos">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Dato label="Tipo">{empresa ? "Empresa" : "Persona"}</Dato>
                  <Dato label="Categoría">{c.categoria_nombre ? <CategoriaChip nombre={c.categoria_nombre} color={c.categoria_color} /> : null}</Dato>
                  <Dato label={empresa ? "Nombre o nombre comercial" : "Nombre y apellido"}>{c.nombre}</Dato>
                  <Dato label={empresa ? "RUC" : "RUC o CI"} mono>{c.documento}</Dato>
                  <Dato label="Teléfono">{c.telefono ? <a href={`tel:${c.telefono.replace(/\s+/g, "")}`} className="hover:text-[var(--brand)] hover:underline">{c.telefono}</a> : null}</Dato>
                  <Dato label="Email">{c.email ? <a href={`mailto:${c.email}`} className="break-all hover:text-[var(--brand)] hover:underline">{c.email}</a> : null}</Dato>
                </div>
              </Bloque>

              <Bloque titulo="Datos para facturación">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Dato label={empresa ? "Razón social" : "Nombre para factura"}>{c.razon_social}</Dato>
                  <Dato label="RUC" mono>{c.ruc}</Dato>
                </div>
              </Bloque>

              <Bloque titulo={empresa ? "Contacto y dirección" : "Dirección"}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {empresa ? (
                    <>
                      <Dato label="Persona de contacto" ancho>{c.nombre_contacto}</Dato>
                      <Dato label="Teléfono del contacto">{c.telefono_secundario}</Dato>
                      <Dato label="Email del contacto">{c.email_secundario}</Dato>
                    </>
                  ) : null}
                  <Dato label="Dirección">{c.direccion}</Dato>
                  <Dato label="Ciudad">{c.ciudad}</Dato>
                </div>
              </Bloque>
            </>
          )}
        </div>
      </MarcoCliente>

      {bajando && c ? (
        <ModalBaja clienteId={c.id} nombre={c.nombre} onCancel={() => setBajando(false)}
          onHecho={() => { setBajando(false); void cambio("Cliente dado de baja. Se conserva todo su historial."); }} />
      ) : null}
    </>
  );
}

/** Un dato del formulario en modo lectura: mismo rótulo que el input, valor como texto. */
function Dato({ label, children, mono = false, ancho = false }: { label: string; children: React.ReactNode; mono?: boolean; ancho?: boolean }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className={`min-w-0 ${ancho ? "sm:col-span-2" : ""}`}>
      <span className={ET}>{label}</span>
      <p className={`break-words text-sm ${vacio ? "text-slate-300" : "font-medium text-slate-900"} ${mono && !vacio ? "font-mono" : ""}`}>{vacio ? "—" : children}</p>
    </div>
  );
}

function Esqueleto() {
  return (
    <>
      {[4, 2, 2].map((n, i) => (
        <section key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 h-4 w-32 animate-pulse rounded bg-slate-200" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: n }).map((_, j) => (
              <div key={j} className="space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-40 max-w-full animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
