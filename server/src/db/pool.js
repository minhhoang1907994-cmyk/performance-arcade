'use strict';

/* Connection pool tới Postgres.
 *
 * `max` để thấp có chủ đích: Neon free tier giới hạn số connection, và spec section 15
 * đã xác định đây là nút thắt đã biết. Số người chơi đồng thời dự kiến rất nhỏ nên
 * pool nhỏ vẫn dư.
 */

const { Pool } = require('pg');

function createPool(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    /* Neon bắt buộc TLS. Local dev qua Docker thì không có TLS. */
    ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : { rejectUnauthorized: true }
  });

  pool.on('error', (err) => {
    /* Client rảnh bị server đóng — pg tự thay thế, chỉ cần log để biết tần suất. */
    console.error('[db] lỗi trên client rảnh:', err.message);
  });

  return pool;
}

/* Chạy một nhóm câu lệnh trong cùng transaction.
 * Dùng cho mọi thao tác cần nguyên tử: chấm điểm một step, cập nhật best-score, rescore.
 */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback thất bại:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
