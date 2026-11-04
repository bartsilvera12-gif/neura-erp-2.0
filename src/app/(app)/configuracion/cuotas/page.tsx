"use client";

/**
 * /configuracion/cuotas — Planes de cuotas (receta 131). Arriba el máximo de cuotas de la empresa
 * (120 por defecto, hasta 360); debajo los planes que se eligen al vender: nombre, cuántas cuotas,
 * cada cuánto, a cuántos días la primera y la entrega mínima (% del total). Solo el Administrador.
 */
import { useEffect, useState } from "react";
import { CalendarRange, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import { EncabezadoPagina } from "@/components/EncabezadoPagina";
import { Select } from "@/components/Select";
import { apiFetch } from "@/lib/api/client-fetch";
import { Aviso, Interruptor, Tarjeta } from "@/modules/facturacion/ui";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, ET, INPUT } from "@/modules/inventario/ui";
import { OPCIONES_CADA, type CadaCuota, type PlanesCuota } from "@/modules/caja/cuotas";

type Fila = { id: string | null; nombre: string; cuotas: string; cada: CadaCuota; primera_dias: string; entrega_pct: string; activo: boolean; clave: string };

const aFila = (p: PlanesCuota["planes"][number]): Fila => ({
  id: p.id, nombre: p.nombre, cuotas: String(p.cuotas), cada: p.cada, primera_dias: String(p.primera_dias),
  entrega_pct: p.entrega_pct ? String(Number(p.entrega_pct)) : "", activo: p.activo, clave: p.id,
});

