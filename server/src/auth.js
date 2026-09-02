'use strict';

const { randomBytes, timingSafeEqual } = require('crypto');
const cfg = require('./config');

const tokens = new Map(); // token -> expiry epoch ms

const enabled = cfg.password.length > 0;

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function login(username, password) {
  if (!enabled) return issue();
  if (!safeEqual(username || cfg.username, cfg.username)) return null;
  if (!safeEqual(password, cfg.password)) return null;
  return issue();
}

function issue() {
  const token = randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + cfg.tokenTtlMs);
  return token;
}

function verify(token) {
  if (!enabled) return true;
  if (!token) return false;
  const expiry = tokens.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

function revoke(token) {
  tokens.delete(token);
}

/** Accepts `Authorization: Bearer`, `?token=`, or the `wt_token` cookie. */
function tokenFromRequest(req, url) {
  const header = req.headers?.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  if (url?.searchParams?.get('token')) return url.searchParams.get('token');
  if (req.query?.token) return String(req.query.token);
  const cookie = req.headers?.cookie;
  if (cookie) {
    for (const part of cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === 'wt_token') return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function middleware(req, res, next) {
  if (!enabled) return next();
  if (verify(tokenFromRequest(req))) return next();
  res.status(401).json({ error: 'unauthorized' });
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of tokens) if (expiry < now) tokens.delete(token);
}, 60_000).unref?.();

module.exports = { enabled, login, verify, revoke, middleware, tokenFromRequest };
