/**
 * Manual de usuario: una guía por tarea. Cada guía declara la pantalla que explica (`ruta`), así se
 * muestra solo si esa pantalla existe en el rubro activo y el perfil la puede abrir.
 *
 * Los pasos con `marca` llevan su número sobre la imagen: `marca` es el texto del botón o campo en esa
 * captura, y su posición sale de marcas.json (generado midiendo la pantalla real).
 */
export type Paso = { t: string; marca?: string };
export type Bloque = { img?: string; alt?: string; pasos?: Paso[]; texto?: string; consejo?: string; ojo?: string };
export type Guia = {
  id: string;
  grupo: string;
  titulo: string;
  resumen: string;
  /** Pantalla que explica. Sin ruta: se muestra siempre. */
  ruta?: string;
  /** Solo para este rubro (la guía del día a día). */
  rubro?: "comercio" | "gastronomia";
  bloques: Bloque[];
};

export const GRUPOS = ["Primeros pasos", "Caja y ventas", "Pedidos y mesas", "Cocina y recetas", "Inventario", "Compras y gastos", "Clientes y ventas", "Cobros", "Reportes", "Atención al cliente", "Configuración"];

export const GUIAS: Guia[] = [
  // ── Primeros pasos ───────────────────────────────────────────────────────────
  {
    id: "dia-comercio", grupo: "Primeros pasos", rubro: "comercio", titulo: "Un día de trabajo en tu negocio", resumen: "El orden de las tareas, de la mañana a la noche.",
    bloques: [
      { texto: "Si recién empezás, leé esto primero. Cada paso tiene su guía propia en este manual, con imágenes." },
      { pasos: [
        { t: "A la mañana, abrí la caja y anotá con cuánto cambio arrancás." },
        { t: "Si trabajás con vendedores, ellos arman el pedido del cliente y lo mandan a caja." },
        { t: "El cajero cobra: los pedidos que llegan o las ventas directas. El stock baja solo." },
        { t: "Cuando llega mercadería, cargá la factura como compra. El stock sube y el costo se actualiza solo." },
        { t: "Cuando un cliente te paga una deuda, registrá el cobro." },
        { t: "A la noche, contá el efectivo y cerrá la caja. Si algo no coincide, el sistema te pide el motivo." },
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
        { t: "La cocina lo prepara y lo marca como listo. Los ingredientes se descuentan cuando se cobra." },
        { t: "Cuando la mesa pide la cuenta, se envía a caja y se cobra." },
        { t: "Si fabricás algo por tanda, registralo en Producción para que el stock esté al día." },
        { t: "Al cerrar, contá el efectivo y cerrá la caja. Si algo no coincide, el sistema te pide el motivo." },
      ] },
      { consejo: "Cerrá la caja todos los días. Así, si falta plata, sabés de qué día es y se encuentra rápido." },
    ],
  },
  {
    id: "moverse", grupo: "Primeros pasos", titulo: "Cómo moverte por el sistema", resumen: "El menú, el buscador, los avisos y tu cuenta.",
    bloques: [
      { img: "inicio", alt: "Pantalla de Inicio con el menú a la izquierda", pasos: [
        { t: "El menú de la izquierda tiene todas las secciones. Tocá una para entrar. En el celular, se abre con el botón de las tres rayitas.", marca: "Caja" },
        { t: "¿No encontrás una pantalla? Tocá Buscar y escribí lo que necesitás, por ejemplo «cerrar caja». También abre con la tecla / del teclado.", marca: "Buscar…" },
        { t: "La campanita avisa lo que necesita tu atención. El número rojo dice cuántos avisos tenés.", marca: "2" },
        { t: "Tocá tu nombre para salir del sistema. Si la computadora la usan varios, salí siempre al terminar.", marca: "admin@demo.neura.com.py" },
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
        { t: "Ganancia bruta: lo vendido menos lo que costó esa mercadería. No descuenta alquiler ni sueldos.", marca: "GANANCIA BRUTA DEL MES" },
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
        { t: "Entrá a Caja › Apertura y cierre y tocá Abrir caja.", marca: "Abrir caja" },
      ] },
      { img: "caja-abrir", alt: "Ventana para abrir una caja", pasos: [
        { t: "Elegí la caja que vas a usar. Las que dicen Abierta ya están en uso.", marca: "Caja 2" },
        { t: "Contá el cambio que hay en el cajón y tocá el monto, o escribilo. Si no hay cambio, tocá Sin cambio.", marca: "Gs. 100.000" },
        { t: "Tocá el botón Abrir. Desde ese momento, todo lo que vendas y cobres queda en este turno.", marca: "Abrir Caja 2" },
      ] },
      { ojo: "Contá el cambio de verdad. A la noche, el sistema compara el efectivo contra este número." },
    ],
  },
  {
    id: "vender", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Hacer una venta", resumen: "De buscar el producto a entregar el ticket.",
    bloques: [
      { img: "venta-buscar", alt: "Buscador de productos con resultados", pasos: [
        { t: "Entrá a Caja › Nueva venta. Pasá el lector por el código de barras, o escribí el nombre del producto.", marca: "Arroz" },
        { t: "Tocá el producto en la lista, o apretá Enter para agregar el primero.", marca: "Arroz 1 kg" },
      ] },
      { img: "venta-item", alt: "Venta con un producto cargado y el total", pasos: [
        { t: "El producto aparece en la lista. Con − y + cambiás la cantidad. Repetí con todos los productos.", marca: "ARROZ1K" },
        { t: "Mirá el total. Es lo que tiene que pagar el cliente, con IVA incluido.", marca: "Total a cobrar" },
        { t: "Tocá Aceptar y cobrar.", marca: "Aceptar y cobrar" },
      ] },
      { img: "venta-cobrar", alt: "Ventana de cobro con las formas de pago", pasos: [
        { t: "Elegí cómo te paga: efectivo, débito, crédito, transferencia, QR o cheque.", marca: "Efectivo" },
        { t: "Si paga en efectivo, tocá el billete que te dio o escribí el monto. El sistema te dice cuánto vuelto dar.", marca: "Gs. 50.000" },
        { t: "¿Paga una parte de cada forma? Tocá Agregar otra forma de pago.", marca: "Agregar otra forma de pago (mixto)" },
        { t: "Tocá Cobrar. La venta queda hecha, baja el stock y sale el ticket.", marca: "Cobrar e imprimir" },
      ] },
      { consejo: "Con teclado es más rápido: Enter agrega, Espacio cobra, + y − cambian la cantidad, Supr quita el producto y Esc limpia." },
      { ojo: "¿Te equivocaste antes de cobrar? Tocá Volver y corregí: todavía no se guardó nada." },
    ],
  },
  {
    id: "factura", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Ticket, factura y cliente", resumen: "Qué elegir según lo que pida el cliente.",
    bloques: [
      { img: "venta-vacia", alt: "Datos de la venta arriba de la pantalla", pasos: [
        { t: "Para un ticket común no hace falta cliente. Si querés que quede a su nombre, buscalo acá por nombre o RUC.", marca: "Buscar por nombre o RUC…" },
        { t: "Solo ticket es la opción normal: comprobante interno.", marca: "Solo ticket" },
        { t: "Factura se habilita cuando el cliente elegido tiene RUC cargado.", marca: "Factura" },
        { t: "¿El cliente quiere factura y no está cargado? Usá Facturar como cliente ocasional.", marca: "Facturar como cliente ocasional (X)" },
      ] },
      { ojo: "Sin RUC no hay factura. Si el cliente solo tiene CI, se le hace ticket o se usa cliente ocasional." },
    ],
  },
  {
    id: "credito", grupo: "Caja y ventas", ruta: "/caja/nueva", titulo: "Vender a crédito o en cuotas", resumen: "El cliente se lleva ahora y paga después.",
    bloques: [
      { img: "venta-credito", alt: "Venta a crédito con cuotas y vencimiento", pasos: [
        { t: "Tocá Crédito.", marca: "Crédito" },
        { t: "Elegí el cliente. A crédito es obligatorio, porque alguien tiene que quedar debiendo.", marca: "Cliente *" },
        { t: "Escribí en cuántas cuotas paga. Con 1, paga todo junto.", marca: "Cuotas" },
        { t: "Escribí en cuántos días vence. Abajo ves la fecha exacta.", marca: "Vence en" },
        { t: "Cargá los productos y cobrá como siempre: no entra plata a la caja, queda la deuda del cliente." },
      ] },
      { texto: "Cuando el cliente te pague, seguí la guía «Registrar el pago de una deuda»." },
      { ojo: "Si el cliente tiene límite de crédito y esta venta lo pasa, el sistema no te deja venderle." },
    ],
  },
  {
    id: "retiro", grupo: "Caja y ventas", ruta: "/caja/turnos", titulo: "Sacar o poner plata en la caja", resumen: "Depósitos, retiros del dueño y cambio extra.",
    bloques: [
      { img: "caja-retiro", alt: "Ventana de retiro de efectivo", pasos: [
        { t: "En Apertura y cierre, tocá Retiro / ingreso en tu caja. Elegí Retiro si sale plata o Ingreso si entra.", marca: "Retiro" },
        { t: "Elegí el motivo. Si es otro, explicalo en el detalle.", marca: "Depósito en banco" },
        { t: "Escribí el monto. Arriba del botón ves cuánto debería haber en la caja.", marca: "Monto en efectivo" },
        { t: "Tocá Registrar.", marca: "Registrar retiro" },
      ] },
      { ojo: "Registrá siempre la plata que sacás. Si no, a la noche te va a faltar en el arqueo." },
    ],
  },
  {
    id: "cerrar-caja", grupo: "Caja y ventas", ruta: "/caja/turnos", titulo: "Cerrar la caja", resumen: "Contar la plata y terminar el turno.",
    bloques: [
      { img: "caja-turnos", alt: "Pantalla Apertura y cierre con las cajas abiertas", pasos: [
        { t: "Entrá a Caja › Apertura y cierre y tocá Cerrar en tu caja.", marca: "Cerrar" },
      ] },
      { img: "caja-cerrar", alt: "Ventana de cierre de caja con el arqueo", pasos: [
        { t: "Contá el efectivo del cajón sin mirar la pantalla y escribí el total. También podés cargarlo por billete.", marca: "¿Cuánto efectivo contaste?" },
        { t: "Compará con lo que debería haber. Tocá Ver de dónde sale si querés entender el número.", marca: "Ver de dónde sale" },
        { t: "Confirmá las otras formas de pago contra el POS o la app del banco. Si un monto no coincide, corregilo.", marca: "OTRAS FORMAS DE PAGO · SE CONFIRMAN" },
        { t: "Si hay diferencia, explicá el motivo en la observación y confirmá el cierre.", marca: "Observación (opcional)" },
      ] },
      { ojo: "Una caja cerrada ya no se toca: no se puede vender en ella ni anular cobros que entraron ahí." },
    ],
  },
  {
    id: "ordenes", grupo: "Caja y ventas", ruta: "/caja", titulo: "Buscar una venta y anularla", resumen: "Ver qué se vendió, reimprimir o deshacer una venta.",
    bloques: [
      { img: "caja-ordenes", alt: "Lista de órdenes de venta", pasos: [
        { t: "Entrá a Caja › Órdenes de venta. Usá los filtros para achicar la lista por fecha, caja o forma de pago.", marca: "Todas las fechas" },
        { t: "Tocá una venta para ver el detalle.", marca: "VTA-005075" },
        { t: "En el detalle, tocá Anular venta y escribí el motivo. Vuelve el stock y sale la plata de la caja." },
      ] },
      { ojo: "Una factura se puede anular solo dentro de las 48 horas. Después hay que hacer una nota de crédito." },
    ],
  },
  {
    id: "nota-credito", grupo: "Caja y ventas", ruta: "/caja/notas-credito", titulo: "Devolver un producto (nota de crédito)", resumen: "El cliente devuelve algo o le hacés un descuento después de la venta.",
    bloques: [
      { pasos: [
        { t: "Entrá a Caja › Órdenes de venta y abrí la venta." },
        { t: "Tocá Nota de crédito." },
        { t: "Elegí Devolución (productos) o Descuento (solo un monto)." },
        { t: "En una devolución, marcá qué productos y cuántos. Si la mercadería sirve, dejala volver al stock; si está rota, no." },
        { t: "Elegí qué pasa con la plata: devolverla, o dejarla a favor del cliente para su próxima compra." },
        { t: "Escribí el motivo y confirmá." },
      ] },
      { img: "caja-nc", alt: "Lista de notas de crédito", pasos: [
        { t: "Todas las notas quedan en Caja › Notas de crédito. Tocá una para ver el detalle o anularla.", marca: "NC-000001" },
      ] },
      { consejo: "Si la venta era a crédito y todavía no pagó, la nota baja lo que debe: no sale plata de la caja." },
    ],
  },

  // ── Pedidos y mesas ──────────────────────────────────────────────────────────
  {
    id: "pedidos", grupo: "Pedidos y mesas", ruta: "/caja/pedidos", titulo: "Pedidos de mostrador", resumen: "El vendedor arma el pedido y la caja lo cobra.",
    bloques: [
      { img: "caja-pedidos", alt: "Pantalla de pedidos de mostrador", pasos: [
        { t: "Entrá a Caja › Pedidos. Buscá los productos arriba o escaneá el código." },
        { t: "Si el cliente te da sus datos, elegilo. No es obligatorio.", marca: "Cliente (opcional)" },
        { t: "Si hace falta, escribí una aclaración.", marca: "Nota (opcional)" },
        { t: "Tocá Enviar a caja. El pedido recibe un número: decíselo al cliente.", marca: "Enviar a caja" },
        { t: "Abajo ves los pedidos del día y en qué estado están.", marca: "Pedidos de hoy" },
      ] },
      { texto: "El cajero, en Nueva venta, ve los pedidos por cobrar y lo cobra como una venta común. El pedido cuenta para la comisión de quien lo armó." },
      { consejo: "El stock baja recién cuando se cobra. Un pedido sin cobrar no descuenta nada." },
    ],
  },
  {
    id: "mesas-config", grupo: "Pedidos y mesas", ruta: "/configuracion/mesas", titulo: "Crear mesas e imprimir los QR", resumen: "Se hace una sola vez, al empezar.",
    bloques: [
      { img: "config-mesas", alt: "Lista de mesas con sus QR", pasos: [
        { t: "Entrá a Configuración › Mesas y QR y tocá Nueva mesa.", marca: "Nueva mesa" },
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
        { t: "Los pedidos que hacen los clientes por QR aparecen acá solos, y suena un aviso si dejás prendido el Sonido.", marca: "Sonido" },
        { t: "Revisá el pedido en Nuevos y aceptalo: pasa a la cocina. Si no se puede hacer, rechazalo.", marca: "Nuevos" },
        { t: "En Cuentas abiertas ves cada mesa con lo que lleva consumido.", marca: "Cuentas abiertas" },
        { t: "Cuando la mesa pide la cuenta, enviala a caja." },
        { t: "En Nueva venta, el cajero ve la mesa por cobrar y la cobra como una venta común." },
      ] },
      { consejo: "El cliente puede dividir la cuenta desde su celular. A la caja llega cada parte por separado." },
      { ojo: "Las ventas de mesa no comisionan." },
    ],
  },

  // ── Cocina y recetas ─────────────────────────────────────────────────────────
  {
    id: "cocina", grupo: "Cocina y recetas", ruta: "/caja/cocina", titulo: "Pantalla de cocina", resumen: "Qué preparar y en qué orden.",
    bloques: [
      { img: "caja-cocina", alt: "Pantalla de cocina con tres columnas", pasos: [
        { t: "Elegí tu estación para ver solo lo tuyo.", marca: "Todas" },
        { t: "Lo nuevo entra en Para preparar. Tocalo cuando empezás a hacerlo.", marca: "Para preparar" },
        { t: "Pasa a En preparación. Tocalo cuando esté terminado.", marca: "En preparación" },
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
        { t: "Entrá a Inventario › Recetas. Tocá un plato para cargarle sus ingredientes, cantidades y merma.", marca: "Empanada de carne" },
        { t: "Acá ves cuántas recetas están completas, a cuáles les falta un ingrediente y cuáles no tienen.", marca: "COMPLETAS" },
        { t: "La tabla te muestra el costo, el margen y para cuántas porciones alcanza lo que tenés.", marca: "ALCANZA PARA" },
        { t: "Nueva preparación sirve para lo que se prepara en la cocina y se usa en otros platos, como una salsa.", marca: "Nueva preparación" },
      ] },
      { img: "recetas-extras", alt: "Lista de extras", pasos: [
        { t: "En Extras cargás lo que se suma a un plato con costo, como «Extra queso».", marca: "Nuevo extra" },
      ] },
      { ojo: "Un plato sin receta no se puede vender: el sistema te avisa para que la cargues." },
    ],
  },
  {
    id: "produccion", grupo: "Cocina y recetas", ruta: "/inventario/produccion", titulo: "Fabricar por tanda", resumen: "Lo que hacés vos para vender después, como bolsas de maní.",
    bloques: [
      { img: "inventario-produccion", alt: "Pantalla de Producción", pasos: [
        { t: "Entrá a Inventario › Producción y tocá Fabricar.", marca: "Fabricar" },
        { t: "Elegí el producto y la cantidad. El sistema te muestra qué materias primas va a usar y si alcanzan." },
        { t: "Cargá cuánto salió de verdad: si esperabas 40 y salieron 38, se registra la merma y el costo real." },
        { t: "Confirmá. Bajan las materias primas y sube el stock del producto." },
      ] },
      { ojo: "Si no alcanzan las materias primas, no te deja fabricar: comprá primero." },
    ],
  },

  // ── Inventario ───────────────────────────────────────────────────────────────
  {
    id: "productos", grupo: "Inventario", ruta: "/inventario", titulo: "Ver tus productos y su stock", resumen: "Cuánto hay, cuánto cuesta y a cuánto se vende.",
    bloques: [
      { img: "inventario-productos", alt: "Lista de productos", pasos: [
        { t: "Entrá a Inventario › Productos. Con estos filtros ves una categoría o un depósito.", marca: "Categoría: Todas" },
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
      { img: "producto-nuevo", alt: "Formulario de nuevo producto", pasos: [
        { t: "En Productos, tocá Nuevo producto. Si ves los tipos, elegí Reventa para lo que comprás y vendés tal cual.", marca: "Reventa" },
        { t: "Escribí el nombre como querés que aparezca en el ticket.", marca: "Nombre *" },
        { t: "El SKU es su código interno. Tocá Generar y listo.", marca: "SKU *" },
        { t: "Si trae código de barras, pasá el lector acá.", marca: "Código de barras (opcional)" },
        { t: "Bajá hasta Precios: cargá el precio de venta con IVA incluido y elegí 10 %, 5 % o Exenta. Después guardá." },
      ] },
      { texto: "Tipos de producto, si tu negocio los usa: Menú es un plato con receta; Materia prima es un ingrediente que no se vende; Fabricado es lo que hacés vos y vendés con stock." },
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
        { t: "Tocá Aplicar ajuste. El stock queda corregido y todo queda registrado.", marca: "Aplicar ajuste" },
      ] },
      { ojo: "Las pérdidas que carga un cajero o vendedor quedan pendientes hasta que las aprueba quien tiene ese permiso. Mientras tanto, el stock no cambia." },
    ],
  },
  {
    id: "traslados", grupo: "Inventario", ruta: "/inventario/traslados", titulo: "Pasar mercadería a otro depósito", resumen: "Entre depósitos o sucursales, con nota de remisión.",
    bloques: [
      { img: "traslado-nuevo", alt: "Formulario de nuevo traslado", pasos: [
        { t: "En Inventario › Traslados, tocá Nuevo traslado. Elegí de dónde sale.", marca: "Sale de" },
        { t: "Elegí a dónde llega.", marca: "Llega a" },
        { t: "Buscá los productos y escribí las cantidades.", marca: "Productos" },
        { t: "Revisá el motivo, la fecha y, si querés, los datos del transporte. Guardá y salen del origen." },
      ] },
      { img: "inventario-traslados", alt: "Lista de traslados", pasos: [
        { t: "El traslado queda En tránsito hasta que lo reciben.", marca: "En tránsito" },
        { t: "En destino, abrilo y confirmá lo que llegó. Si llegó menos, escribí el motivo." },
      ] },
      { ojo: "Hasta que no lo reciben, esa mercadería no se puede vender en ningún depósito." },
    ],
  },
  {
    id: "movimientos", grupo: "Inventario", ruta: "/inventario/movimientos", titulo: "Averiguar por qué cambió el stock", resumen: "Cada entrada y salida, con quién la hizo.",
    bloques: [
      { img: "inventario-movimientos", alt: "Lista de movimientos de inventario", pasos: [
        { t: "Entrá a Inventario › Movimientos y filtrá por tipo: ventas, traslados, ajustes, pérdidas…", marca: "Ventas" },
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
        { t: "Entrá a Gastos empresariales › Compras y gastos y tocá Nueva compra o gasto.", marca: "Nueva compra o gasto" },
      ] },
      { img: "compra-nueva", alt: "Formulario de nueva compra", pasos: [
        { t: "Elegí qué es: Mercadería suma stock, Gasto es alquiler o luz, y Mixta lleva las dos cosas.", marca: "Mercadería" },
        { t: "Elegí el proveedor.", marca: "Proveedor *" },
        { t: "Copiá el número de la factura.", marca: "Número *" },
        { t: "Elegí Contado si ya pagaste, o Crédito si queda como deuda.", marca: "Contado" },
        { t: "Buscá o escaneá cada producto, con su cantidad y costo. Después guardá.", marca: "Productos" },
      ] },
      { ojo: "Si pagás en efectivo, la plata sale de la caja abierta: tiene que haber una caja abierta." },
      { consejo: "Podés adjuntar la foto de la factura para tenerla a mano." },
    ],
  },
  {
    id: "orden-compra", grupo: "Compras y gastos", ruta: "/compras/ordenes", titulo: "Pedirle mercadería a un proveedor", resumen: "La orden de compra: qué pediste y cuánto llegó.",
    bloques: [
      { img: "orden-nueva", alt: "Formulario de orden de compra", pasos: [
        { t: "En Órdenes de compra, tocá Nueva orden y elegí el proveedor.", marca: "Proveedor *" },
        { t: "Buscá los productos a pedir.", marca: "Buscá los productos que le vas a pedir." },
        { t: "Este botón te muestra lo que está por debajo del stock mínimo, para no olvidarte de nada.", marca: "Ver qué está por debajo del stock mínimo" },
        { t: "Tocá Crear orden de compra. Después podés bajar el PDF y mandárselo.", marca: "Crear orden de compra" },
      ] },
      { img: "compras-ordenes", alt: "Lista de órdenes de compra", pasos: [
        { t: "Cuando llegue la mercadería, abrí la orden y recibila. Ahí recién sube el stock.", marca: "OC-000001" },
      ] },
    ],
  },
  {
    id: "proveedor", grupo: "Compras y gastos", ruta: "/proveedores", titulo: "Cargar un proveedor", resumen: "A quién le comprás.",
    bloques: [
      { img: "proveedor-nuevo", alt: "Formulario de nuevo proveedor", pasos: [
        { t: "En Proveedores, tocá Nuevo proveedor. Solo la razón social es obligatoria.", marca: "Razón social *" },
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
        { t: "Cuentas a pagar es la lista de facturas. Filtrá por Vencidas para ver lo urgente.", marca: "Vencidas" },
        { t: "Elegí el proveedor o la factura, cargá cómo le pagás y confirmá. La deuda baja." },
        { t: "En Pagos realizados está todo lo que ya pagaste.", marca: "Pagos realizados" },
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
        { t: "Entrá a Comercial › Clientes y tocá Nuevo cliente.", marca: "Nuevo cliente" },
      ] },
      { img: "cliente-nuevo", alt: "Formulario de nuevo cliente", pasos: [
        { t: "Elegí si es una persona o una empresa.", marca: "Persona" },
        { t: "Escribí el nombre.", marca: "NOMBRE Y APELLIDO *" },
        { t: "Escribí el RUC o CI. El sistema avisa si ya existe.", marca: "RUC O CI *" },
        { t: "Escribí el teléfono.", marca: "TELÉFONO *" },
        { t: "Si la factura va a otro nombre, completá esta parte. Si la dejás vacía, se usan los datos de arriba.", marca: "DATOS PARA FACTURACIÓN" },
        { t: "Tocá Guardar cliente.", marca: "Guardar cliente" },
      ] },
      { consejo: "Tocá un cliente en la lista para ver su ficha: lo que compró, lo que debe y su estado de cuenta." },
    ],
  },
  {
    id: "crm", grupo: "Clientes y ventas", ruta: "/crm", titulo: "Seguir a los posibles clientes", resumen: "De la primera consulta hasta la venta.",
    bloques: [
      { img: "crm", alt: "Tablero de oportunidades por etapa", pasos: [
        { t: "Cada columna es una etapa. Arrastrá la tarjeta a la siguiente cuando avanza.", marca: "Contactado" },
        { t: "Con Nuevo prospecto cargás uno nuevo.", marca: "Nuevo prospecto" },
        { t: "Cuando se concreta, tocá Transformar a cliente.", marca: "Transformar a cliente" },
        { t: "Solo hoy te muestra a quién tenés que contactar hoy.", marca: "Solo hoy" },
      ] },
      { img: "crm-nuevo", alt: "Formulario de nuevo prospecto", pasos: [
        { t: "Completá la empresa y la persona de contacto.", marca: "EMPRESA *" },
        { t: "Marcá qué le interesa.", marca: "SERVICIOS / PRODUCTOS DE INTERÉS *" },
        { t: "Anotá qué vas a hacer y cuándo, para que no se te pase.", marca: "PRÓXIMA ACCIÓN" },
      ] },
    ],
  },
  {
    id: "presupuestos", grupo: "Clientes y ventas", ruta: "/presupuestos", titulo: "Hacer un presupuesto", resumen: "Cotizar y convertirlo en venta si te dicen que sí.",
    bloques: [
      { img: "presupuestos", alt: "Lista de presupuestos", pasos: [
        { t: "Entrá a Comercial › Presupuestos y tocá Nuevo presupuesto.", marca: "Nuevo presupuesto" },
        { t: "Elegí el cliente, cargá los productos y creá el presupuesto." },
        { t: "Mandáselo. Podés bajarlo en PDF o compartirle un enlace para que lo acepte o rechace." },
        { t: "En estas pestañas sabés en qué quedó cada uno.", marca: "Abiertos" },
        { t: "Cuando lo aceptan, convertilo en venta: no hace falta cargar todo de nuevo.", marca: "Aceptados" },
      ] },
      { ojo: "Un presupuesto no descuenta stock. Solo cuenta cuando se convierte en venta." },
    ],
  },
  {
    id: "gestion", grupo: "Clientes y ventas", ruta: "/clientes/gestion", titulo: "Atender una consulta de un cliente", resumen: "Encontrar todo de un cliente en un solo lugar.",
    bloques: [
      { img: "gestion-clientes", alt: "Pantalla de Gestión del Cliente", pasos: [
        { t: "Escribí el nombre, RUC, teléfono, correo o documento en el único buscador.", marca: "Buscá un cliente" },
        { t: "Abrí el cliente y registrá el motivo de la consulta (eso se llama tipificar), para que quede el historial." },
      ] },
    ],
  },
  {
    id: "comisiones", grupo: "Clientes y ventas", ruta: "/comisiones", titulo: "Ver tus comisiones", resumen: "Cuánto llevás ganado en el mes.",
    bloques: [
      { img: "comisiones", alt: "Pantalla de Comisiones", texto: "Comisionás por lo que vendés. Si armaste un pedido y lo cobró la caja, la venta es tuya. Si la registraste directo en Nueva venta, también." },
      { pasos: [
        { t: "Entrá a Comercial › Comisiones y elegí el mes." },
        { t: "Mirá cuánto vendiste, en qué tramo estás y cuánto falta para el siguiente." },
        { t: "Abajo está cada movimiento, y lo que todavía no te pagaron." },
      ] },
      { texto: "No comisionan las suscripciones, las ventas de mesa ni lo que el administrador excluya con motivo. Una nota de crédito resta lo devuelto en el mes en que se hizo." },
      { ojo: "Si dice que no hay política configurada, el administrador tiene que cargarla en Configuración › Comisiones." },
    ],
  },
  {
    id: "planes", grupo: "Clientes y ventas", ruta: "/clientes/suscripciones", titulo: "Abonos y cuotas mensuales", resumen: "Lo que tus clientes pagan todos los meses.",
    bloques: [
      { img: "planes", alt: "Pantalla de suscripciones", pasos: [
        { t: "En Planes creás lo que ofrecés, cada uno con su plazo definido.", marca: "Planes" },
        { t: "En Suscripciones ves qué cliente tiene qué plan.", marca: "Suscripciones" },
        { t: "Cada mes, tocá Emitir cuotas para generar lo que tienen que pagar.", marca: "Emitir cuotas de Noviembre 2026 (1)" },
      ] },
      { consejo: "Una suscripción pausada no genera cuotas. Sirve si el cliente deja por un tiempo y después vuelve." },
    ],
  },
  {
    id: "agenda", grupo: "Clientes y ventas", ruta: "/clientes/agenda", titulo: "Agendar una cita", resumen: "Reuniones y visitas, con recordatorio.",
    bloques: [
      { img: "agenda-nueva", alt: "Formulario de nueva cita", pasos: [
        { t: "En Comercial › Agenda, tocá Nueva cita. Poné un título claro.", marca: "Título *" },
        { t: "Elegí quiénes participan. Todos reciben el recordatorio.", marca: "Responsables *" },
        { t: "Elegí la fecha y la hora de inicio.", marca: "Fecha *" },
        { t: "Tocá cuánto dura.", marca: "30m" },
        { t: "Elegí el cliente, si corresponde, y guardá.", marca: "Cliente existente" },
      ] },
    ],
  },

  // ── Cobros ───────────────────────────────────────────────────────────────────
  {
    id: "cobrar-deuda", grupo: "Cobros", ruta: "/pagos", titulo: "Registrar el pago de una deuda", resumen: "Un cliente vino a pagar lo que debía.",
    bloques: [
      { img: "pagos", alt: "Lista de facturas pendientes de cobro", pasos: [
        { t: "Entrá a Finanzas › Pagos. En Pendientes está lo que te deben.", marca: "Pendientes" },
        { t: "Buscá por el nombre del cliente.", marca: "BUSCAR POR NOMBRE DE CLIENTE" },
        { t: "Al final de cada fila, a la derecha, están los botones. Si no los ves, deslizá la tabla hacia un costado." },
        { t: "Si te paga en persona, tocá En caja: el cobro entra a tu caja abierta." },
        { t: "Si te transfirió, tocá Cobrar." },
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
        { t: "En Pendiente están las transferencias que cargaron. Comparalas con tu banco.", marca: "Pendiente" },
        { t: "Si entró, aprobala: recién ahí baja la deuda. Si no, rechazala." },
        { t: "Para no comparar a mano, tocá Cargar extracto y subí el archivo del banco.", marca: "Cargar extracto (Excel o CSV)" },
        { t: "Con Registrar transferencia cargás una que todavía no esté.", marca: "Registrar transferencia" },
      ] },
    ],
  },
  {
    id: "cobranzas", grupo: "Cobros", ruta: "/cobranzas", titulo: "Saber quién te debe", resumen: "Clientes con deuda y hace cuánto.",
    bloques: [
      { img: "cobranzas", alt: "Pantalla de seguimiento de cobranzas", pasos: [
        { t: "Arriba ves el total que te deben y cuántos clientes son.", marca: "Total adeudado Gs. 1.382.300" },
        { t: "Los tramos agrupan a los clientes según cuánto atraso tienen. Empezá por los más atrasados.", marca: "Tramo 3" },
        { t: "Promesas hoy son los clientes que dijeron que hoy te pagan.", marca: "Promesas hoy" },
        { t: "Tocá un cliente para ver el detalle y anotar lo que hablaste con él." },
      ] },
    ],
  },

  // ── Reportes ─────────────────────────────────────────────────────────────────
  {
    id: "reportes", grupo: "Reportes", ruta: "/reportes", titulo: "Sacar un reporte", resumen: "Todos los números, en Excel o PDF.",
    bloques: [
      { img: "reportes", alt: "Lista de reportes", pasos: [
        { t: "Entrá a Reportes y tocá Ver reporte en el que necesitás. Ponele las fechas, y bajalo en Excel o PDF.", marca: "Ver reporte" },
        { t: "Cierre de caja por día: cuánto se vendió y cobró cada día.", marca: "Cierre de caja por día" },
        { t: "Productos vendidos: qué se vende más y cuánto te deja.", marca: "Productos vendidos" },
        { t: "Cuentas por cobrar y por pagar: lo que te deben y lo que debés.", marca: "Cuentas por cobrar" },
        { t: "Existencias por depósito: cuánta mercadería tenés y cuánto vale.", marca: "Existencias por depósito" },
        { t: "Registro de comprobantes (RG 90): el archivo para tu contador.", marca: "Registro de comprobantes (RG 90)" },
      ] },
    ],
  },

  // ── Atención al cliente ──────────────────────────────────────────────────────
  {
    id: "omnicanal", grupo: "Atención al cliente", ruta: "/conversaciones", titulo: "Responder los chats", resumen: "Todos los mensajes de los clientes en un solo lugar.",
    bloques: [
      { img: "conversaciones", alt: "Bandeja de conversaciones", pasos: [
        { t: "Mías son las que te asignaron. Empezá por ahí.", marca: "Mías" },
        { t: "Sin asignar son las que nadie tomó todavía.", marca: "Sin asignar" },
        { t: "Dejá tu estado en Disponible para que te lleguen chats.", marca: "Disponible" },
        { t: "En Respuestas tenés textos listos para no escribir siempre lo mismo.", marca: "Respuestas" },
        { t: "Tocá un chat a la izquierda, escribí abajo y enviá. Al terminar, finalizá la conversación." },
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
    ],
  },

  // ── Configuración ────────────────────────────────────────────────────────────
  {
    id: "empresa", grupo: "Configuración", ruta: "/configuracion/empresa", titulo: "Datos de tu empresa", resumen: "Lo que sale en tickets y documentos.",
    bloques: [
      { img: "config-empresa", alt: "Formulario de datos de la empresa", pasos: [
        { t: "Escribí la razón social como figura en tu constancia de RUC.", marca: "Razón social *" },
        { t: "El nombre de fantasía es el que va grande en los documentos.", marca: "Nombre de fantasía (opcional)" },
        { t: "Cargá el RUC. El sistema controla que esté bien escrito.", marca: "RUC (opcional)" },
        { t: "Más abajo van la dirección, el teléfono y el logo. Guardá al terminar." },
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
        { t: "Entrá a Configuración › Usuarios y tocá Nuevo usuario.", marca: "Nuevo usuario" },
        { t: "En la lista ves si cada uno está conectado y cuándo entró por última vez.", marca: "CONEXIÓN" },
      ] },
      { img: "usuario-nuevo", alt: "Formulario de nuevo usuario", pasos: [
        { t: "Escribí el nombre.", marca: "Nombre *" },
        { t: "Escribí el correo: ahí le llega la invitación para elegir su contraseña. Vos nunca la ves.", marca: "Email *" },
        { t: "Elegí el perfil. A la derecha ves qué va a poder usar.", marca: "Perfil *" },
        { t: "Elegí su sucursal: de ahí sale el stock de lo que venda.", marca: "Sucursal" },
      ] },
      { img: "perfiles", alt: "Perfiles y permisos", pasos: [
        { t: "En Perfiles y permisos cambiás qué ve y qué puede hacer cada perfil, o creás uno nuevo.", marca: "Nuevo perfil" },
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
        { t: "Cargá los tramos: desde qué monto, hasta cuál y qué porcentaje. Dejá vacío «Hasta» en el último.", marca: "Desde" },
        { t: "Con Agregar escala sumás otro tramo.", marca: "Agregar escala" },
        { t: "Tocá Guardar política. Sin esto, nadie ve comisiones.", marca: "Guardar política" },
      ] },
    ],
  },
];

/** Las imágenes que usa el manual y dónde se midieron sus marcas (para regenerar marcas.json). */
export function marcasPorImagen(): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  for (const g of GUIAS) for (const b of g.bloques) if (b.img) r[b.img] = [...(r[b.img] ?? []), ...(b.pasos ?? []).flatMap((p) => (p.marca ? [p.marca] : []))];
  return r;
}
