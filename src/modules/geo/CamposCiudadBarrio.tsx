"use client";

/**
 * Selectores de ciudad y barrio de Paraguay: primero la ciudad y después solo sus barrios. Se guardan
 * como texto. Si el dato no está en la lista del INE (o ya estaba escrito distinto) se escribe a mano.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetchCache } from "@/lib/api/cache-cliente";
import { Select } from "@/components/Select";

type Ciudad = { codigo: string; nombre: string; departamento: string };
const OTRO = "__otro";

function Boton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="mt-1 min-h-9 text-xs font-medium text-[var(--brand)] hover:underline max-sm:min-h-11">{children}</button>;
}

export function CamposCiudadBarrio({ ciudad, barrio, onCiudad, onBarrio, claseInput, Campo }: {
  ciudad: string;
  barrio: string;
  onCiudad: (v: string) => void;
  onBarrio: (v: string) => void;
  claseInput: string;
  /** Envoltura con la etiqueta, la del formulario que los usa. */
  Campo: (p: { label: string; children: ReactNode }) => ReactNode;
}) {
  const [ciudades, setCiudades] = useState<Ciudad[] | null>(null);
  const [barrios, setBarrios] = useState<string[] | null>(null);
  const [ciudadLibre, setCiudadLibre] = useState(false);
  const [barrioLibre, setBarrioLibre] = useState(false);

  useEffect(() => {
    apiFetchCache<Ciudad[]>("/api/geo").then(setCiudades).catch(() => setCiudades([]));
  }, []);

  // Hay dos Bella Vista: en esos casos se guarda con el departamento.
  const opciones = useMemo(() => (ciudades ?? []).map((c, _i, l) => ({
    ...c,
    valor: l.filter((x) => x.nombre === c.nombre).length > 1 ? `${c.nombre} (${c.departamento})` : c.nombre,
  })), [ciudades]);
  const elegida = opciones.find((c) => c.valor.toLowerCase() === ciudad.trim().toLowerCase()) ?? null;
  const codigo = elegida?.codigo ?? null;

  useEffect(() => {
    setBarrios(null);
    if (!codigo) return;
    let vivo = true;
    apiFetchCache<string[]>(`/api/geo?ciudad=${codigo}`).then((b) => { if (vivo) setBarrios(b); }).catch(() => { if (vivo) setBarrios([]); });
    return () => { vivo = false; };
  }, [codigo]);

  const sinCatalogo = ciudades !== null && !elegida && ciudad.trim() !== "";
  const escribeCiudad = ciudadLibre || sinCatalogo || ciudades?.length === 0;
  const barrioElegido = barrios?.find((b) => b.toLowerCase() === barrio.trim().toLowerCase()) ?? null;
  const escribeBarrio = escribeCiudad || barrioLibre || (barrios !== null && barrio.trim() !== "" && !barrioElegido);

  return (
    <>
      <Campo label="Ciudad">
        {escribeCiudad ? (
          <>
            <input className={claseInput} value={ciudad} onChange={(e) => onCiudad(e.target.value)} placeholder="Escribí la ciudad" />
            {opciones.length ? <Boton onClick={() => { setCiudadLibre(false); onCiudad(""); onBarrio(""); }}>Elegir de la lista</Boton> : null}
          </>
        ) : (
          <Select block etiqueta="Ciudad" disabled={!ciudades} value={elegida?.valor ?? ""}
            options={[["", ciudades ? "Elegí la ciudad" : "Cargando…"], ...opciones.map((c): [string, string] => [c.valor, c.nombre === c.departamento ? c.nombre : `${c.nombre} · ${c.departamento}`]), [OTRO, "No está en la lista: escribirla"]]}
            onChange={(v) => { setBarrioLibre(false); onBarrio(""); if (v === OTRO) { setCiudadLibre(true); onCiudad(""); } else onCiudad(v); }} />
        )}
      </Campo>
      <Campo label="Barrio">
        {escribeBarrio ? (
          <>
            <input className={claseInput} value={barrio} onChange={(e) => onBarrio(e.target.value)} placeholder="Escribí el barrio" />
            {barrios?.length ? <Boton onClick={() => { setBarrioLibre(false); onBarrio(""); }}>Elegir de la lista</Boton> : null}
          </>
        ) : (
          <Select block etiqueta="Barrio" disabled={!codigo || !barrios} value={barrioElegido ?? ""}
            options={[["", !codigo ? "Primero elegí la ciudad" : barrios ? "Elegí el barrio" : "Cargando…"], ...(barrios ?? []).map((b): [string, string] => [b, b]), [OTRO, "No está en la lista: escribirlo"]]}
            onChange={(v) => { if (v === OTRO) { setBarrioLibre(true); onBarrio(""); } else onBarrio(v); }} />
        )}
      </Campo>
    </>
  );
}
