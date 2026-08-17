'use strict';

/* Truy vấn cho users và auth_sessions.
 *
 * Mọi truy vấn dùng tham số hoá — không nối chuỗi SQL (spec section 12).
 * `password_hash` và `refresh_token_hash` không bao giờ nằm trong SELECT trả ra ngoài,
 * trừ đúng hàm cần chúng để xác thực.
 */

const crypto = require('node:crypto');

const PUBLIC_USER_COLUMNS = 'id, email, display_name, role, is_active, created_at';

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function createUser(db, { email, displayName, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${PUBLIC_USER_COLUMNS}`,
    [email, displayName, passwordHash]
  );
  return rows[0];
}

async function findUserByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function findUserById(db, id) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function updatePasswordHash(db, userId, passwordHash) {
  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
    [passwordHash, userId]
  );
}

async function createSession(db, { userId, token, ttlSeconds, userAgent, ip }) {
  const { rows } = await db.query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)
     RETURNING id, expires_at`,
    [userId, hashRefreshToken(token), ttlSeconds, userAgent || null, ip || null]
  );
  return rows[0];
}

/* Tìm session còn sống theo refresh token thô. Chỉ so hash, không lưu token gốc. */
async function findLiveSession(db, token) {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id, s.expires_at
       FROM auth_sessions s
      WHERE s.refresh_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [hashRefreshToken(token)]
  );
  return rows[0] || null;
}

async function revokeSession(db, sessionId) {
  await db.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [sessionId]
  );
}

/* Thu hồi toàn bộ session của một user. Dùng khi admin reset mật khẩu (BR-12) —
 * người đang giữ phiên cũ phải bị đá ra, nếu không việc reset thành vô nghĩa. */
async function revokeAllSessions(db, userId) {
  const { rowCount } = await db.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  return rowCount;
}

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  updatePasswordHash,
  createSession,
  findLiveSession,
  revokeSession,
  revokeAllSessions,
  newRefreshToken,
  hashRefreshToken
};
