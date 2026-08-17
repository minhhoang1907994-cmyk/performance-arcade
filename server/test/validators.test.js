'use strict';

/* Test validator nội dung.
 *
 * Phần 1 — BỘ TEST VÀNG: 24 mục viết tay của v1 phải pass 100%. Chúng đã chạy đúng
 * trong game thật, nên mục nào fail nghĩa là validator sai chứ không phải data sai.
 *
 * Phần 2 — TEST ÂM: các kịch bản hỏng ở spec section 17 "Generation Tests". Đây là
 * những lỗi AI thực sự hay mắc; validator là lớp chặn duy nhất vì đã bỏ human review.
 */

const test = require('node:test');
const assert = require('node:assert');

const { validateContent } = require('../src/content/validators');
const { extractLegacyContent } = require('../scripts/extract-legacy-content');
const { contentHash, canonicalJson } = require('../src/content/hash');

const legacyRows = extractLegacyContent();

/* ---------- Phần 1: bộ test vàng ---------- */

test('bank viết tay có đúng 24 mục, phân bố đúng theo game', () => {
  const byGame = legacyRows.reduce((acc, r) => {
    acc[r.game_id] = (acc[r.game_id] || 0) + 1;
    return acc;
  }, {});
  assert.deepStrictEqual(byGame, {
    'bug-hunt': 12,
    'spec-detective': 6,
    'prod-roulette': 3,
    incident: 3
  });
});

for (const row of legacyRows) {
  test(`golden: ${row.game_id} / ${row.legacy_id} pass validator`, () => {
    const res = validateContent(row.game_id, row.payload);
    assert.deepStrictEqual(res.errors, [], `phải không có lỗi nào`);
    assert.strictEqual(res.ok, true);
  });
}

test('golden: không mục nào còn field id hay level của v1', () => {
  for (const row of legacyRows) {
    assert.ok(!('id' in row.payload), `${row.legacy_id}: payload còn field id`);
    assert.ok(!('level' in row.payload), `${row.legacy_id}: payload còn field level`);
  }
});

test('golden: content_hash duy nhất trên toàn bank', () => {
  const hashes = new Set(legacyRows.map((r) => r.content_hash));
  assert.strictEqual(hashes.size, legacyRows.length);
});

/* ---------- Phần 2: test âm ---------- */

function bugHuntPayload(overrides) {
  return {
    lang: 'PHP / Laravel',
    title: 'Tìm dòng có lỗi',
    code: ['<?php', '$id = $_GET["id"];', 'DB::select("... $id");', 'return $rows;'],
    answerLines: [3],
    category: 'sql-injection',
    explanation: 'Nối chuỗi thẳng vào câu SQL.',
    fix: 'Dùng binding tham số.',
    ...overrides
  };
}

function expectError(gameId, payload, fragment) {
  const res = validateContent(gameId, payload);
  assert.strictEqual(res.ok, false, 'phải bị từ chối');
  assert.ok(
    res.errors.some((e) => e.includes(fragment)),
    `mong đợi lỗi chứa "${fragment}", nhận được: ${JSON.stringify(res.errors)}`
  );
}

test('gen-1: thiếu explanation → reject', () => {
  const payload = bugHuntPayload();
  delete payload.explanation;
  expectError('bug-hunt', payload, 'explanation: thiếu field bắt buộc');
});

test('gen-2: answerLines trỏ ra ngoài phạm vi code → reject', () => {
  expectError('bug-hunt', bugHuntPayload({ answerLines: [99] }), 'nằm ngoài phạm vi 1..4');
});

test('gen-2b: category không có trong bảng tham chiếu → reject', () => {
  expectError('bug-hunt', bugHuntPayload({ category: 'made-up-bug' }), 'không có trong BUG_HUNT_CATEGORIES');
});

test('gen-2c: còn field level của v1 → reject (quyết định N6)', () => {
  expectError('bug-hunt', bugHuntPayload({ level: 'Trung bình' }), 'field lạ');
});

test('gen-3: prod-roulette có next trỏ node không tồn tại → reject', () => {
  const payload = {
    title: 'Kịch bản',
    brief: 'Mô tả',
    start: 'n1',
    nodes: {
      n1: {
        text: 'Làm gì?',
        options: [
          { t: 'A', risk: 0, feedback: 'ok', next: 'nEnd' },
          { t: 'B', risk: 10, feedback: 'hmm', next: 'nGhost' }
        ]
      },
      nEnd: { end: true, tone: 'good', title: 'Xong', verdict: 'Tốt' }
    }
  };
  expectError('prod-roulette', payload, 'trỏ tới node "nGhost" không tồn tại');
});

test('gen-4: prod-roulette có chu trình không qua node end → reject', () => {
  const payload = {
    title: 'Kịch bản',
    brief: 'Mô tả',
    start: 'n1',
    nodes: {
      n1: {
        text: 'Bước 1',
        options: [
          { t: 'A', risk: 0, feedback: 'ok', next: 'n2' },
          { t: 'B', risk: 5, feedback: 'ok', next: 'nEnd' }
        ]
      },
      n2: {
        text: 'Bước 2',
        options: [
          { t: 'C', risk: 0, feedback: 'ok', next: 'n1' },
          { t: 'D', risk: 0, feedback: 'ok', next: 'n1' }
        ]
      },
      nEnd: { end: true, tone: 'good', title: 'Xong', verdict: 'Tốt' }
    }
  };
  expectError('prod-roulette', payload, 'chu trình không đi qua node end');
});

