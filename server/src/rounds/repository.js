'use strict';

/* Truy cập DB cho vòng đời một lượt chơi.
 *
 * Mọi hàm nhận `client` (không phải pool) vì gần như toàn bộ đều chạy trong cùng một
 * transaction với việc chấm điểm — spec 9.1: kiểm `answered_at IS NULL` phải nằm cùng
 * transaction với UPDATE, nếu không double-submit lọt qua.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function normalizeStep(row) {
  return {
    id: Number(row.id),
    roundItemId: row.round_item_id === undefined ? null : Number(row.round_item_id),
    stepSeq: row.step_seq,
    kind: row.kind,
    /* smallint[] về từ pg là mảng số — ép lại cho chắc, vì order_map sai kiểu thì ánh
     * xạ ngược ra đáp án sai chứ không nổ ra lỗi thấy được ngay. */
    orderMap: (row.order_map || []).map(Number),
    servedAt: row.served_at,
    expiresAt: row.expires_at === undefined ? null : row.expires_at,
    answeredAt: row.answered_at === undefined ? null : row.answered_at,
    choice: row.choice === undefined ? null : row.choice,
    effect: row.effect === undefined ? null : row.effect
  };
}

async function countActiveItems(client, gameId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS total FROM content_items WHERE game_id = $1 AND status = 'active'",
    [gameId]
  );
  return rows[0].total;
}

/* BR-09: bốc ngẫu nhiên đều, không hoàn lại, một công thức cho mọi người chơi.
 * ORDER BY random() đủ nhanh với pool cỡ vài nghìn dòng — spec section 15 đã ghi nhận
 * đây là chỗ phải đo lại nếu pool phình lên. */
async function pickItems(client, gameId, count) {
  const { rows } = await client.query(
    `SELECT id, payload, content_hash
       FROM content_items
      WHERE game_id = $1 AND status = 'active'
      ORDER BY random()
      LIMIT $2`,
    [gameId, count]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    payload: row.payload,
    contentHash: row.content_hash
  }));
}

async function findActiveRoundForUser(client, userId) {
  const { rows } = await client.query(
    `SELECT id FROM game_rounds
      WHERE user_id = $1 AND status = 'in_progress'
      LIMIT 1`,
    [userId]
  );
  return rows[0] ? rows[0].id : null;
}

async function insertRound(client, { userId, isGuest, guestIp, gameId, state }) {
  const { rows } = await client.query(
    `INSERT INTO game_rounds (user_id, is_guest, guest_ip, game_id, state)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, is_guest, game_id, status, state, score, started_at`,
    [userId, isGuest, guestIp, gameId, state]
  );
  return rows[0];
}

async function insertRoundItems(client, roundId, contentItemIds) {
  const { rows } = await client.query(
    `INSERT INTO round_items (round_id, item_seq, content_item_id)
     SELECT $1, seq::smallint, id
       FROM unnest($2::bigint[]) WITH ORDINALITY AS t(id, seq)
     RETURNING id, item_seq, content_item_id`,
    [roundId, contentItemIds]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    itemSeq: row.item_seq,
    contentItemId: Number(row.content_item_id)
  }));
}

/* expires_at tính bằng SQL chứ không bằng đồng hồ Node: served_at mặc định là now()
 * của cùng câu lệnh này, tính ở hai nơi khác nhau thì hai mốc lệch nhau vài ms và
 * BR-03a (bonus tốc độ đo từ served_at) chấm sai ngay ở biên. */
async function insertStep(client, step) {
  const { rows } = await client.query(
    `INSERT INTO round_steps
       (round_id, round_item_id, step_seq, kind, order_map, content_snapshot_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             CASE WHEN $7::int IS NULL THEN NULL
                  ELSE now() + ($7::int * interval '1 second') END)
     RETURNING id, round_item_id, step_seq, kind, order_map, served_at, expires_at`,
    [
      step.roundId,
      step.roundItemId,
      step.stepSeq,
      step.kind,
      step.orderMap,
      step.contentSnapshotHash,
      step.timeLimitSeconds
    ]
  );
  return normalizeStep(rows[0]);
}

/* FOR UPDATE trên chính hàng round: hai tab cùng gửi step sẽ xếp hàng thay vì cùng đọc
 * ra `current_step_seq` cũ rồi cùng ghi (spec 9.3). */
async function lockRound(client, roundId) {
  const { rows } = await client.query(
    `SELECT id, user_id, is_guest, game_id, status, state, score, started_at
       FROM game_rounds
      WHERE id = $1
      FOR UPDATE`,
    [roundId]
  );
  return rows[0] || null;
}

async function loadRoundItems(client, roundId) {
  const { rows } = await client.query(
    `SELECT ri.id, ri.item_seq, ri.content_item_id, ri.points, ri.voided,
            ci.payload, ci.content_hash
       FROM round_items ri
       JOIN content_items ci ON ci.id = ri.content_item_id
      WHERE ri.round_id = $1
      ORDER BY ri.item_seq`,
    [roundId]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    itemSeq: row.item_seq,
    contentItemId: Number(row.content_item_id),
    points: row.points,
    voided: row.voided,
    payload: row.payload,
    contentHash: row.content_hash
  }));
}

const STEP_COLUMNS = `id, round_item_id, step_seq, kind, order_map, served_at, expires_at,
                      answered_at, choice, effect`;

