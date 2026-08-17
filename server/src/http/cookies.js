'use strict';

/* Refresh token cookie.
 *
 * httpOnly để JavaScript phía client không đọc được — spec section 13 quy định
 * front-end không bao giờ chạm vào refresh token.
 * Secure + SameSite=Lax: Lax đủ vì mọi request refresh đều xuất phát từ chính trang
 * này; Strict sẽ chặn cả trường hợp người dùng bấm link quay lại app từ nơi khác.
 *
 * Tự parse thay vì dùng cookie-parser: chỉ cần đọc đúng một cookie.
 */

const REFRESH_COOKIE = 'devlab_refresh';

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header.length === 0) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function readRefreshToken(req) {
  return parseCookies(req.get('cookie'))[REFRESH_COOKIE] || null;
}

function setRefreshCookie(res, token, { ttlSeconds, isProduction }) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: ttlSeconds * 1000
  });
}

function clearRefreshCookie(res, { isProduction }) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth'
  });
}

module.exports = {
  REFRESH_COOKIE,
  parseCookies,
  readRefreshToken,
  setRefreshCookie,
  clearRefreshCookie
};