test('gen-5: incident có 2 causes correct → reject', () => {
  const payload = {
    title: 'Sự cố',
    severity: 'Cao',
    budget: 30,
    brief: 'Mô tả',
    actions: [
      { id: 'a1', label: 'Đọc log', cost: 4, key: true, result: 'Thấy lỗi' },
      { id: 'a2', label: 'Xem diff', cost: 6, result: 'Không có gì' },
      { id: 'a3', label: 'Kiểm tra env', cost: 3, result: 'Thiếu biến' }
    ],
    causes: [
      { t: 'Thiếu biến môi trường', correct: true, why: 'Khớp log' },
      { t: 'Hết RAM', correct: true, why: 'Không khớp' }
    ]
  };
  expectError('incident', payload, 'cần đúng 1 cause có correct=true, đang có 2');
});

test('gen-6: spec-detective có 0 followUp option good → reject', () => {
  const payload = {
    title: 'Case',
    source: 'Email khách',
    segments: [
      { t: 'Hệ thống phải xử lý ' },
      { t: 'nhanh chóng', a: true, r: 'Không có con số cụ thể' }
    ],
    followUp: {
      question: 'Hỏi gì trước?',
      options: [
        { t: 'Hỏi ngưỡng cụ thể', why: 'Đúng nhưng chưa đánh dấu good' },
        { t: 'Hỏi màu logo', why: 'Không ảnh hưởng kiến trúc' }
      ]
    }
  };
  expectError('spec-detective', payload, 'cần đúng 1 option có good=true, đang có 0');
});

test('gen-6b: spec-detective không có segment mơ hồ nào → reject', () => {
  const payload = {
    title: 'Case',
    source: 'Email khách',
    segments: [{ t: 'Câu này rõ ràng.' }, { t: 'Câu này cũng rõ.' }],
    followUp: {
      question: 'Hỏi gì?',
      options: [
        { t: 'A', good: true, why: 'Vì thế' },
        { t: 'B', why: 'Không' }
      ]
    }
  };
  expectError('spec-detective', payload, 'cần tối thiểu 1 segment có a=true');
});

test('gen-6c: segment mơ hồ nhưng thiếu lý do → reject', () => {
  const payload = {
    title: 'Case',
    source: 'Email khách',
    segments: [{ t: 'Phần rõ ' }, { t: 'nhanh chóng', a: true }],
    followUp: {
      question: 'Hỏi gì?',
      options: [
        { t: 'A', good: true, why: 'Vì thế' },
        { t: 'B', why: 'Không' }
      ]
    }
  };
  expectError('spec-detective', payload, 'segment mơ hồ bắt buộc có lý do');
});

test('incident: tổng cost action key vượt budget → reject', () => {
  const payload = {
    title: 'Sự cố',
    severity: 'Cao',
    budget: 10,
    brief: 'Mô tả',
    actions: [
      { id: 'a1', label: 'A', cost: 6, key: true, result: 'r' },
      { id: 'a2', label: 'B', cost: 6, key: true, result: 'r' },
      { id: 'a3', label: 'C', cost: 2, result: 'r' }
    ],
    causes: [
      { t: 'X', correct: true, why: 'vì' },
      { t: 'Y', why: 'không' }
    ]
  };
  expectError('incident', payload, 'vượt budget 10');
});

test('incident: action id trùng nhau → reject', () => {
  const payload = {
    title: 'Sự cố',
    severity: 'Cao',
    budget: 30,
    brief: 'Mô tả',
    actions: [
      { id: 'a1', label: 'A', cost: 4, key: true, result: 'r' },
      { id: 'a1', label: 'B', cost: 4, result: 'r' },
      { id: 'a3', label: 'C', cost: 4, result: 'r' }
    ],
    causes: [
      { t: 'X', correct: true, why: 'vì' },
      { t: 'Y', why: 'không' }
    ]
  };
  expectError('incident', payload, 'bị trùng với action khác');
});

test('game_id không hợp lệ → reject', () => {
  expectError('tetris', bugHuntPayload(), 'không thuộc');
});

/* ---------- Phần 3: content hash ---------- */

test('hash: khác thứ tự khoá vẫn ra cùng hash', () => {
  const a = { title: 'X', lang: 'PHP', code: ['a', 'b'] };
  const b = { code: ['a', 'b'], lang: 'PHP', title: 'X' };
  assert.strictEqual(contentHash(a), contentHash(b));
});

test('hash: khác thứ tự phần tử mảng ra hash khác', () => {
  /* Thứ tự dòng code và thứ tự option là một phần nội dung, không được chuẩn hoá đi. */
  assert.notStrictEqual(contentHash({ code: ['a', 'b'] }), contentHash({ code: ['b', 'a'] }));
});

test('hash: canonicalJson bỏ qua field undefined', () => {
  assert.strictEqual(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});