async function loadStep(client, roundId, stepSeq) {
  const { rows } = await client.query(
    `SELECT ${STEP_COLUMNS} FROM round_steps WHERE round_id = $1 AND step_seq = $2`,
    [roundId, stepSeq]
  );
  return rows[0] ? normalizeStep(rows[0]) : null;
}

async function loadSteps(client, roundId) {
  const { rows } = await client.query(
    `SELECT ${STEP_COLUMNS} FROM round_steps WHERE round_id = $1 ORDER BY step_seq`,
    [roundId]
  );
  return rows.map(normalizeStep);
}

/* Step đầu tiên của một item — quyết định có gửi lại phần bối cảnh (title/brief) hay
 * không. Truy vấn thay vì suy ra từ state để không phải nhớ thêm một field nữa. */
async function firstStepSeqOfItem(client, roundItemId) {
  const { rows } = await client.query(
    'SELECT min(step_seq)::int AS first_seq FROM round_steps WHERE round_item_id = $1',
    [roundItemId]
  );
  return rows[0].first_seq;
}

async function answerStep(client, stepId, { choice, effect }) {
  await client.query(
    `UPDATE round_steps
        SET answered_at = now(), choice = $2, effect = $3
      WHERE id = $1 AND answered_at IS NULL`,
    [stepId, choice, effect]
  );
}

async function updateRoundState(client, roundId, state) {
  await client.query(
    'UPDATE game_rounds SET state = $2, last_activity_at = now() WHERE id = $1',
    [roundId, state]
  );
}

async function completeItem(client, roundItemId, points) {
  await client.query(
    'UPDATE round_items SET points = $2, completed_at = now() WHERE id = $1',
    [roundItemId, points]
  );
}

async function finishRound(client, roundId, score) {
  await client.query(
    `UPDATE game_rounds
        SET status = 'finished', score = $2, finished_at = now(), last_activity_at = now()
      WHERE id = $1`,
    [roundId, score]
  );
}

async function abandonRound(client, roundId) {
  await client.query(
    `UPDATE game_rounds
        SET status = 'abandoned', last_activity_at = now()
      WHERE id = $1 AND status = 'in_progress'`,
    [roundId]
  );
}

async function bumpServedCount(client, contentItemId) {
  await client.query(
    'UPDATE content_items SET served_count = served_count + 1 WHERE id = $1',
    [contentItemId]
  );
}

/* BR-05: best score là điểm CAO NHẤT nên dùng GREATEST chứ không gán đè.
 * best_round_id chỉ đổi khi điểm mới thực sự cao hơn — bằng điểm thì giữ round cũ, vì
 * lần đầu đạt mốc mới là lần đáng truy vết. */
async function upsertLeaderboardBest(client, { userId, gameId, score, roundId }) {
  const { rows: before } = await client.query(
    'SELECT best_score FROM leaderboard_best WHERE user_id = $1 AND game_id = $2',
    [userId, gameId]
  );
  const previousBest = before[0] ? before[0].best_score : null;

  await client.query(
    `INSERT INTO leaderboard_best (user_id, game_id, best_score, best_round_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, game_id) DO UPDATE
        SET best_score    = GREATEST(leaderboard_best.best_score, EXCLUDED.best_score),
            best_round_id = CASE
                              WHEN EXCLUDED.best_score > leaderboard_best.best_score
                              THEN EXCLUDED.best_round_id
                              ELSE leaderboard_best.best_round_id
                            END,
            updated_at    = now()`,
    [userId, gameId, score, roundId]
  );

  return { previousBest, isPersonalBest: previousBest === null || score > previousBest };
}

/* Hạng hiện tại của người chơi. COALESCE(..., -1) để người chưa có bản ghi nào vẫn ra
 * hạng cuối thay vì NULL — spec 5.2 luôn có `rank` trong summary của round đã đăng nhập. */
async function fetchRanks(client, userId, gameId) {
  const { rows } = await client.query(
    `WITH totals AS (
        SELECT user_id, sum(best_score)::int AS total
          FROM leaderboard_best
         GROUP BY user_id
     )
     SELECT
       (SELECT count(*) + 1
          FROM leaderboard_best
         WHERE game_id = $2
           AND best_score > COALESCE(
                 (SELECT best_score FROM leaderboard_best WHERE user_id = $1 AND game_id = $2), -1
               ))::int AS game_rank,
       (SELECT count(*) + 1
          FROM totals
         WHERE total > COALESCE((SELECT total FROM totals WHERE user_id = $1), -1))::int AS overall_rank`,
    [userId, gameId]
  );
  return { game: rows[0].game_rank, overall: rows[0].overall_rank };
}

async function fetchMyBest(client, userId) {
  const { rows } = await client.query(
    'SELECT game_id, best_score FROM leaderboard_best WHERE user_id = $1',
    [userId]
  );
  return Object.fromEntries(rows.map((row) => [row.game_id, row.best_score]));
}

module.exports = {
  isUuid,
  countActiveItems,
  pickItems,
  findActiveRoundForUser,
  insertRound,
  insertRoundItems,
  insertStep,
  lockRound,
  loadRoundItems,
  loadStep,
  loadSteps,
  firstStepSeqOfItem,
  answerStep,
  updateRoundState,
  completeItem,
  finishRound,
  abandonRound,
  bumpServedCount,
  upsertLeaderboardBest,
  fetchRanks,
  fetchMyBest
};
