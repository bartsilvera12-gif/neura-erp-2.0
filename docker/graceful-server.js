// Arranque del servidor standalone con apagado ordenado (reemplaza a `node server.js`).
//
// En un deploy, Coolify arranca el contenedor nuevo, espera a que esté sano y enseguida apaga
// el viejo (docker stop, 30 s de gracia). Traefik tarda un par de segundos en enterarse del
// cambio: si el viejo se cierra al instante, los pedidos que le siguen llegando dan 502 o quedan
// colgados (El Papu y Tecnolabo, 30-sep-2026). Acá, al recibir SIGTERM el proceso sigue
// atendiendo GRACEFUL_DRAIN_MS (Traefik ya ruteó al nuevo), después deja de aceptar conexiones,
// termina los pedidos en curso y sale. Probado con Traefik: 0 errores en 3200 pedidos por deploy.
"use strict";

const http = require("node:http");
const path = require("node:path");

const DRAIN_MS = Number(process.env.GRACEFUL_DRAIN_MS || 8000);
// Tope total: siempre por debajo de los 30 s que Coolify espera antes de matar el contenedor.
const MAX_MS = Number(process.env.GRACEFUL_MAX_MS || 20000);

// Next registra su propio SIGTERM (sale al instante) salvo que esté esta variable.
process.env.NEXT_MANUAL_SIG_HANDLE = "true";

// Guardamos los servidores HTTP que abre Next para poder cerrarlos al final.
const servers = [];
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  servers.push(this);
  return originalListen.apply(this, args);
};

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[graceful] ${signal}: sigo atendiendo ${DRAIN_MS} ms y después cierro`);
  setTimeout(() => process.exit(0), MAX_MS).unref();
  setTimeout(() => {
    let pending = servers.length;
    if (pending === 0) process.exit(0);
    for (const server of servers) {
      server.close(() => {
        pending -= 1;
        if (pending === 0) process.exit(0);
      });
      server.closeIdleConnections?.();
    }
  }, DRAIN_MS);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

require(path.join(__dirname, "server.js"));
