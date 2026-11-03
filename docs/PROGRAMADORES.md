# Hoja para programadores: clonar el ERP 2.0 para un cliente

La guía larga, con cada paso a mano, está en [CLONAR.md](CLONAR.md). Esta hoja alcanza para el día a día.

---

## 1. Preparar tu computadora (una sola vez)

### La forma fácil

Pedile al administrador dos cosas: el `.env.local` de la flota y la IP del servidor. Después:

1. Bajá el 2.0:
   ```bash
   git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git
   ```
2. Poné el `.env.local` en esa carpeta, al lado de `package.json`.
3. Abrí la carpeta en Claude Code y escribile:

   > Prepará mi computadora para clonar clientes: corré `npm run preparar -- --ip <la IP>` y decime qué falta.

   O correlo vos mismo en una terminal, dentro de la carpeta.
4. La primera vez te muestra una línea que empieza con `ssh-ed25519`: es tu llave pública. Mandásela al
   administrador (no es secreta).
5. Cuando te avise que la agregó, volvé a correr `npm run preparar`. Tiene que decir **"Listo: ya podés
   clonar"**.

El comando se puede repetir sin miedo: cada vez hace solo lo que falta (crear la llave, armar
`~/.ssh/config`, probar la conexión) y te dice el próximo paso. Nunca muestra tu llave privada.

### A mano, paso por paso

Lo mismo que hace `npm run preparar`:

