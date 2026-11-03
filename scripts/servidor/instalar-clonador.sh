#!/bin/bash
# =============================================================================
# instalar-clonador.sh — acceso restringido para que los programadores clonen el ERP 2.0.
#
#   sudo bash instalar-clonador.sh          (en el servidor de Supabase; se puede repetir)
#
# Crea:
#   · el usuario "clonador": entra SOLO con llave y su llave SOLO puede correr erp-puerta (sin
#     consola, sin archivos, sin reenvío de puertos). No está en el grupo docker ni tiene sudo libre.
#   · /usr/local/bin/erp-puerta: lo único que corre la llave restringida. Deja pasar dos pedidos:
#       erp-psql      psql dentro de supabase-db con el SQL por stdin, como postgres (o
#                     supabase_admin, que la receta 36b necesita)
#       erp-habilitar suma un clon terminado a Supabase (schema y dominio) y lo anota
#     Rechaza cualquier otro. Cada llave lleva su nombre, así el registro dice quién clonó.
#   · /usr/local/sbin/erp-clonador-llave: para que el administrador agregue o quite llaves.
#   · /usr/local/sbin/erp-clientes: la lista de clientes habilitados, con quién y cuándo.
#
# Lo que la llave restringida NO puede: leer o cambiar el .env de Supabase a mano, reiniciar
# servicios, entrar a otros contenedores ni a la máquina. Lo que SÍ puede: todo dentro de la base
# (hace falta para crear schemas) y habilitar un schema erp_* ya armado con un dominio
# <nombre>.neura.com.py. Un dominio propio del cliente lo habilita el administrador.
# =============================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Correlo con sudo" >&2; exit 1; }

# ── La puerta ────────────────────────────────────────────────────────────────
cat > /usr/local/bin/erp-psql <<'EOF'
#!/bin/bash
# erp-psql — única puerta a la base para clonar el ERP 2.0 (scripts/remoto.mjs del repo).
#   erp-psql <postgres|supabase_admin> <q|At|qAt> [sincuerpos]     el SQL entra por stdin
set -euo pipefail
pedido="$*"
pedido="${pedido#*erp-psql }"
if [[ ! "$pedido" =~ ^(postgres|supabase_admin)\ (q|At|qAt)(\ sincuerpos)?$ ]]; then
  echo "erp-psql: pedido no permitido" >&2
  exit 64
fi
usuario="${BASH_REMATCH[1]}"
modo="${BASH_REMATCH[2]}"
cuerpos="${BASH_REMATCH[3]}"
flags=()
[[ "$modo" == *q* ]] && flags+=(-q)
[[ "$modo" == *At* ]] && flags+=(-At)
entorno=(-e PGCLIENTENCODING=UTF8)
[[ -n "$cuerpos" ]] && entorno+=(-e PGOPTIONS=-ccheck_function_bodies=off)
exec /usr/bin/docker exec -i "${entorno[@]}" supabase-db psql -U "$usuario" -d postgres -v ON_ERROR_STOP=1 "${flags[@]}" -f -
EOF
chown root:root /usr/local/bin/erp-psql
chmod 755 /usr/local/bin/erp-psql

# ── Habilitar un clon en Supabase ────────────────────────────────────────────
cat > /usr/local/bin/erp-habilitar <<'EOF'
#!/bin/bash
# erp-habilitar — suma un clon del ERP 2.0 a Supabase: el schema a PGRST_DB_SCHEMAS y el dominio a
# ADDITIONAL_REDIRECT_URLS (con respaldo del .env), reinicia rest y auth y lo anota en el registro.
#   erp-habilitar <schema> <dominio>             (el formulario de clonar, al final)
#   sudo erp-habilitar --quitar <schema> <dominio>   (solo el administrador: borrar un clon)
# La llave restringida llega por erp-puerta (ERP_QUIEN = nombre de la llave) y solo puede
# habilitar dominios <nombre>.neura.com.py.
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo -n "$0" "$@"
falla() { echo "erp-habilitar: $*" >&2; exit 1; }
quitar=""
[[ "${1:-}" == "--quitar" ]] && { quitar=1; shift; }
schema="${1:-}"; dominio="${2:-}"
restringida="${ERP_QUIEN:-}"
quien="${ERP_QUIEN:-administrador (${SUDO_USER:-root})}"
dir=/home/ubuntu/supabase/docker
env="$dir/.env"
registro=/var/log/erp-clientes.log

