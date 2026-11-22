'use strict';

/**
 * Аутентификация администратора: хэширование пароля (scrypt) и
 * подписанные HMAC-сессии (cookie), без внешних зависимостей.
 */

const crypto = require('node:crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(String(data)).digest('hex');
}

/** Создаёт подписанный токен: "role:expiry.signature". */
function createAdminToken(secret, ttlMs = 7 * 24 * 60 * 60 * 1000, role = 'admin') {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${role}:${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Проверяет токен; возвращает роль ('admin' | 'editor') или null. */
function verifyAdminToken(token, secret) {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(payload, secret) !== sig) return null;
  const m = /^(admin|editor):(\d+)$/.exec(payload);
  if (!m) return null;
  return Number(m[2]) > Date.now() ? m[1] : null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
    }
  }
  return out;
}

function getClientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    const xr = req.headers['x-real-ip'];
    if (xr) return String(xr).trim();
  }
  return (req.socket && req.socket.remoteAddress) || '';
}

module.exports = {
  hashPassword,
  verifyPassword,
  sign,
  createAdminToken,
  verifyAdminToken,
  parseCookies,
  getClientIp
};
