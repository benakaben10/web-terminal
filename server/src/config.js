'use strict';

const path = require('path');

function envInt(name, fallback) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const home = process.env.WT_HOME || process.env.HOME || '/root';
const shell = process.env.WT_SHELL || '/bin/zsh';

module.exports = {
  host: process.env.WT_HOST || '0.0.0.0',
  port: envInt('WT_PORT', 7681),
  basePath: (process.env.WT_BASE_PATH || '').replace(/\/+$/, ''),

  home,
  shell,
  // Login shell so /etc/zsh/zshrc + ~/.zshrc (oh-my-zsh) are sourced.
  shellArgs: process.env.WT_SHELL_ARGS ? process.env.WT_SHELL_ARGS.split(' ').filter(Boolean) : ['-l'],

  password: process.env.WT_PASSWORD || '',
  username: process.env.WT_USERNAME || 'admin',
  readOnly: envBool('WT_READONLY', false),
  allowExec: envBool('WT_ALLOW_EXEC', true),

  maxSessions: envInt('WT_MAX_SESSIONS', 12),
  scrollbackBytes: envInt('WT_SCROLLBACK_BYTES', 256 * 1024),
  deadSessionGraceMs: envInt('WT_DEAD_SESSION_GRACE_MS', 5 * 60 * 1000),
  tokenTtlMs: envInt('WT_TOKEN_TTL_MS', 7 * 24 * 60 * 60 * 1000),
  pingIntervalMs: envInt('WT_PING_INTERVAL_MS', 25_000),

  webRoot: path.resolve(__dirname, '..', '..', 'web'),
  trustProxy: envBool('WT_TRUST_PROXY', true),
  title: process.env.WT_TITLE || 'Web Terminal',
};
