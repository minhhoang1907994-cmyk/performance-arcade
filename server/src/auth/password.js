'use strict';

/* Băm mật khẩu bằng scrypt của node:crypto.
 *
 * Chọn scrypt thay vì bcrypt/argon2 vì hai lý do:
 *  - có sẵn trong Node, không thêm dependency (A2 chỉ chốt express + pg)
 *  - không phải native module, nên build trên Render không có rủi ro toolchain
 *
 * Định dạng lưu: scrypt$N$r$p$<salt base64url>$<hash base64url>
 * Tham số nằm trong chuỗi để sau này tăng cost mà vẫn verify được hash cũ.
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

/* N=16384 là mặc định của Node. maxmem phải nới vì mặc định 32MB không đủ cho N này. */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new TypeError('password phải là chuỗi không rỗng');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(plain, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url')
  ].join('$');
}

async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await scrypt(plain, salt, expected.length, { N, r, p, maxmem: PARAMS.maxmem });

  /* timingSafeEqual để không rò rỉ thông tin qua thời gian so sánh. */
  return crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword };
