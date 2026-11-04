import type { Modulo } from "@/modules/types";

// Receta 123: rubro Sorteos. Todas las pantallas dependen de la función `sorteos` (Rubro y funciones):
// apagada, el módulo no aparece. Ver: sorteos_vender (Supervisor, Cajero y Vendedor al prenderla),
// revisar pagos: sorteos_revisar (Supervisor), administrar: sorteos_administrar (Administrador).
export const moduloSorteos: Modulo = {
  id: "sorteos",
  label: "Sorteos",
  palabras: ["rifa", "rifas", "boletas", "boletos", "cupones", "urna", "premios", "ganador", "vendedores", "combos"],
  href: "/sorteos/panel",
  panel: true,
  icon: "ticket",
  familia: "Sorteos",
  children: [
    { label: "Sorteos", href: "/sorteos", funcion: "sorteos", permiso: "sorteos_vender", palabras: ["premios", "urna", "cupones", "sortear"] },
    { label: "Vender", href: "/sorteos/vender", funcion: "sorteos", permiso: "sorteos_vender", palabras: ["venta manual", "boletas"] },
    { label: "Compras", href: "/sorteos/ventas", funcion: "sorteos", permiso: "sorteos_vender", palabras: ["ordenes", "compradores", "anular"] },
    { label: "Por revisar", href: "/sorteos/revision", funcion: "sorteos", permiso: "sorteos_revisar", palabras: ["comprobantes", "transferencias", "confirmar pagos"] },
    { label: "Vendedores", href: "/sorteos/vendedores", funcion: "sorteos", permiso: "sorteos_administrar", palabras: ["revendedores", "comisiones", "rendiciones", "referidos"] },
    { label: "WhatsApp", href: "/sorteos/whatsapp", funcion: "sorteos", permiso: "sorteos_administrar", palabras: ["bot", "chat", "venta automatica", "comprobantes", "ocr"] },
  ],
};