**a. Instalá** [Node 22](https://nodejs.org) y [git](https://git-scm.com).

**b. Traé el 2.0:**

```bash
git clone https://github.com/bartsilvera12-gif/neura-erp-2.0.git
cd neura-erp-2.0
```

**c. Pedí el `.env.local` de la flota** y ponelo en la raíz de esa carpeta (al lado de `package.json`).
Tiene las claves maestras de Supabase:
- Nunca lo subas a git: `.gitignore` ya lo excluye, no lo fuerces.
- No lo mandes por chat abierto ni por correo.
- No lo copies a otro lado.

**d. Creá tu llave SSH** para el servidor. Al final poné tu nombre, sin espacios (ej. `juan.perez`):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/neura_zentra -C "tu.nombre"
```

Mandale a quien administra el servidor **solo** el archivo `~/.ssh/neura_zentra.pub`, el que termina
en `.pub`. El otro (`neura_zentra`, sin extensión) es privado y no sale de tu computadora.

Es una llave **restringida**: entrás como el usuario `clonador`, que solo puede trabajar en la base de
datos (crear el schema del cliente, cargar la empresa, correr las pruebas). No abre consola, no ve
archivos del servidor y no puede reiniciar nada.

**e. Cuando te confirme que la agregó**, sumá esto a `~/.ssh/config` (en Windows:
`C:\Users\<vos>\.ssh\config`). La IP te la pasa él.

```
Host zentra-app
    HostName <IP del servidor>
    User clonador
    IdentityFile ~/.ssh/neura_zentra
    IdentitiesOnly yes
    ServerAliveInterval 60
```

**f. Probá la conexión.** Tiene que responder `ok`:

```bash
echo "select 'ok';" | ssh zentra-app /usr/local/bin/erp-psql postgres At
```

Cualquier otro comando (`ssh zentra-app`, `ssh zentra-app ls`…) responde "pedido no permitido": es
lo esperado.

---

## 2. Clonar un cliente

**a. Pedí los datos:**
- nombre del negocio y razón social;
- dominio;
- nombre y correo del administrador;
- rubro: Comercio (ferretería, almacén, tienda) o Gastronomía (restaurante, bar);
- color y logo (opcionales).

**b. Abrí el formulario** desde la carpeta del 2.0:

```bash
git pull
npm run clonar
```

`git pull` trae la última versión del 2.0: el formulario copia lo que está guardado en git. Lo que
tengas modificado sin commit no va al clon.

**c. Completá el formulario.** Se abre solo en tu navegador (http://localhost:4545). Al escribir el
nombre se completan solos el schema, el dominio y la carpeta: revisalos.

**d. Elegí las opciones:**

| Opción | Qué hacer |
|---|---|
| Instalar y compilar | Dejala tildada: confirma que el clon arranca. Tarda unos minutos. |
| Subir al repo del cliente | Solo si ya creaste el repo vacío en GitHub y pegaste su dirección. |

**e. Tocá Clonar y no cierres la pestaña.** Cada paso se pone en verde. Cuando pasan las pruebas, el
formulario habilita el cliente en Supabase solo (la API y el login se cortan unos segundos para todos)
y queda anotado con tu nombre. Si el dominio no es `<nombre>.neura.com.py` sino uno propio del
cliente, ese paso lo hace el administrador: el resumen te dice qué pedirle.

**f. Al final:**
- **Contraseña del administrador:** si la dejaste vacía, se muestra una sola vez. Copiala y pasásela
  al cliente por un canal seguro.
- **Lo que falta:** el resumen lo dice. Casi siempre es Coolify (app nueva desde el repo del cliente,
  con las variables del `.env.local` de la carpeta del clon) y el dominio en Cloudflare.

**g. Cerrá el formulario** con Ctrl+C en la terminal.

### Si algo falla

El formulario se frena y dice qué pasó. Corregí y tocá **Clonar** otra vez con los **mismos datos**:
retoma la misma carpeta sin repetir lo hecho ni duplicar nada.

| Dice | Qué hacer |
|---|---|
| "El schema … ya existe" | Ese cliente ya tiene base. Elegí otro nombre o, si es el mismo cliente, usá la carpeta donde lo clonaste. |
| "La carpeta … ya existe" | Elegí otra carpeta, o la del clon de ese mismo schema para retomarlo. |
| "Falta … en el .env.local del 2.0" | No está el `.env.local` de la flota en la carpeta del 2.0 (paso 1c). |
| "no acepta tu llave SSH" | El administrador todavía no la agregó, o `~/.ssh/config` apunta a otro archivo (paso 1e). |
| "No llego a zentra-app" | Revisá el `HostName` en `~/.ssh/config` (paso 1e). |
| "falta erp-psql" o "falta erp-habilitar" | El servidor no tiene la puerta al día: avisale al administrador. |
| Falla "Habilitar en Supabase" | Pasale el mensaje al administrador. La base ya quedó armada: cuando lo resuelva, tocá Clonar otra vez. |
| Falla una receta en "Armar la base" | Mandá el detalle ("Ver el detalle") a quien mantiene el 2.0. No la arregles en el clon. |

---

## 3. Trabajar en un clon

- **Un arreglo que sirve para todos** se hace en el 2.0, no en el clon.
- **Para traer los arreglos del 2.0** al clon, desde la carpeta del clon:

  ```bash
  git fetch base
  git merge base/main
  npm run provision -- --schema <schema del cliente> --ssh zentra-app
  ```

  `provision` aplica solo las recetas nuevas. Si `src/cliente.config.ts` da conflicto, quedate con la
  versión del cliente.
- **Las recetas que ya se aplicaron** (`db/canonical`) no se editan nunca. Un cambio de base es una
  receta nueva con el número siguiente.
- **Cada función nueva** de la base lleva `revoke execute … from public, anon`. Si no,
  `npm run db:verify-rls` falla.
- **Nunca uses `erp_demo`** para un cliente, ni lo toques desde un clon.

---

## Para quien administra el servidor

Los programadores entran con el usuario restringido `clonador`. Nunca agregues su llave a `ubuntu`:
esa da acceso a toda la máquina.

- **Instalación** (ya hecha el 3-nov-2026; repetirla no rompe nada), desde la carpeta del 2.0:

  ```bash
  ssh zentra-app "sudo bash -s" < scripts/servidor/instalar-clonador.sh
  ```

  En Windows, desde Git Bash: PowerShell le agrega caracteres que rompen el script.
- **Agregar la llave de un programador**, pegando su `.pub` completo:

  ```bash
  ssh zentra-app 'sudo erp-clonador-llave agregar "ssh-ed25519 AAAA... juan.perez"'
  ```

- **Si alguien deja el equipo:** `ssh zentra-app 'sudo erp-clonador-llave quitar juan.perez'`
  (`lista` muestra quiénes tienen llave).
- **Quién clonó qué:** `ssh zentra-app 'sudo erp-clientes lista'` muestra cada cliente habilitado, con
  fecha, quién (el nombre de su llave), schema y dominio. `erp-clientes activos` lista los schemas que
  hoy sirve la API.
- **Qué puede y qué no la llave restringida:**
  - **Puede** correr `psql` en la base, como `postgres` o como `supabase_admin` (la receta 36b lo
    necesita): todo lo de adentro de la base, de cualquier cliente.
  - **Puede** habilitar un clon con `erp-habilitar`: solo un schema `erp_*` armado con las recetas y
    con empresa, y solo con un dominio `<nombre>.neura.com.py`. Hace respaldo del `.env`, reinicia
    `rest` y `auth` y lo anota en el registro.
  - **No puede** abrir consola, leer archivos (ni el `.env` de Supabase), usar docker, reiniciar
    servicios por su cuenta, quitar clientes ni hacer túneles.
- **Un dominio propio del cliente** (ej. `sistema.ferreteria.com.py`) lo habilitás vos:
  `ssh zentra-app 'erp-habilitar erp_ferreteria sistema.ferreteria.com.py'`.
- **Borrar un clon:** `ssh zentra-app 'erp-habilitar --quitar <schema> <dominio>'` y después el
  schema ([CLONAR.md](CLONAR.md), "Borrar un clon").
- **Después de actualizar el 2.0**, volvé a correr el instalador: es lo que pone al día
  `erp-habilitar` y la puerta.
