'use strict';

/* Route auth — spec section 5.1.
 *
 * Access token đi trong body (client giữ trong bộ nhớ, KHÔNG localStorage).
 * Refresh token đi trong cookie httpOnly, client không bao giờ đọc.
 */

const express = require('express');

const { AppError } = require('../http/errors');
const { readRefreshToken, setRefreshCookie, clearRefreshCookie } = require('../http/cookies');
const { createRateLimiter, byIp } = require('../http/middleware/rate-limit');

function sessionResponse(res, session, config) {
  setRefreshCookie(res, session.refreshToken, {
    ttlSeconds: config.refreshTokenTtlSeconds,
    isProduction: config.isProduction
  });
  return {
    user: session.user,
    access_token: session.accessToken,
    expires_in: session.expiresIn
  };
}

function createAuthRouter({ authService, config, authMiddleware }) {
  const router = express.Router();

  /* Spec section 12: 10 request / 15 phút / IP cho login và register. */
  const credentialLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyFn: byIp('auth')
  });

  router.post('/register', credentialLimiter, async (req, res, next) => {
    try {
      const session = await authService.register(
        {
          email: req.body?.email,
          displayName: req.body?.display_name,
          password: req.body?.password
        },
        { userAgent: req.get('user-agent'), ip: req.ip }
      );
      res.status(201).json(sessionResponse(res, session, config));
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', credentialLimiter, async (req, res, next) => {
    try {
      const session = await authService.login(
        { email: req.body?.email, password: req.body?.password },
        { userAgent: req.get('user-agent'), ip: req.ip }
      );
      res.json(sessionResponse(res, session, config));
    } catch (err) {
      next(err);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const session = await authService.refresh(readRefreshToken(req), {
        userAgent: req.get('user-agent'),
        ip: req.ip
      });
      res.json(sessionResponse(res, session, config));
    } catch (err) {
      /* Refresh hỏng thì xoá luôn cookie chết, tránh client lặp vô hạn. */
      if (err instanceof AppError && err.status === 401) {
        clearRefreshCookie(res, { isProduction: config.isProduction });
      }
      next(err);
    }
  });

  router.post('/logout', authMiddleware.requireAuth, async (req, res, next) => {
    try {
      await authService.logout(readRefreshToken(req));
      clearRefreshCookie(res, { isProduction: config.isProduction });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function createMeRouter({ authMiddleware }) {
  const router = express.Router();

  router.get('/', authMiddleware.requireAuth, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        display_name: req.user.display_name,
        role: req.user.role
      }
      /* best score từng game sẽ bổ sung khi có leaderboard_best (slice kế tiếp). */
    });
  });

  return router;
}

function createAdminRouter({ authService, authMiddleware }) {
  const router = express.Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireAdmin);

  router.post('/users/:userId/reset-password', async (req, res, next) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isInteger(userId) || userId <= 0) throw new AppError('NOT_FOUND');

      const result = await authService.adminResetPassword(userId, req.body?.password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createAuthRouter, createMeRouter, createAdminRouter };
