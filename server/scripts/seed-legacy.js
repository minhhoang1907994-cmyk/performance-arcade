'use strict';

/* Nạp 24 mục nội dung viết tay của v1 vào content_items.
 *
 * Chạy lại nhiều lần an toàn: ON CONFLICT (content_hash) DO NOTHING, nên mục đã có
 * thì bỏ qua thay vì lỗi.
 *
 * Mỗi mục vẫn phải qua validator trước khi INSERT — bank viết tay không được miễn
 * kiểm. Nếu một mục fail thì đó là dấu hiệu validator sai (xem server/README.md),
 * và script dừng lại thay vì âm thầm bỏ mục đó.
 *
 * Dùng:  node server/scripts/seed-legacy.js
 */

const { loadConfig } = require('../src/config');
const { createPool } = require('../src/db/pool');
const { validateContent } = require('../src/content/validators');
const { extractLegacyContent } = require('./extract-legacy-content');

async function seedLegacy(pool) {
  const rows = extractLegacyContent();

  const invalid = [];
  for (const row of rows) {
    const res = validateContent(row.game_id, row.payload);
    if (!res.ok) invalid.push({ legacy_id: row.legacy_id, errors: res.errors });
  }
  if (invalid.length > 0) {
    const detail = invalid
      .map((i) => `  ${i.legacy_id}: ${i.errors.join('; ')}`)
      .join('\n');
    throw new Error(
      `${invalid.length} mục viết tay không qua validator — validator sai, không phải data sai:\n${detail}`
    );
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO content_items (game_id, category, lang, payload, content_hash, source, status)
       VALUES ($1, $2, $3, $4, $5, 'handwritten', 'active')
       ON CONFLICT (content_hash) DO NOTHING`,
      [row.game_id, row.category, row.lang, row.payload, row.content_hash]
    );
    if (rowCount === 1) inserted += 1;
    else skipped += 1;
  }

  return { total: rows.length, inserted, skipped };
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    const result = await seedLegacy(pool);
    console.log(
      `[seed] ${result.total} mục — thêm mới ${result.inserted}, đã có sẵn ${result.skipped}`
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed] thất bại:', err.message);
    process.exit(1);
  });
}

module.exports = { seedLegacy };
