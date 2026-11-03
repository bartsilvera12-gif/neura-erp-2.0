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

# ── Publicar un clon: repo en GitHub, DNS en Cloudflare y app en Coolify ─────
# Los tokens viven solo acá (root, 600); el formulario nunca los ve. Ver el final del archivo.
install -d -m 700 /etc/erp-clonar
cat > /usr/local/bin/erp-publicar <<'EOF'
#!/bin/bash
# erp-publicar — publica un clon del ERP 2.0 ya habilitado (erp-habilitar). Lo llama el formulario.
#   erp-publicar repo <schema>             crea el repo privado del cliente (si no existe) y entrega
#                                          una llave de escritura temporal para subir el código
#   erp-publicar app <schema> <dominio>    stdin: el .env.local del clon. Borra la llave temporal,
#                                          crea el DNS (proxy) y la app en Coolify, carga las
#                                          variables, publica y espera a que el dominio responda
# Tokens y datos de Coolify: /etc/erp-clonar/tokens.env. Todo queda en /var/log/erp-clientes.log.
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo -n "$0" "$@"
falla() { echo "erp-publicar: $*" >&2; exit 1; }
paso() { echo "· $*"; }
[[ -r /etc/erp-clonar/tokens.env ]] || falla "faltan los tokens en /etc/erp-clonar/tokens.env (los carga el administrador)"
# shellcheck disable=SC1091
source /etc/erp-clonar/tokens.env
quien="${ERP_QUIEN:-administrador (${SUDO_USER:-root})}"
registro=/var/log/erp-clientes.log
anotar() { printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$quien" "$schema" "${dominio:--}" "$1" >> "$registro"; }

accion="${1:-}"; schema="${2:-}"; dominio="${3:-}"
[[ "$schema" =~ ^erp_[a-z0-9_]{1,58}$ && "$schema" != "erp_demo" ]] || falla "schema inválido: $schema"
repo="neura-erp-$(tr '_' '-' <<<"${schema#erp_}")"

gh() { curl -sS -m 60 -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "User-Agent: erp-publicar" "$@"; }
cf() { curl -sS -m 60 -H "Authorization: Bearer $CLOUDFLARE_TOKEN" -H "Content-Type: application/json" "$@"; }
co() { curl -sS -m 120 -H "Authorization: Bearer $COOLIFY_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json" "$@"; }
llaves_temporales() { gh "https://api.github.com/repos/$GITHUB_DUENO/$repo/keys" | jq -r '.[]? | select(.title == "clonar (temporal)") | .id'; }

# Solo clones habilitados en Supabase (erp-habilitar ya revisó recetas, empresa y pruebas).
grep -m1 '^PGRST_DB_SCHEMAS=' /home/ubuntu/supabase/docker/.env | cut -d= -f2- | tr ',' '\n' | grep -qx "$schema" \
  || falla "$schema todavía no está habilitado en Supabase (erp-habilitar)"

case "$accion" in
repo)
  estado=$(gh -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$GITHUB_DUENO/$repo")
  if [[ "$estado" == "404" ]]; then
    gh -X POST https://api.github.com/user/repos -d "$(jq -n --arg n "$repo" --arg d "ERP 2.0 · $schema" '{name: $n, description: $d, private: true}')" | jq -e '.id' >/dev/null \
      || falla "GitHub no dejó crear el repo $repo"
    anotar "repo creado $GITHUB_DUENO/$repo"
  elif [[ "$estado" != "200" ]]; then
    falla "GitHub respondió $estado al buscar $repo"
  fi
  for id in $(llaves_temporales); do gh -X DELETE "https://api.github.com/repos/$GITHUB_DUENO/$repo/keys/$id" >/dev/null; done
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  ssh-keygen -q -t ed25519 -N "" -C "clonar $repo" -f "$tmp/k"
  gh -X POST "https://api.github.com/repos/$GITHUB_DUENO/$repo/keys" -d "$(jq -n --arg k "$(cat "$tmp/k.pub")" '{title: "clonar (temporal)", key: $k, read_only: false}')" | jq -e '.id' >/dev/null \
    || falla "GitHub no aceptó la llave temporal"
  echo "REPO=git@github.com:$GITHUB_DUENO/$repo.git"
  echo "WEB=https://github.com/$GITHUB_DUENO/$repo"
  cat "$tmp/k"
  ;;

app)
  [[ "$dominio" =~ ^[a-z0-9-]+\.${CLOUDFLARE_ZONA//./\\.}$ ]] || falla "solo se publican dominios <nombre>.$CLOUDFLARE_ZONA (un dominio propio lo publica el administrador)"
  variables=$(cat)
  grep -qx "APP_DB_SCHEMA=$schema" <<<"$variables" || falla "las variables no son de $schema (APP_DB_SCHEMA)"
  datos=$(grep -E '^[A-Z][A-Z0-9_]*=' <<<"$variables" | jq -Rn '[inputs | capture("^(?<key>[^=]+)=(?<value>.*)$") | . + {is_literal: true, is_preview: false}]')

  gh -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$GITHUB_DUENO/$repo/branches/main" | grep -qx 200 || falla "el repo $repo no tiene la rama main: subí el código primero"
  for id in $(llaves_temporales); do gh -X DELETE "https://api.github.com/repos/$GITHUB_DUENO/$repo/keys/$id" >/dev/null; done
  paso "Código en github.com/$GITHUB_DUENO/$repo (llave temporal borrada)"

  zona=$(cf "https://api.cloudflare.com/client/v4/zones?name=$CLOUDFLARE_ZONA" | jq -r '.result[0].id // empty')
  [[ -n "$zona" ]] || falla "Cloudflare no encontró la zona $CLOUDFLARE_ZONA"
  actual=$(cf "https://api.cloudflare.com/client/v4/zones/$zona/dns_records?name=$dominio" | jq -r '.result[0] | select(.) | "\(.type) \(.content)"')
  if [[ -z "$actual" ]]; then
    cf -X POST "https://api.cloudflare.com/client/v4/zones/$zona/dns_records" -d "$(jq -n --arg n "$dominio" --arg ip "$COOLIFY_IP" '{type: "A", name: $n, content: $ip, proxied: true, ttl: 1, comment: "ERP 2.0 (erp-publicar)"}')" | jq -e '.success' >/dev/null \
      || falla "Cloudflare no dejó crear $dominio"
    paso "DNS $dominio → Coolify (con proxy)"
  elif [[ "$actual" == "A $COOLIFY_IP" ]]; then
    paso "DNS $dominio ya apuntaba a Coolify"
  else
    falla "$dominio ya existe en Cloudflare y apunta a otro lado ($actual): no lo toco"
  fi

  app=$(co "$COOLIFY_URL/api/v1/applications" | jq -r --arg f "http://$dominio" '.[] | select((.fqdn // "") | split(",") | index($f)) | .uuid' | head -1)
  if [[ -z "$app" ]]; then
    cuerpo=$(jq -n --arg p "$COOLIFY_PROYECTO" --arg s "$COOLIFY_SERVIDOR" --arg e "$COOLIFY_ENTORNO" --arg eu "$COOLIFY_ENTORNO_UUID" \
      --arg d "$COOLIFY_DESTINO" --arg g "$COOLIFY_GITHUB_APP" --arg r "$GITHUB_DUENO/$repo" --arg n "$repo" --arg f "http://$dominio" \
      --arg img "$COOLIFY_REGISTRO/$repo" --arg desc "ERP 2.0 · $schema" \
      '{project_uuid: $p, server_uuid: $s, environment_name: $e, environment_uuid: $eu, destination_uuid: $d, github_app_uuid: $g,
        git_repository: $r, git_branch: "main", build_pack: "dockerfile", dockerfile_location: "/Dockerfile", base_directory: "/",
        ports_exposes: "3000", name: $n, description: $desc, domains: $f, docker_registry_image_name: $img, use_build_server: true,
        health_check_enabled: true, health_check_path: "/", is_auto_deploy_enabled: true, instant_deploy: false}')
    respuesta=$(co -X POST "$COOLIFY_URL/api/v1/applications/private-github-app" -d "$cuerpo")
    app=$(jq -r '.uuid // empty' <<<"$respuesta")
    [[ -n "$app" ]] || falla "Coolify no creó la app: $(jq -c '.message // .errors // .' <<<"$respuesta" | head -c 400)"
    anotar "app coolify $app"
    paso "App $repo creada en Coolify"
  else
    paso "La app de $dominio ya existía en Coolify"
  fi
  co -X PATCH "$COOLIFY_URL/api/v1/applications/$app/envs/bulk" -d "$(jq -n --argjson d "$datos" '{data: $d}')" | jq -e 'type == "array" or (.message | not)' >/dev/null \
    || falla "Coolify no aceptó las variables"
  paso "Variables cargadas ($(jq length <<<"$datos"))"

  despliegue=$(co -X POST "$COOLIFY_URL/api/v1/deploy?uuid=$app&force=false" | jq -r '.deployments[0].deployment_uuid // empty')
  [[ -n "$despliegue" ]] || falla "Coolify no arrancó el despliegue"
  paso "Compilando en Coolify (unos minutos)…"
  for i in $(seq 1 120); do
    estado=$(co "$COOLIFY_URL/api/v1/deployments/$despliegue" | jq -r '.status // "?"')
    case "$estado" in
      finished) break ;;
      failed|cancelled*) falla "el despliegue terminó en $estado: mirá los logs de $repo en Coolify" ;;
    esac
    (( i % 4 == 0 )) && paso "Coolify: $estado ($((i / 2)) min)"
    sleep 30
  done
  [[ "$estado" == "finished" ]] || falla "el despliegue tardó más de una hora"
  paso "Despliegue terminado; esperando el dominio…"
  for i in $(seq 1 36); do
    codigo=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$dominio/login" || true)
    [[ "$codigo" == "200" ]] && break
    sleep 5
  done
  [[ "$codigo" == "200" ]] || falla "la app se publicó pero https://$dominio/login responde $codigo"
  anotar "publicado"
  echo "publicado: https://$dominio"
  ;;
*) falla "uso: erp-publicar repo <schema> | app <schema> <dominio>" ;;
esac
EOF
chown root:root /usr/local/bin/erp-publicar
chmod 755 /usr/local/bin/erp-publicar

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
if [[ "$pedido" =~ ^(/usr/local/bin/)?erp-publicar\ repo\ ([a-z0-9_]+)$ ]]; then
  exec env ERP_QUIEN="$quien" /usr/local/bin/erp-publicar repo "${BASH_REMATCH[2]}"
fi
if [[ "$pedido" =~ ^(/usr/local/bin/)?erp-publicar\ app\ ([a-z0-9_]+)\ ([a-z0-9.-]+)$ ]]; then
  exec env ERP_QUIEN="$quien" /usr/local/bin/erp-publicar app "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
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

[[ -s /etc/erp-clonar/tokens.env ]] || echo "Ojo: falta /etc/erp-clonar/tokens.env (GitHub, Cloudflare y Coolify) para erp-publicar; ver docs/PROGRAMADORES.md."
echo "Listo. Llaves: sudo erp-clonador-llave agregar \"<contenido del .pub>\" · Clientes: sudo erp-clientes lista"
