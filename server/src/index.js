'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const cfg = require('./config');
const auth = require('./auth');
const system = require('./system');
const { SessionManager } = require('./sessions');

const manager = new SessionManager();
const app = express();

if (cfg.trustProxy) app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

/**
 * A phone re-fetches index.html on every load but asks for js/css by the same
 * name, so a stale copy outlives a rebuild. Stamping the URLs with the newest
 * asset mtime is what actually retires it.
 */
const BUILD_ID = (() => {
  let newest = 0;
  for (const rel of ['index.html', 'js/app.js', 'js/keys.js', 'css/app.css']) {
    try { newest = Math.max(newest, fs.statSync(path.join(cfg.webRoot, rel)).mtimeMs); }
    catch { /* asset is optional */ }
  }
  return Math.round(newest || Date.now()).toString(36);
})();

let shellHtml = '';

/** The app shell, with the build stamp filled in. Read once, held in memory. */
function appShell() {
  if (!shellHtml) {
    shellHtml = fs
      .readFileSync(path.join(cfg.webRoot, 'index.html'), 'utf8')
      .replace(/__BUILD__/g, BUILD_ID);
  }
  return shellHtml;
}

function sendShell(res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(appShell());
}

const router = express.Router();

router.get('/api/config', (_req, res) => {
  res.json({
    title: cfg.title,
    authRequired: auth.enabled,
    readOnly: cfg.readOnly,
    maxSessions: cfg.maxSessions,
    basePath: cfg.basePath,
  });
});

router.post('/api/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const token = auth.login(username, password);
  if (!token) return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token, expiresIn: cfg.tokenTtlMs });
});

router.post('/api/logout', auth.middleware, (req, res) => {
  auth.revoke(auth.tokenFromRequest(req));
  res.json({ ok: true });
});

router.get('/api/sessions', auth.middleware, (_req, res) => {
  res.json({ sessions: manager.list() });
});

router.post('/api/sessions', auth.middleware, (req, res) => {
  if (!cfg.allowExec) return res.status(403).json({ error: 'session creation disabled' });
  try {
    const { name, cols, rows, cwd } = req.body ?? {};
    const session = manager.create({ name, cols, rows, cwd });
    res.status(201).json({ session: session.toJSON() });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

router.patch('/api/sessions/:id', auth.middleware, (req, res) => {
  const session = manager.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  if (!session.rename(req.body?.name)) return res.status(400).json({ error: 'name required' });
  res.json({ session: session.toJSON() });
});

router.delete('/api/sessions/:id', auth.middleware, (req, res) => {
  if (!manager.remove(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.get('/api/system', auth.middleware, async (_req, res) => {
  try {
    res.json(await system.info(manager));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/healthz', (_req, res) => res.type('text').send('ok'));

router.get('/', (_req, res) => sendShell(res));

router.use(
  express.static(cfg.webRoot, {
    index: false, // the shell is rendered, not served straight off disk
    // App code must never sit in a phone's cache after a rebuild — index.html is
    // fresh but it asks for the same js/css filenames, so an hour-long max-age
    // pins the old build. `no-cache` still revalidates against the ETag, which
    // costs a 304 for an unchanged file. Only the fonts are worth pinning.
    maxAge: 0,
    setHeaders(res, filePath) {
      if (/[\\/]fonts[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// SPA fallback: anything unmatched inside the base path renders the app shell.
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  sendShell(res);
});

app.use(cfg.basePath || '/', router);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return socket.destroy();
  }
  if (url.pathname !== `${cfg.basePath}/ws`) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }
  if (!auth.verify(auth.tokenFromRequest(req, url))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url));
});

/** Thin adapter so a Session can talk to a socket without knowing about ws. */
class Client {
  constructor(ws) {
    this.ws = ws;
    this.alive = true;
  }

  sendOutput(buffer) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(buffer, { binary: true });
  }

  sendEvent(obj) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  close(code, reason) {
    try {
      this.ws.close(code, reason);
    } catch { /* already closing */ }
  }
}

wss.on('connection', (ws, _req, url) => {
  const client = new Client(ws);
  const cols = Number(url.searchParams.get('cols')) || 80;
  const rows = Number(url.searchParams.get('rows')) || 24;
  const sid = url.searchParams.get('sid');

  let session = sid ? manager.get(sid) : null;

  if (!session) {
    if (sid) {
      client.sendEvent({ t: 'error', message: `session ${sid} is gone`, code: 'session_gone' });
    }
    if (!cfg.allowExec) {
      client.sendEvent({ t: 'error', message: 'session creation disabled', code: 'forbidden' });
      return client.close(4003, 'forbidden');
    }
    try {
      session = manager.create({ name: url.searchParams.get('name') || 'shell', cols, rows });
    } catch (err) {
      client.sendEvent({ t: 'error', message: err.message, code: 'limit' });
      return client.close(4029, 'limit');
    }
  }

  session.attach(client);
  session.resize(cols, rows);

  client.sendEvent({ t: 'ready', session: session.toJSON(), readOnly: cfg.readOnly });
  const replay = session.replay;
  if (replay) client.sendOutput(Buffer.from(replay, 'utf8'));
  if (session.exited) client.sendEvent({ t: 'exit', exitCode: session.exitCode });

  ws.on('message', (data, isBinary) => {
    client.alive = true;
    if (isBinary) {
      if (cfg.readOnly) return;
      return session.write(Buffer.from(data).toString('utf8'));
    }
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    switch (msg.t) {
      case 'in':
        if (!cfg.readOnly && typeof msg.d === 'string') session.write(msg.d);
        break;
      case 'resize':
        session.resize(msg.cols, msg.rows);
        break;
      case 'rename':
        session.rename(msg.name);
        break;
      case 'ping':
        client.sendEvent({ t: 'pong', time: Date.now() });
        break;
      default:
        break;
    }
  });

  ws.on('pong', () => { client.alive = true; });
  ws.on('close', () => session.detach(client));
  ws.on('error', () => session.detach(client));
});

// Drop half-open sockets; phones going through a tunnel leave plenty behind.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.__alive === false) {
      ws.terminate();
      continue;
    }
    ws.__alive = false;
    ws.once('pong', () => { ws.__alive = true; });
    try {
      ws.ping();
    } catch { /* socket already dead */ }
  }
}, cfg.pingIntervalMs);
heartbeat.unref?.();

server.listen(cfg.port, cfg.host, () => {
  const where = `http://${cfg.host}:${cfg.port}${cfg.basePath || ''}`;
  console.log(`[web-terminal] listening on ${where}`);
  console.log(`[web-terminal] shell=${cfg.shell} ${cfg.shellArgs.join(' ')} home=${cfg.home}`);
  if (!auth.enabled) {
    console.warn('[web-terminal] WARNING: WT_PASSWORD is not set — the terminal is open to anyone who can reach this port.');
  } else {
    console.log(`[web-terminal] auth enabled for user "${cfg.username}"`);
  }
});

function shutdown(signal) {
  console.log(`[web-terminal] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  manager.killAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
