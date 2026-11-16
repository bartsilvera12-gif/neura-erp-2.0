/**
 * Manual de usuario: una guía por tarea. Cada guía declara la pantalla que explica (`ruta`), así se
 * muestra solo si esa pantalla existe en el rubro activo y el perfil la puede abrir.
 *
 * Los pasos con `marca` llevan su número sobre la imagen: `marca` es el texto del botón o campo en esa
 * captura, y su posición sale de marcas.json (generado midiendo la pantalla real).
 */
/** t: la frase grande, una sola acción. d: aclaración, en letra chica. */
export type Paso = { t: string; d?: string; marca?: string };
export type Bloque = { img?: string; alt?: string; pasos?: Paso[]; texto?: string; consejo?: string; ojo?: string; /** Solo en este rubro. */ rubro?: "comercio" | "gastronomia" };
export type Guia = {
  id: string;
  grupo: string;
  titulo: string;
  resumen: string;
  /** Pantalla que explica. Sin ruta: se muestra siempre. */
  ruta?: string;
  /**
   * Solo para este rubro. comercio/gastronomia: la guía del día a día. Un rubro de módulo
   * (inmobiliaria, sorteos, gimnasio): se ve si la empresa tiene esa función prendida.
   */
  rubro?: "comercio" | "gastronomia" | "inmobiliaria" | "sorteos" | "gimnasio" | "comedor";
  bloques: Bloque[];
};

export const GRUPOS = ["Primeros pasos", "Caja y ventas", "Pedidos y mesas", "Cocina y recetas", "Inventario", "Compras y gastos", "Clientes y ventas", "Cobros", "Sorteos", "Inmobiliaria", "Asistencia", "Comedor", "Reportes", "Atención al cliente", "RR HH", "Configuración"];

/** Cómo se llega a la pantalla de cada guía: la sección del menú y la tarjeta de su panel. */
export const LLEGAR: Record<string, [string, string?]> = {
  "abrir-caja": ["Caja", "Apertura y cierre"], retiro: ["Caja", "Apertura y cierre"], "cerrar-caja": ["Caja", "Apertura y cierre"],
  vender: ["Caja", "Nueva venta"], factura: ["Caja", "Nueva venta"], credito: ["Caja", "Nueva venta"],
  ordenes: ["Caja", "Órdenes de venta"], "nota-credito": ["Caja", "Órdenes de venta"],
  pedidos: ["Caja", "Pedidos"], mesas: ["Caja", "Pedidos de mesas"], cocina: ["Caja", "Cocina"],
  "mesas-config": ["Configuración", "Mesas y QR"],
  recetas: ["Inventario", "Recetas"], produccion: ["Inventario", "Producción"],
  productos: ["Inventario", "Productos"], "producto-nuevo": ["Inventario", "Productos"], ajustes: ["Inventario", "Ajustes y pérdidas"],
  traslados: ["Inventario", "Traslados"], movimientos: ["Inventario", "Movimientos"], vencimientos: ["Inventario", "Vencimientos"],
  categorias: ["Inventario", "Categorías"], depositos: ["Inventario", "Depósitos"],
  compra: ["Gastos empresariales", "Compras y gastos"], "orden-compra": ["Gastos empresariales", "Órdenes de compra"],
  proveedor: ["Gastos empresariales", "Proveedores"], "pagar-proveedor": ["Gastos empresariales", "Pagos a proveedores"], recurrentes: ["Gastos empresariales", "Recurrentes"],
  cliente: ["Comercial", "Clientes"], crm: ["Comercial", "CRM Funnel"], presupuestos: ["Comercial", "Presupuestos"], gestion: ["Comercial", "Gestión Clientes"],
  comisiones: ["Comercial", "Comisiones"], planes: ["Comercial", "Planes"], agenda: ["Comercial", "Agenda"],
  "cobrar-deuda": ["Finanzas", "Pagos"], conciliacion: ["Finanzas", "Conciliación"], cobranzas: ["Finanzas", "Cobranzas"],
  reportes: ["Reportes"], omnicanal: ["Omnicanal", "Conversaciones"], soporte: ["Soporte"], "whatsapp-canal": ["Omnicanal", "Canales de WhatsApp"],
  empresa: ["Configuración", "Datos de la empresa"], facturacion: ["Configuración", "Tickets y facturación"], usuarios: ["Configuración", "Usuarios"],
  rubro: ["Configuración", "Rubro y funciones"], "config-comisiones": ["Configuración", "Comisiones"],
  "rrhh-datos": ["RR HH", "Personal"], "rrhh-salario": ["RR HH", "Personal"], "rrhh-ausencia": ["RR HH", "Personal"], "rrhh-vacaciones": ["RR HH", "Personal"],
  "rrhh-historial": ["RR HH", "Personal"], "rrhh-liquidacion": ["RR HH", "Liquidaciones"],
  "sorteo-crear": ["Sorteos", "Sorteos"], "sorteo-vender": ["Sorteos", "Vender"], "sorteo-revisar": ["Sorteos", "Por revisar"],
  "sorteo-vendedor": ["Sorteos", "Vendedores"], "sorteo-whatsapp": ["Sorteos", "WhatsApp"], "sorteo-sortear": ["Sorteos", "Sorteos"],
  "inmo-propiedad": ["Inmobiliaria", "Propiedades"], "inmo-vender": ["Inmobiliaria", "Propiedades"], "inmo-caja": ["Caja", "Nueva venta"],
  "inmo-alquiler": ["Inmobiliaria", "Alquileres"], "inmo-cobrar-alquiler": ["Inmobiliaria", "Alquileres"], "inmo-busqueda": ["Comercial", "Clientes"],
  "inmo-avisos": ["Inmobiliaria", "Propiedades"], "inmo-planes": ["Configuración", "Planes de cuotas y mora"],
  "gim-clase": ["Asistencia", "Clases"], "gim-reglas": ["Asistencia", "Clases"], "gim-membresia": ["Comercial", "Planes"],
  "gim-alumno": ["Asistencia", "Recepción"], "gim-asistencia": ["Asistencia", "Recepción"], "gim-turno": ["Asistencia", "Recepción"],
  "gim-comisiones": ["Asistencia", "Comisiones de profesores"], "gim-autoasistencia": ["Asistencia", "Que el alumno marque solo"],
  "comedor-empresa": ["Comedor", "Configuración del comedor"], "comedor-padron": ["Comedor", "Funcionarios"],
  "comedor-menu": ["Comedor", "Menú semanal"], "comedor-reserva": ["Comedor", "Menú semanal"],
  "comedor-retiro": ["Comedor", "Retiro"], "comedor-cantina": ["Comedor", "Cantina"], "comedor-liquidacion": ["Comedor", "Liquidación"],
};
/** La captura del panel que abre cada sección del menú. */
export const PANELES: Record<string, string> = {
  Caja: "panel-caja", Inventario: "panel-inventario", "Gastos empresariales": "panel-gastos", Comercial: "panel-comercial",
  Finanzas: "panel-finanzas", Omnicanal: "panel-omnicanal", Configuración: "panel-config", "RR HH": "rrhh-panel",
  Sorteos: "panel-sorteos", Inmobiliaria: "inmo-panel", Asistencia: "gim-panel",
};
/** La captura donde se ve la sección en el menú, si no es la de Inicio. */
export const MENUS: Record<string, string> = { "RR HH": "rrhh-panel", Sorteos: "sorteos-menu", Inmobiliaria: "inmo-menu", Asistencia: "gim-menu" };

