#!/bin/bash
# =============================================================================
# instalar-clonador.sh — acceso restringido para que los programadores clonen el ERP 2.0.
#
#   sudo bash instalar-clonador.sh          (en el servidor de Supabase; se puede repetir)
#
# Crea:
#   · el usuario "clonador": entra SOLO con llave y su llave SOLO puede correr erp-psql (sin
#     consola, sin archivos, sin reenvío de puertos). No está en el grupo docker ni tiene sudo libre.
#   · /usr/local/bin/erp-psql: la única puerta. Corre psql dentro de supabase-db con el SQL que
#     llega por stdin, como postgres (o supabase_admin, que la receta 36b necesita). Rechaza
#     cualquier otro pedido.
#   · /usr/local/sbin/erp-clonador-llave: para que el administrador agregue o quite llaves.
#
# Lo que la llave restringida NO puede: leer o cambiar el .env de Supabase, reiniciar servicios,
# entrar a otros contenedores ni a la máquina. Lo que SÍ puede: todo dentro de la base (hace
# falta para crear schemas). La opción "Configurar el servidor" del formulario sigue siendo del
# administrador.
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
clonador ALL=(root) NOPASSWD: /usr/local/bin/erp-psql
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
prefijo='command="sudo -n /usr/local/bin/erp-psql \"$SSH_ORIGINAL_COMMAND\"",restrict '
case "${1:-}" in
  agregar)
    llave="${2:-}"
    [[ "$llave" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\ [A-Za-z0-9+/=]+\ [A-Za-z0-9._@-]+$ ]] || { echo "Pegá la llave .pub completa, con un nombre al final (ej. ssh-ed25519 AAAA... juan)" >&2; exit 1; }
    clave=$(cut -d' ' -f2 <<<"$llave")
    if grep -qF "$clave" "$archivo"; then echo "Esa llave ya estaba."; exit 0; fi
    printf '%s%s\n' "$prefijo" "$llave" >> "$archivo"
    echo "Agregada: $(cut -d' ' -f3 <<<"$llave")" ;;
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

echo "Listo. Llaves: sudo erp-clonador-llave agregar \"<contenido del .pub>\""
