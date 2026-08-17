'use strict';

/* Cấu hình đọc từ biến môi trường.
 *
 * Kiểm tra ngay lúc khởi động chứ không lười: thiếu JWT_SECRET mà chỉ phát hiện ở
 * request đăng nhập đầu tiên thì service đã lên PROD rồi mới vỡ.
 */

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || env[key].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);
  }

  if (env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET quá ngắn, cần tối thiểu 32 ký tự');
  }

  return {
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT) || 3000,
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,

    /* A3: access token 15 phút, refresh token 14 ngày, xoay vòng mỗi lần refresh. */
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 14 * 24 * 60 * 60,

    /* BR-16 */
    allowAnonymousPlay: env.ALLOW_ANONYMOUS_PLAY !== 'false',

    isProduction: (env.NODE_ENV || 'development') === 'production'
  };
}

module.exports = { loadConfig, REQUIRED };
