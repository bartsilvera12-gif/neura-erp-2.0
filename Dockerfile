# syntax=docker/dockerfile:1.7
# Imagen del ERP 2.0 para Coolify (build pack "dockerfile", compila en el build server).
# Misma receta probada que sistemas-propio: Debian slim (glibc), output standalone, fuentes
# locales, usuario no-root y apagado ordenado (graceful-server.js). Las variables las inyecta
# Coolify: las NEXT_PUBLIC_* también en el build (van dentro del JS del navegador).
ARG NODE_IMAGE=node:22-slim

# ── deps: node_modules (solo se rehace si cambia el lockfile) ────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ── builder: next build (con caché incremental entre deploys) ───────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP
ARG NEXT_PUBLIC_SOPORTE_NEURA_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP=$NEXT_PUBLIC_SOPORTE_NEURA_WHATSAPP
ENV NEXT_PUBLIC_SOPORTE_NEURA_URL=$NEXT_PUBLIC_SOPORTE_NEURA_URL
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ── runner: imagen final mínima ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# standalone escucha en HOSTNAME:PORT; sin 0.0.0.0 Coolify/Traefik no llega al contenedor.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl: lo usa el healthcheck de Coolify DENTRO del contenedor. ca-certificates: sin eso
# `curl https://` falla (error 77) en las tareas programadas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/: el logo de los PDF (public/brand/logo-doc.png) se lee en runtime; standalone no lo copia.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs docker/graceful-server.js ./graceful-server.js
ENV NEXT_MANUAL_SIG_HANDLE=true

USER nextjs
EXPOSE 3000
CMD ["node", "graceful-server.js"]
