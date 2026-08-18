'use strict';

/* Integration test cho round/step engine: Postgres thật, HTTP thật.
 *
 * Bỏ qua khi chưa có DATABASE_URL — giống auth-integration.test.js. Chạy đầy đủ:
 *
 *   docker run -d --rm --name devlab-pg -e POSTGRES_PASSWORD=dev \
 *     -e POSTGRES_DB=devlab_dev -p 55432:5432 postgres:17-alpine
 *   DATABASE_URL=postgres://postgres:dev@localhost:55432/devlab_dev \
 *   JWT_SECRET=$(node -e "console.log('x'.repeat(48))") \
 *   node --test test/rounds-integration.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const hasDb = Boolean(process.env.DATABASE_URL);

test('rounds integration', { skip: hasDb ? false : 'chưa đặt DATABASE_URL' }, async (t) => {
  const { loadConfig } = require('../src/config');
  const { createPool } = require('../src/db/pool');
  const { createApp } = require('../src/http/app');
  const { applyMigrations } = require('../scripts/migrate');
  const { seedLegacy } = require('../scripts/seed-legacy');

  const config = loadConfig();
  const pool = createPool(config);
  const quietLogger = { error() {}, log() {}, warn() {} };
  const app = createApp({ pool, config, logger: quietLogger });

  await applyMigrations(pool);
  await seedLegacy(pool);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = (path, { method = 'GET', body, token } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

  async function registerPlayer(tag) {
    const res = await call('/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@devlab.test`,
        display_name: tag,
        password: 'player-pass-123'
      }
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    return { token: body.access_token, user: body.user };
  }

  /* Chiến lược chơi tối giản, chỉ cần hợp lệ — mục tiêu của test này là luồng và
   * ràng buộc, phần chấm điểm đã có unit test bám công thức v1. */
  function pickChoice(step, taken) {
    switch (step.kind) {
      case 'bug-hunt.identify':
        return { line: 1, category_id: step.prompt.categories[0].id };
      case 'spec-detective.segments':
        return { segment_indexes: [0] };
      case 'spec-detective.follow_up':
      case 'prod-roulette.node':
      case 'incident.cause':
        return { option_index: 0 };
      case 'incident.action': {
        const next = step.prompt.actions.find((action) => !action.taken);
        /* Làm 2 hành động rồi kết luận: đủ để đi qua cả hai loại step. */
        return taken.size >= 2 || !next ? { declare_cause: true } : { action_id: next.id };
      }
      default:
        throw new Error(`kind lạ: ${step.kind}`);
    }
  }

  async function playRound(gameId, token) {
    const created = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: gameId },
      token
    });
    assert.strictEqual(created.status, 201, `mở round ${gameId}`);
    const start = await created.json();

    const taken = new Set();
    let step = start.step;
    let last = null;
    let guard = 0;

    while (step && guard < 80) {
      guard += 1;
      const choice = pickChoice(step, taken);
      if (choice.action_id) taken.add(choice.action_id);

      const res = await call(`/api/v1/rounds/${start.round_id}/steps/${step.step_seq}`, {
        method: 'POST',
        body: { choice },
        token
      });
      assert.strictEqual(res.status, 200, `step ${step.step_seq} của ${gameId}`);
      last = await res.json();
      step = last.next_step;
    }

    assert.ok(last && last.summary, `${gameId} phải kết thúc và có summary`);
    return { roundId: start.round_id, start, final: last };
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });

  /* ----------------------------------------------------------- chơi khách */

  await t.test('round khách chơi được nhưng không tính vào bảng xếp hạng', async () => {
    const { final } = await playRound('bug-hunt', null);

    assert.strictEqual(final.progress.completed, true);
    assert.strictEqual(final.next_step, null);
    assert.strictEqual(final.summary.counts_toward_leaderboard, false);
    assert.strictEqual(final.summary.is_personal_best, false);
    assert.strictEqual(final.summary.rank, null);
    assert.ok(final.summary.score >= 0 && final.summary.score <= 100);
    assert.strictEqual(final.summary.breakdown.length, 8);
  });

  /* ------------------------------------------------- chơi đủ 4 game khi đã login */

  const player = await registerPlayer('player');

  await t.test('chơi hết 4 game, điểm nằm trong 0-100 và ghi vào best score', async () => {
    for (const gameId of ['bug-hunt', 'spec-detective', 'prod-roulette', 'incident']) {
      const { final } = await playRound(gameId, player.token);
      assert.strictEqual(final.summary.counts_toward_leaderboard, true, gameId);
      assert.ok(final.summary.score >= 0 && final.summary.score <= 100, gameId);
      assert.ok(final.summary.notes.length >= 0, gameId);
      assert.ok(final.summary.rank.game >= 1 && final.summary.rank.overall >= 1, gameId);
    }

    const me = await (await call('/api/v1/me', { token: player.token })).json();
    assert.deepStrictEqual(
      Object.keys(me.best_scores).sort(),
      ['bug-hunt', 'incident', 'prod-roulette', 'spec-detective']
    );

    const games = await (await call('/api/v1/games', { token: player.token })).json();
    for (const game of games.games) {
      assert.strictEqual(game.my_best, me.best_scores[game.id], game.id);
    }
  });

  await t.test('best score chỉ đi lên, không bị lượt kém hơn ghi đè (BR-05)', async () => {
    const before = await (await call('/api/v1/me', { token: player.token })).json();

    /* Chơi lại bug-hunt bằng đúng chiến lược tối giản: điểm sẽ không cao hơn lần trước
     * bao nhiêu, nhưng best score tuyệt đối không được giảm. */
    const { final } = await playRound('bug-hunt', player.token);
    const after = await (await call('/api/v1/me', { token: player.token })).json();

    assert.ok(after.best_scores['bug-hunt'] >= before.best_scores['bug-hunt']);
    assert.ok(after.best_scores['bug-hunt'] >= final.summary.score);
  });

  /* ------------------------------------------------------------ ràng buộc round */

  await t.test('không cho mở round thứ hai khi còn round đang chơi (BR-10)', async () => {
    const first = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'incident' },
      token: player.token
    });
    assert.strictEqual(first.status, 201);
    const started = await first.json();

    const second = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'bug-hunt' },
      token: player.token
    });
    assert.strictEqual(second.status, 409);
    const body = await second.json();
    assert.strictEqual(body.error.code, 'ROUND_ALREADY_ACTIVE');
    assert.strictEqual(body.round_id, started.round_id);

    /* Bỏ lượt xong thì mở lại được, và không gửi step vào round đã bỏ được nữa. */
    const abandoned = await call(`/api/v1/rounds/${started.round_id}/abandon`, {
      method: 'POST',
      token: player.token
    });
    assert.strictEqual(abandoned.status, 200);

    const afterAbandon = await call(`/api/v1/rounds/${started.round_id}/steps/1`, {
      method: 'POST',
      body: { choice: { declare_cause: true } },
      token: player.token
    });
    assert.strictEqual(afterAbandon.status, 409);
    assert.strictEqual((await afterAbandon.json()).error.code, 'ROUND_NOT_ACTIVE');
  });

  await t.test('game_id sai bị từ chối trước khi đụng tới DB', async () => {
    const res = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'khong-ton-tai' },
      token: player.token
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual((await res.json()).error.code, 'VALIDATION_ERROR');
  });

  /* ------------------------------------------------------------ ràng buộc step */

  await t.test('double-submit, sai thứ tự, choice không hợp lệ', async () => {
    const created = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'spec-detective' },
      token: player.token
    });
    const start = await created.json();
    const url = (seq) => `/api/v1/rounds/${start.round_id}/steps/${seq}`;

    /* 9.2: chỉ nhận đúng step đang chờ. */
    const outOfOrder = await call(url(2), {
      method: 'POST',
      body: { choice: { option_index: 0 } },
      token: player.token
    });
    assert.strictEqual(outOfOrder.status, 404, 'step 2 chưa tồn tại');

    /* 9.4: index ngoài phạm vi → 400 và step KHÔNG bị đánh dấu đã trả lời. */
    const bad = await call(url(1), {
      method: 'POST',
      body: { choice: { segment_indexes: [999] } },
      token: player.token
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).error.code, 'INVALID_CHOICE');

    const ok = await call(url(1), {
      method: 'POST',
      body: { choice: { segment_indexes: [0] } },
      token: player.token
    });
    assert.strictEqual(ok.status, 200, 'step vẫn gửi lại được sau INVALID_CHOICE');

    /* 9.1: gửi trùng. */
    const again = await call(url(1), {
      method: 'POST',
      body: { choice: { segment_indexes: [0] } },
      token: player.token
    });
    assert.strictEqual(again.status, 409);
    assert.strictEqual((await again.json()).error.code, 'STEP_ALREADY_ANSWERED');

    /* 9.2 lần hai: step 1 đã trả lời, step đang chờ là 2 → gửi lại step cũ ra
     * STEP_ALREADY_ANSWERED, còn step chưa tới thì 404. */
    const tooFar = await call(url(3), {
      method: 'POST',
      body: { choice: { option_index: 0 } },
      token: player.token
    });
    assert.strictEqual(tooFar.status, 404);

    await call(`/api/v1/rounds/${start.round_id}/abandon`, { method: 'POST', token: player.token });
  });

  /* --------------------------------------------------- đồng hồ Bug Hunt (8.2) */

  await t.test('step Bug Hunt quá hạn bị chốt 0 điểm, choice bị vứt bỏ (BR-03a)', async () => {
    const created = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'bug-hunt' },
      token: player.token
    });
    const start = await created.json();
    assert.strictEqual(start.step.time_limit_seconds, 60);
    assert.ok(start.step.expires_at, 'Bug Hunt phải có mốc hết hạn');

    /* Kéo mốc hết hạn về quá khứ thay vì chờ 60 giây thật. */
    await pool.query(
      `UPDATE round_steps SET expires_at = now() - interval '1 second'
        WHERE round_id = $1 AND step_seq = 1`,
      [start.round_id]
    );

    const res = await call(`/api/v1/rounds/${start.round_id}/steps/1`, {
      method: 'POST',
      body: { choice: { line: 1, category_id: start.step.prompt.categories[0].id } },
      token: player.token
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.error.code, 'STEP_EXPIRED');
    assert.strictEqual(body.effect.points_delta, 0, 'chốt cứng 0 điểm');
    assert.ok(body.reveal.answerLines, '409 vẫn kèm reveal để client đi tiếp');
    assert.ok(body.next_step, '409 vẫn kèm step kế');

    /* Việc chốt step phải được COMMIT, không bị rollback theo lỗi 409. */
    const { rows } = await pool.query(
      'SELECT answered_at, choice FROM round_steps WHERE round_id = $1 AND step_seq = 1',
      [start.round_id]
    );
    assert.ok(rows[0].answered_at, 'step quá hạn phải được ghi answered_at');
    assert.strictEqual(rows[0].choice, null, 'choice gửi muộn bị vứt bỏ, không lưu');

    await call(`/api/v1/rounds/${start.round_id}/abandon`, { method: 'POST', token: player.token });
  });

  await t.test('GET /rounds/:id không đặt lại đồng hồ và tự chốt step quá hạn (8.6, 8.2C)', async () => {
    const created = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'bug-hunt' },
      token: player.token
    });
    const start = await created.json();

    const resumed = await (
      await call(`/api/v1/rounds/${start.round_id}`, { token: player.token })
    ).json();
    assert.strictEqual(resumed.step.step_seq, 1);
    assert.strictEqual(resumed.step.expires_at, start.step.expires_at, 'F5 không reset đồng hồ');

    await pool.query(
      `UPDATE round_steps SET expires_at = now() - interval '1 second'
        WHERE round_id = $1 AND step_seq = 1`,
      [start.round_id]
    );

    const afterExpiry = await (
      await call(`/api/v1/rounds/${start.round_id}`, { token: player.token })
    ).json();
    assert.strictEqual(afterExpiry.expired_step.step_seq, 1);
    assert.strictEqual(afterExpiry.step.step_seq, 2, 'trả về step kế, không treo step cũ');

    const { rows } = await pool.query(
      'SELECT points FROM round_items WHERE round_id = $1 AND item_seq = 1',
      [start.round_id]
    );
    assert.strictEqual(rows[0].points, 0);

    await call(`/api/v1/rounds/${start.round_id}/abandon`, { method: 'POST', token: player.token });
  });

  /* ------------------------------------------------------------ quyền sở hữu */

  await t.test('người khác không đọc được round của mình (spec 12)', async () => {
    const other = await registerPlayer('other');
    const created = await call('/api/v1/rounds', {
      method: 'POST',
      body: { game_id: 'prod-roulette' },
      token: player.token
    });
    const start = await created.json();

    const asOther = await call(`/api/v1/rounds/${start.round_id}`, { token: other.token });
    assert.strictEqual(asOther.status, 404, 'không lộ cả sự tồn tại của round');

    const asAnonymous = await call(`/api/v1/rounds/${start.round_id}`);
    assert.strictEqual(asAnonymous.status, 404);

    const notUuid = await call('/api/v1/rounds/khong-phai-uuid', { token: player.token });
    assert.strictEqual(notUuid.status, 404, 'id sai định dạng không được để lọt xuống DB');

    await call(`/api/v1/rounds/${start.round_id}/abandon`, { method: 'POST', token: player.token });
  });

  /* ------------------------------------------------------------- pool cạn (8.4) */

  await t.test('pool không đủ item thì trả 422 POOL_EXHAUSTED', async () => {
    await pool.query(
      "UPDATE content_items SET status = 'hidden' WHERE game_id = 'prod-roulette'"
    );
    try {
      const res = await call('/api/v1/rounds', {
        method: 'POST',
        body: { game_id: 'prod-roulette' },
        token: player.token
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual((await res.json()).error.code, 'POOL_EXHAUSTED');

      const games = await (await call('/api/v1/games')).json();
      const prod = games.games.find((g) => g.id === 'prod-roulette');
      assert.strictEqual(prod.playable, false);
      assert.strictEqual(prod.pool_available, 0);
    } finally {
      await pool.query(
        "UPDATE content_items SET status = 'active' WHERE game_id = 'prod-roulette'"
      );
    }
  });
});
