'use strict';

/* Middleware xác thực.
 *
 * requireAuth  — bắt buộc đăng nhập
 * optionalAuth — gắn req.user nếu có token hợp lệ, không có thì đi tiếp (dùng cho
 *                các endpoint vừa phục vụ Player vừa phục vụ Guest, ví dụ /rounds)
 * requireAdmin — chạy sau requireAuth
 */

const { AppError } = require('../errors');
const jwt = require('../../auth/jwt');

function readBearer(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

function createAuthMiddleware({ config, authService }) {
  async function attachUser(req) {
    const token = readBearer(req);
    if (!token) return null;

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (err) {
      if (err instanceof jwt.JwtError) return null;
      throw err;
    }

    const user = await authService.getUserById(Number(payload.sub));
    if (!user) return null;
    /* Tài khoản bị khoá giữa vòng đời access token: chặn ngay, không đợi token hết hạn. */
    if (!user.is_active) throw new AppError('ACCOUNT_DISABLED');
    return user;
  }

  const optionalAuth = async (req, _res, next) => {
    try {
      req.user = await attachUser(req);
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireAuth = async (req, _res, next) => {
    try {
      req.user = await attachUser(req);
      if (!req.user) throw new AppError('UNAUTHORIZED');
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireAdmin = (req, _res, next) => {
    if (!req.user) return next(new AppError('UNAUTHORIZED'));
    if (req.user.role !== 'admin') return next(new AppError('FORBIDDEN'));
    next();
  };

  return { optionalAuth, requireAuth, requireAdmin };
}

module.exports = { createAuthMiddleware, readBearer };