[[ "$schema" =~ ^erp_[a-z0-9_]{1,58}$ ]] || falla "el schema tiene que empezar con erp_ (minúsculas, números y _)"
[[ "$schema" != "erp_demo" ]] || falla "erp_demo no se toca"
[[ "$dominio" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || falla "dominio inválido: $dominio"
if [[ -n "$restringida" ]]; then
  [[ -z "$quitar" ]] || falla "quitar un cliente lo hace el administrador"
  [[ "$dominio" =~ ^[a-z0-9-]+\.neura\.com\.py$ ]] || falla "con la llave restringida solo se habilitan dominios <nombre>.neura.com.py; un dominio propio del cliente lo habilita el administrador"
fi

if [[ -z "$quitar" ]]; then
  # Solo un clon terminado: armado con las recetas (tabla _recetas) y con empresa cargada.
  estado=$(docker exec -i supabase-db psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -v s="$schema" <<'SQL'
select case
  when to_regnamespace(:'s') is null then 'el schema no existe'
  when to_regclass(format('%I._recetas', :'s')) is null or to_regclass(format('%I.empresas', :'s')) is null
    then 'el schema no lo armó el clonador (faltan _recetas o empresas)'
  when (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I._recetas', :'s'), false, true, '')))[1]::text::int = 0
    then 'la base está vacía: no corrió ninguna receta'
  when (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.empresas', :'s'), false, true, '')))[1]::text::int = 0
    then 'todavía no tiene empresa (falta el paso del administrador)'
  else 'ok' end;
SQL
)
  [[ "$estado" == "ok" ]] || falla "$schema: $estado"
fi

exec 9>/var/lock/erp-habilitar
flock -w 120 9 || falla "hay otro clon habilitándose; probá en un minuto"

nuevo=$(mktemp)
trap 'rm -f "$nuevo" "$nuevo.2"' EXIT
cp "$env" "$nuevo"
cambios=0
cambiar() {   # cambiar <sumar|sacar> <clave> <valor>
  local accion="$1" clave="$2" valor="$3" actual final
  actual=$(grep -m1 "^${clave}=" "$nuevo" | cut -d= -f2-) || falla "el .env no tiene $clave"
  if [[ ",${actual// /}," == *",${valor},"* ]]; then
    [[ "$accion" == "sumar" ]] && return 0
    final=$(tr ',' '\n' <<<"$actual" | sed 's/^ *//; s/ *$//' | { grep -vxF -- "$valor" || true; } | paste -sd, -)
  else
    [[ "$accion" == "sacar" ]] && return 0
    final="${actual:+$actual,}$valor"
  fi
  K="$clave" L="$clave=$final" awk 'index($0, ENVIRON["K"] "=") == 1 && !hecho { print ENVIRON["L"]; hecho = 1; next } { print }' "$nuevo" > "$nuevo.2"
  cat "$nuevo.2" > "$nuevo"
  cambios=$((cambios + 1))
}
accion=$([[ -n "$quitar" ]] && echo sacar || echo sumar)
cambiar "$accion" PGRST_DB_SCHEMAS "$schema"
cambiar "$accion" ADDITIONAL_REDIRECT_URLS "https://$dominio/**"

if (( cambios )); then
  cp -p "$env" "$env.bak-$(date +%Y%m%d-%H%M%S)"
  cat "$nuevo" > "$env"   # así conserva dueño y permisos
  (cd "$dir" && docker compose up -d --no-deps rest auth) >&2 || falla "el .env quedó cambiado pero no pude reiniciar rest y auth: avisale al administrador"
  resultado=$([[ -n "$quitar" ]] && echo quitado || echo habilitado)
else
  resultado=$([[ -n "$quitar" ]] && echo "no estaba" || echo "ya estaba")
fi
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$quien" "$schema" "$dominio" "$resultado" >> "$registro"
echo "$resultado: $schema (https://$dominio)"
EOF
chown root:root /usr/local/bin/erp-habilitar
chmod 755 /usr/local/bin/erp-habilitar
touch /var/log/erp-clientes.log
chmod 640 /var/log/erp-clientes.log

# ── Lo único que corre la llave restringida ──────────────────────────────────
cat > /usr/local/bin/erp-puerta <<'EOF'
#!/bin/bash
# erp-puerta — lo único que corre la llave restringida (usuario clonador). La llama authorized_keys:
#   sudo -n /usr/local/bin/erp-puerta <nombre de la llave> "$SSH_ORIGINAL_COMMAND"
set -euo pipefail
quien="${1:-}"; pedido="${2:-}"
[[ "$quien" =~ ^[A-Za-z0-9._@-]+$ ]] || { echo "erp-puerta: llave sin nombre" >&2; exit 64; }
if [[ "$pedido" =~ ^(/usr/local/bin/)?erp-psql\ (.*)$ ]]; then
  exec /usr/local/bin/erp-psql "${BASH_REMATCH[2]}"
fi
if [[ "$pedido" =~ ^(/usr/local/bin/)?erp-habilitar\ ([a-z0-9_]+)\ ([a-z0-9.-]+)$ ]]; then
  exec env ERP_QUIEN="$quien" /usr/local/bin/erp-habilitar "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
fi
echo "erp-psql: pedido no permitido" >&2
exit 64
EOF
chown root:root /usr/local/bin/erp-puerta
chmod 755 /usr/local/bin/erp-puerta

# ── Registro de clientes ─────────────────────────────────────────────────────
cat > /usr/local/sbin/erp-clientes <<'EOF'
#!/bin/bash
# erp-clientes — clientes del ERP 2.0 habilitados en Supabase, con quién y cuándo.
#   sudo erp-clientes lista        todo el registro
#   sudo erp-clientes activos      los schemas que hoy están en PGRST_DB_SCHEMAS
set -euo pipefail
registro=/var/log/erp-clientes.log
case "${1:-lista}" in
  lista)
    { printf 'Fecha\tQuién\tSchema\tDominio\tResultado\n'; cat "$registro"; } | column -t -s $'\t' ;;
  activos)
    grep -m1 '^PGRST_DB_SCHEMAS=' /home/ubuntu/supabase/docker/.env | cut -d= -f2- | tr ',' '\n' | grep '^erp_' ;;
  *) echo "Uso: erp-clientes lista | activos" >&2; exit 1 ;;
esac
EOF
chown root:root /usr/local/sbin/erp-clientes
chmod 750 /usr/local/sbin/erp-clientes

# ── El usuario ───────────────────────────────────────────────────────────────
if ! id clonador >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --comment "Clonado del ERP 2.0 (solo erp-psql)" clonador
fi
passwd -l clonador >/dev/null
install -d -m 700 -o clonador -g clonador /home/clonador/.ssh
touch /home/clonador/.ssh/authorized_keys
chown clonador:clonador /home/clonador/.ssh/authorized_keys
chmod 600 /home/clonador/.ssh/authorized_keys

# Solo puede correr la puerta como root (la puerta decide qué se permite).
cat > /etc/sudoers.d/erp-clonador <<'EOF'
clonador ALL=(root) NOPASSWD: /usr/local/bin/erp-puerta
EOF
chmod 440 /etc/sudoers.d/erp-clonador
visudo -cf /etc/sudoers.d/erp-clonador >/dev/null

# ── Llaves ───────────────────────────────────────────────────────────────────
cat > /usr/local/sbin/erp-clonador-llave <<'EOF'
#!/bin/bash
# erp-clonador-llave — llaves de los programadores que clonan el ERP 2.0.
#   sudo erp-clonador-llave agregar "ssh-ed25519 AAAA... nombre"
#   sudo erp-clonador-llave quitar nombre
#   sudo erp-clonador-llave lista
set -euo pipefail
archivo=/home/clonador/.ssh/authorized_keys
# El nombre de la llave va en el comando: así el registro de clientes dice quién clonó.
linea() { printf 'command="sudo -n /usr/local/bin/erp-puerta %s \\"$SSH_ORIGINAL_COMMAND\\"",restrict %s\n' "$(cut -d' ' -f3 <<<"$1")" "$1"; }
case "${1:-}" in
  agregar)
    llave="${2:-}"
    [[ "$llave" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\ [A-Za-z0-9+/=]+\ [A-Za-z0-9._@-]+$ ]] || { echo "Pegá la llave .pub completa, con un nombre al final (ej. ssh-ed25519 AAAA... juan)" >&2; exit 1; }
    clave=$(cut -d' ' -f2 <<<"$llave")
    if grep -qF "$clave" "$archivo"; then echo "Esa llave ya estaba."; exit 0; fi
    linea "$llave" >> "$archivo"
    echo "Agregada: $(cut -d' ' -f3 <<<"$llave")" ;;
  rehacer)
    # Reescribe todas las líneas con el comando actual (lo corre el instalador).
    awk '{print $(NF-2), $(NF-1), $NF}' "$archivo" | while read -r l; do [[ -n "$l" ]] && linea "$l"; done > "$archivo.tmp"
    cat "$archivo.tmp" > "$archivo"; rm -f "$archivo.tmp" ;;
  quitar)
    nombre="${2:-}"
    [[ -n "$nombre" ]] || { echo "Decí el nombre de la llave" >&2; exit 1; }
    antes=$(wc -l < "$archivo")
    grep -vE " ${nombre}\$" "$archivo" > "$archivo.tmp" || true
    cat "$archivo.tmp" > "$archivo"; rm -f "$archivo.tmp"
    echo "Quitadas: $((antes - $(wc -l < "$archivo")))" ;;
  lista)
    awk '{print $NF}' "$archivo" ;;
  *) echo "Uso: erp-clonador-llave agregar \"<llave .pub>\" | quitar <nombre> | lista" >&2; exit 1 ;;
esac
EOF
chown root:root /usr/local/sbin/erp-clonador-llave
chmod 750 /usr/local/sbin/erp-clonador-llave
/usr/local/sbin/erp-clonador-llave rehacer   # las llaves de antes pasan a la puerta nueva

echo "Listo. Llaves: sudo erp-clonador-llave agregar \"<contenido del .pub>\" · Clientes: sudo erp-clientes lista"
