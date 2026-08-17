'use strict';

/* Trích 24 mục nội dung viết tay của bản v1 (data/*.js) sang định dạng content_items.
 *
 * Hai vai trò:
 *  1. Seed pool khởi đầu cho P1 với source = 'handwritten'
 *  2. BỘ TEST VÀNG cho validator — 24 mục này do người viết và đã chạy đúng trong
 *     game v1, nên chúng PHẢI pass validator 100%. Mục nào fail nghĩa là validator
 *     sai, không phải data sai.
 *
 * Data v1 gán vào window.* nên cần shim trước khi require.
 * Field `id` của v1 bị bỏ (DB có id riêng); Bug Hunt bỏ thêm `level` theo quyết định N6.
 *
 * Dùng:  node server/scripts/extract-legacy-content.js [--out <file.json>]
 */

const path = require('node:path');
const fs = require('node:fs');
const { contentHash } = require('../src/content/hash');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const SOURCES = [
  { file: 'bug-hunt.data.js', global: 'BUG_HUNT_QUESTIONS', gameId: 'bug-hunt' },
  { file: 'spec-detective.data.js', global: 'SPEC_DETECTIVE_CASES', gameId: 'spec-detective' },
  { file: 'prod-roulette.data.js', global: 'PROD_ROULETTE_SCENARIOS', gameId: 'prod-roulette' },
  { file: 'incident.data.js', global: 'INCIDENT_SCENARIOS', gameId: 'incident' }
];

/* Field của v1 không có trong schema v2, bỏ khi chuyển đổi. */
const DROPPED_FIELDS = {
  'bug-hunt': ['id', 'level'],
  'spec-detective': ['id'],
  'prod-roulette': ['id'],
  incident: ['id']
};

function loadLegacyGlobals() {
  /* Data v1 viết cho trình duyệt: `window.X = [...]`. Tạo shim rồi require. */
  const win = {};
  global.window = win;
  try {
    for (const src of SOURCES) {
      const full = path.join(DATA_DIR, src.file);
      delete require.cache[require.resolve(full)];
      require(full);
    }
  } finally {
    delete global.window;
  }
  return win;
}

function toPayload(gameId, legacyItem) {
  const dropped = DROPPED_FIELDS[gameId] || [];
  const payload = {};
  for (const [key, value] of Object.entries(legacyItem)) {
    if (dropped.includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

function extractLegacyContent() {
  const win = loadLegacyGlobals();
  const rows = [];

  for (const src of SOURCES) {
    const list = win[src.global];
    if (!Array.isArray(list)) {
      throw new Error(`${src.file}: không tìm thấy window.${src.global}`);
    }

    for (const legacyItem of list) {
      const payload = toPayload(src.gameId, legacyItem);
      rows.push({
        game_id: src.gameId,
        /* Bug Hunt phân loại sẵn; 3 game còn lại v1 không có category/lang
         * nên để '' — nghĩa là "chưa phân loại", khớp DEFAULT của schema. */
        category: src.gameId === 'bug-hunt' ? payload.category : '',
        lang: src.gameId === 'bug-hunt' ? payload.lang : '',
        payload,
        content_hash: contentHash(payload),
        source: 'handwritten',
        status: 'active',
        legacy_id: legacyItem.id || null
      });
    }
  }

  return rows;
}

function main() {
  const outIndex = process.argv.indexOf('--out');
  const rows = extractLegacyContent();

  const byGame = rows.reduce((acc, r) => {
    acc[r.game_id] = (acc[r.game_id] || 0) + 1;
    return acc;
  }, {});

  const hashes = new Set(rows.map((r) => r.content_hash));
  if (hashes.size !== rows.length) {
    console.error(`LỖI: ${rows.length - hashes.size} mục trùng content_hash trong chính bank viết tay`);
    process.exitCode = 1;
  }

  if (outIndex !== -1 && process.argv[outIndex + 1]) {
    const outPath = path.resolve(process.argv[outIndex + 1]);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`Đã ghi ${rows.length} mục vào ${outPath}`);
  }

  console.log(`Tổng: ${rows.length} mục — ${JSON.stringify(byGame)}`);
}

if (require.main === module) main();

module.exports = { extractLegacyContent, SOURCES };
