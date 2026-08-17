'use strict';

/* Mã lỗi theo bảng ở spec section 5.2.
 *
 * Định nghĩa tập trung để client và server không lệch nhau, và để không ai bịa
 * thêm mã mới rải rác trong code.
 */

const ERRORS = {
  VALIDATION_ERROR: { status: 400, message: 'Invalid request payload' },
  INVALID_CHOICE: { status: 400, message: 'Choice does not match the current step' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  GUEST_PLAY_DISABLED: { status: 401, message: 'Sign in to play' },
  FORBIDDEN: { status: 403, message: 'Insufficient permission' },
  ACCOUNT_DISABLED: { status: 403, message: 'Account has been disabled' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  EMAIL_TAKEN: { status: 409, message: 'Email already registered' },
  STEP_ALREADY_ANSWERED: { status: 409, message: 'This step was already answered' },
  STEP_EXPIRED: { status: 409, message: 'Time is up for this step' },
  STEP_OUT_OF_ORDER: { status: 409, message: 'Step submitted out of order' },
  ROUND_NOT_ACTIVE: { status: 409, message: 'Round is no longer active' },
  ROUND_ALREADY_ACTIVE: { status: 409, message: 'Another round is already in progress' },
  ALREADY_REPORTED: { status: 409, message: 'You already reported this item' },
  POOL_EXHAUSTED: { status: 422, message: 'Not enough questions available' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Too many requests' },
  GENERATION_UNAVAILABLE: { status: 503, message: 'Content generation temporarily unavailable' }
};

class AppError extends Error {
  constructor(code, { details, extra } = {}) {
    const spec = ERRORS[code];
    if (!spec) throw new Error(`Mã lỗi không tồn tại: ${code}`);
    super(spec.message);
    this.name = 'AppError';
    this.code = code;
    this.status = spec.status;
    this.details = details;
    /* extra: field bổ sung đưa thẳng vào body, ví dụ round_id khi ROUND_ALREADY_ACTIVE */
    this.extra = extra;
  }

  toBody() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details) body.error.details = this.details;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

module.exports = { AppError, ERRORS };
