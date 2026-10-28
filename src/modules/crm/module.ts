import type { Modulo } from "@/modules/types";

/** CRM Funnel: prospectos por etapa (Kanban / Lista), seguimiento y "Transformar a cliente". Sin submenú. */
export const moduloCrm: Modulo = {
  id: "crm",
  label: "CRM Funnel",
  palabras: ["prospectos", "leads", "embudo", "oportunidades"],
  href: "/crm",
  grupo: "comercial",
  icon: "sparkles",
  familia: "Comercial",
  atajos: [{ label: "Nuevo prospecto", href: "/crm/nuevo" }],
};