export default function PlanesCuotasPage() {
  const [max, setMax] = useState("120");
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Receta 135: interés por mora (para todos los rubros; arranca apagado).
  const [mora, setMora] = useState<{ activa: boolean; tasa: string; gracia: string; iva: string } | null>(null);
  const cargar = (d: PlanesCuota) => { setMax(String(d.max_cuotas)); setFilas(d.planes.map(aFila)); };
  useEffect(() => {
    apiFetch<PlanesCuota>("/api/cuotas/planes").then(cargar).catch((e: Error) => setError(e.message));
    apiFetch<{ activa: boolean; tasa: number; gracia: number; iva: string }>("/api/configuracion/mora")
      .then((m) => setMora({ activa: m.activa, tasa: String(Number(m.tasa)).replace(".", ","), gracia: String(m.gracia), iva: m.iva }))
      .catch(() => {});
  }, []);

  const cambiar = (i: number, p: Partial<Fila>) => { setFilas((f) => f!.map((x, j) => (j === i ? { ...x, ...p } : x))); setOk(null); setError(null); };
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  async function guardar() {
    if (!filas) return;
    setGuardando(true);
    setError(null);
    try {
      const d = await apiFetch<PlanesCuota>("/api/cuotas/planes", {
        method: "PUT",
        body: JSON.stringify({
          max_cuotas: parseInt(max) || 0,
          planes: filas.map((f) => ({ id: f.id, nombre: f.nombre.trim(), cuotas: parseInt(f.cuotas) || 0, cada: f.cada,
            primera_dias: parseInt(f.primera_dias) || 30, entrega_pct: num(f.entrega_pct), activo: f.activo })),
        }),
      });
      cargar(d);
      if (mora) {
        await apiFetch("/api/configuracion/mora", { method: "PUT", body: JSON.stringify({ activa: mora.activa, tasa: num(mora.tasa), gracia: parseInt(mora.gracia) || 0, iva: mora.iva }) });
      }
      setOk("Guardado.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5 pb-28 sm:pb-10">
      <EncabezadoPagina
        volver={{ href: "/configuracion", label: "Configuración" }}
        kicker="Configuración"
        titulo="Planes de cuotas y mora"
        subtitulo="Hasta cuántas cuotas se puede vender a crédito, los planes que se eligen al vender (por ejemplo, un lote en 120 cuotas con 10 % de entrega) y el interés por atraso."
      />

      {error ? <Aviso tono="error">{error}</Aviso> : null}
      {ok ? <Aviso tono="ok">{ok}</Aviso> : null}

      <Tarjeta icono={<CalendarRange className="h-4 w-4" />} titulo="Máximo de cuotas" detalle="Vale para la caja, los presupuestos y la venta de propiedades. Hasta 360.">
        <label className="block max-w-40">
          <span className={ET}>Cuotas como máximo</span>
          <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={max} onChange={(e) => { setMax(e.target.value.replace(/\D/g, "").slice(0, 3)); setOk(null); }} />
        </label>
      </Tarjeta>

      <Tarjeta icono={<CalendarRange className="h-4 w-4" />} titulo="Planes" detalle="Al vender se elige un plan y quedan puestas las cuotas, cada cuánto y la entrega mínima. También se puede vender sin plan, con las cuotas a mano.">
        {!filas ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        ) : (
          <div className="space-y-3">
            {filas.length === 0 ? <p className="text-sm text-slate-500">Todavía no hay planes.</p> : null}
            {filas.map((f, i) => (
              <div key={f.clave} className={`rounded-xl border p-3 ${f.activo ? "border-slate-200" : "border-dashed border-slate-200 opacity-70"}`}>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[1.6fr_0.6fr_1fr_0.8fr_0.8fr_auto] sm:items-end">
                  <label className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className={ET}>Nombre</span>
                    <input className={INPUT} value={f.nombre} maxLength={80} placeholder="Ej: 120 cuotas con 10 % de entrega" onChange={(e) => cambiar(i, { nombre: e.target.value })} />
                  </label>
                  <label className="block min-w-0">
                    <span className={ET}>Cuotas</span>
                    <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={f.cuotas} onChange={(e) => cambiar(i, { cuotas: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                  </label>
                  <div className="min-w-0">
                    <span className={ET}>Cada</span>
                    <Select block value={f.cada} onChange={(v) => cambiar(i, { cada: v as CadaCuota })} options={OPCIONES_CADA} etiqueta="Cada cuánto se paga" />
                  </div>
                  <label className="block min-w-0">
                    <span className={ET}>1ª a (días)</span>
                    <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={f.primera_dias} onChange={(e) => cambiar(i, { primera_dias: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                  </label>
                  <label className="block min-w-0">
                    <span className={ET}>Entrega mín. (%)</span>
                    <input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={f.entrega_pct} placeholder="0" onChange={(e) => cambiar(i, { entrega_pct: e.target.value.replace(/[^\d.,]/g, "").slice(0, 5) })} />
                  </label>
                  <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                    <button type="button" onClick={() => cambiar(i, { activo: !f.activo })} className="min-h-11 rounded-xl px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100">{f.activo ? "Desactivar" : "Activar"}</button>
                    <button type="button" aria-label="Quitar el plan" onClick={() => { setFilas((x) => x!.filter((_, j) => j !== i)); setOk(null); }} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setFilas((x) => [...(x ?? []), { id: null, nombre: "", cuotas: "12", cada: "mes", primera_dias: "30", entrega_pct: "", activo: true, clave: `n${Date.now()}` }])}
              className={`${BOTON_SECUNDARIO} max-sm:min-h-11 max-sm:w-full`}>
              <Plus className="h-4 w-4" /> Agregar plan
            </button>
          </div>
        )}
      </Tarjeta>

      {mora ? (
        <Tarjeta icono={<Percent className="h-4 w-4" />} titulo="Interés por mora"
          detalle="Para cualquier rubro. Al cobrar, a cada cuota vencida hace más que los días de gracia se le suma el interés por los días de atraso (saldo × tasa mensual × días / 30). Se cobra primero y queda aparte del capital; quien tenga el permiso lo puede perdonar con un motivo.">
          <div className="space-y-3">
            <Interruptor activo={mora.activa} onChange={(v) => { setMora({ ...mora, activa: v }); setOk(null); }}
              etiqueta="Cobrar interés por mora" descripcion={mora.activa ? "Se calcula y se suma en la pantalla de cobro." : "Apagado: los cobros quedan como siempre."} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block min-w-0"><span className={ET}>Tasa mensual (%)</span>
                <input inputMode="decimal" className={`${INPUT} text-right tabular-nums`} value={mora.tasa} onChange={(e) => { setMora({ ...mora, tasa: e.target.value.replace(/[^\d.,]/g, "").slice(0, 5) }); setOk(null); }} /></label>
              <label className="block min-w-0"><span className={ET}>Días de gracia</span>
                <input inputMode="numeric" className={`${INPUT} text-right tabular-nums`} value={mora.gracia} onChange={(e) => { setMora({ ...mora, gracia: e.target.value.replace(/\D/g, "").slice(0, 2) }); setOk(null); }} /></label>
              <div className="min-w-0"><span className={ET}>IVA del interés</span>
                <Select block value={mora.iva} onChange={(v) => { setMora({ ...mora, iva: v }); setOk(null); }} options={[["10%", "10 %"], ["5%", "5 %"], ["EXENTA", "Exenta"]]} etiqueta="IVA del interés" /></div>
            </div>
          </div>
        </Tarjeta>
      ) : null}

      <div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:border-t max-sm:border-slate-200 max-sm:bg-white/95 max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:backdrop-blur sm:flex sm:justify-end">
        <button type="button" onClick={() => void guardar()} disabled={guardando || !filas} className={`${BOTON_PRIMARIO} bg-[var(--brand)] max-sm:min-h-11 max-sm:w-full`}>
          {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
        </button>
      </div>
    </div>
  );
}
