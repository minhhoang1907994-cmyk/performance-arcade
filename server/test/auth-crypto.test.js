'use strict';

/* Test phần crypto tự viết: băm mật khẩu (scrypt) và JWT HS256.
 *
 * Đây là hai chỗ tự viết thay vì dùng thư viện, nên phải test kỹ hơn bình thường —
 * đặc biệt các lỗ hổng kinh điển của JWT.
 */

const test = require('node:test');
const assert = require('node:assert');

const { hashPassword, verifyPassword } = require('../src/auth/password');
const jwt = require('../src/auth/jwt');
const { normalizeEmail } = require('../src/auth/service');
const { parseCookies } = require('../src/http/cookies');

const SECRET = 'a'.repeat(48);

/* ---------- password ---------- */

test('password: hash rồi verify đúng mật khẩu', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.strictEqual(await verifyPassword('correct horse battery', stored), true);
});

test('password: sai mật khẩu thì false', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.strictEqual(await verifyPassword('wrong horse battery', stored), false);
});

test('password: cùng mật khẩu ra hash khác nhau (salt ngẫu nhiên)', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notStrictEqual(a, b);
  assert.strictEqual(await verifyPassword('same-password', a), true);
  assert.strictEqual(await verifyPassword('same-password', b), true);
});

test('password: định dạng lưu mang theo tham số cost', async () => {
  const stored = await hashPassword('x'.repeat(12));
  const [scheme, N, r, p] = stored.split('$');
  assert.strictEqual(scheme, 'scrypt');
  assert.strictEqual(N, '16384');
  assert.strictEqual(r, '8');
  assert.strictEqual(p, '1');
});

test('password: chuỗi lưu hỏng thì trả false chứ không ném lỗi', async () => {
  for (const bad of ['', 'not-a-hash', 'scrypt$16384$8$1$onlyfour', 'bcrypt$1$2$3$4$5']) {
    assert.strictEqual(await verifyPassword('anything', bad), false, `với input: ${bad}`);
  }
});

test('password: mật khẩu rỗng bị từ chối ngay khi hash', async () => {
  await assert.rejects(() => hashPassword(''), TypeError);
});

/* ---------- JWT ---------- */

test('jwt: ký rồi verify trả lại payload', () => {
  const token = jwt.sign({ sub: '42', role: 'player' }, SECRET, 60);
  const payload = jwt.verify(token, SECRET);
  assert.strictEqual(payload.sub, '42');
  assert.strictEqual(payload.role, 'player');
  assert.ok(payload.exp > payload.iat);
});

test('jwt: sai secret thì từ chối', () => {
  const token = jwt.sign({ sub: '1' }, SECRET, 60);
  assert.throws(() => jwt.verify(token, 'b'.repeat(48)), jwt.JwtError);
});

test('jwt: sửa payload thì chữ ký không khớp', () => {
  const token = jwt.sign({ sub: '1', role: 'player' }, SECRET, 60);
  const [head, , sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: '1', role: 'admin', exp: 9e9 })).toString(
    'base64url'
  );
  assert.throws(() => jwt.verify(`${head}.${forged}.${sig}`, SECRET), jwt.JwtError);
});

test('jwt: token hết hạn bị từ chối', () => {
  const token = jwt.sign({ sub: '1' }, SECRET, -1);
  assert.throws(() => jwt.verify(token, SECRET), /hết hạn/);
});

test('jwt: alg none bị từ chối (alg confusion)', () => {
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ sub: '1', role: 'admin', exp: 9e9 })).toString(
    'base64url'
  );
  assert.throws(() => jwt.verify(`${head}.${claims}.`, SECRET), /alg không được hỗ trợ/);
});

test('jwt: token dị dạng bị từ chối chứ không crash', () => {
  for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '...', 'not.a.token']) {
    assert.throws(() => jwt.verify(bad, SECRET), jwt.JwtError, `với input: ${JSON.stringify(bad)}`);
  }
});

test('jwt: thiếu secret thì ném lỗi cấu hình chứ không ký bằng chuỗi rỗng', () => {
  assert.throws(() => jwt.sign({ sub: '1' }, '', 60), /JWT_SECRET/);
});

/* ---------- email ---------- */

test('email: chuẩn hoá về chữ thường và cắt khoảng trắng', () => {
  assert.strictEqual(normalizeEmail('  Nguyen.Van.A@Example.COM '), 'nguyen.van.a@example.com');
});

test('email: các dạng không hợp lệ trả null', () => {
  const bad = ['', 'no-at-sign', '@example.com', 'a@', 'a@b', 'a b@example.com', 'a@@b.com', null];
  for (const value of bad) {
    assert.strictEqual(normalizeEmail(value), null, `với input: ${JSON.stringify(value)}`);
  }
});

/* ---------- cookie ---------- */

test('cookie: parse nhiều cookie, giữ giá trị đầu tiên khi trùng tên', () => {
  const out = parseCookies('a=1; devlab_refresh=tok%20en; a=2');
  assert.strictEqual(out.a, '1');
  assert.strictEqual(out.devlab_refresh, 'tok en');
});

test('cookie: header rỗng hoặc thiếu trả object rỗng', () => {
  assert.deepStrictEqual(parseCookies(undefined), {});
  assert.deepStrictEqual(parseCookies(''), {});
});
