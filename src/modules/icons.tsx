/**
 * Resolución de íconos por nombre (lucide-react). Cada módulo declara `icon: "wallet"`
 * y acá se traduce al componente. Centralizado para que el sidebar y el dashboard usen
 * el mismo set y agregar un módulo no toque más que su propio manifiesto.
 */
import { Banknote, BarChart3, CalendarDays, Coins, LayoutGrid, LifeBuoy, Users, UserSearch, Wallet, Package, FileText, Truck, ShoppingCart, Sparkles, MessagesSquare, ListChecks, Activity, History, FolderKanban, Scale, Receipt, FileSignature, WalletCards, UserCog, Building2, ReceiptText, Settings, Landmark, type LucideIcon } from "lucide-react";

const ICONOS: Record<string, LucideIcon> = {
  wallet: Wallet,
  users: Users,
  package: Package,
  "file-text": FileText,
  chart: BarChart3,
  truck: Truck,
  cart: ShoppingCart,
  lifebuoy: LifeBuoy,
  file: FileText,
  calendar: CalendarDays,
  coins: Coins,
  banknote: Banknote,
  "user-search": UserSearch,
  sparkles: Sparkles,
  messages: MessagesSquare,
  "list-checks": ListChecks,
  activity: Activity,
  history: History,
  folder: FolderKanban,
  scale: Scale,
  receipt: Receipt,
  "file-signature": FileSignature,
  "wallet-cards": WalletCards,
  "user-cog": UserCog,
  building: Building2,
  "receipt-text": ReceiptText,
  settings: Settings,
  landmark: Landmark,
};

export function iconoModulo(nombre?: string): LucideIcon {
  return (nombre && ICONOS[nombre]) || LayoutGrid;
}
