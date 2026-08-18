'use strict';

/* Route lượt chơi — spec section 5.1.
 *
 * Toàn bộ dùng optionalAuth: có Bearer thì là round của người chơi đã đăng nhập,
 * không có thì là round khách (BR-16). Việc quyết định có cho chơi khách hay không
 * nằm ở service, vì nó phụ thuộc config chứ không phụ thuộc route.
 */

const express = require('express');

const { AppError } = require('../http/errors');
const { createRateLimiter, byIp, byUserOrIp } = require('../http/middleware/rate-limit');

const HOUR_MS = 60 * 60 * 1000;

function parseStepSeq(raw) {
  const stepSeq = Number(raw);
  if (!Number.isInteger(stepSeq) || stepSeq < 1) {
    throw new AppError('VALIDATION_ERROR', { details: 'stepSeq: phải là số nguyên >= 1' });
  }
  return stepSeq;
}

function createRoundsRouter({ roundService, authMiddleware }) {
  const router = express.Router();
  router.use(authMiddleware.optionalAuth);

  /* Ngưỡng lấy từ spec section 12. Khách chặt hơn người đã đăng nhập vì khách chỉ
   * định danh bằng IP — đó cũng là kênh dễ dùng để quét sạch pool câu hỏi nhất. */
  const userRoundLimiter = createRateLimiter({
    windowMs: HOUR_MS,
    max: 20,
    keyFn: (req) => `rounds:u${req.user.id}`
  });
  const guestRoundLimiter = createRateLimiter({
    windowMs: HOUR_MS,
    max: 10,
    keyFn: byIp('rounds-guest')
  });
  const stepLimiter = createRateLimiter({
    windowMs: HOUR_MS,
    max: 300,
    keyFn: byUserOrIp('steps')
  });

  const roundLimiter = (req, res, next) =>
    (req.user ? userRoundLimiter : guestRoundLimiter)(req, res, next);

  router.post('/', roundLimiter, async (req, res, next) => {
    try {
      const result = await roundService.startRound({
        user: req.user,
        ip: req.ip,
        gameId: req.body?.game_id
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:roundId', async (req, res, next) => {
    try {
      res.json(await roundService.getRound({ user: req.user, roundId: req.params.roundId }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:roundId/steps/:stepSeq', stepLimiter, async (req, res, next) => {
    try {
      const { expired, result } = await roundService.submitStep({
        user: req.user,
        roundId: req.params.roundId,
        stepSeq: parseStepSeq(req.params.stepSeq),
        choice: req.body?.choice
      });

      /* Step quá hạn: 409 nhưng body vẫn mang reveal + next_step (spec 8.2 điều kiện B).
       * Việc chốt 0 điểm đã COMMIT trước khi tới đây. */
      if (expired) {
        const err = new AppError('STEP_EXPIRED', { extra: result });
        return res.status(err.status).json(err.toBody());
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:roundId/abandon', async (req, res, next) => {
    try {
      res.json(await roundService.abandonRound({ user: req.user, roundId: req.params.roundId }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createRoundsRouter };
