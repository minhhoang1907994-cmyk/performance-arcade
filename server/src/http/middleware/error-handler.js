'use strict';

/* Xử lý lỗi tập trung.
 *
 * Quy tắc: lỗi ngoài dự kiến KHÔNG bao giờ lộ chi tiết ra client. Message thật và
 * stack chỉ vào log phía server — spec section 12 cấm rò rỉ dữ liệu nhạy cảm, và
 * message của Postgres hay lộ tên bảng, tên cột, cả giá trị.
 */

const { AppError } = require('../errors');

function notFoundHandler(_req, _res, next) {
  next(new AppError('NOT_FOUND'));
}

function createErrorHandler({ logger = console } = {}) {
  // eslint-disable-next-line no-unused-vars -- Express nhận diện error handler qua arity 4
  return function errorHandler(err, req, res, _next) {
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error(`[${err.code}] ${req.method} ${req.originalUrl}`, err);
      return res.status(err.status).json(err.toBody());
    }

    /* Body JSON hỏng do express.json() ném ra — là lỗi của client, không phải 500. */
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      const parseError = new AppError('VALIDATION_ERROR', { details: { body: 'JSON không hợp lệ' } });
      return res.status(parseError.status).json(parseError.toBody());
    }

    logger.error(`[UNHANDLED] ${req.method} ${req.originalUrl}`, err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  };
}

module.exports = { createErrorHandler, notFoundHandler };
