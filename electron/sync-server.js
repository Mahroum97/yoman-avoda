/**
 * The Mac end of local-network sync.
 *
 * The diary lives in IndexedDB, which belongs to the renderer, so this server
 * owns only the transport: it accepts a request on the LAN, hands it to the
 * window to answer, and writes the answer back. Nothing is stored here.
 *
 * Access is guarded by a six-digit code shown in the app. It is a home or site
 * network, not the open internet, but a shared Wi-Fi is still shared — without
 * the code any device on it could read the diary.
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomInt, timingSafeEqual } from 'node:crypto';

const PORT = 45231;
/** Photos travel as data URLs, so a sync body can be tens of megabytes. */
const MAX_BODY_BYTES = 200 * 1024 * 1024;
const ANSWER_TIMEOUT_MS = 60_000;

let server = null;
let pairingCode = null;
let askRenderer = null;
let lastSyncAt = null;
/**
 * Whether the socket is actually bound.
 *
 * Not the same as `server !== null`: `listen` is asynchronous, so for a moment
 * — and forever, if the bind fails — there is a server object listening to
 * nothing. Reporting that as "running" is how the Mac came to show an address
 * and a code while the port was closed and every phone got a refused
 * connection.
 */
let listening = false;
/** Why the last bind failed, so the app can say something better than "off". */
let lastError = null;
let retryTimer = null;
let retries = 0;

/**
 * Rebinding after a failure is worth doing on a timer rather than once.
 *
 * The common failure is EADDRINUSE straight after an update: `push-all.sh`
 * quits the old app and replaces the bundle, and the previous process can still
 * be holding the port for a few seconds when the new one starts. One swallowed
 * error there used to disable sync until somebody noticed and restarted the app
 * — which is exactly the silence this is meant to end.
 */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];

/** The address a phone should be pointed at. */
export function lanAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      // Skip loopback and link-local; we want the address the router handed out.
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return `${net.address}:${PORT}`;
      }
    }
  }
  return null;
}

function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Constant-time compare, so the code cannot be guessed a digit at a time. */
function codeMatches(given) {
  if (typeof given !== 'string' || !pairingCode) return false;
  const a = Buffer.from(given.padEnd(32, '\0'));
  const b = Buffer.from(pairingCode.padEnd(32, '\0'));
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // The phone app's page origin is capacitor://localhost, so this is a
    // cross-origin request even though both ends are on the same network.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Yoman-Code',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    send(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');

  // Lets a phone confirm it has the right address before asking for the code.
  if (url.pathname === '/sync/hello' && request.method === 'GET') {
    send(response, 200, { app: 'yoman-avoda', needsCode: true });
    return;
  }

  if (url.pathname !== '/sync' || request.method !== 'POST') {
    send(response, 404, { error: 'not found' });
    return;
  }

  if (!codeMatches(request.headers['x-yoman-code'])) {
    send(response, 401, { error: 'bad code' });
    return;
  }

  if (!askRenderer) {
    send(response, 503, { error: 'app not ready' });
    return;
  }

  try {
    const body = JSON.parse(await readBody(request));
    const answer = await askRenderer(body);
    lastSyncAt = Date.now();
    send(response, 200, answer);
  } catch (error) {
    send(response, 500, { error: String(error?.message ?? error) });
  }
}

/**
 * @param ask  called with the client's exchange; must resolve to the response
 *             the renderer produced.
 */
export function startSyncServer(ask) {
  if (ask) askRenderer = ask;
  if (server) return status();

  // The code survives a rebind: a phone that was already paired should not have
  // to be paired again because the port took a few seconds to come free.
  if (!pairingCode) pairingCode = newCode();

  server = createServer((req, res) => {
    handle(req, res).catch(() => {
      try {
        send(res, 500, { error: 'internal' });
      } catch {
        /* the socket is already gone */
      }
    });
  });

  server.on('listening', () => {
    listening = true;
    lastError = null;
    retries = 0;
  });

  server.on('error', (error) => {
    listening = false;
    lastError = error?.code || 'UNKNOWN';
    server = null;
    scheduleRetry();
  });

  server.listen(PORT, '0.0.0.0');
  return status();
}

function scheduleRetry() {
  if (retryTimer) return;
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // `stopSyncServer` clears the code; a retry after a deliberate stop would
    // bring the host back up behind the user's back.
    if (pairingCode) startSyncServer();
  }, wait);
  retryTimer.unref?.();
}

export function stopSyncServer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retries = 0;
  server?.close();
  server = null;
  listening = false;
  lastError = null;
  pairingCode = null;
}

export function regenerateCode() {
  pairingCode = newCode();
  return status();
}

export function status() {
  return {
    // The bound socket, not the object. See `listening`.
    running: listening,
    address: lanAddress(),
    code: pairingCode,
    lastSyncAt,
    /** Set only when the port could not be taken; `EADDRINUSE` in practice. */
    error: lastError,
    retrying: !!retryTimer,
  };
}

export { ANSWER_TIMEOUT_MS };
