"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { buscar } from "@/lib/busqueda";
import { clienteConfig } from "@/cliente.config";
import { NuevoCliente } from "@/modules/clientes/NuevoCliente";
import { formatGs, type Cliente } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [q, setQ] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setClientes(await apiFetch<Cliente[]>("/api/clientes"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Búsqueda inteligente en la base (nombre, razón social, CI/RUC con o sin puntos,
  // teléfono, email, ciudad; sin tildes, errores de tipeo, por relevancia). Mientras
  // llega la respuesta se filtra lo que ya está en pantalla con la misma lógica.
  const [buscados, setBuscados] = useState<Cliente[] | null>(null);
  useEffect(() => {
    const t = q.trim();
    setBuscados(null);
    if (!t) return;
    let vivo = true;
    const h = setTimeout(() => {
      apiFetch<Cliente[]>(`/api/clientes?q=${encodeURIComponent(t)}&limite=200`)
        .then((r) => { if (vivo) setBuscados(r); })
        .catch(() => {});
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [q]);

  const filtrados = useMemo(() => {
    if (!q.trim()) return clientes;
    return buscados ?? buscar(clientes, q, (c) => ({ principal: c.razon_social || c.nombre, otros: [c.nombre, c.telefono], codigos: [c.documento, c.ruc] }));
  }, [clientes, q, buscados]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Clientes</h1>
          <p className="mt-0.5 text-sm text-slate-500">{clientes.length} registrado(s).</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, RUC, CI o teléfono…"
              className="w-48 rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand-100)] sm:w-64"
            />
          </div>
          <button
            onClick={() => setNuevo(true)}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
            style={{ backgroundColor: BRAND }}
          >
            <Plus className="h-4 w-4" /> Nuevo
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : error ? (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
      ) : clientes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-50)", color: BRAND }}>
            <Users className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">Todavía no hay clientes.</p>
          <p className="mt-1 text-xs text-slate-400">Cargá el primero con “Nuevo”.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Documento / RUC</th>
                <th className="hidden px-4 py-3 md:table-cell">Teléfono</th>
                <th className="px-4 py-3">Condición</th>
                <th className="px-4 py-3 text-right">Límite crédito</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtrados.map((c) => (
                <tr key={c.id} className="group transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ backgroundColor: "var(--brand-50)", color: BRAND }}>
                        {c.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800 group-hover:text-[var(--brand)]">{c.nombre}</div>
                        <div className="text-xs capitalize text-slate-400">{c.tipo_cliente ?? "persona"}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.ruc || c.documento || "—"}</td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{c.telefono || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={
                        c.condicion_pago === "CREDITO"
                          ? { backgroundColor: "#fff7ed", color: "#ea580c" }
                          : { backgroundColor: "#f1f5f9", color: "#64748b" }
                      }
                    >
                      {c.condicion_pago === "CREDITO" ? "Crédito" : "Contado"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {c.limite_credito && c.limite_credito > 0 ? formatGs(c.limite_credito) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">Ningún cliente coincide con “{q}”.</p>
          ) : null}
        </div>
      )}

      {nuevo ? (
        <NuevoCliente
          onClose={() => setNuevo(false)}
          onCreado={() => {
            setNuevo(false);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}
