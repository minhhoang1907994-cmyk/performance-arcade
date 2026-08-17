'use strict';

/* Integration test: chạy migration, seed, dựng app thật và gọi HTTP thật.
 *
 * Bỏ qua khi chưa có DATABASE_URL — để `npm test` vẫn chạy được trên máy không có
 * Postgres. Muốn chạy đầy đủ:
 *
 *   docker run -d --rm --name devlab-pg -e POSTGRES_PASSWORD=dev \
 *     -e POSTGRES_DB=devlab_dev -p 55432:5432 postgres:17-alpine
 *   DATABASE_URL=postgres://postgres:dev@localhost:55432/devlab_dev \
 *   JWT_SECRET=$(node -e "console.log('x'.repeat(48))") \
 *   BOOTSTRAP_ADMIN_EMAIL=admin@devlab.test BOOTSTRAP_ADMIN_PASSWORD=admin-pass-123 \
 *   node --test test/auth-integration.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const hasDb = Boolean(process.env.DATABASE_URL);

test('auth integration', { skip: hasDb ? false : 'chưa đặt DATABASE_URL' }, async (t) => {
  const { loadConfig } = require('../src/config');
  const { createPool } = require('../src/db/pool');
  const { createApp } = require('../src/http/app');
  const { applyMigrations, bootstrapAdmin } = require('../scripts/migrate');
  const { seedLegacy } = require('../scripts/seed-legacy');

  const config = loadConfig();
  const pool = createPool(config);
  const quietLogger = { error() {}, log() {}, warn() {} };
  const app = createApp({ pool, config, logger: quietLogger });

  await applyMigrations(pool);
  await bootstrapAdmin(pool, process.env);
  const seeded = await seedLegacy(pool);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /* Email duy nhất cho mỗi lần chạy để test lặp lại được mà không cần dọn DB. */
  const email = `player-${Date.now()}@devlab.test`;
  const password = 'player-pass-123';
  let accessToken = null;
  let refreshCookie = null;

  const call = (path, { method = 'GET', body, token, cookie } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

  const cookieFrom = (res) => {
    const raw = res.headers.getSetCookie?.() || [];
    const found = raw.find((c) => c.startsWith('devlab_refresh='));
    return found ? found.split(';')[0] : null;
  };

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  await t.test('seed nạp đủ 24 mục viết tay', () => {
    assert.strictEqual(seeded.total, 24);
    assert.strictEqual(seeded.inserted + seeded.skipped, 24);
  });

  await t.test('GET /health trả ok', async () => {
    const res = await call('/health');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { status: 'ok' });
  });

  await t.test('GET /api/v1/games phản ánh pool thật', async () => {
    const res = await call('/api/v1/games');
    assert.strictEqual(res.status, 200);
    const { games } = await res.json();
    assert.strictEqual(games.length, 4);

    const bugHunt = games.find((g) => g.id === 'bug-hunt');
    assert.strictEqual(bugHunt.pool_available, 12);
    assert.strictEqual(bugHunt.items_per_round, 8);
    assert.strictEqual(bugHunt.playable, true, '12 >= 8 nên chơi được');

    const specDetective = games.find((g) => g.id === 'spec-detective');
    assert.strictEqual(specDetective.pool_available, 6);
    assert.strictEqual(specDetective.playable, true, '6 >= 4 nên chơi được');
  });

  await t.test('POST /auth/register tạo tài khoản và trả token', async () => {
    const res = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email, display_name: 'Người chơi', password }
    });
    assert.strictEqual(res.status, 201);

    const body = await res.json();
    assert.strictEqual(body.user.email, email);
    assert.strictEqual(body.user.role, 'player');
    assert.ok(body.access_token);
    assert.strictEqual(body.expires_in, 15 * 60);
    assert.ok(!('password_hash' in body.user), 'không được lộ password_hash');

    accessToken = body.access_token;
    refreshCookie = cookieFrom(res);
    assert.ok(refreshCookie, 'phải set cookie refresh');

    const setCookie = res.headers.getSetCookie().join(';');
    assert.match(setCookie, /HttpOnly/i, 'cookie refresh phải là httpOnly');
  });

  await t.test('đăng ký trùng email → 409 EMAIL_TAKEN', async () => {
    const res = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email, display_name: 'Trùng', password }
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual((await res.json()).error.code, 'EMAIL_TAKEN');
  });

  await t.test('input sai → 400 VALIDATION_ERROR kèm chi tiết từng field', async () => {
    const res = await call('/api/v1/auth/register', {
      method: 'POST',
      body: { email: 'khong-phai-email', display_name: 'x', password: 'ngan' }
    });
    assert.strictEqual(res.status, 400);
    const { error } = await res.json();
    assert.strictEqual(error.code, 'VALIDATION_ERROR');
    assert.deepStrictEqual(Object.keys(error.details).sort(), ['display_name', 'email', 'password']);
  });

  await t.test('GET /api/v1/me cần token', async () => {
    const anon = await call('/api/v1/me');
    assert.strictEqual(anon.status, 401);

    const res = await call('/api/v1/me', { token: accessToken });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).user.email, email);
  });

  await t.test('token bị sửa → 401', async () => {
    const tampered = `${accessToken.slice(0, -3)}xyz`;
    const res = await call('/api/v1/me', { token: tampered });
    assert.strictEqual(res.status, 401);
  });

  await t.test('refresh xoay vòng token, token cũ dùng lại bị từ chối', async () => {
    const first = await call('/api/v1/auth/refresh', { method: 'POST', cookie: refreshCookie });
    assert.strictEqual(first.status, 200);
    const rotated = cookieFrom(first);
    assert.ok(rotated && rotated !== refreshCookie, 'refresh token phải đổi');

    const replay = await call('/api/v1/auth/refresh', { method: 'POST', cookie: refreshCookie });
    assert.strictEqual(replay.status, 401, 'refresh token cũ chỉ dùng được một lần');

    refreshCookie = rotated;
    accessToken = (await first.json()).access_token;
  });

  await t.test('logout thu hồi session hiện tại', async () => {
    const res = await call('/api/v1/auth/logout', {
      method: 'POST',
      token: accessToken,
      cookie: refreshCookie
    });
    assert.strictEqual(res.status, 204);

    const after = await call('/api/v1/auth/refresh', { method: 'POST', cookie: refreshCookie });
    assert.strictEqual(after.status, 401);
  });

  await t.test('login lại được sau khi logout', async () => {
    const res = await call('/api/v1/auth/login', { method: 'POST', body: { email, password } });
    assert.strictEqual(res.status, 200);
    accessToken = (await res.json()).access_token;
    assert.ok(accessToken);
  });

  await t.test('sai mật khẩu và email không tồn tại đều trả 401 giống nhau', async () => {
    const wrongPassword = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'sai-mat-khau-roi' }
    });
    const noSuchUser = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email: `khongton-${Date.now()}@devlab.test`, password }
    });

    assert.strictEqual(wrongPassword.status, 401);
    assert.strictEqual(noSuchUser.status, 401);
    assert.deepStrictEqual(await wrongPassword.json(), await noSuchUser.json());
  });

  await t.test('player không vào được endpoint admin → 403', async () => {
    const res = await call('/api/v1/admin/users/1/reset-password', {
      method: 'POST',
      token: accessToken,
      body: { password: 'gi-cung-duoc-123' }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual((await res.json()).error.code, 'FORBIDDEN');
  });

  await t.test('admin reset mật khẩu và đá mọi session của user đó (BR-12)', async () => {
    const adminLogin = await call('/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: process.env.BOOTSTRAP_ADMIN_EMAIL,
        password: process.env.BOOTSTRAP_ADMIN_PASSWORD
      }
    });
    assert.strictEqual(adminLogin.status, 200, 'bootstrap admin phải đăng nhập được');
    const adminToken = (await adminLogin.json()).access_token;

    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    const targetId = rows[0].id;

    const newPassword = 'mat-khau-moi-456';
    const res = await call(`/api/v1/admin/users/${targetId}/reset-password`, {
      method: 'POST',
      token: adminToken,
      body: { password: newPassword }
    });
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).revoked_sessions >= 1, 'phải thu hồi session đang mở');

    const oldFails = await call('/api/v1/auth/login', { method: 'POST', body: { email, password } });
    assert.strictEqual(oldFails.status, 401, 'mật khẩu cũ hết tác dụng');

    const newWorks = await call('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: newPassword }
    });
    assert.strictEqual(newWorks.status, 200, 'mật khẩu mới dùng được');
  });

  await t.test('endpoint không tồn tại → 404 theo đúng format lỗi chung', async () => {
    const res = await call('/api/v1/khong-co-gi');
    assert.strictEqual(res.status, 404);
    assert.strictEqual((await res.json()).error.code, 'NOT_FOUND');
  });

  await t.test('JSON hỏng → 400 chứ không phải 500', async () => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ khong phai json'
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error.code, 'VALIDATION_ERROR');
  });

  await t.test('rate limit login: request thứ 11 trong cửa sổ bị chặn', async () => {
    const throwaway = `rl-${Date.now()}@devlab.test`;
    let last;
    for (let i = 0; i < 12; i += 1) {
      last = await call('/api/v1/auth/login', {
        method: 'POST',
        body: { email: throwaway, password: 'sai-het' }
      });
      if (last.status === 429) break;
    }
    assert.strictEqual(last.status, 429);
    assert.strictEqual((await last.json()).error.code, 'TOO_MANY_REQUESTS');
    assert.ok(last.headers.get('retry-after'), 'phải có header Retry-After');
  });
});
