'use strict';

/* Chạy migration và tạo admin đầu tiên.
 *
 * Theo dõi migration đã áp bằng bảng schema_migrations để chạy lại nhiều lần vẫn an toàn.
 * Bootstrap admin nằm ở đây chứ không trong file .sql vì cần băm mật khẩu bằng scrypt.
 *
 * Dùng:  node server/scripts/migrate.js
 */

const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { hashPassword } = require('../src/auth/password');
const { normalizeEmail } = require('../src/auth/service');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureTrackingTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedFilenames(pool) {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function applyMigrations(pool) {
  await ensureTrackingTable(pool);
  const done = await appliedFilenames(pool);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`  = ${file} (đã áp trước đó)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    /* File .sql tự quản BEGIN/COMMIT nên chạy nguyên khối; chỉ ghi nhận sau khi thành công. */
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`  + ${file}`);
    applied += 1;
  }
  return { total: files.length, applied };
}

/* Tạo admin từ env. Nếu email đã tồn tại thì nâng quyền thay vì tạo mới (spec 4.2). */
async function bootstrapAdmin(pool, env) {
  const rawEmail = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!rawEmail || !password) {
    console.log('  ! bỏ qua bootstrap admin: chưa đặt BOOTSTRAP_ADMIN_EMAIL/PASSWORD');
    return null;
  }

  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error(`BOOTSTRAP_ADMIN_EMAIL không hợp lệ: ${rawEmail}`);
  if (password.length < 10) throw new Error('BOOTSTRAP_ADMIN_PASSWORD cần tối thiểu 10 ký tự');

  const { rows: existing } = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);

  if (existing.length > 0) {
    if (existing[0].role !== 'admin') {
      await pool.query("UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1", [
        existing[0].id
      ]);
      console.log(`  ~ nâng quyền admin cho user đã có: ${email}`);
    } else {
      console.log(`  = admin đã tồn tại: ${email}`);
    }
    return existing[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [email, 'Admin', await hashPassword(password)]
  );
  console.log(`  + tạo admin: ${email}`);
  return rows[0].id;
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);

  try {
    console.log('[migrate] áp migration');
    const result = await applyMigrations(pool);
    console.log('[migrate] bootstrap admin');
    await bootstrapAdmin(pool, process.env);
    console.log(`[migrate] xong — ${result.applied}/${result.total} file mới được áp`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate] thất bại:', err.message);
    process.exit(1);
  });
}

module.exports = { applyMigrations, bootstrapAdmin };
