'use strict';

/* Rate limit cửa sổ cố định, lưu trong bộ nhớ tiến trình.
 *
 * GIỚI HẠN ĐÃ BIẾT: bộ đếm không chia sẻ giữa các instance. Render free tier chạy một
 * instance nên hiện tại đúng; nếu sau này scale ngang thì phải chuyển sang store dùng
 * chung (Redis hoặc một bảng Postgres). Ghi lại đây để không ai tưởng nó phân tán.
 *
 * Ngưỡng lấy từ spec section 12.
 */

const { AppError } = require('../errors');

function createRateLimiter({ windowMs, max, keyFn, now = () => Date.now() }) {
  const buckets = new Map();

  /* Dọn định kỳ để Map không phình theo số IP đã từng gọi. unref() để timer này
   * không giữ process sống khi server đã đóng. */
  const sweeper = setInterval(() => {
    const cutoff = now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= cutoff) buckets.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  const middleware = (req, res, next) => {
    const key = keyFn(req);
    if (key === null) return next();

    const current = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));
    res.set('RateLimit-Reset', String(Math.ceil((bucket.resetAt - current) / 1000)));

    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - current) / 1000)));
      return next(new AppError('TOO_MANY_REQUESTS'));
    }
    next();
  };

  middleware.reset = () => buckets.clear();
  middleware.stop = () => clearInterval(sweeper);
  return middleware;
}

const byIp = (prefix) => (req) => `${prefix}:${req.ip}`;
const byUserOrIp = (prefix) => (req) => `${prefix}:${req.user ? `u${req.user.id}` : req.ip}`;

module.exports = { createRateLimiter, byIp, byUserOrIp };
