"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, CircleDollarSign, TriangleAlert, Users } from "lucide-react";
import { apiFetch } from "@/lib/api/client-fetch";
import { modulosActivos } from "@/modules/registry";
import { iconoModulo } from "@/modules/icons";
import { clienteConfig } from "@/cliente.config";
import { formatGs } from "@/modules/caja/lib";

const BRAND = clienteConfig.color;

type CajaAbierta = { numero_caja: number; monto_apertura: number } | null;
type Resumen = { caja: CajaAbierta; productos: number; sin_stock: number; clientes: number };

export default function Dashboard() {
  const modulos = useMemo(() => modulosActivos(), []);
  const [caja, setCaja] = useState<CajaAbierta>(null);
  const [totalProd, setTotalProd] = useState<number | null>(null);
  const [stockBajo, setStockBajo] = useState<number | null>(null);
  const [clientes, setClientes] = useState<number | null>(null);

  // Un solo pedido con los conteos (antes: catálogo entero + 500 clientes para un .length).
  useEffect(() => {
    apiFetch<Resumen>("/api/dashboard")
      .then((r) => {
        setCaja(r.caja);
        setTotalProd(r.productos);
        setStockBajo(r.sin_stock);
        setClientes(r.clientes);
      })
      .catch(() => {
        setTotalProd(0);
        setStockBajo(0);
      });
  }, []);

  const hora = new Date().getHours();
  const saludo = hora < 12 ? "Buen día" : hora < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <div className="space-y-7">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{saludo} 👋</h1>
        <p className="mt-1 text-sm text-slate-500">
          Resumen de <span className="font-medium text-slate-600">{clienteConfig.nombre}</span>.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          titulo="Caja"
          Icon={CircleDollarSign}
          valor={caja ? `N° ${caja.numero_caja}` : "Cerrada"}
          detalle={caja ? `Apertura ${formatGs(caja.monto_apertura)}` : "Abrí la caja para vender"}
          tono={caja ? "ok" : "muted"}
          href="/caja"
        />
        <Kpi
          titulo="Productos"
          Icon={Boxes}
          valor={totalProd === null ? "…" : String(totalProd)}
          detalle="Catálogo activo"
        />
        <Kpi
          titulo="Sin stock"
          Icon={TriangleAlert}
          valor={stockBajo === null ? "…" : String(stockBajo)}
          detalle="Productos agotados"
          tono={stockBajo && stockBajo > 0 ? "warn" : "ok"}
        />
        <Kpi
          titulo="Clientes"
          Icon={Users}
          valor={clientes === null ? "…" : String(clientes)}
          detalle="Registrados"
          href="/clientes"
        />
      </div>

      {/* Accesos a módulos */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modulos.map((m) => {
            const Icon = iconoModulo(m.icon);
            return (
              <Link
                key={m.id}
                href={m.href}
                className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors"
                  style={{ backgroundColor: "var(--brand-50)", color: BRAND }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800">{m.label}</div>
                  <div className="text-xs text-slate-400">Abrir módulo</div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5" style={{ color: BRAND }} />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  detalle,
  Icon,
  tono = "brand",
  href,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  Icon: React.ComponentType<{ className?: string }>;
  tono?: "brand" | "ok" | "warn" | "muted";
  href?: string;
}) {
  const colores = {
    brand: { bg: "var(--brand-50)", fg: BRAND },
    ok: { bg: "#ecfdf5", fg: "#059669" },
    warn: { bg: "#fff7ed", fg: "#ea580c" },
    muted: { bg: "#f1f5f9", fg: "#64748b" },
  }[tono];

  const card = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{titulo}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: colores.bg, color: colores.fg }}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{valor}</div>
      <div className="mt-0.5 text-xs text-slate-400">{detalle}</div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}
