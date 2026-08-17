'use strict';

/* JWT HS256 tối giản, đủ cho access token 15 phút (A3).
 *
 * Tự viết thay vì thêm thư viện vì phạm vi rất hẹp: chỉ ký và xác minh token do
 * chính server này phát, một thuật toán duy nhất, không cần JWKS hay khoá bất đối xứng.
 *
 * Hai lỗ hổng kinh điển của JWT đều được chặn tường minh ở đây:
 *  - alg confusion: chỉ chấp nhận đúng "HS256", từ chối "none" và mọi alg khác
 *  - so sánh chữ ký không an toàn: dùng timingSafeEqual
 */

const crypto = require('node:crypto');

const ALG = 'HS256';

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecodeJson(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function sign(payload, secret, ttlSeconds) {
  if (!secret) throw new Error('JWT_SECRET chưa được cấu hình');

  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };

  const head = b64urlEncode(JSON.stringify({ alg: ALG, typ: 'JWT' }));
  const claims = b64urlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${head}.${claims}`)
    .digest('base64url');

  return `${head}.${claims}.${signature}`;
}

class JwtError extends Error {}

function verify(token, secret) {
  if (!secret) throw new Error('JWT_SECRET chưa được cấu hình');
  if (typeof token !== 'string') throw new JwtError('token không hợp lệ');

  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('token không hợp lệ');

  const [head, claims, signature] = parts;

  let header;
  try {
    header = b64urlDecodeJson(head);
  } catch {
    throw new JwtError('header không đọc được');
  }
  /* Chặn alg confusion: không chấp nhận "none", cũng không tin alg trong header. */
  if (header.alg !== ALG) throw new JwtError(`alg không được hỗ trợ: ${header.alg}`);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${head}.${claims}`)
    .digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    throw new JwtError('chữ ký không đọc được');
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new JwtError('chữ ký sai');
  }

  let payload;
  try {
    payload = b64urlDecodeJson(claims);
  } catch {
    throw new JwtError('payload không đọc được');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new JwtError('token hết hạn');
  }

  return payload;
}

module.exports = { sign, verify, JwtError, ALG };