export const GUIAS: Guia[] = [
  // ── Primeros pasos ───────────────────────────────────────────────────────────
  {
    id: "dia-comercio", grupo: "Primeros pasos", rubro: "comercio", titulo: "Un día de trabajo en tu negocio", resumen: "El orden de las tareas, de la mañana a la noche.",
    bloques: [
      { texto: "Si recién empezás, leé esto primero. Cada paso tiene su guía propia en este manual, con imágenes." },
      { pasos: [
        { t: "A la mañana, abrí la caja y anotá con cuánto cambio arrancás." },
        { t: "Si trabajás con vendedores, ellos arman el pedido del cliente y lo mandan a caja." },
        { t: "El cajero cobra: los pedidos que llegan o las ventas directas.", d: "El stock baja solo." },
        { t: "Cuando llega mercadería, cargá la factura como compra.", d: "El stock sube y el costo se actualiza solo." },
        { t: "Cuando un cliente te paga una deuda, registrá el cobro." },
        { t: "A la noche, contá el efectivo y cerrá la caja.", d: "Si algo no coincide, el sistema te pide el motivo." },
      ] },
      { consejo: "Cerrá la caja todos los días. Así, si falta plata, sabés de qué día es y se encuentra rápido." },
    ],
  },
  {
    id: "dia-gastronomia", grupo: "Primeros pasos", rubro: "gastronomia", titulo: "Un día de trabajo en tu local", resumen: "El orden de las tareas, de la apertura al cierre.",
    bloques: [
      { texto: "Si recién empezás, leé esto primero. Cada paso tiene su guía propia en este manual, con imágenes." },
      { pasos: [
        { t: "Antes de abrir, abrí la caja y anotá con cuánto cambio arrancás." },
        { t: "El cliente escanea el QR de su mesa y hace el pedido desde su celular." },
        { t: "La caja acepta el pedido en Pedidos de mesas, y pasa a la cocina." },
        { t: "La cocina lo prepara y lo marca como listo.", d: "Los ingredientes se descuentan cuando se cobra." },
        { t: "Cuando la mesa pide la cuenta, se envía a caja y se cobra." },
        { t: "Si fabricás algo por tanda, registralo en Producción para que el stock esté al día." },
        { t: "Al cerrar, contá el efectivo y cerrá la caja.", d: "Si algo no coincide, el sistema te pide el motivo." },
      ] },
      { consejo: "Cerrá la caja todos los días. Así, si falta plata, sabés de qué día es y se encuentra rápido." },
    ],
  },
  {
    id: "moverse", grupo: "Primeros pasos", titulo: "Cómo moverte por el sistema", resumen: "El menú, el buscador, los avisos y tu cuenta.",
    bloques: [
      { img: "inicio", alt: "Pantalla de Inicio con el menú a la izquierda", pasos: [
        { t: "Tocá una sección del menú para entrar.", d: "En el celular, el menú se abre con el botón de las tres rayitas.", marca: "Caja" },
        { t: "¿No encontrás una pantalla? Tocá Buscar.", d: "Escribí lo que necesitás, por ejemplo «cerrar caja». También abre con la tecla /.", marca: "Buscar…" },
        { t: "La campanita avisa lo que necesita tu atención.", d: "El número rojo dice cuántos avisos tenés.", marca: "2" },
        { t: "El botón Manual abre esta ayuda, desde cualquier pantalla.", marca: "Manual" },
        { t: "Tocá tu nombre para salir del sistema.", d: "Si la computadora la usan varios, salí siempre al terminar.", marca: "admin@demo.neura.com.py" },
      ] },
      { consejo: "Solo ves las pantallas que tu perfil tiene habilitadas. Si te falta alguna, pedísela al administrador." },
    ],
  },
  {
    id: "inicio", grupo: "Primeros pasos", ruta: "/", titulo: "Entender la pantalla de Inicio", resumen: "Cómo viene el negocio, de un vistazo.",
    bloques: [
      { img: "inicio", alt: "Cifras de ventas en la pantalla de Inicio", pasos: [
        { t: "Ventas de hoy: lo que vendiste hoy, comparado con el mismo día de la semana pasada.", marca: "VENTAS DE HOY" },
        { t: "Esta semana y Este mes: lo mismo, por períodos más largos.", marca: "ESTE MES" },
        { t: "Ticket promedio: cuánto gasta en promedio cada cliente por venta.", marca: "TICKET PROMEDIO" },
        { t: "Ganancia bruta: lo vendido menos lo que costó esa mercadería.", d: "No descuenta alquiler ni sueldos.", marca: "GANANCIA BRUTA DEL MES" },
        { t: "Si tenés más de una sucursal, acá elegís cuál mirar.", marca: "Todas las sucursales" },
      ] },
      { texto: "Más abajo tenés el gráfico de ventas por día (tocá un día para ver su cierre de caja), lo más vendido, cómo te pagan y el estado del inventario." },
    ],
  },

  // ── Caja y ventas ────────────────────────────────────────────────────────────
  {
    id: "abrir-caja", grupo: "Caja y ventas", ruta: "/caja/turnos", titulo: "Abrir la caja", resumen: "Lo primero del día: sin caja abierta no se puede vender.",
    bloques: [
      { img: "caja-turnos", alt: "Pantalla Apertura y cierre", pasos: [
        { t: "Tocá Abrir caja.", marca: "Abrir caja" },
      ] },
      { img: "caja-abrir", alt: "Ventana para abrir una caja", pasos: [
        { t: "Elegí la caja que vas a usar.", d: "Las que dicen Abierta ya están en uso.", marca: "Caja 2" },
        { t: "Contá el cambio del cajón y tocá el monto.", d: "También podés escribirlo. Si no hay cambio, tocá Sin cambio.", marca: "Gs. 100.000" },
        { t: "Tocá el botón Abrir.", d: "Desde ese momento, todo lo que vendas y cobres queda en este turno.", marca: "Abrir Caja 2" },
      ] },
      { ojo: "Contá el cambio de verdad. A la noche, el sistema compara el efectivo contra este número." },
    ],
  },
  {
    id: "vender", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Hacer una venta", resumen: "De buscar el producto a entregar el ticket.",
    bloques: [
      { img: "venta-buscar", alt: "Buscador de productos con resultados", pasos: [
        { t: "Pasá el lector por el código de barras, o escribí el nombre del producto.", marca: "Arroz" },
        { t: "Tocá el producto en la lista, o apretá Enter para agregar el primero.", marca: "Arroz 1 kg" },
      ] },
      { img: "venta-item", alt: "Venta con un producto cargado y el total", pasos: [
        { t: "El producto aparece en la lista.", d: "Con − y + cambiás la cantidad. Repetí con todos los productos.", marca: "ARROZ1K" },
        { t: "Mirá el total.", d: "Es lo que tiene que pagar el cliente, con IVA incluido.", marca: "Total a cobrar" },
        { t: "Tocá Aceptar y cobrar.", marca: "Aceptar y cobrar" },
      ] },
      { img: "venta-cobrar", alt: "Ventana de cobro con las formas de pago", pasos: [
        { t: "Elegí cómo te paga: efectivo, débito, crédito, transferencia, QR o cheque.", marca: "Efectivo" },
        { t: "Si paga en efectivo, tocá el billete que te dio o escribí el monto.", d: "El sistema te dice cuánto vuelto dar.", marca: "Gs. 50.000" },
        { t: "¿Paga una parte de cada forma? Tocá acá.", marca: "Agregar otra forma de pago (mixto)" },
        { t: "Tocá Cobrar.", d: "La venta queda hecha, baja el stock y sale el ticket.", marca: "Cobrar e imprimir" },
      ] },
      { consejo: "Con teclado es más rápido: Enter agrega, Espacio cobra, + y − cambian la cantidad, Supr quita el producto y Esc limpia." },
      { ojo: "¿Te equivocaste antes de cobrar? Tocá Volver y corregí: todavía no se guardó nada." },
    ],
  },
  {
    id: "factura", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Ticket, factura y cliente", resumen: "Qué elegir según lo que pida el cliente.",
    bloques: [
      { img: "venta-vacia", alt: "Datos de la venta arriba de la pantalla", pasos: [
        { t: "Para un ticket común no hace falta cliente.", d: "Si querés que quede a su nombre, buscalo acá por nombre o RUC.", marca: "Buscar por nombre o RUC…" },
        { t: "Solo ticket es la opción normal: comprobante interno.", marca: "Solo ticket" },
        { t: "Factura se habilita cuando el cliente elegido tiene RUC cargado.", marca: "Factura" },
        { t: "¿Quiere factura y no está cargado? Tocá acá.", d: "Es la opción Facturar como cliente ocasional.", marca: "Facturar como cliente ocasional (X)" },
      ] },
      { ojo: "Sin RUC no hay factura. Si el cliente solo tiene CI, se le hace ticket o se usa cliente ocasional." },
    ],
  },
  {
    id: "credito", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Vender a crédito o en cuotas", resumen: "El cliente se lleva ahora y paga después.",
    bloques: [
      { img: "venta-credito", alt: "Venta a crédito con cuotas y vencimiento", pasos: [
        { t: "Tocá Crédito.", marca: "Crédito" },
        { t: "Elegí el cliente.", d: "A crédito es obligatorio, porque alguien tiene que quedar debiendo.", marca: "Cliente *" },
        { t: "Escribí en cuántas cuotas paga.", d: "Con 1, paga todo junto.", marca: "Cuotas" },
        { t: "Escribí en cuántos días vence.", d: "Abajo ves la fecha exacta.", marca: "Vence en" },
        { t: "Cargá los productos y cobrá como siempre.", d: "No entra plata a la caja: queda la deuda del cliente." },
      ] },
      { texto: "Cuando el cliente te pague, seguí la guía «Registrar el pago de una deuda»." },
      { ojo: "Si el cliente tiene límite de crédito y esta venta lo pasa, el sistema no te deja venderle." },
    ],
  },
  {
    id: "retiro", grupo: "Caja y ventas", ruta: "/caja/turnos", titulo: "Sacar o poner plata en la caja", resumen: "Depósitos, retiros del dueño y cambio extra.",
    bloques: [
      { img: "caja-turnos", alt: "Cajas con el botón de retiro", pasos: [
        { t: "Tocá Retiro / ingreso en tu caja.", marca: "Retiro / ingreso" },
      ] },
      { img: "caja-retiro", alt: "Ventana de retiro de efectivo", pasos: [
        { t: "Elegí Retiro si sale plata o Ingreso si entra.", marca: "Retiro" },
        { t: "Elegí el motivo.", d: "Si es otro, explicalo en el detalle.", marca: "Depósito en banco" },
        { t: "Escribí el monto.", d: "Arriba del botón ves cuánto debería haber en la caja.", marca: "Monto en efectivo" },
        { t: "Tocá Registrar.", marca: "Registrar retiro" },
      ] },
      { ojo: "Registrá siempre la plata que sacás. Si no, a la noche te va a faltar en el arqueo." },
    ],
  },
  {
    id: "cerrar-caja", grupo: "Caja y ventas", ruta: "/caja/turnos", titulo: "Cerrar la caja", resumen: "Contar la plata y terminar el turno.",
    bloques: [
      { img: "caja-turnos", alt: "Pantalla Apertura y cierre con las cajas abiertas", pasos: [
        { t: "Tocá Cerrar en tu caja.", marca: "Cerrar" },
      ] },
      { img: "caja-cerrar", alt: "Ventana de cierre de caja con el arqueo", pasos: [
        { t: "Contá el efectivo del cajón sin mirar la pantalla y escribí el total.", d: "También podés cargarlo por billete.", marca: "¿Cuánto efectivo contaste?" },
        { t: "Compará con lo que debería haber.", d: "Tocá Ver de dónde sale si querés entender el número.", marca: "Ver de dónde sale" },
        { t: "Confirmá las otras formas de pago contra el POS o la app del banco.", d: "Si un monto no coincide, corregilo.", marca: "OTRAS FORMAS DE PAGO · SE CONFIRMAN" },
        { t: "Si hay diferencia, explicá el motivo en la observación y confirmá el cierre.", marca: "Observación (opcional)" },
      ] },
      { ojo: "Una caja cerrada ya no se toca: no se puede vender en ella ni anular cobros que entraron ahí." },
    ],
  },
  {
    id: "ordenes", grupo: "Caja y ventas", ruta: "/caja", titulo: "Buscar una venta y anularla", resumen: "Ver qué se vendió, reimprimir o deshacer una venta.",
    bloques: [
      { img: "caja-ordenes", alt: "Lista de órdenes de venta", pasos: [
        { t: "Usá los filtros para achicar la lista por fecha, caja o forma de pago.", marca: "Todas las fechas" },
        { t: "Tocá una venta para ver el detalle.", marca: "VTA-005075" },
      ] },
      { img: "venta-detalle", alt: "Detalle de una venta", pasos: [
        { t: "Ver comprobante abre el ticket o la factura, para volver a imprimirlo.", marca: "Ver comprobante" },
        { t: "Si cargaste mal la forma de pago, tocá Corregir.", marca: "Corregir" },
        { t: "Anular venta deshace todo.", d: "Te pide el motivo, vuelve el stock y sale la plata de la caja.", marca: "Anular venta" },
        { t: "Si el cliente devuelve algo, usá Nota de crédito.", d: "Mirá la guía siguiente.", marca: "Nota de crédito" },
      ] },
      { ojo: "Una factura se puede anular solo dentro de las 48 horas. Después hay que hacer una nota de crédito." },
    ],
  },
  {
    id: "nota-credito", grupo: "Caja y ventas", ruta: "/caja/notas-credito", titulo: "Devolver un producto (nota de crédito)", resumen: "El cliente devuelve algo o le hacés un descuento después de la venta.",
    bloques: [
      { pasos: [
        { t: "Abrí la venta y tocá Nota de crédito." },
      ] },
      { img: "nc-modal", alt: "Ventana de nota de crédito", pasos: [
        { t: "Si devuelve mercadería, dejá Devolver productos.", marca: "Devolver productos" },
        { t: "Si solo le hacés un descuento, sin que devuelva nada, tocá Descuento por monto.", marca: "Descuento por monto" },
        { t: "Marcá cuántos devuelve, o tocá Devolver todo.", d: "Si la mercadería sirve, dejala volver al stock; si está rota, no.", marca: "Devolver todo" },
        { t: "Escribí el motivo.", d: "Después elegí qué pasa con la plata: devolverla, o dejarla a favor del cliente.", marca: "Motivo *" },
        { t: "Tocá Emitir nota.", marca: "Emitir nota" },
      ] },
      { img: "caja-nc", alt: "Lista de notas de crédito", pasos: [
        { t: "Todas las notas quedan en Caja › Notas de crédito.", d: "Tocá una para ver el detalle o anularla.", marca: "NC-000001" },
      ] },
      { consejo: "Si la venta era a crédito y todavía no pagó, la nota baja lo que debe: no sale plata de la caja." },
    ],
  },

  // ── Pedidos y mesas ──────────────────────────────────────────────────────────
  {
    id: "pedidos", grupo: "Pedidos y mesas", ruta: "/caja/pedidos", titulo: "Pedidos de mostrador", resumen: "El vendedor arma el pedido y la caja lo cobra.",
    bloques: [
      { img: "caja-pedidos", alt: "Pantalla de pedidos de mostrador", pasos: [
        { t: "Buscá los productos arriba o escaneá el código." },
        { t: "Si el cliente te da sus datos, elegilo.", d: "No es obligatorio.", marca: "Cliente (opcional)" },
        { t: "Si hace falta, escribí una aclaración.", marca: "Nota (opcional)" },
        { t: "Tocá Enviar a caja.", d: "El pedido recibe un número: decíselo al cliente.", marca: "Enviar a caja" },
        { t: "Abajo ves los pedidos del día y en qué estado están.", marca: "Pedidos de hoy" },
      ] },
      { img: "venta-porcobrar-pedido", alt: "Nueva venta con los pedidos por cobrar", pasos: [
        { t: "En Nueva venta, el cajero toca Pedidos por cobrar.", d: "Elige el pedido del cliente y se carga solo.", marca: "Pedidos por cobrar" },
        { t: "Después cobra como en una venta común.", d: "La comisión es de quien armó el pedido." },
      ] },
      { consejo: "El stock baja recién cuando se cobra. Un pedido sin cobrar no descuenta nada." },
    ],
  },
  {
    id: "mesas-config", grupo: "Pedidos y mesas", ruta: "/configuracion/mesas", titulo: "Crear mesas e imprimir los QR", resumen: "Se hace una sola vez, al empezar.",
    bloques: [
      { img: "config-mesas", alt: "Lista de mesas con sus QR", pasos: [
        { t: "Tocá Nueva mesa.", marca: "Nueva mesa" },
        { t: "Tocá Imprimir QR y pegá cada uno en su mesa.", marca: "Imprimir QR" },
        { t: "En Estaciones de cocina creás los sectores que preparan: Plancha, Barra, Pizzería…", marca: "Estaciones de cocina" },
      ] },
      { img: "mesa-nueva", alt: "Formulario de nueva mesa", pasos: [
        { t: "Elegí la sucursal.", marca: "Sucursal *" },
        { t: "Poné el nombre, por ejemplo «Mesa 5».", marca: "Nombre *" },
        { t: "Si querés, agregá la zona, por ejemplo «Terraza».", marca: "Zona (opcional)" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
    ],
  },
  {
    id: "mesas", grupo: "Pedidos y mesas", ruta: "/caja/mesas", titulo: "Atender los pedidos de las mesas", resumen: "Aceptar lo que piden y cobrar la cuenta.",
    bloques: [
      { img: "caja-mesas", alt: "Pantalla Pedidos de mesas", pasos: [
        { t: "Dejá prendido el Sonido para enterarte de los pedidos.", d: "Los pedidos que hacen los clientes por QR aparecen acá solos.", marca: "Sonido" },
        { t: "Los pedidos que llegan aparecen en Nuevos.", marca: "Nuevos" },
        { t: "Tocá Aceptar y el pedido pasa a la cocina.", marca: "Aceptar" },
        { t: "Si no se puede hacer, tocá Rechazar.", marca: "Rechazar" },
        { t: "En Cuentas abiertas ves lo que lleva cada mesa.", marca: "Cuentas abiertas" },
        { t: "Cuando la mesa pide la cuenta, tocá Enviar a caja.", marca: "Enviar a caja" },
      ] },
      { img: "venta-porcobrar-mesa", alt: "Nueva venta con las mesas por cobrar", pasos: [
        { t: "En Nueva venta, el cajero toca Mesas por cobrar.", d: "Elige la mesa y se carga sola.", marca: "Mesas por cobrar" },
        { t: "Después cobra como en una venta común." },
      ] },
      { img: "mesa-partes", alt: "Mesa con la cuenta separada en partes", texto: "El cliente puede dividir la cuenta desde su celular. A la caja llega cada parte por separado.", pasos: [
        { t: "Si la cuenta está dividida, tocá Cobrar en la parte de cada persona.", d: "También podés cobrar todo junto.", marca: "Laura" },
      ] },
      { img: "mesa-parte-cargada", alt: "La parte de una persona cargada para cobrar", pasos: [
        { t: "Mirá el total: es solo lo de esa persona.", marca: "Total a cobrar" },
        { t: "Tocá Aceptar y cobrar.", d: "La cuenta se cierra sola cuando se paga la última parte.", marca: "Aceptar y cobrar" },
      ] },
      { ojo: "Las ventas de mesa no comisionan." },
    ],
  },

  // ── Cocina y recetas ─────────────────────────────────────────────────────────
  {
    id: "cocina", grupo: "Cocina y recetas", ruta: "/caja/cocina", titulo: "Pantalla de cocina", resumen: "Qué preparar y en qué orden.",
    bloques: [
      { img: "caja-cocina", alt: "Pantalla de cocina con tres columnas", pasos: [
        { t: "Elegí tu estación para ver solo lo tuyo.", marca: "Todas" },
        { t: "Lo nuevo entra en Para preparar, con el número de mesa.", d: "Marcalo cuando empezás a hacerlo.", marca: "Para preparar" },
        { t: "Cuando esté terminado, tocá Listo.", d: "Mientras tanto, queda en En preparación.", marca: "Listo" },
        { t: "Queda en Listos para llevar: la caja lo ve y el mozo lo retira.", marca: "Listos para llevar" },
        { t: "Si querés la comanda en papel, prendé Imprimir al llegar.", marca: "Imprimir al llegar" },
        { t: "Pantalla completa deja solo la cocina a la vista, ideal para una tablet.", marca: "Pantalla completa" },
      ] },
    ],
  },
  {
    id: "recetas", grupo: "Cocina y recetas", ruta: "/inventario/recetas", titulo: "Cargar recetas", resumen: "Para que cada plato descuente sus ingredientes y sepas cuánto te cuesta.",
    bloques: [
      { texto: "Primero tienen que existir los productos: cada ingrediente como «Materia prima» y cada plato como «Menú». Mirá la guía «Cargar un producto nuevo»." },
      { img: "inventario-recetas", alt: "Lista de recetas con costo y margen", pasos: [
        { t: "Tocá un plato para cargarle sus ingredientes, cantidades y merma.", marca: "Empanada de carne" },
        { t: "Acá ves cuántas recetas están completas.", d: "También a cuáles les falta un ingrediente y cuáles no tienen receta.", marca: "COMPLETAS" },
        { t: "Mirá para cuántas porciones te alcanza.", d: "La tabla también muestra el costo y el margen.", marca: "ALCANZA PARA" },
        { t: "Nueva receta lista tus platos y materias primas: tocá al que le vas a cargar la receta.", d: "Una materia prima con receta es una preparación que usás en otros platos, por ejemplo una salsa.", marca: "Nueva receta" },
      ] },
      { img: "receta-detalle", alt: "Receta de un plato con sus ingredientes", pasos: [
        { t: "En Ingredientes cargá lo que lleva el plato.", d: "Poné la cantidad que va al plato. Si hay desperdicio, agregá la merma.", marca: "Ingredientes" },
        { t: "En Rendimiento poné cuántas porciones salen.", d: "Un flan entero, por ejemplo, son 8 porciones.", marca: "Rendimiento *" },
        { t: "Arriba ves al momento lo que cuesta cada porción, a cuánto la vendés y cuánto ganás.", marca: "COSTO POR PORCIÓN" },
        { t: "En Opciones cargás lo que el cliente elige, como el punto de la carne.", marca: "Opciones" },
      ] },
      { img: "recetas-extras", alt: "Lista de extras", pasos: [
        { t: "En Extras cargás lo que se suma a un plato con costo, como «Extra queso».", marca: "Nuevo extra" },
      ] },
      { ojo: "Un plato sin receta no se puede vender: el sistema te avisa para que la cargues." },
    ],
  },
  {
    id: "produccion", grupo: "Cocina y recetas", ruta: "/inventario/produccion", titulo: "Fabricar por tanda", resumen: "Las preparaciones que hacés por tanda, como la salsa de la casa.",
    bloques: [
      { img: "inventario-produccion", alt: "Pantalla de Producción", pasos: [
        { t: "Tocá Fabricar.", marca: "Fabricar" },
      ] },
      { img: "fabricar-datos", alt: "Ventana para fabricar con un producto elegido", pasos: [
        { t: "Elegí qué fabricás.", d: "Aparecen las preparaciones que se fabrican por tanda: tocá la que vas a hacer.", marca: "Qué fabricás *" },
        { t: "Elegí el depósito de donde salen las materias primas.", marca: "Depósito *" },
        { t: "Escribí cuánto vas a fabricar.", d: "Si no sabés, Usar el máximo pone todo lo que alcanza.", marca: "Vas a fabricar *" },
        { t: "En Salió de verdad cargá lo que salió.", d: "Si esperabas 40 y salieron 38, queda registrada la merma.", marca: "Salió de verdad" },
        { t: "Acá ves qué materias primas se van a usar y si alcanzan.", d: "Abajo está el costo.", marca: "Materias primas que se usan" },
        { t: "Tocá el botón Fabricar, al final de la ventana.", d: "Bajan las materias primas y sube el stock de la preparación." },
      ] },
      { ojo: "Si no alcanzan las materias primas, no te deja fabricar: comprá primero." },
    ],
  },

  // ── Inventario ───────────────────────────────────────────────────────────────
  {
    id: "productos", grupo: "Inventario", ruta: "/inventario", titulo: "Ver tus productos y su stock", resumen: "Cuánto hay, cuánto cuesta y a cuánto se vende.",
    bloques: [
      { img: "inventario-productos", alt: "Lista de productos", pasos: [
        { t: "Con estos filtros ves una categoría o un depósito.", marca: "Categoría: Todas" },
        { t: "Cada fila muestra el costo, el precio, el stock y el margen.", marca: "STOCK" },
        { t: "Bajá la lista en Excel con Exportar Excel.", marca: "Exportar Excel" },
        { t: "¿Muchos productos? Importar Excel los carga todos juntos.", marca: "Importar Excel" },
      ] },
      { ojo: "El stock no se cambia a mano en el producto. Sube con compras y baja con ventas. Para corregirlo, usá un ajuste." },
    ],
  },
  {
    id: "producto-nuevo", grupo: "Inventario", ruta: "/inventario", titulo: "Cargar un producto nuevo", resumen: "Nombre, precio e IVA.",
    bloques: [
      { img: "inventario-productos", alt: "Lista de productos", pasos: [
        { t: "Tocá Nuevo producto.", marca: "Nuevo producto" },
      ] },
      { img: "producto-nuevo", alt: "Formulario de nuevo producto", rubro: "gastronomia", pasos: [
        { t: "Elegí el tipo de producto.", d: "Reventa se vende tal cual. Menú es un plato con receta. Materia prima es un ingrediente (con receta, una preparación).", marca: "Reventa" },
        { t: "Escribí el nombre como querés que aparezca en el ticket.", marca: "Nombre *" },
        { t: "El SKU es su código interno.", d: "Tocá Generar y listo.", marca: "SKU *" },
        { t: "Si trae código de barras, pasá el lector acá.", marca: "Código de barras (opcional)" },
        { t: "Bajá hasta Precios y cargá el precio de venta.", d: "Va con IVA incluido. El IVA viene en 10 %: si es otro, cambialo al lado del precio. Después tocá Crear producto." },
      ] },
      { img: "producto-nuevo", alt: "Formulario de nuevo producto", rubro: "comercio", pasos: [
        { t: "Escribí el nombre como querés que aparezca en el ticket.", marca: "Nombre *" },
        { t: "El SKU es su código interno.", d: "Tocá Generar y listo.", marca: "SKU *" },
        { t: "Si trae código de barras, pasá el lector acá.", marca: "Código de barras (opcional)" },
        { t: "Bajá hasta Precios y cargá el precio de venta.", d: "Va con IVA incluido. El IVA viene en 10 %: si es otro, cambialo al lado del precio. Después tocá Crear producto." },
      ] },
      { consejo: "No hace falta cargar el stock acá: cuando registres la primera compra, sube solo." },
    ],
  },
  {
    id: "ajustes", grupo: "Inventario", ruta: "/inventario/ajustes", titulo: "Corregir el stock o dar de baja mercadería", resumen: "Conteos físicos, roturas y vencidos.",
    bloques: [
      { img: "inventario-ajustes", alt: "Lista de ajustes y pérdidas", pasos: [
        { t: "Usá Nueva pérdida para lo que se rompió, venció o faltó.", marca: "Nueva pérdida" },
        { t: "Usá Nuevo ajuste cuando contaste la mercadería y el número es otro.", marca: "Nuevo ajuste" },
      ] },
      { img: "ajuste-nuevo", alt: "Formulario de nuevo ajuste", pasos: [
        { t: "Elegí el depósito donde contaste.", marca: "Casa central › Depósito principal" },
        { t: "Elegí el motivo.", marca: "Conteo físico" },
        { t: "Buscá el producto y escribí cuánto contaste, o la diferencia.", marca: "Productos" },
        { t: "Tocá Aplicar ajuste.", d: "El stock queda corregido y todo queda registrado.", marca: "Aplicar ajuste" },
      ] },
      { ojo: "Las pérdidas que carga un cajero o vendedor quedan pendientes hasta que las aprueba quien tiene ese permiso. Mientras tanto, el stock no cambia." },
    ],
  },
  {
    id: "traslados", grupo: "Inventario", ruta: "/inventario/traslados", titulo: "Pasar mercadería a otro depósito", resumen: "Entre depósitos o sucursales, con nota de remisión.",
    bloques: [
      { img: "inventario-traslados", alt: "Lista de traslados", pasos: [
        { t: "Tocá Nuevo traslado.", marca: "Nuevo traslado" },
      ] },
      { img: "traslado-nuevo", alt: "Formulario de nuevo traslado", pasos: [
        { t: "Elegí de dónde sale.", marca: "Sale de" },
        { t: "Elegí a dónde llega.", marca: "Llega a" },
        { t: "Buscá los productos y escribí las cantidades.", marca: "Productos" },
        { t: "Revisá el motivo, la fecha y, si querés, los datos del transporte.", d: "Guardá y salen del origen." },
      ] },
      { img: "inventario-traslados", alt: "Lista de traslados", pasos: [
        { t: "El traslado queda En tránsito hasta que lo reciben.", marca: "En tránsito" },
      ] },
      { img: "traslado-detalle", alt: "Detalle de un traslado en tránsito", pasos: [
        { t: "Cuando llega, abrí el traslado y tocá Recibir.", d: "Si llegó menos, escribí cuánto llegó y el motivo.", marca: "Recibir en" },
      ] },
      { ojo: "Hasta que no lo reciben, esa mercadería no se puede vender en ningún depósito." },
    ],
  },
  {
    id: "movimientos", grupo: "Inventario", ruta: "/inventario/movimientos", titulo: "Averiguar por qué cambió el stock", resumen: "Cada entrada y salida, con quién la hizo.",
    bloques: [
      { img: "inventario-movimientos", alt: "Lista de movimientos de inventario", pasos: [
        { t: "Filtrá por tipo: ventas, traslados, ajustes, pérdidas…", marca: "Ventas" },
        { t: "Elegí el depósito.", marca: "Todos los depósitos" },
        { t: "Bajalo en Excel si lo necesitás.", marca: "Exportar Excel" },
      ] },
    ],
  },
  {
    id: "vencimientos", grupo: "Inventario", ruta: "/inventario/vencimientos", titulo: "Controlar vencimientos", resumen: "Lo vencido y lo que vence pronto.",
    bloques: [
      { img: "inventario-vencimientos", alt: "Lista de lotes por vencer", pasos: [
        { t: "Arriba ves cuánto hay vencido y cuánto te cuesta.", marca: "VENCIDOS" },
        { t: "También lo que vence en los próximos 30 días: ofrecelo antes de que se pierda.", marca: "VENCEN EN 30 DÍAS" },
        { t: "Cambiá el período que querés mirar.", marca: "Próximos 30 días" },
      ] },
      { consejo: "Lo que ya venció, dalo de baja con una pérdida con motivo Vencimiento." },
    ],
  },
  {
    id: "categorias", grupo: "Inventario", ruta: "/inventario/categorias", titulo: "Ordenar productos en categorías", resumen: "Por ejemplo: Bebidas › Gaseosas.",
    bloques: [
      { img: "inventario-categorias", alt: "Pantalla de categorías", pasos: [
        { t: "Escribí el nombre.", marca: "Nombre" },
        { t: "Elegí si es principal o va dentro de otra.", marca: "Es una categoría principal" },
        { t: "Tocá Crear categoría.", marca: "Crear categoría" },
      ] },
    ],
  },
  {
    id: "depositos", grupo: "Inventario", ruta: "/inventario/depositos", titulo: "Sucursales y depósitos", resumen: "Dónde está guardada tu mercadería.",
    bloques: [
      { img: "inventario-depositos", alt: "Sucursales con sus depósitos", pasos: [
        { t: "Con Nueva sucursal agregás un local.", marca: "Nueva sucursal" },
        { t: "Cada sucursal muestra sus depósitos, con cuánta mercadería y cuánto vale.", marca: "Depósito principal" },
        { t: "Con Agregar depósito sumás otro lugar de guardado.", marca: "Agregar depósito" },
      ] },
    ],
  },

  // ── Compras y gastos ─────────────────────────────────────────────────────────
  {
    id: "compra", grupo: "Compras y gastos", ruta: "/gastos-empresariales/compras-gastos", titulo: "Cargar una compra o un gasto", resumen: "La factura del proveedor: suma stock y actualiza costos.",
    bloques: [
      { img: "compras-gastos", alt: "Lista de compras y gastos", pasos: [
        { t: "Tocá Nueva compra o gasto.", marca: "Nueva compra o gasto" },
      ] },
      { img: "compra-nueva", alt: "Formulario de nueva compra", pasos: [
        { t: "Elegí qué es.", d: "Mercadería suma stock, Gasto es alquiler o luz, y Mixta lleva las dos cosas.", marca: "Mercadería" },
        { t: "Elegí el proveedor.", marca: "Proveedor *" },
        { t: "Copiá el número de la factura.", marca: "Número *" },
        { t: "Elegí Contado si ya pagaste, o Crédito si queda como deuda.", marca: "Contado" },
        { t: "Buscá o escaneá cada producto, con su cantidad y costo.", d: "Después guardá.", marca: "Productos" },
      ] },
      { ojo: "Si pagás en efectivo, la plata sale de la caja abierta: tiene que haber una caja abierta." },
      { consejo: "Podés adjuntar la foto de la factura para tenerla a mano." },
    ],
  },
  {
    id: "orden-compra", grupo: "Compras y gastos", ruta: "/compras/ordenes", titulo: "Pedirle mercadería a un proveedor", resumen: "La orden de compra: qué pediste y cuánto llegó.",
    bloques: [
      { img: "compras-ordenes", alt: "Lista de órdenes de compra", pasos: [
        { t: "Tocá Nueva orden.", marca: "Nueva orden" },
      ] },
      { img: "orden-nueva", alt: "Formulario de orden de compra", pasos: [
        { t: "Elegí el proveedor.", marca: "Proveedor *" },
        { t: "Buscá los productos a pedir.", marca: "Buscá los productos que le vas a pedir." },
        { t: "Este botón muestra lo que está bajo el stock mínimo.", d: "Así no te olvidás de nada.", marca: "Ver qué está por debajo del stock mínimo" },
        { t: "Tocá Crear orden de compra.", d: "Después podés bajar el PDF y mandárselo.", marca: "Crear orden de compra" },
      ] },
      { img: "compras-ordenes", alt: "Lista de órdenes de compra", pasos: [
        { t: "Tocá la orden para ver cuánto llegó.", marca: "OC-000001" },
      ] },
      { img: "orden-detalle", alt: "Detalle de una orden de compra", pasos: [
        { t: "Mirá cuánto llegó de lo que pediste.", marca: "Llegaron 42 de 54 unidades" },
        { t: "Cuando llegue la mercadería, tocá Recibir mercadería.", marca: "Recibir" },
      ] },
      { img: "recibir-orden", alt: "Pantalla para recibir una orden de compra", pasos: [
        { t: "Copiá el número de la factura del proveedor.", marca: "Número *" },
        { t: "Corregí la cantidad a lo que llegó de verdad.", d: "Lo que no llegó queda pendiente en la orden.", marca: "Cantidad" },
        { t: "Al final, tocá Registrar compra.", d: "Ahí recién sube el stock." },
      ] },
    ],
  },
  {
    id: "proveedor", grupo: "Compras y gastos", ruta: "/proveedores", titulo: "Cargar un proveedor", resumen: "A quién le comprás.",
    bloques: [
      { img: "proveedores", alt: "Lista de proveedores", pasos: [
        { t: "Tocá Nuevo proveedor.", marca: "Nuevo proveedor" },
      ] },
      { img: "proveedor-nuevo", alt: "Formulario de nuevo proveedor", pasos: [
        { t: "Solo la razón social es obligatoria.", marca: "Razón social *" },
        { t: "Agregá el RUC: lo vas a necesitar para las facturas.", marca: "RUC (opcional)" },
        { t: "Elegí cómo le pagás normalmente.", marca: "Cómo le pagás" },
        { t: "Tocá Crear proveedor.", marca: "Crear proveedor" },
      ] },
    ],
  },
  {
    id: "pagar-proveedor", grupo: "Compras y gastos", ruta: "/compras/pagos", titulo: "Pagarle a un proveedor", resumen: "Lo que debés, empezando por lo más urgente.",
    bloques: [
      { img: "compras-pagos", alt: "Pantalla de pagos a proveedores", pasos: [
        { t: "Arriba ves cuánto debés en total y cuánto está vencido.", marca: "A PAGAR" },
        { t: "Cuentas a pagar es la lista de facturas.", d: "Filtrá por Vencidas para ver lo urgente.", marca: "Vencidas" },
        { t: "En Pagos realizados está todo lo que ya pagaste.", marca: "Pagos realizados" },
        { t: "Tocá Pagar en la factura, o Pagar varias para hacer un solo pago.", marca: "Pagar" },
      ] },
      { img: "pago-proveedor", alt: "Ventana para pagarle a un proveedor", pasos: [
        { t: "Escribí cuánto le pagás.", d: "Se aplica primero a lo que vence antes, y abajo ves cuánto le vas a quedar debiendo.", marca: "¿Cuánto le pagás?" },
        { t: "Si querés, tocá Todo o Solo lo vencido y el monto se completa solo.", marca: "Solo lo vencido" },
        { t: "Revisá las facturas que cubre el pago.", d: "Podés marcar otras o cambiar el monto de cada una.", marca: "Facturas que pagás" },
        { t: "Más abajo elegí cómo le pagás y tocá Pagar.", d: "La deuda baja.", marca: "Pagar Gs." },
      ] },
      { ojo: "Si pagás en efectivo, sale de la caja abierta. En dólares se paga por transferencia u otro medio." },
    ],
  },
  {
    id: "recurrentes", grupo: "Compras y gastos", ruta: "/gastos-empresariales/recurrentes", titulo: "Gastos de todos los meses", resumen: "Alquiler, sueldos, luz: que no se te olvide ninguno.",
    bloques: [
      { img: "compras-recurrentes", alt: "Pantalla de gastos recurrentes", pasos: [
        { t: "Con Nueva plantilla cargás cada gasto una sola vez, con su día del mes.", marca: "Nueva plantilla" },
        { t: "Cada mes, tocá Generar gastos: se crean los borradores.", marca: "Generar gastos de noviembre (3)" },
        { t: "Cuando llega la factura o lo pagás, revisá el monto y confirmalo." },
      ] },
    ],
  },

  // ── Clientes y ventas ────────────────────────────────────────────────────────
  {
    id: "cliente", grupo: "Clientes y ventas", ruta: "/clientes", titulo: "Cargar un cliente", resumen: "Sus datos, para venderle a crédito o facturarle.",
    bloques: [
      { img: "clientes", alt: "Lista de clientes", pasos: [
        { t: "Tocá Nuevo cliente.", marca: "Nuevo cliente" },
      ] },
      { img: "cliente-nuevo", alt: "Formulario de nuevo cliente", pasos: [
        { t: "Elegí si es una persona o una empresa.", marca: "Persona" },
        { t: "Escribí el nombre.", marca: "NOMBRE Y APELLIDO *" },
        { t: "Escribí el RUC o CI.", d: "El sistema avisa si ya existe.", marca: "RUC O CI *" },
        { t: "Escribí el teléfono.", marca: "TELÉFONO *" },
        { t: "Si la factura va a otro nombre, completá esta parte.", d: "Si la dejás vacía, se usan los datos de arriba.", marca: "DATOS PARA FACTURACIÓN" },
        { t: "Tocá Guardar cliente.", marca: "Guardar cliente" },
      ] },
      { img: "cliente-ficha", alt: "Datos de un cliente", pasos: [
        { t: "Tocá un cliente en la lista y después Ver ficha completa.", d: "Ahí está lo que compró, lo que debe y su estado de cuenta.", marca: "Ver ficha completa" },
        { t: "Con Editar corregís sus datos.", marca: "Editar" },
        { t: "Dar de baja lo saca de la lista de activos sin perder su historial.", marca: "Dar de baja" },
      ] },
    ],
  },
  {
    id: "crm", grupo: "Clientes y ventas", ruta: "/crm", titulo: "Seguir a los posibles clientes", resumen: "De la primera consulta hasta la venta.",
    bloques: [
      { img: "crm", alt: "Tablero de oportunidades por etapa", pasos: [
        { t: "Cada columna es una etapa.", d: "Arrastrá la tarjeta a la siguiente cuando avanza.", marca: "Contactado" },
        { t: "Con Nuevo prospecto cargás uno nuevo.", marca: "Nuevo prospecto" },
        { t: "Cuando se concreta, tocá Transformar a cliente.", marca: "Transformar a cliente" },
        { t: "Solo hoy te muestra a quién tenés que contactar hoy.", marca: "Solo hoy" },
      ] },
      { img: "crm-nuevo", alt: "Formulario de nuevo prospecto", pasos: [
        { t: "Completá la empresa y la persona de contacto.", marca: "EMPRESA *" },
        { t: "Marcá qué le interesa.", marca: "SERVICIOS / PRODUCTOS DE INTERÉS *" },
        ] },
      { img: "crm-seguimiento", alt: "Parte de seguimiento del prospecto", pasos: [
        { t: "Anotá qué vas a hacer y cuándo, para que no se te pase.", marca: "PRÓXIMA ACCIÓN" },
      ] },
    ],
  },
  {
    id: "presupuestos", grupo: "Clientes y ventas", ruta: "/presupuestos", titulo: "Hacer un presupuesto", resumen: "Cotizar y convertirlo en venta si te dicen que sí.",
    bloques: [
      { img: "presupuestos", alt: "Lista de presupuestos", pasos: [
        { t: "Tocá Nuevo presupuesto.", marca: "Nuevo presupuesto" },
        { t: "En estas pestañas sabés en qué quedó cada uno.", marca: "Abiertos" },
      ] },
      { img: "presupuesto-nuevo", alt: "Formulario de nuevo presupuesto", pasos: [
        { t: "Elegí el cliente.", d: "Si todavía no lo es, usá Prospecto y cargá sus datos.", marca: "Cliente *" },
        { t: "Elegí hasta cuándo vale la oferta.", d: "Por defecto son 15 días.", marca: "Validez" },
        { t: "Elegí si le proponés contado o crédito.", marca: "Condición propuesta" },
        { t: "Más abajo cargá lo que cotizás y tocá Crear presupuesto." },
      ] },
      { img: "presupuesto-detalle", alt: "Detalle de un presupuesto aceptado", pasos: [
        { t: "Descargá el PDF para mandárselo al cliente.", marca: "Descargar PDF" },
        { t: "En Seguimiento ves qué pasó con el presupuesto.", marca: "Seguimiento" },
        { t: "Cuando lo aceptan, tocá Convertir a venta: no hace falta cargar todo de nuevo.", marca: "Convertir a venta" },
      ] },
      { ojo: "Un presupuesto no descuenta stock. Solo cuenta cuando se convierte en venta." },
    ],
  },
  {
    id: "gestion", grupo: "Clientes y ventas", ruta: "/clientes/gestion", titulo: "Atender una consulta de un cliente", resumen: "Encontrar todo de un cliente en un solo lugar.",
    bloques: [
      { img: "gestion-clientes", alt: "Pantalla de Gestión del Cliente", pasos: [
        { t: "Escribí el nombre, RUC, teléfono, correo o documento en el único buscador.", marca: "Buscá un cliente" },
        { t: "Abrí el cliente y registrá el motivo de la consulta.", d: "Eso se llama tipificar, y deja el historial." },
      ] },
    ],
  },
  {
    id: "comisiones", grupo: "Clientes y ventas", ruta: "/comisiones", titulo: "Ver tus comisiones", resumen: "Cuánto llevás ganado en el mes.",
    bloques: [
      { texto: "Comisionás por lo que vendés. Si armaste un pedido y lo cobró la caja, la venta es tuya. Si la registraste directo en Nueva venta, también." },
      { img: "comisiones", alt: "Pantalla de Comisiones con cifras del mes", pasos: [
        { t: "Elegí el mes.", marca: "MES A CONSULTAR" },
        { t: "Base comisionable es lo que cuenta para tu comisión.", marca: "BASE COMISIONABLE" },
        { t: "Comisión estimada es lo que llevás ganado hasta hoy.", marca: "COMISIÓN ESTIMADA" },
        { t: "Pendiente de cobro es lo vendido que todavía no te pagaron.", marca: "TOTAL PENDIENTE DE COBRO" },
        { t: "Por vendedor muestra el tramo de cada persona.", d: "También cuánto falta para el siguiente. Si no sos administrador, ves solo lo tuyo.", marca: "POR VENDEDOR" },
      ] },
      { texto: "No comisionan las suscripciones, las ventas de mesa ni lo que el administrador excluya con motivo. Una nota de crédito resta lo devuelto en el mes en que se hizo." },
      { ojo: "Si dice que no hay política configurada, el administrador tiene que cargarla en Configuración › Comisiones." },
    ],
  },
  {
    id: "planes", grupo: "Clientes y ventas", ruta: "/clientes/suscripciones", titulo: "Abonos y cuotas mensuales", resumen: "Lo que tus clientes pagan todos los meses.",
    bloques: [
      { img: "planes", alt: "Pantalla de suscripciones", pasos: [
        { t: "En Suscripciones ves qué cliente tiene qué plan.", marca: "Suscripciones" },
        { t: "Cada mes, tocá Emitir cuotas para generar lo que tienen que pagar.", marca: "Emitir cuotas de Noviembre 2026 (1)" },
      ] },
      { img: "planes-lista", alt: "Lista de planes", pasos: [
        { t: "Tocá Nuevo plan para crear lo que ofrecés.", marca: "Nuevo plan" },
        { t: "Cada plan tiene un solo plazo: si querés uno a 6 meses y otro a 12, creá dos planes.", marca: "PLAZO" },
      ] },
      { consejo: "Una suscripción pausada no genera cuotas. Sirve si el cliente deja por un tiempo y después vuelve." },
    ],
  },
  {
    id: "agenda", grupo: "Clientes y ventas", ruta: "/clientes/agenda", titulo: "Anotar un evento", resumen: "Tus eventos, con aviso a la hora que elijas.",
    bloques: [
      { img: "agenda", alt: "Agenda de la semana", pasos: [
        { t: "Tocá Nuevo evento.", marca: "Nuevo evento" },
      ] },
      { img: "agenda-nueva", alt: "Formulario de nuevo evento", pasos: [
        { t: "Escribí qué tenés.", marca: "¿Qué tenés? *" },
        { t: "Elegí la fecha y la hora.", marca: "Fecha *" },
        { t: "Elegí cuándo te avisamos.", d: "Suena la campanita y aparece un aviso del navegador, aunque estés en otra pestaña. El ERP tiene que estar abierto.", marca: "Avisarme" },
        { t: "Guardá.", marca: "Guardar" },
      ] },
      { consejo: "La primera vez, el navegador pregunta si puede mostrar avisos: tocá Permitir. En Más detalles podés sumar a otras personas, un cliente o el lugar." },
    ],
  },

  // ── Cobros ───────────────────────────────────────────────────────────────────
  {
    id: "cobrar-deuda", grupo: "Cobros", ruta: "/pagos", titulo: "Registrar el pago de una deuda", resumen: "Un cliente vino a pagar lo que debía.",
    bloques: [
      { img: "pagos", alt: "Lista de facturas pendientes de cobro", pasos: [
        { t: "En Pendientes está lo que te deben.", marca: "Pendientes" },
        { t: "Buscá por el nombre del cliente.", marca: "BUSCAR POR NOMBRE DE CLIENTE" },
      ] },
      { img: "pagos-acciones", alt: "Botones de cobro al final de cada fila", texto: "Los botones están al final de cada fila, a la derecha. Si no los ves, deslizá la tabla hacia un costado.", pasos: [
        { t: "Si te paga en persona, tocá En caja: el cobro entra a tu caja abierta.", marca: "En caja" },
        { t: "Si te transfirió, tocá Cobrar.", marca: "Cobrar" },
      ] },
      { img: "pago-cobrar", alt: "Ventana para registrar una transferencia", pasos: [
        { t: "Marcá qué facturas paga, cargá el monto y los datos de la transferencia, y guardá." },
      ] },
      { ojo: "La transferencia no baja la deuda hasta que la aprueban en Conciliación. Mirá la guía siguiente." },
      { consejo: "Si te paga de más, lo que sobra queda a favor del cliente y lo puede usar en su próxima compra." },
    ],
  },
  {
    id: "conciliacion", grupo: "Cobros", ruta: "/cobranzas/conciliacion", titulo: "Aprobar transferencias", resumen: "Controlar que la plata entró al banco.",
    bloques: [
      { img: "conciliacion", alt: "Pantalla de conciliación bancaria", pasos: [
        { t: "En Pendiente están las transferencias que cargaron.", d: "Comparalas con tu banco.", marca: "Pendiente" },
        { t: "Si entró, aprobala: recién ahí baja la deuda.", d: "Si no, rechazala." },
        { t: "Para no comparar a mano, tocá Cargar extracto y subí el archivo del banco.", marca: "Cargar extracto (Excel o CSV)" },
        { t: "Con Registrar transferencia cargás una que todavía no esté.", marca: "Registrar transferencia" },
      ] },
    ],
  },
  {
    id: "cobranzas", grupo: "Cobros", ruta: "/cobranzas", titulo: "Saber quién te debe", resumen: "Clientes con deuda y hace cuánto.",
    bloques: [
      { img: "cobranzas", alt: "Pantalla de seguimiento de cobranzas", pasos: [
        { t: "Arriba ves el total que te deben y cuántos clientes son.", marca: "Total adeudado" },
        { t: "Los tramos agrupan a los clientes según cuánto atraso tienen.", d: "Empezá por los más atrasados.", marca: "Tramo 3" },
        { t: "Promesas hoy son los clientes que dijeron que hoy te pagan.", marca: "Promesas hoy" },
      ] },
      { img: "cobranza-detalle", alt: "Detalle de cobranza de un cliente", pasos: [
        { t: "Tocá un cliente para ver cuánto debe y hace cuánto.", marca: "DEUDA TOTAL" },
        { t: "Cada cuota vencida tiene Registrar pago.", d: "Se paga primero la más vieja.", marca: "Registrar pago" },
      ] },
    ],
  },

  // ── Reportes ─────────────────────────────────────────────────────────────────
  {
    id: "reportes", grupo: "Reportes", ruta: "/reportes", titulo: "Sacar un reporte", resumen: "Todos los números, en Excel o PDF.",
    bloques: [
      { img: "reportes", alt: "Lista de reportes", pasos: [
        { t: "Tocá la tarjeta del reporte que necesitás.", d: "Adentro elegís las fechas y lo bajás en Excel o PDF.", marca: "Estado de cuenta" },
        { t: "Cierre de caja por día: cuánto se vendió y cobró cada día.", marca: "Cierre de caja por día" },
        { t: "Productos vendidos: qué se vende más y cuánto te deja.", marca: "Productos vendidos" },
        { t: "Cuentas por cobrar y por pagar: lo que te deben y lo que debés.", marca: "Cuentas por cobrar" },
        { t: "Existencias por depósito: cuánta mercadería tenés y cuánto vale.", marca: "Existencias por depósito" },
        { t: "Registro de comprobantes (RG 90): el archivo para tu contador.", marca: "Registro de comprobantes (RG 90)" },
      ] },
      { img: "reporte-ejemplo", alt: "Reporte de ventas del período", pasos: [
        { t: "Dentro del reporte, elegí las fechas.", marca: "Este mes" },
        { t: "Afiná con los filtros: por cajero, medio de pago o categoría.", marca: "Cajero: Todos" },
        { t: "Bajalo en Excel.", marca: "Exportar Excel" },
        { t: "O en PDF, para imprimirlo o mandarlo.", marca: "Descargar PDF" },
      ] },
    ],
  },

  // ── Atención al cliente ──────────────────────────────────────────────────────
  {
    id: "whatsapp-canal", grupo: "Atención al cliente", ruta: "/conversaciones/canales", titulo: "Conectar el WhatsApp de la empresa",
    resumen: "Una sola vez: el número y las claves que te da YCloud o Meta.",
    bloques: [
      { texto: "Lo hace el administrador una sola vez, con los datos que te da el proveedor (YCloud o Meta). Hasta que lo prendas, nada cambia." },
      { img: "canales-lista", alt: "Canales de WhatsApp", pasos: [{ t: "Tocá Conectar un WhatsApp.", marca: "Conectar un WhatsApp" }] },
      { img: "canales-nuevo", alt: "Conectar un WhatsApp", pasos: [
        { t: "Elegí el proveedor.", d: "YCloud o la API oficial de Meta.", marca: "YCloud" },
        { t: "Escribí el número de WhatsApp de la empresa.", d: "Con 595 y sin el 0: 595981123456.", marca: "Número de WhatsApp Business" },
        { t: "Pegá la API key.", d: "En YCloud: Developers › API Keys.", marca: "API key" },
        { t: "Pegá el secreto del webhook.", d: "Lo da YCloud cuando creás el webhook.", marca: "Secreto del webhook" },
        { t: "Tocá Guardar.", d: "El canal queda apagado hasta que lo pruebes.", marca: "Guardar" },
      ] },
      { img: "canales-tarjeta", alt: "Canal de WhatsApp guardado", pasos: [
        { t: "Copiá la URL del webhook y pegala en el proveedor.", d: "En YCloud: Developers › Webhooks, con los avisos de mensajes y de estados.", marca: "URL del webhook (pegala en el proveedor)" },
        { t: "Tocá Probar conexión.", d: "Si dice «Conexión correcta», las claves están bien.", marca: "Probar conexión" },
        { t: "Tocá Prender.", d: "Probá escribiendo al número desde otro celular: el mensaje tiene que aparecer en la bandeja.", marca: "Prender" },
      ] },
      { ojo: "Las claves no se vuelven a mostrar. Si las cambiás en el proveedor, tocá Editar y cargalas de nuevo." },
    ],
  },
  {
    id: "omnicanal", grupo: "Atención al cliente", ruta: "/conversaciones", titulo: "Responder los chats", resumen: "Todos los mensajes de los clientes en un solo lugar.",
    bloques: [
      { img: "conversaciones", alt: "Bandeja de conversaciones", pasos: [
        { t: "Mías son las que te asignaron.", d: "Empezá por ahí.", marca: "Mías" },
        { t: "Sin asignar son las que nadie tomó todavía.", marca: "Sin asignar" },
        { t: "Dejá tu estado en Disponible para que te lleguen chats.", marca: "Disponible" },
        { t: "En Respuestas tenés textos listos para no escribir siempre lo mismo.", marca: "Respuestas" },
        { t: "Tocá un chat de la lista para abrirlo.", d: "Escribí abajo y enviá. Al terminar, finalizá la conversación.", marca: "Pedro Gómez" },
      ] },
    ],
  },
  {
    id: "soporte", grupo: "Atención al cliente", ruta: "/soporte/panel", titulo: "Tickets de soporte", resumen: "Los problemas de los clientes, hasta resolverlos.",
    bloques: [
      { img: "soporte", alt: "Panel de Soporte", pasos: [
        { t: "Dashboard muestra cómo está todo en general.", marca: "Dashboard" },
        { t: "Tickets es la cola completa de trabajo.", marca: "Tickets" },
        { t: "Mis tickets es lo que te toca a vos.", marca: "Mis tickets" },
      ] },
      { img: "soporte-tickets", alt: "Lista de tickets", pasos: [
        { t: "Con Cargar ticket registrás un problema nuevo.", marca: "Cargar ticket" },
        { t: "Filtrá por estado para ver qué falta atender.", marca: "Pendientes" },
        { t: "Para hacerte cargo, tocá Tomar en la columna Asignado a.", d: "Si no lo ves, pasá el mouse por esa columna. Después abrí el ticket y seguilo hasta resolverlo.", marca: "Tomar" },
      ] },
    ],
  },

  // ── Configuración ────────────────────────────────────────────────────────────
  {
    id: "empresa", grupo: "Configuración", ruta: "/configuracion/empresa", titulo: "Datos de tu empresa", resumen: "Lo que sale en tickets y documentos.",
    bloques: [
      { img: "config-empresa", alt: "Formulario de datos de la empresa", pasos: [
        { t: "Escribí la razón social como figura en tu constancia de RUC.", marca: "Razón social *" },
        { t: "El nombre de fantasía es el que va grande en los documentos.", marca: "Nombre de fantasía (opcional)" },
        { t: "Cargá el RUC.", d: "El sistema controla que esté bien escrito.", marca: "RUC (opcional)" },
        { t: "Más abajo van la dirección, el teléfono y el logo.", d: "Guardá al terminar." },
      ] },
    ],
  },
  {
    id: "facturacion", grupo: "Configuración", ruta: "/configuracion/facturacion", titulo: "Tickets y facturación", resumen: "Cómo se ven tus comprobantes.",
    bloques: [
      { img: "config-facturacion", alt: "Pantalla de tickets y facturación", pasos: [
        { t: "Sin factura fiscal: solo registra ventas internas.", marca: "Sin factura fiscal" },
        { t: "Facturación electrónica: documentos electrónicos por SIFEN.", marca: "Facturación electrónica SIFEN" },
        { t: "Autoimpresor: factura impresa con tu timbrado.", marca: "Autoimpresor / factura impresa" },
      ] },
      { ojo: "Si tenés dudas sobre cuál te corresponde, consultalo con tu contador antes de cambiarlo." },
    ],
  },
  {
    id: "usuarios", grupo: "Configuración", ruta: "/configuracion/usuarios", titulo: "Crear usuarios para tu equipo", resumen: "Cada empleado con su acceso.",
    bloques: [
      { img: "config-usuarios", alt: "Lista de usuarios", pasos: [
        { t: "Tocá Nuevo usuario.", marca: "Nuevo usuario" },
        { t: "En la lista ves si cada uno está conectado y cuándo entró por última vez.", marca: "CONEXIÓN" },
      ] },
      { img: "usuario-nuevo", alt: "Formulario de nuevo usuario", pasos: [
        { t: "Escribí el nombre.", marca: "Nombre *" },
        { t: "Escribí el correo: ahí le llega la invitación para elegir su contraseña.", d: "Vos nunca la ves.", marca: "Email *" },
        { t: "Elegí el perfil.", d: "A la derecha ves qué va a poder usar.", marca: "Perfil *" },
        { t: "Elegí su sucursal: de ahí sale el stock de lo que venda.", marca: "Sucursal" },
      ] },
      { img: "perfiles", alt: "Perfiles y permisos", pasos: [
        { t: "En Perfiles y permisos definís qué puede hacer cada perfil.", d: "También podés crear uno nuevo.", marca: "Nuevo perfil" },
      ] },
      { consejo: "Cuando alguien deja de trabajar, desactivá su usuario en vez de borrarlo: no puede entrar más y su historial queda." },
    ],
  },
  {
    id: "rubro", grupo: "Configuración", ruta: "/configuracion/funciones", titulo: "Cambiar el rubro y las funciones", resumen: "Prendé solo lo que usa tu negocio.",
    bloques: [
      { img: "config-funciones", alt: "Pantalla Rubro y funciones", pasos: [
        { t: "Arriba ves lo que viene incluido en todos los rubros.", marca: "BASE, INCLUIDA EN TODOS LOS RUBROS" },
        { t: "Elegí el rubro que se parece a tu negocio.", marca: "Comercio" },
        { t: "Después podés prender o apagar cada función, y guardar." },
      ] },
      { consejo: "Apagar una función no borra nada: si la volvés a prender, todo queda como estaba. Este manual también cambia según lo que tengas prendido." },
    ],
  },
  {
    id: "config-comisiones", grupo: "Configuración", ruta: "/configuracion/comisiones", titulo: "Configurar las comisiones", resumen: "Cuánto gana cada vendedor según lo que vende.",
    bloques: [
      { img: "config-comisiones", alt: "Pantalla de configuración de comisiones", pasos: [
        { t: "Elegí qué cuenta: lo cobrado, lo facturado o las ventas ya cobradas del todo.", marca: "Base de cálculo" },
        { t: "Cargá los tramos: desde qué monto, hasta cuál y qué porcentaje.", d: "Dejá vacío «Hasta» en el último.", marca: "Desde" },
        { t: "Con Agregar escala sumás otro tramo.", marca: "Agregar escala" },
        { t: "Tocá Guardar política.", d: "Sin esto, nadie ve comisiones.", marca: "Guardar política" },
      ] },
    ],
  },
  // ── Sorteos (rubro Sorteos, recetas 123 a 125) ──────────────────────────────
  {
    id: "sorteo-crear", grupo: "Sorteos", ruta: "/sorteos/nuevo", titulo: "Crear un sorteo", resumen: "Precio, números, combos y la cuenta donde te pagan.",
    bloques: [
      { img: "sorteos-lista", alt: "Lista de sorteos", pasos: [{ t: "Tocá Nuevo sorteo.", marca: "Nuevo sorteo" }] },
      { img: "sorteo-nuevo-datos", alt: "Datos del sorteo nuevo", pasos: [
        { t: "Escribí el nombre del sorteo.", d: "Es lo que ve el comprador en la página y en su ticket.", marca: "Nombre" },
        { t: "Poné el precio de cada boleta.", marca: "Precio por boleta (Gs.)" },
        { t: "Elegí hasta qué número va.", d: "Por ejemplo, del 1 al 10.000.", marca: "Hasta el número" },
      ] },
      { img: "sorteo-nuevo-cobro", alt: "Combos y cuentas para cobrar", pasos: [
        { t: "Si querés, agregá combos con descuento.", d: "Por ejemplo, 3 boletas a Gs. 25.000. Se cobran solos en todos los canales.", marca: "Agregar combo" },
        { t: "Cargá la cuenta donde te transfieren.", d: "Sin una cuenta no se puede activar.", marca: "Banco o billetera" },
        { t: "Tocá Crear sorteo.", d: "Queda en borrador: todavía no se vende.", marca: "Crear sorteo" },
      ] },
      { img: "sorteo-activar", alt: "Sorteo en borrador", pasos: [
        { t: "Revisá todo y tocá Activar.", d: "Recién ahí se generan los números y se empieza a vender.", marca: "Activar" },
      ] },
      { ojo: "Una vez activado, el rango de números ya no se puede cambiar." },
    ],
  },
  {
    id: "sorteo-vender", grupo: "Sorteos", ruta: "/sorteos/vender", titulo: "Vender boletas en el local", resumen: "La venta queda confirmada al guardarla.",
    bloques: [
      { img: "sorteo-vender", alt: "Venta de boletas", pasos: [
        { t: "Elegí cuántas boletas lleva.", d: "Los combos ya tienen el descuento.", marca: "Gs. 25.000" },
        { t: "Escribí el nombre y la cédula o el teléfono del comprador.", d: "Queda guardado en Clientes.", marca: "Nombre y apellido" },
        { t: "Elegí cómo pagó.", marca: "Efectivo" },
        { t: "Tocá Registrar venta.", d: "Los números se asignan solos y se ven en la compra.", marca: "Registrar venta" },
      ] },
    ],
  },
  {
    id: "sorteo-revisar", grupo: "Sorteos", ruta: "/sorteos/revision", titulo: "Confirmar un pago", resumen: "Las transferencias que esperan que alguien las mire.",
    bloques: [
      { img: "sorteo-revision", alt: "Pagos por revisar", pasos: [{ t: "Tocá la compra que querés revisar.", d: "La más vieja aparece primero.", marca: "Carlos Duarte" }] },
      { img: "sorteo-revision-detalle", alt: "Compra con su comprobante", pasos: [
        { t: "Mirá el comprobante y lo que leyó el sistema.", d: "Si algo no coincide, te dice qué.", marca: "Lectura automática del comprobante" },
      ] },
      { img: "sorteo-revision-acciones", alt: "Confirmar o rechazar el pago", pasos: [
        { t: "Si la plata llegó, tocá Confirmar pago.", d: "Si compró por WhatsApp, le llega el ticket a su chat.", marca: "Confirmar pago" },
        { t: "Si no llegó, tocá Rechazar pago y escribí el motivo.", d: "Los números quedan libres para vender.", marca: "Rechazar" },
      ] },
    ],
  },
  {
    id: "sorteo-vendedor", grupo: "Sorteos", ruta: "/sorteos/vendedores", titulo: "Sumar un vendedor", resumen: "Vende desde su celular con un link y su PIN.",
    bloques: [
      { img: "sorteo-vendedores", alt: "Lista de vendedores", pasos: [{ t: "Tocá Nuevo vendedor.", marca: "Nuevo vendedor" }] },
      { img: "sorteo-vendedor-nuevo", alt: "Alta de un vendedor", pasos: [
        { t: "Escribí su nombre y su teléfono.", marca: "Nombre" },
        { t: "Poné cuánto cobra de comisión.", marca: "Comisión (%)" },
        { t: "Si querés, poné un tope de boletas por sorteo.", marca: "Cupo por sorteo (opcional)" },
        { t: "Tocá Guardar.", d: "Te muestra su PIN una sola vez: anotalo y pasáselo.", marca: "Guardar" },
      ] },
      { img: "sorteo-vendedores", alt: "Lista de vendedores", pasos: [
        { t: "Tocá Link nuevo y pasale ese link por WhatsApp.", d: "Con el link y su PIN vende desde el celular. Si lo pierde, generás otro y el anterior deja de andar.", marca: "Link nuevo" },
        { t: "Cuando te entrega el efectivo, tocá Rendición.", d: "Se descuenta su comisión y queda registrado.", marca: "Rendición" },
      ] },
      { consejo: "El link de referido de cada vendedor sirve para compartir en redes: quien compra desde ahí queda a su nombre." },
    ],
  },
  {
    id: "sorteo-whatsapp", grupo: "Sorteos", ruta: "/sorteos/whatsapp", titulo: "Vender por WhatsApp", resumen: "Un bot toma el pedido, reserva los números y recibe el comprobante.",
    bloques: [
      { texto: "Antes, conectá el número de la empresa en Omnicanal › Canales de WhatsApp (guía «Conectar el WhatsApp de la empresa»). Mientras tanto podés probar el bot acá mismo, con el chat de prueba." },
      { img: "sorteo-whatsapp", alt: "Venta por WhatsApp", pasos: [
        { t: "Prendé el bot.", marca: "Atender los chats de WhatsApp con el bot" },
        { t: "Elegí en qué WhatsApp atiende y tocá Guardar.", marca: "Guardar" },
        { t: "Probalo vos: tocá Hola como si fueras un cliente.", d: "El chat de prueba también aparece en Omnicanal.", marca: "Hola" },
      ] },
      { texto: "El cliente puede escribir en cualquier momento MENU para empezar de nuevo, MIS NUMEROS para ver sus compras, CANCELAR o ASESOR para hablar con una persona." },
      { consejo: "Si alguien de tu equipo contesta en un chat, el bot se calla en ese chat por 12 horas." },
    ],
  },
  {
    id: "sorteo-sortear", grupo: "Sorteos", ruta: "/sorteos", titulo: "Hacer el sorteo en el vivo", resumen: "Lista de participantes, el número que salió y la imagen del ganador.",
    bloques: [
      { texto: "El sorteo lo hacés en un vivo por tus redes, con tu urna o tu herramienta. El sistema te prepara la lista, guarda el número que salió y te arma la imagen del ganador." },
      { img: "sorteos-lista", alt: "Lista de sorteos", pasos: [{ t: "Tocá el sorteo.", marca: "Sorteo web" }] },
      { img: "sorteo-ficha", alt: "Ficha del sorteo", pasos: [
        { t: "En Premios y ganadores, cargá los premios.", marca: "Premios y ganadores" },
        { t: "El día del vivo, tocá Cerrar la venta.", d: "Desde ahí nadie más puede comprar.", marca: "Cerrar la venta" },
        { t: "Abrí Participantes y urna.", marca: "Participantes y urna" },
      ] },
      { img: "sorteo-cupones", alt: "Participantes y cupones para la urna", pasos: [
        { t: "Para mostrar en el vivo, imprimí la lista de participantes.", d: "Lleva el número, el nombre corto y la ciudad: sin cédula ni teléfono.", marca: "Lista para mostrar en el vivo" },
        { t: "Si sorteás con urna, elegí el papel.", marca: "Ticketera 80 mm" },
        { t: "Tocá Imprimir cupones.", d: "Sale uno por cada número vendido, con el nombre del comprador.", marca: "Imprimir cupones" },
      ] },
      { img: "sorteo-premios", alt: "Premios con sus ganadores", pasos: [
        { t: "Pegá el link del vivo.", d: "Sale en la página del sorteo: antes avisa dónde se sortea y después queda la grabación.", marca: "El vivo del sorteo" },
        { t: "Cuando sale un número, tocá Cargar el número que salió y escribilo.", d: "El sistema busca quién lo compró y lo publica en la página del sorteo." },
        { t: "Tocá Imagen para redes y publicala.", d: "Una imagen con el número y el nombre corto del ganador, con los colores de tu empresa.", marca: "Imagen para redes" },
        { t: "Tocá Avisarle por WhatsApp para escribirle al ganador.", marca: "Avisarle por WhatsApp" },
      ] },
      { consejo: "Si preferís que sortee el sistema, en cada premio está «Que lo sortee el sistema», con su pantalla para transmitir." },
    ],
  },
  // ── Inmobiliaria (solo con Inmobiliaria prendida; capturas en public/manual/inmobiliaria) ──
  {
    id: "inmo-propiedad", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/inmobiliaria", titulo: "Cargar una propiedad", resumen: "Casa, lote, departamento o local: propia o de un dueño.",
    bloques: [
      { img: "inmo-propiedades", alt: "Lista de propiedades", pasos: [{ t: "Tocá Nueva propiedad.", marca: "Nueva propiedad" }] },
      { img: "inmo-propiedad-datos", alt: "Datos de la propiedad", pasos: [
        { t: "Escribí un título que la describa.", d: "Por ejemplo: Departamento de 2 dormitorios en Villa Morra.", marca: "Título" },
        { t: "Elegí el tipo.", d: "Casa, departamento, lote, local… Los tipos se cambian con el botón Tipos.", marca: "Tipo" },
        { t: "Elegí si la vendés, la alquilás o las dos cosas.", marca: "Gestión" },
        { t: "Poné el precio.", d: "Para vender aparece Precio de venta; para alquilar, Alquiler por mes.", marca: "Alquiler por mes" },
        { t: "Revisá el IVA.", d: "Los inmuebles pagan 5 %.", marca: "IVA" },
      ] },
      { img: "inmo-propiedad-ubicacion", alt: "Ubicación, superficie y catastro", pasos: [
        { t: "Elegí la ciudad y el barrio.", marca: "Ciudad" },
        { t: "Escribí la dirección.", marca: "Dirección" },
        { t: "Cargá los metros: de terreno y construidos.", marca: "Construcción (m²)" },
        { t: "Si los tenés, cargá la cuenta catastral, la finca, la manzana y el lote.", d: "Después la encontrás buscando por cualquiera de esos datos.", marca: "Cuenta catastral" },
      ] },
      { img: "inmo-propiedad-dueno", alt: "Documentación y dueño", pasos: [
        { t: "Marcá cómo está la documentación.", d: "Si falta algo, anotá qué.", marca: "Estado de la documentación" },
        { t: "Si no es de la inmobiliaria, tocá De un dueño y elegí al cliente dueño.", marca: "De un dueño" },
        { t: "Poné la comisión de la inmobiliaria.", d: "Al dueño se le paga lo cobrado menos esta comisión.", marca: "Comisión del alquiler (%)" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { consejo: "Con la ficha abierta, abajo le cambiás el estado: disponible, reservada o retirada. Vendida y alquilada se ponen solas." },
    ],
  },
  {
    id: "inmo-vender", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/inmobiliaria", titulo: "Vender una propiedad en cuotas", resumen: "Con un plan, entrega inicial y hasta 120 cuotas.",
    bloques: [
      { img: "inmo-ficha-venta", alt: "Ficha de la propiedad", texto: "Tocá la propiedad para abrir su ficha.", pasos: [{ t: "Tocá Vender.", marca: "Vender" }] },
      { img: "inmo-vender", alt: "Vender la propiedad en cuotas", pasos: [
        { t: "Elegí el comprador.", marca: "Comprador" },
        { t: "Tocá En cuotas.", d: "Si paga todo junto, tocá Contado.", marca: "En cuotas" },
        { t: "Elegí el plan.", d: "Pone solo las cuotas, cada cuánto y la entrega mínima. Sin plan, las cargás a mano.", marca: "Plan de cuotas" },
        { t: "Revisá la entrega inicial.", d: "Abajo ves cuánto queda financiado y cuánto es cada cuota.", marca: "Entrega inicial" },
        { t: "Elegí cómo paga la entrega.", marca: "Medio de pago" },
        { t: "Tocá Vender.", d: "La entrega entra a tu caja abierta y las cuotas quedan en Cuentas a cobrar. La propiedad pasa a vendida.", marca: "Vender" },
      ] },
      { ojo: "Si anulás la venta, la propiedad vuelve a estar disponible." },
    ],
  },
  {
    id: "inmo-caja", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/caja/nueva", titulo: "Vender en cuotas desde la caja", resumen: "Elegir un plan y cobrar la entrega en el momento.",
    bloques: [
      { img: "inmo-caja-credito", alt: "Venta a crédito con plan y entrega", pasos: [
        { t: "Elegí el cliente.", d: "A crédito es obligatorio.", marca: "Cliente *" },
        { t: "Tocá Crédito.", marca: "Crédito" },
        { t: "Elegí el plan.", d: "Pone las cuotas, cada cuánto y en cuántos días vence la primera.", marca: "Plan de cuotas" },
        { t: "Si querés, cambiá las cuotas a mano.", d: "Al tocarlas, el plan se quita.", marca: "Cuotas" },
        { t: "Revisá la entrega inicial.", d: "Se completa con el mínimo del plan. Las cuotas se arman sobre lo que falta.", marca: "Entrega inicial" },
        { t: "Elegí con qué paga la entrega.", marca: "Cómo paga la entrega" },
        { t: "Cargá la propiedad y tocá Aceptar y cobrar.", d: "La entrega se cobra en ese momento y el resto queda en cuotas." },
      ] },
      { consejo: "Si el plan tiene recargo, la ventana de cobro te muestra el total con el recargo y cuánto queda cada cuota." },
    ],
  },
  {
    id: "inmo-alquiler", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/inmobiliaria/alquileres", titulo: "Alquilar una propiedad", resumen: "El contrato con el inquilino, el aumento y la comisión.",
    bloques: [
      { img: "inmo-alquileres", alt: "Lista de contratos", pasos: [{ t: "Tocá Nuevo contrato.", marca: "Nuevo contrato" }] },
      { img: "inmo-contrato", alt: "Contrato de alquiler", pasos: [
        { t: "Elegí la propiedad.", marca: "Propiedad" },
        { t: "Elegí el inquilino.", marca: "Inquilino" },
        { t: "Revisá el alquiler por mes.", d: "Viene de la ficha de la propiedad.", marca: "Alquiler por mes" },
        { t: "Elegí qué día del mes vence.", marca: "Vence el día" },
        { t: "Poné cuántos meses dura.", d: "Si lo dejás vacío, no tiene fin.", marca: "Duración (meses)" },
        { t: "Si sube, poné cuánto aumenta y cada cuántos meses.", d: "Por ejemplo, 5 % cada 12 meses. Se aplica solo.", marca: "Aumento (%)" },
        { t: "Revisá la comisión de la inmobiliaria.", d: "Viene de la propiedad. Es lo que te quedás de cada cobro.", marca: "Comisión de la inmobiliaria (%)" },
        { t: "Tocá Guardar.", d: "La propiedad pasa a alquilada.", marca: "Guardar" },
      ] },
      { consejo: "Para cerrar un contrato, abrilo y tocá Terminar. Si se corta antes, Rescindir." },
    ],
  },
  {
    id: "inmo-cobrar-alquiler", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/inmobiliaria/alquileres", titulo: "Cobrar el alquiler y pagarle al dueño", resumen: "La cuota de cada mes y la liquidación al propietario.",
    bloques: [
      { img: "inmo-alquileres", alt: "Contratos con el mes sin emitir", pasos: [
        { t: "Cada mes, tocá Emitir el mes.", d: "Crea la cuota de cada contrato vigente y queda en Cuentas a cobrar. Si ya lo emitiste, el botón queda gris y cada contrato dice Mes emitido.", marca: "Emitir el mes" },
      ] },
      { texto: "Cuando el inquilino paga, registrá el cobro como cualquier deuda (guía «Registrar el pago de una deuda»)." },
      { img: "inmo-liquidar", alt: "Liquidar a los dueños", pasos: [
        { t: "Tocá Liquidar a dueños.", marca: "Liquidar a dueños" },
        { t: "Mirá cuánto le toca a cada dueño.", d: "Lo cobrado menos la comisión de la inmobiliaria.", marca: "A pagarle" },
        { t: "Elegí cómo le pagás.", d: "Si es transferencia, anotá la referencia.", marca: "Transferencia" },
        { t: "Tocá Liquidar.", d: "La plata sale de tu caja y queda el comprobante de la liquidación.", marca: "Liquidar Gs. 3.150.000" },
      ] },
    ],
  },
  {
    id: "inmo-busqueda", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/clientes", titulo: "Anotar lo que busca un cliente", resumen: "Así te avisa cuando entra algo que le sirve.",
    bloques: [
      { texto: "Abrí la ficha del cliente desde la lista." },
      { img: "inmo-cliente-tab", alt: "Ficha del cliente", pasos: [
        { t: "Tocá Inmobiliaria.", marca: "Inmobiliaria" },
        { t: "Tocá Agregar.", marca: "Agregar" },
      ] },
      { img: "inmo-busqueda", alt: "Lo que busca el cliente", pasos: [
        { t: "Elegí si quiere comprar o alquilar.", marca: "Qué busca" },
        { t: "Elegí el tipo de propiedad.", d: "Si le da igual, dejá Cualquiera.", marca: "Tipo de propiedad" },
        { t: "Elegí la ciudad.", marca: "Ciudad" },
        { t: "Poné hasta cuánto puede pagar.", marca: "Hasta (precio)" },
        { t: "Si necesita un terreno mínimo, ponelo.", marca: "Terreno mínimo (m²)" },
        { t: "Anotá lo que pidió.", d: "Por ejemplo: con patio y cochera.", marca: "Notas" },
        { t: "Tocá Guardar.", d: "Abajo te muestra las propiedades disponibles que le sirven.", marca: "Guardar" },
      ] },
    ],
  },
  {
    id: "inmo-avisos", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/inmobiliaria", titulo: "Avisar a los interesados", resumen: "Entró una propiedad que alguien busca: mandale un WhatsApp.",
    bloques: [
      { texto: "Cuando cargás una propiedad, vuelve a estar disponible o le bajás el precio, y le sirve a alguien que la busca, te llega un aviso a la campanita." },
      { img: "inmo-avisos", alt: "Clientes para avisar", pasos: [
        { t: "Arriba de las propiedades ves a quién avisarle.", marca: "1 cliente para avisar" },
        { t: "Tocá WhatsApp.", d: "Se abre WhatsApp con el mensaje listo. Lo revisás y lo enviás vos: el sistema no manda nada solo.", marca: "WhatsApp" },
        { t: "Si ya se lo dijiste por otro lado, tocá Ya le avisé.", marca: "Ya le avisé" },
        { t: "Si no le interesa, tocá Descartar.", marca: "Descartar" },
      ] },
      { img: "inmo-ficha-venta", alt: "Avisos en la ficha de la propiedad", pasos: [
        { t: "También los ves en la ficha de la propiedad.", marca: "WhatsApp" },
      ] },
      { consejo: "Lo que ya le servía cuando cargaste la búsqueda no se avisa: lo ves en la ficha del cliente." },
    ],
  },
  {
    id: "inmo-planes", grupo: "Inmobiliaria", rubro: "inmobiliaria", ruta: "/configuracion/cuotas", titulo: "Planes de cuotas, recargo y mora", resumen: "Los planes que se eligen al vender y el interés por atraso.",
    bloques: [
      { img: "inmo-config-cuotas", alt: "Planes de cuotas y mora", pasos: [
        { t: "Poné hasta cuántas cuotas se puede vender.", d: "Hasta 360.", marca: "Cuotas como máximo" },
        { t: "Tocá Agregar plan.", marca: "Agregar plan" },
        { t: "Ponele un nombre.", d: "Por ejemplo: 120 cuotas con 10 % de entrega.", marca: "Nombre" },
        { t: "Poné en cuántas cuotas y cada cuánto.", marca: "Cuotas" },
        { t: "Poné la entrega mínima.", d: "En porcentaje del precio.", marca: "Entrega mín. (%)" },
        { t: "Si financiar cuesta, poné el recargo.", d: "Se suma sobre lo financiado como un renglón de la venta y lo pagan las cuotas.", marca: "Recargo (%)" },
        { t: "Para cobrar interés por atraso, prendé la mora.", d: "Arranca apagada. Elegí la tasa por mes y los días de gracia.", marca: "Cobrar interés por mora" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { consejo: "El interés por mora se suma al cobrar. Quien tenga el permiso lo puede perdonar, con un motivo." },
    ],
  },

  // ── Asistencia: rubro Gimnasio/academias (solo con la función prendida; capturas en public/manual/gimnasio) ──
  {
    id: "gim-clase", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio/clases", titulo: "Crear una clase", resumen: "Natación, karate, spinning: días, hora, profesor y cupo.",
    bloques: [
      { img: "gim-clases", alt: "Lista de clases", pasos: [{ t: "Tocá Nueva clase.", marca: "Nueva clase" }] },
      { img: "gim-clase-form", alt: "Datos de la clase", pasos: [
        { t: "Escribí el nombre de la clase.", d: "Por ejemplo: Natación nivel 1.", marca: "Nombre *" },
        { t: "Elegí el profesor.", d: "Es quien cobra la comisión de esa clase.", marca: "Profesor" },
        { t: "Marcá los días que se da.", marca: "Días *" },
        { t: "Poné la hora y cuánto dura.", marca: "Hora *" },
        { t: "Poné el cupo.", d: "Cuántos alumnos entran. Vacío es sin límite.", marca: "Cupo" },
        { t: "Si esta clase tiene otro precio suelta, ponelo.", d: "Vacío usa el precio de Precios y reglas.", marca: "Clase suelta (Gs.)" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { consejo: "La clase se repite sola todas las semanas: aparece en la Recepción y en la Agenda de cada día." },
    ],
  },
  {
    id: "gim-reglas", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio/clases", titulo: "Precio de la clase suelta y deudas", resumen: "Cuánto cuesta una clase sin membresía y si entra quien debe.",
    bloques: [
      { img: "gim-clases", alt: "Lista de clases", pasos: [{ t: "Tocá Precios y reglas.", marca: "Precios y reglas" }] },
      { img: "gim-reglas", alt: "Precios y reglas", pasos: [
        { t: "Poné el precio de la clase suelta.", d: "Se cobra cuando el alumno no tiene membresía o ya usó sus clases del mes.", marca: "Clase suelta (Gs.)" },
        { t: "Decidí si se frena a quien debe.", d: "Prendido, el alumno con una cuota vencida sin pagar no puede marcar la entrada.", marca: "Frenar la entrada a quien debe" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
    ],
  },
  {
    id: "gim-membresia", grupo: "Asistencia", rubro: "gimnasio", ruta: "/clientes/suscripciones", titulo: "Crear una membresía", resumen: "Mensual ilimitada o con un número de clases por mes.",
    bloques: [
      { img: "gim-plan", alt: "Plan de membresía", texto: "En Planes, abrí la pestaña Planes y tocá Nuevo plan.", pasos: [
        { t: "Escribí el nombre.", d: "Por ejemplo: Natación 8 clases.", marca: "Nombre" },
        { t: "Poné el precio del mes.", marca: "Precio mensual" },
        { t: "Poné cuántas clases por mes incluye.", d: "Vacío es ilimitada. Cuando se terminan, las siguientes se cobran como clase suelta.", marca: "Clases por mes" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { consejo: "Después, en la ficha del alumno, en Suscripciones, le asignás el plan. Cada mes se emite la cuota como en cualquier suscripción." },
    ],
  },
  {
    id: "gim-alumno", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio", titulo: "Recibir a un alumno", resumen: "Ver si está al día, marcar su entrada y cobrarle.",
    bloques: [
      { img: "gim-alumno", alt: "Recepción con el alumno elegido", pasos: [
        { t: "Buscá al alumno.", d: "Por nombre, CI o teléfono.", marca: "Alumno" },
        { t: "Mirá si está al día.", d: "En verde dice Al día. En rojo debe una cuota vencida y no puede entrar.", marca: "Debe Gs. 180.000 vencido" },
        { t: "Si viene a la sala sin clase, tocá Entrada libre.", d: "Descuenta una clase de su membresía, o se cobra como clase suelta.", marca: "Entrada libre" },
        { t: "Si debe, tocá Cobrar.", d: "Se cobra en tu caja abierta, como cualquier deuda.", marca: "Cobrar" },
      ] },
      { ojo: "Quien tenga el permiso puede dejar entrar a alguien que debe: le pide el motivo, y queda registrado con su nombre." },
    ],
  },
  {
    id: "gim-asistencia", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio", titulo: "Marcar la asistencia de una clase", resumen: "Anotar alumnos y marcar quién vino.",
    bloques: [
      { img: "gim-recepcion", alt: "Clases del día con sus alumnos", pasos: [
        { t: "Para sumar a alguien, tocá Anotar alumno.", d: "Si la clase está llena, no deja.", marca: "Anotar alumno" },
        { t: "Cuando llega, tocá Llegó.", d: "Queda en espera. Si debe, no lo deja.", marca: "Llegó" },
        { t: "Al terminar la clase, tocá Culminó.", d: "Ahí descuenta la clase de su membresía o se cobra la clase suelta.", marca: "Culminó" },
        { t: "Si no vino, tocá No vino.", marca: "No vino" },
      ] },
      { consejo: "Con las flechas de arriba pasás a otro día. Lo mismo se puede marcar desde la Agenda." },
    ],
  },
  {
    id: "gim-turno", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio", titulo: "Dar un turno individual", resumen: "Personal trainer o clase de prueba con un profesor.",
    bloques: [
      { img: "gim-turno", alt: "Turno individual", texto: "En la Recepción tocá Turno individual.", pasos: [
        { t: "Elegí el alumno.", marca: "Alumno *" },
        { t: "Elegí el profesor.", marca: "Profesor *" },
        { t: "Poné el día, la hora y los minutos.", marca: "Día *" },
        { t: "Tocá Crear turno.", d: "También aparece en la Agenda.", marca: "Crear turno" },
      ] },
    ],
  },
  {
    id: "gim-autoasistencia", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio/autoasistencia", titulo: "Que el alumno marque solo", resumen: "Un QR en la entrada: el alumno marca su llegada con su CI y su PIN.",
    bloques: [
      { img: "gim-autoasistencia", alt: "Link y QR de asistencia", pasos: [
        { t: "Tocá Imprimir QR y pegalo en la entrada.", d: "Sale una hoja con el QR grande y los pasos para el alumno.", marca: "Imprimir QR" },
        { t: "O mandá el link por WhatsApp con Compartir.", marca: "Compartir" },
      ] },
      { img: "gim-pin", alt: "PIN del alumno", texto: "Cada alumno necesita su PIN. En Recepción buscalo.", pasos: [
        { t: "Tocá Crear PIN y dáselo al alumno.", d: "Son 4 números y se ven una sola vez. Si se lo olvida, tocá Cambiar PIN.", marca: "Crear PIN" },
      ] },
      { img: "gim-link", alt: "Lo que ve el alumno", pasos: [
        { t: "El alumno escanea el QR y pone su cédula.", marca: "Tu cédula" },
        { t: "Pone su PIN y toca Entrar.", d: "Después toca Llegué en su clase, o Entrada libre. Ya cuenta como asistencia.", marca: "Entrar" },
      ] },
      { ojo: "Si tiene una cuota vencida no puede marcar: le pide pasar por recepción." },
    ],
  },  {
    id: "gim-comisiones", grupo: "Asistencia", rubro: "gimnasio", ruta: "/gimnasio/comisiones", titulo: "Comisión de los profesores", resumen: "Elegir cómo se paga y ver cuánto le toca a cada uno.",
    bloques: [
      { img: "gim-comisiones", alt: "Comisiones de profesores", pasos: [
        { t: "Elegí la regla.", d: "Un monto por alumno que asistió, por clase dada o un porcentaje del valor de la clase.", marca: "Regla" },
        { t: "Poné el monto o el porcentaje y tocá Guardar.", marca: "Guardar" },
        { t: "Con las flechas elegí el mes.", d: "Abajo ves a cada profesor con sus clases, alumnos y la comisión.", marca: "Total del mes" },
      ] },
    ],
  },  // ── RR HH ────────────────────────────────────────────────────────────────────
  {
    id: "rrhh-datos", grupo: "RR HH", ruta: "/rrhh", titulo: "Cargar los datos de una persona", resumen: "Datos personales, trabajo, salario y horario.",
    bloques: [
      { texto: "Acá aparecen los usuarios del sistema. Para sumar a alguien, primero crealo en Configuración › Usuarios." },
      { img: "rrhh-lista", alt: "Lista del personal", pasos: [
        { t: "En Falta cargar están las personas sin datos.", d: "En la lista dicen Cargar datos.", marca: "Falta cargar" },
        { t: "Tocá el nombre de la persona.", marca: "Laura Benítez" },
      ] },
      { img: "rrhh-ficha", alt: "Ficha de la persona", pasos: [
        { t: "Escribí su nombre.", marca: "Nombres *" },
        { t: "Escribí su número de cédula.", marca: "Número de CI" },
        { t: "Elegí su fecha de nacimiento.", marca: "Fecha de nacimiento" },
        { t: "Escribí su teléfono.", marca: "Número de contacto" },
        { t: "Escribí su correo.", d: "Es obligatorio y tiene que tener @. No cambia el correo con el que entra al sistema.", marca: "Correo *" },
        { t: "Escribí su dirección.", marca: "Dirección" },
        { t: "Elegí su ciudad.", d: "Podés buscarla escribiendo. Si no está, elegí la última opción y escribila.", marca: "Ciudad" },
        { t: "Elegí su barrio.", d: "La lista muestra solo los barrios de esa ciudad.", marca: "Barrio" },
        { t: "Escribí el nombre de quién llamar en una emergencia.", marca: "Nombre del contacto" },
        { t: "Elegí su parentesco.", d: "Por ejemplo: madre, hermano o pareja.", marca: "Parentesco" },
        { t: "Escribí el teléfono de ese contacto.", marca: "Teléfono del contacto" },
        { t: "Elegí la fecha en que empezó a trabajar.", d: "De acá salen la antigüedad, las vacaciones y el aguinaldo.", marca: "Fecha de ingreso *" },
        { t: "Escribí en qué área trabaja.", d: "Por ejemplo: Ventas, Caja o Depósito.", marca: "Área de trabajo" },
        { t: "Elegí su perfil.", d: "Define qué puede hacer en el sistema. Tu propio perfil lo cambia otro administrador.", marca: "Perfil" },
        { t: "Elegí su sucursal.", marca: "Sucursal" },
        { t: "Elegí si es mensualero o jornalero.", marca: "Cómo cobra" },
        { t: "Escribí cuánto gana.", d: "Si es jornalero, cuánto gana por día.", marca: "Salario mensual (Gs.)" },
        { t: "Dejá prendido Aporta IPS si aporta.", marca: "Aporta IPS" },
        { t: "Apagá Comisiona si no cobra comisión.", d: "Así deja de aparecer en Comisiones.", marca: "Comisiona" },
        { t: "Tocá los días que trabaja.", marca: "Lu" },
        { t: "Escribí a qué hora entra y a qué hora sale.", marca: "Entrada" },
        { t: "Tocá Guardar.", marca: "Guardar" },
        { t: "Arriba ves su antigüedad, sus vacaciones y su aguinaldo.", d: "Se calculan solos.", marca: "ANTIGÜEDAD" },
      ] },
      { ojo: "Sin un correo con @ no se puede guardar." },
    ],
  },
  {
    id: "rrhh-salario", grupo: "RR HH", ruta: "/rrhh", titulo: "Cambiar el salario", resumen: "Un aumento queda guardado con su motivo.",
    bloques: [
      { img: "rrhh-lista", alt: "Lista del personal", pasos: [{ t: "Tocá el nombre de la persona.", marca: "Laura Benítez" }] },
      { img: "rrhh-salario", alt: "Cambio de salario con su motivo", pasos: [
        { t: "Escribí el salario nuevo.", marca: "Salario mensual (Gs.)" },
        { t: "Escribí el motivo.", d: "Por ejemplo: aumento anual o ascenso.", marca: "Motivo del cambio *" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { consejo: "Los meses ya cerrados no cambian. El salario nuevo cuenta para los meses que todavía están abiertos." },
    ],
  },
  {
    id: "rrhh-ausencia", grupo: "RR HH", ruta: "/rrhh", titulo: "Registrar una ausencia", resumen: "Faltas, permisos y reposos.",
    bloques: [
      { img: "rrhh-lista", alt: "Lista del personal", pasos: [{ t: "Tocá el nombre de la persona.", marca: "Laura Benítez" }] },
      { img: "rrhh-ausencias", alt: "Ausencias de la persona", pasos: [
        { t: "Tocá Ausencias.", marca: "Ausencias" },
        { t: "Tocá Registrar ausencia.", marca: "Registrar ausencia" },
      ] },
      { img: "rrhh-ausencia-nueva", alt: "Formulario de ausencia", pasos: [
        { t: "Elegí el día en que faltó.", marca: "Fecha" },
        { t: "Escribí cuántos días faltó.", d: "Medio día: 0,5. Si abarca dos meses, cargá una ausencia por mes.", marca: "Días" },
        { t: "Elegí el tipo de ausencia.", marca: "Tipo" },
        { t: "Mirá si descuenta del salario.", d: "Se prende o apaga solo según el tipo, y lo podés cambiar. Te muestra cuánto va a descontar.", marca: "Descuenta del salario" },
        { t: "Escribí el motivo, si querés.", marca: "Motivo" },
        { t: "Tocá Guardar.", d: "El descuento pasa solo a la liquidación del mes.", marca: "Guardar" },
      ] },
      { img: "rrhh-ausencias", alt: "Ausencias de la persona", pasos: [{ t: "Si te equivocaste, tocá Anular y escribí el motivo.", marca: "Anular" }] },
      { ojo: "Con la liquidación del mes cerrada no se cargan ni se anulan ausencias de ese mes. Primero hay que reabrirla." },
    ],
  },
  {
    id: "rrhh-vacaciones", grupo: "RR HH", ruta: "/rrhh", titulo: "Cargar vacaciones", resumen: "Cuántos días le quedan y cuándo se los toma.",
    bloques: [
      { img: "rrhh-lista", alt: "Lista del personal", pasos: [{ t: "Tocá el nombre de la persona.", marca: "Laura Benítez" }] },
      { img: "rrhh-vacaciones", alt: "Vacaciones de la persona", pasos: [
        { t: "Tocá Vacaciones.", marca: "Vacaciones" },
        { t: "Disponibles son los días que le quedan.", marca: "DISPONIBLES" },
        { t: "Generados son los días que ganó por sus años completos.", d: "12 días hábiles por año hasta 5 años, 18 hasta 10 años y 30 después.", marca: "GENERADOS" },
        { t: "Próximos son los días que gana en su próximo aniversario.", marca: "PRÓXIMOS" },
        { t: "Tocá Cargar vacaciones.", marca: "Cargar vacaciones" },
      ] },
      { img: "rrhh-vacacion-nueva", alt: "Formulario de vacaciones", pasos: [
        { t: "Elegí el primer día.", marca: "Desde" },
        { t: "Elegí el último día.", marca: "Hasta" },
        { t: "Escribí cuántos días hábiles son.", d: "Si son más de los disponibles, se puede cargar igual como adelanto.", marca: "Días hábiles" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
    ],
  },
  {
    id: "rrhh-historial", grupo: "RR HH", ruta: "/rrhh", titulo: "Ver el historial de una persona", resumen: "Aumentos, cambios, ausencias y ascensos.",
    bloques: [
      { img: "rrhh-lista", alt: "Lista del personal", pasos: [{ t: "Tocá el nombre de la persona.", marca: "Laura Benítez" }] },
      { img: "rrhh-historial", alt: "Historial de la persona", pasos: [
        { t: "Tocá Historial.", marca: "Historial" },
        { t: "Cada aumento muestra el salario de antes, el nuevo y el motivo.", d: "También quedan los demás cambios, las ausencias, las vacaciones y las liquidaciones cerradas.", marca: "Cambio de salario" },
        { t: "Para sumar un ascenso o una felicitación, tocá Agregar al historial.", marca: "Agregar al historial" },
      ] },
      { img: "rrhh-historial-nota", alt: "Agregar al historial", pasos: [
        { t: "Elegí el tipo.", d: "Ascenso, felicitación, capacitación, llamada de atención u otro.", marca: "Tipo" },
        { t: "Escribí qué pasó.", marca: "Qué pasó *" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
    ],
  },
  {
    id: "rrhh-liquidacion", grupo: "RR HH", ruta: "/rrhh/liquidaciones", titulo: "Preparar la liquidación del mes", resumen: "El extracto para revisar con tu asesor.",
    bloques: [
      { texto: "La liquidación es un extracto para revisar con tu asesor. No registra pagos ni gastos." },
      { img: "rrhh-liquidaciones", alt: "Liquidaciones del mes", pasos: [
        { t: "Elegí el mes.", d: "Con las flechas pasás al anterior o al siguiente.", marca: "noviembre de 2026" },
        { t: "Neto a cobrar es la suma de lo que cobra cada persona.", marca: "NETO A COBRAR" },
        { t: "IPS empresa es lo que aporta la empresa.", d: "No sale del salario de nadie.", marca: "IPS EMPRESA" },
        { t: "Tocá el nombre de una persona para ver su extracto.", marca: "Laura Benítez" },
      ] },
      { img: "rrhh-extracto", alt: "Extracto de una persona", pasos: [
        { t: "Las ausencias que descuentan ya están restadas.", d: "Un día vale el salario dividido 30. Si la persona comisiona, la comisión del mes también aparece sola.", marca: "Ausencias: 1 día" },
        { t: "Imponible es sobre lo que se calcula el IPS.", marca: "Imponible" },
        { t: "Neto a cobrar es lo que le queda a la persona.", marca: "Neto a cobrar" },
        { t: "Para sumar o restar algo más, tocá Agregar.", marca: "Agregar" },
      ] },
      { img: "rrhh-extra", alt: "Agregar horas extra", pasos: [
        { t: "Escribí qué es, elegí si suma o resta y escribí el monto.", d: "Por ejemplo: horas extra o un adelanto.", marca: "Extras y descuentos" },
        { t: "Si suma, indicá si aporta IPS.", d: "Si no sabés, preguntale a tu asesor.", marca: "Aporta IPS" },
        { t: "Tocá Guardar.", d: "El extracto se actualiza.", marca: "Guardar" },
      ] },
      { img: "rrhh-liquidaciones", alt: "Liquidaciones del mes", pasos: [{ t: "Si dice Faltan días, es un jornalero: tocá su nombre.", marca: "Faltan días" }] },
      { img: "rrhh-jornalero", alt: "Extracto de un jornalero", pasos: [
        { t: "Escribí cuántos días trabajó en el mes.", marca: "Días trabajados en el mes *" },
        { t: "Tocá Guardar.", d: "Sin este dato no se puede cerrar.", marca: "Guardar" },
      ] },
      { img: "rrhh-extracto", alt: "Extracto de una persona", pasos: [
        { t: "Tocá Imprimir para llevarle el extracto a tu asesor.", d: "Trae lugar para las firmas. También lo podés guardar como PDF.", marca: "Imprimir" },
        { t: "Cuando esté revisado, tocá Cerrar.", d: "Queda fijo aunque después cambie el salario.", marca: "Cerrar" },
      ] },
      { img: "rrhh-liquidaciones", alt: "Liquidaciones del mes", pasos: [
        { t: "Tocá Excel para bajar el mes completo.", d: "Trae a todas las personas, con su aguinaldo acumulado y sus vacaciones.", marca: "Excel" },
        { t: "Con Cerrar el mes cerrás todas las que falten.", d: "Antes cargá los días de los jornaleros: si falta alguno, no cierra.", marca: "Cerrar el mes" },
      ] },
      { img: "rrhh-cerrada", alt: "Liquidación cerrada", pasos: [{ t: "Para corregir una cerrada, abrila y tocá Reabrir.", d: "Te pide el motivo, y queda en el historial.", marca: "Reabrir" }] },
      { consejo: "El aguinaldo acumulado es una doceava parte de lo ganado en el año. Si hay meses sin cerrar, en mensualeros se estiman con el salario actual." },
      { ojo: "Los cálculos son una ayuda. Tu asesor tiene que revisarlos antes de pagar." },
    ],
  },
  // ── Comedor (receta 161-164): solo si la empresa tiene la función Comedor prendida ──────────
  {
    id: "comedor-arranque", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/panel",
    titulo: "Poner en marcha el comedor", resumen: "El orden para arrancar: empresa, padrón, menú y las terminales.",
    bloques: [
      { texto: "El comedor funciona en 4 pasos. Hacelos en orden la primera vez; después es solo el día a día." },
      { texto: "1) Cargá la empresa y su subsidio en Configuración del comedor." },
      { texto: "2) Cargá el padrón de funcionarios (importá el Excel) en Funcionarios." },
      { texto: "3) Armá el menú de la semana y publicá el enlace en Menú semanal." },
      { texto: "4) Abrí la terminal de Retiro en la tablet del comedor." },
      { consejo: "El día a día: el domingo publicás el menú, el funcionario reserva por el enlace, al mediodía retira en la terminal, y a fin de mes sacás la Liquidación." },
    ],
  },
  {
    id: "comedor-empresa", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/configuracion",
    titulo: "Cargar la empresa y el subsidio", resumen: "La empresa contratante y cuánto subsidio tiene cada funcionario por mes.",
    bloques: [
      { pasos: [{ t: "Tocá Nueva empresa.", marca: "Nueva empresa" }] },
      { pasos: [
        { t: "Escribí el nombre de la empresa.", d: "Por ejemplo: Kingspan MV Aceros S.A.", marca: "Nombre de la empresa" },
        { t: "Poné el subsidio mensual por funcionario.", d: "Lo que cubre la empresa por mes a cada uno. Por defecto Gs 350.000.", marca: "Subsidio mensual (Gs)" },
        { t: "Si querés, elegí el día y la hora de cierre de reservas.", d: "Hasta cuándo pueden reservar los funcionarios cada semana.", marca: "Día de cierre de reservas" },
        { t: "Tocá Guardar.", marca: "Guardar" },
      ] },
      { ojo: "El subsidio no se acumula: arranca de nuevo cada mes. Lo que un funcionario gasta de más queda como excedente, que la empresa le recupera." },
    ],
  },
  {
    id: "comedor-padron", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/funcionarios",
    titulo: "Cargar el padrón de funcionarios", resumen: "Importá la lista del Excel o agregalos a mano. Cada funcionario es una ficha de cliente.",
    bloques: [
      { texto: "Lo más rápido es importar el Excel con el nombre y la cédula de cada uno." },
      { pasos: [{ t: "Tocá Importar padrón.", marca: "Importar padrón" }] },
      { pasos: [
        { t: "Elegí la empresa a la que pertenecen.", marca: "Empresa contratante del padrón" },
        { t: "Subí el Excel.", d: "Columnas: Nombre y apellido · CI. Podés bajar la plantilla desde el mismo asistente.", marca: "Analizar (preview)" },
        { t: "Revisá la vista previa y tocá Confirmar.", d: "Te muestra cuántos se crean y cuántos se actualizan antes de guardar.", marca: "Confirmar e importar" },
      ] },
      { texto: "Para cargar uno a mano, tocá Nuevo funcionario y poné nombre, cédula y empresa." },
      { consejo: "La cédula es la llave: con ella el funcionario reserva y retira. Si alguien deja la empresa, editá su ficha y desactivalo (se conserva su historial)." },
    ],
  },
  {
    id: "comedor-menu", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/menu",
    titulo: "Armar y publicar el menú de la semana", resumen: "Dos opciones por día, publicás el enlace y ves cuántos reservaron.",
    bloques: [
      { texto: "Para cada día de lunes a viernes cargás 2 opciones de almuerzo." },
      { pasos: [
        { t: "Escribí el nombre de cada plato en Opción 1 y Opción 2.", marca: "Nombre del plato" },
        { t: "Poné el precio del plato.", d: "Es lo que se le descuenta del subsidio al retirar.", marca: "Precio" },
        { t: "Si un día es especial (ej. asado), marcá Especial y poné el precio especial.", d: "La diferencia con el precio normal la paga la empresa, no sale del subsidio.", marca: "Especial" },
      ] },
      { pasos: [
        { t: "Elegí el cierre de reservas.", d: "Hasta cuándo pueden reservar (ej. domingo 10:00).", marca: "Cierre de reservas" },
        { t: "Tocá Publicar y generar enlace.", marca: "Publicar y generar enlace" },
        { t: "Copiá el enlace y mandáselo a los funcionarios.", d: "Por WhatsApp o el grupo. Con ese link reservan su menú.", marca: "Copiar" },
      ] },
      { consejo: "Cuando empiecen a reservar, vas a ver el número de reservas en cada opción: así sabés cuánto preparar." },
    ],
  },
  {
    id: "comedor-reserva", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/menu",
    titulo: "Cómo reserva el funcionario", resumen: "Lo que hace cada funcionario con el enlace que le pasás.",
    bloques: [
      { texto: "El funcionario abre el enlace en el celular (no necesita usuario ni contraseña)." },
      { texto: "Pone su cédula y elige una opción por día, o 'traigo mi propio almuerzo'." },
      { ojo: "Solo puede retirar quien reservó. Si no reservó un día, ese día no puede retirar." },
      { consejo: "Puede cambiar su elección hasta la hora de cierre que vos pusiste." },
    ],
  },
  {
    id: "comedor-retiro", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/retiro",
    titulo: "El retiro en el comedor", resumen: "La terminal donde el funcionario marca su almuerzo. Reemplaza la planilla.",
    bloques: [
      { texto: "Primero generás el enlace de la terminal y lo dejás abierto en la tablet del comedor." },
      { pasos: [
        { t: "Elegí el depósito del que se descuentan los ingredientes.", marca: "Depósito del que descuenta el stock" },
        { t: "Tocá Generar enlace y abrilo en la tablet del comedor.", d: "Ese enlace queda fijo; no hace falta generarlo de nuevo.", marca: "Generar enlace" },
      ] },
      { texto: "Al mediodía, cada funcionario pone su cédula en la tablet, ve su menú reservado y confirma. Eso descuenta su subsidio y queda registrado." },
      { ojo: "Cada funcionario retira una sola vez por día. Si ya retiró, la terminal lo avisa." },
      { consejo: "En esta misma pantalla ves los retiros del día con sus totales. Si hubo un error, podés anular un retiro (devuelve el stock y libera el subsidio)." },
    ],
  },
  {
    id: "comedor-cantina", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/cantina",
    titulo: "Cargar la cantina a cuenta", resumen: "Productos extra (gaseosa, snack) a la cuenta del funcionario, sin cobrar en caja.",
    bloques: [
      { pasos: [
        { t: "Poné la cédula del funcionario y tocá Buscar.", marca: "Buscar" },
        { t: "Tocá los productos para agregarlos y ajustá la cantidad.", marca: "Buscar producto…" },
        { t: "Tocá Cargar a la cuenta.", marca: "Cargar a la cuenta" },
      ] },
      { ojo: "La cantina también descuenta del subsidio del mes. Cuando se agota, lo que sigue queda como excedente del funcionario." },
    ],
  },
  {
    id: "comedor-liquidacion", grupo: "Comedor", rubro: "comedor", ruta: "/comedor/liquidacion",
    titulo: "La liquidación mensual", resumen: "Lo que se le cobra a la empresa: subsidio, excedente y diferencias de especiales.",
    bloques: [
      { pasos: [
        { t: "Elegí el período (desde y hasta) y, si hay varias, la empresa.", marca: "Desde" },
      ] },
      { texto: "La tabla muestra, por funcionario: reservas, almuerzos, cantina, subsidio aplicado, excedente y diferencia de especiales, con el total." },
      { pasos: [
        { t: "Bajá la liquidación en PDF o Excel para mandársela a la empresa.", marca: "PDF" },
      ] },
      { consejo: "El total es lo que paga la empresa. El excedente es la parte que la empresa le recupera a cada funcionario; la diferencia de los menús especiales la absorbe la empresa." },
    ],
  },
];

/** Las imágenes que usa el manual y dónde se midieron sus marcas (para regenerar marcas.json). */
export function marcasPorImagen(): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  for (const g of GUIAS) for (const b of g.bloques) if (b.img) r[b.img] = [...(r[b.img] ?? []), ...(b.pasos ?? []).flatMap((p) => (p.marca ? [p.marca] : []))];
  return r;
}
