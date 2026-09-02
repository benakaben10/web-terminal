'use strict';

const os = require('os');
const { randomUUID } = require('crypto');
const pty = require('node-pty');

const cfg = require('./config');

/**
 * A session owns one pty. It outlives its websockets on purpose: mobile
 * networks drop constantly, so a reconnecting client re-attaches to the same
 * shell and gets the scrollback replayed instead of a fresh prompt.
 */
class Session {
  constructor({ name, cols, rows, cwd, shell, args, env }) {
    this.id = randomUUID().slice(0, 8);
    this.name = name || 'shell';
    // Distinguishes a name the user chose from the auto one, so clients know
    // not to let the shell's OSC title win over it.
    this.renamed = false;
    this.cols = clamp(cols, 2, 1000, 80);
    this.rows = clamp(rows, 2, 1000, 24);
    this.title = this.name;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.clients = new Set();
    this.exited = false;
    this.exitCode = null;

    // Ring buffer of recent output, replayed on (re)attach.
    this.buffer = [];
    this.bufferBytes = 0;

    this.shell = shell || cfg.shell;
    this.args = args || cfg.shellArgs;

    this.pty = pty.spawn(this.shell, this.args, {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: cwd || cfg.home,
      env: {
        ...process.env,
        ...env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL || 'C.UTF-8',
        WEB_TERMINAL: '1',
        WEB_TERMINAL_SESSION: this.id,
      },
    });

    this.pty.onData((data) => {
      this.lastActivity = Date.now();
      this.#appendToBuffer(data);
      const payload = Buffer.from(data, 'utf8');
      for (const client of this.clients) client.sendOutput(payload);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.exitCode = exitCode;
      for (const client of this.clients) client.sendEvent({ t: 'exit', exitCode, signal });
    });
  }

  #appendToBuffer(data) {
    this.buffer.push(data);
    this.bufferBytes += Buffer.byteLength(data, 'utf8');
    while (this.bufferBytes > cfg.scrollbackBytes && this.buffer.length > 1) {
      this.bufferBytes -= Buffer.byteLength(this.buffer.shift(), 'utf8');
    }
  }

  get replay() {
    return this.buffer.join('');
  }

  write(data) {
    if (this.exited) return;
    this.lastActivity = Date.now();
    this.pty.write(data);
  }

  resize(cols, rows) {
    if (this.exited) return;
    const c = clamp(cols, 2, 1000, this.cols);
    const r = clamp(rows, 2, 1000, this.rows);
    if (c === this.cols && r === this.rows) return;
    this.cols = c;
    this.rows = r;
    try {
      this.pty.resize(c, r);
    } catch {
      /* pty may have died between the check and the call */
    }
  }

  attach(client) {
    this.clients.add(client);
  }

  detach(client) {
    this.clients.delete(client);
  }

  rename(name) {
    const clean = String(name ?? '').trim().slice(0, 48);
    if (!clean) return false;
    this.name = clean;
    this.renamed = true;
    for (const client of this.clients) client.sendEvent({ t: 'renamed', name: clean });
    return true;
  }

  kill(signal = 'SIGHUP') {
    if (this.exited) return;
    try {
      this.pty.kill(signal);
    } catch {
      /* already gone */
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      renamed: this.renamed,
      title: this.title,
      cols: this.cols,
      rows: this.rows,
      pid: this.exited ? null : this.pty.pid,
      shell: this.shell,
      clients: this.clients.size,
      exited: this.exited,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
    };
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.reaper = setInterval(() => this.#reap(), 30_000);
    this.reaper.unref?.();
  }

  create(opts = {}) {
    if (this.sessions.size >= cfg.maxSessions) {
      const err = new Error(`Session limit reached (${cfg.maxSessions})`);
      err.status = 429;
      throw err;
    }
    const session = new Session(opts);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => s.toJSON());
  }

  remove(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill('SIGKILL');
    this.sessions.delete(id);
    for (const client of session.clients) client.close(4001, 'session removed');
    return true;
  }

  /** Drop exited sessions once nobody is looking at them any more. */
  #reap() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (!s.exited) continue;
      if (s.clients.size > 0) continue;
      if (now - s.lastActivity < cfg.deadSessionGraceMs) continue;
      this.sessions.delete(id);
    }
  }

  killAll() {
    for (const s of this.sessions.values()) s.kill('SIGKILL');
    this.sessions.clear();
  }
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

module.exports = { SessionManager, Session, hostname: os.hostname() };
