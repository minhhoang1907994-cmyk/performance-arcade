'use strict';

const express = require('express');

const { createAuthService } = require('../auth/service');
const { createAuthRouter, createMeRouter, createAdminRouter } = require('../auth/routes');
const { createRoundService } = require('../rounds/service');
const { createRoundsRouter } = require('../rounds/routes');
const { createAuthMiddleware } = require('./middleware/auth');
const { createErrorHandler, notFoundHandler } = require('./middleware/error-handler');
const { createRateLimiter, byIp } = require('./middleware/rate-limit');
const { GAME_IDS } = require('../content/categories');

/* Metadata 4 game. Hằng số phía server chứ không phải bảng DB (spec 4.1): không có UI
 * nào sửa chúng, và chúng gắn liền với code của từng game.
 * Nguồn: js/games/*.js của bản v1. */
const GAME_CATALOG = [
  {
    id: 'bug-hunt',
    icon: '🐞',
    name: 'Bug Hunt',
    tagline: 'Đọc đoạn code, chỉ đúng dòng có bug và gọi tên loại bug. Càng nhanh càng nhiều điểm.',
    skill: 'Code review',
    duration: '~8 phút',
    items_per_round: 8
  },
  {
    id: 'spec-detective',
    icon: '🔍',
    name: 'Spec Detective',
    tagline: 'Tìm điểm mơ hồ trong đoạn spec và chọn câu hỏi làm rõ đáng gửi trước nhất.',
    skill: 'Đọc & chất vấn spec',
    duration: '~7 phút',
    items_per_round: 4
  },
  {
    id: 'prod-roulette',
    icon: '☠️',
    name: 'PROD Roulette',
    tagline: 'Kịch bản phân nhánh về thao tác trên production. Mỗi lựa chọn cộng điểm rủi ro.',
    skill: 'An toàn production',
    duration: '~4 phút',
    items_per_round: 1
  },
  {
    id: 'incident',
    icon: '🚨',
    name: 'Incident Escape Room',
    tagline: 'Tìm nguyên nhân gốc trước khi hết ngân sách phút điều tra.',
    skill: 'Xử lý sự cố',
    duration: '~6 phút',
    items_per_round: 1
  }
];

function createApp({ pool, config, logger = console }) {
  const app = express();

  /* Render đứng sau proxy — không bật thì req.ip là IP của proxy và rate limit theo IP
   * sẽ gộp tất cả người dùng vào một bucket. */
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '128kb' }));

  const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 300,
    keyFn: byIp('global')
  });
  app.use('/api/', globalLimiter);

  const authService = createAuthService({ pool, config });
  const authMiddleware = createAuthMiddleware({ config, authService });
  const roundService = createRoundService({ pool, config, logger });

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });

  app.get('/api/v1/games', authMiddleware.optionalAuth, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT game_id, count(*)::int AS pool_available
           FROM content_items
          WHERE status = 'active'
          GROUP BY game_id`
      );
      const poolByGame = Object.fromEntries(rows.map((r) => [r.game_id, r.pool_available]));
      const myBest = req.user ? await roundService.fetchMyBest(req.user.id) : {};

      res.json({
        games: GAME_CATALOG.map((game) => {
          const available = poolByGame[game.id] || 0;
          return {
            ...game,
            pool_available: available,
            playable: available >= game.items_per_round,
            /* null khi chưa đăng nhập hoặc chưa chơi game đó (spec 5.2). */
            my_best: myBest[game.id] === undefined ? null : myBest[game.id]
          };
        })
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/auth', createAuthRouter({ authService, config, authMiddleware }));
  app.use('/api/v1/me', createMeRouter({ authMiddleware, roundService }));
  app.use('/api/v1/rounds', createRoundsRouter({ roundService, authMiddleware }));
  app.use('/api/v1/admin', createAdminRouter({ authService, authMiddleware }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));

  app.locals.authService = authService;
  return app;
}

module.exports = { createApp, GAME_CATALOG, GAME_IDS };
