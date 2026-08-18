'use strict';

/* Unit test cho engine 4 game — thuần hàm, không cần Postgres.
 *
 * Dữ liệu dùng chính bank viết tay 24 mục của v1 (BỘ TEST VÀNG): nó đã chạy đúng
 * trong game v1 nên nếu engine chấm ra số khác công thức v1, lỗi nằm ở engine.
 */

const test = require('node:test');
const assert = require('node:assert');

const { extractLegacyContent } = require('../scripts/extract-legacy-content');
const { getEngine } = require('../src/rounds/engines');
const { computeRoundScore } = require('../src/rounds/scoring');
const { shuffledIndexes, toOriginalIndex, toDisplayIndex } = require('../src/rounds/shuffle');
const { AppError } = require('../src/http/errors');

/* RNG tất định để test lặp lại được. LCG của Numerical Recipes. */
function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const LEGACY = extractLegacyContent();
const payloadsOf = (gameId) => LEGACY.filter((row) => row.game_id === gameId).map((r) => r.payload);

/* Duyệt đệ quy mọi khoá trong một object — dùng để khẳng định allowlist spec 5.3. */
function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}

function expectAppError(code, fn) {
  assert.throws(fn, (err) => err instanceof AppError && err.code === code);
}

/* ------------------------------------------------------------------ shuffle */

test('shuffle: order_map là hoán vị đầy đủ và ánh xạ hai chiều khớp nhau', () => {
  const rng = seededRng(7);
  const orderMap = shuffledIndexes(6, rng);

  assert.deepStrictEqual([...orderMap].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  for (let display = 0; display < orderMap.length; display += 1) {
    const original = toOriginalIndex(orderMap, display);
    assert.strictEqual(toDisplayIndex(orderMap, original), display);
  }
  assert.strictEqual(toOriginalIndex(orderMap, 6), null);
  assert.strictEqual(toOriginalIndex(orderMap, -1), null);
  assert.strictEqual(toOriginalIndex(orderMap, '0'), null);
});

test('shuffle: thực sự đảo thứ tự chứ không trả lại danh sách gốc', () => {
  const rng = seededRng(3);
  /* Danh sách 10 phần tử: xác suất hoán vị đồng nhất là 1/10! nên nếu đây fail thì
   * là do shuffle không chạy chứ không phải xui. */
  assert.notDeepStrictEqual(shuffledIndexes(10, rng), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

/* ----------------------------------------------------------------- bug-hunt */

test('bug-hunt: công thức điểm khớp js/games/bug-hunt.js:136-137', () => {
  const engine = getEngine('bug-hunt');
  const payload = payloadsOf('bug-hunt')[0];
  const { step } = engine.startItem(payload, seededRng(1));

  assert.strictEqual(step.timeLimitSeconds, 60);

  const perfect = engine.applyChoice({
    payload,
    step,
    choice: { line: payload.answerLines[0], categoryId: payload.category },
    itemState: {},
    elapsedSeconds: 0,
    expired: false
  });
  assert.strictEqual(perfect.itemPoints, 100, '50 + 30 + round(20 × 60/60)');

  const half = engine.applyChoice({
    payload,
    step,
    choice: { line: payload.answerLines[0], categoryId: payload.category },
    itemState: {},
    elapsedSeconds: 30,
    expired: false
  });
  assert.strictEqual(half.itemPoints, 90, '50 + 30 + round(20 × 30/60)');

  /* Sai một trong hai thì KHÔNG có điểm tốc độ — port nguyên từ v1. */
  const lineOnly = engine.applyChoice({
    payload,
    step,
    choice: { line: payload.answerLines[0], categoryId: null },
    itemState: {},
    elapsedSeconds: 0,
    expired: false
  });
  assert.strictEqual(lineOnly.itemPoints, 50);
});

test('bug-hunt: step quá hạn bị khoá cứng 0 điểm, lựa chọn bị vứt bỏ (BR-03a)', () => {
  const engine = getEngine('bug-hunt');
  const payload = payloadsOf('bug-hunt')[0];
  const { step } = engine.startItem(payload, seededRng(1));

  const outcome = engine.applyChoice({
    payload,
    step,
    /* Gửi đáp án hoàn toàn đúng nhưng muộn: vẫn phải 0 điểm, nếu không thì tra
     * Google xong mới bấm là ăn điểm tuyệt đối. */
    choice: { line: payload.answerLines[0], categoryId: payload.category },
    itemState: {},
    elapsedSeconds: 75,
    expired: true
  });

  assert.strictEqual(outcome.itemPoints, 0);
  assert.strictEqual(outcome.effect.line_ok, false);
  assert.strictEqual(outcome.effect.category_ok, false);
});

test('bug-hunt: prompt không mang theo đáp án (allowlist 5.3)', () => {
  const engine = getEngine('bug-hunt');
  const payload = payloadsOf('bug-hunt')[0];
  const { step } = engine.startItem(payload, seededRng(1));
  const prompt = engine.buildPrompt({ payload, step, itemState: {}, isItemStart: true });

  const keys = collectKeys(prompt);
  for (const forbidden of ['answerLines', 'category', 'explanation', 'fix']) {
    assert.ok(!keys.has(forbidden), `prompt không được chứa ${forbidden}`);
  }
  assert.deepStrictEqual(Object.keys(prompt).sort(), ['categories', 'code', 'lang', 'title']);
});

test('bug-hunt: choice ngoài phạm vi bị từ chối', () => {
  const engine = getEngine('bug-hunt');
  const payload = payloadsOf('bug-hunt')[0];
  const { step } = engine.startItem(payload, seededRng(1));
  const parse = (choice) => engine.parseChoice({ payload, step, itemState: {}, choice });

  expectAppError('INVALID_CHOICE', () => parse({ line: payload.code.length + 1 }));
  expectAppError('INVALID_CHOICE', () => parse({ line: 0 }));
  expectAppError('INVALID_CHOICE', () => parse({ category_id: 'khong-ton-tai' }));
  expectAppError('VALIDATION_ERROR', () => parse(undefined));

  /* Cả hai null là hợp lệ: client tự báo hết giờ (8.2 điều kiện A). */
  assert.deepStrictEqual(parse({ line: null, category_id: null }), {
    line: null,
    categoryId: null
  });
});

/* ---------------------------------------------------------- spec-detective */

test('spec-detective: công thức điểm khớp js/games/spec-detective.js:121,150', () => {
  const engine = getEngine('spec-detective');
  const payload = payloadsOf('spec-detective')[0];
  const started = engine.startItem(payload, seededRng(11));

  const ambiguous = payload.segments
    .map((seg, i) => (seg.a === true ? i : -1))
    .filter((i) => i !== -1);
  const clear = payload.segments.map((seg, i) => (seg.a === true ? -1 : i)).filter((i) => i !== -1);

  const allFound = engine.applyChoice({
    payload,
    step: started.step,
    choice: engine.parseChoice({
      payload,
      step: started.step,
      itemState: started.itemState,
      choice: { segment_indexes: ambiguous.map((i) => toDisplayIndex(started.step.orderMap, i)) }
    }),
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(12)
  });
  assert.strictEqual(allFound.effect.points_delta, 60, 'tìm hết điểm mơ hồ = 60');
  assert.strictEqual(allFound.itemPoints, null, 'chưa xong item, còn step follow_up');

  const withFalsePositive = engine.applyChoice({
    payload,
    step: started.step,
    choice: engine.parseChoice({
      payload,
      step: started.step,
      itemState: started.itemState,
      choice: {
        segment_indexes: [...ambiguous, clear[0]].map((i) =>
          toDisplayIndex(started.step.orderMap, i)
        )
      }
    }),
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(12)
  });
  assert.strictEqual(withFalsePositive.effect.points_delta, 50, 'chọn nhầm 1 lần trừ 10');

  /* Chọn đúng followUp cộng 40 → tổng 100. */
  const followStep = allFound.nextStep;
  const goodOriginal = payload.followUp.options.findIndex((o) => o.good === true);
  const final = engine.applyChoice({
    payload,
    step: followStep,
    choice: engine.parseChoice({
      payload,
      step: followStep,
      itemState: allFound.itemState,
      choice: { option_index: toDisplayIndex(followStep.orderMap, goodOriginal) }
    }),
    itemState: allFound.itemState,
    elapsedSeconds: 0,
    expired: false
  });
  assert.strictEqual(final.itemPoints, 100);
  assert.strictEqual(final.reveal.good_index, toDisplayIndex(followStep.orderMap, goodOriginal));
});

test('spec-detective: prompt không lộ segment nào mơ hồ trước khi trả lời', () => {
  const engine = getEngine('spec-detective');
  const payload = payloadsOf('spec-detective')[0];
  const started = engine.startItem(payload, seededRng(11));
  const prompt = engine.buildPrompt({
    payload,
    step: started.step,
    itemState: started.itemState,
    isItemStart: true
  });

  const keys = collectKeys(prompt);
  assert.ok(!keys.has('a'), 'segments không được mang cờ a');
  assert.ok(!keys.has('r'), 'segments không được mang lý do r');
  assert.strictEqual(prompt.segments.length, payload.segments.length);
});

test('spec-detective: follow_up không lộ option nào đúng trước khi trả lời', () => {
  const engine = getEngine('spec-detective');
  const payload = payloadsOf('spec-detective')[0];
  const started = engine.startItem(payload, seededRng(11));
  const outcome = engine.applyChoice({
    payload,
    step: started.step,
    choice: { pickedOriginals: new Set() },
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(5)
  });

  const prompt = engine.buildPrompt({
    payload,
    step: outcome.nextStep,
    itemState: outcome.itemState,
    isItemStart: false
  });
  const keys = collectKeys(prompt);
  assert.ok(!keys.has('good'), 'không được gửi cờ good');
  assert.ok(!keys.has('why'), 'không được gửi giải thích why trước khi chọn');
});

/* ----------------------------------------------------------- prod-roulette */

test('prod-roulette: đi hết kịch bản và chấm max(0, 100 − Σ risk)', () => {
  const engine = getEngine('prod-roulette');
  const payload = payloadsOf('prod-roulette')[0];
  const rng = seededRng(21);

  let started = engine.startItem(payload, rng);
  let step = started.step;
  let itemState = started.itemState;
  let riskSum = 0;
  let outcome = null;
  let guard = 0;

  while (guard < 50) {
    guard += 1;
    const node = payload.nodes[itemState.node_id];
    /* Luôn chọn option rủi ro thấp nhất để kết quả tất định. */
    const cheapest = node.options.reduce(
      (best, opt, i) => (opt.risk < node.options[best].risk ? i : best),
      0
    );
    riskSum += node.options[cheapest].risk;

    outcome = engine.applyChoice({
      payload,
      step,
      choice: { optionOriginal: cheapest },
      itemState,
      elapsedSeconds: 0,
      expired: false,
      rng
    });
    itemState = outcome.itemState;
    if (!outcome.nextStep) break;
    step = outcome.nextStep;
  }

  assert.ok(outcome.itemPoints !== null, 'kịch bản phải kết thúc');
  assert.strictEqual(outcome.itemPoints, Math.max(0, 100 - riskSum));
  assert.ok(outcome.reveal.verdict, 'node end phải trả verdict');
});

test('prod-roulette: prompt không lộ cấu trúc đồ thị và rủi ro của option', () => {
  const engine = getEngine('prod-roulette');
  const payload = payloadsOf('prod-roulette')[0];
  const started = engine.startItem(payload, seededRng(21));
  const prompt = engine.buildPrompt({
    payload,
    step: started.step,
    itemState: started.itemState,
    isItemStart: true
  });

  const keys = collectKeys(prompt);
  for (const forbidden of ['next', 'risk', 'feedback', 'nodes']) {
    assert.ok(!keys.has(forbidden), `prompt không được chứa ${forbidden}`);
  }
  assert.ok(prompt.brief, 'step đầu có brief');

  /* Step sau không lặp lại bối cảnh. */
  const outcome = engine.applyChoice({
    payload,
    step: started.step,
    choice: { optionOriginal: 0 },
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(22)
  });
  if (outcome.nextStep) {
    const next = engine.buildPrompt({
      payload,
      step: outcome.nextStep,
      itemState: outcome.itemState,
      isItemStart: false
    });
    assert.strictEqual(next.brief, undefined);
  }
});

/* ----------------------------------------------------------------- incident */

test('incident: công thức điểm khớp js/games/incident.js:156-158', () => {
  const engine = getEngine('incident');
  const payload = payloadsOf('incident')[0];
  const rng = seededRng(31);

  const started = engine.startItem(payload, rng);
  let step = started.step;
  let itemState = started.itemState;

  /* Làm hết action key rồi kết luận đúng — trường hợp chơi tối ưu. */
  const keyActions = payload.actions.filter((a) => a.key === true);
  for (const action of keyActions) {
    const outcome = engine.applyChoice({
      payload,
      step,
      choice: engine.parseChoice({ payload, step, itemState, choice: { action_id: action.id } }),
      itemState,
      elapsedSeconds: 0,
      expired: false,
      rng
    });
    itemState = outcome.itemState;
    step = outcome.nextStep;
  }

  const declared = engine.applyChoice({
    payload,
    step,
    choice: engine.parseChoice({ payload, step, itemState, choice: { declare_cause: true } }),
    itemState,
    elapsedSeconds: 0,
    expired: false,
    rng
  });
  assert.strictEqual(declared.nextStep.kind, 'incident.cause');

  const correctOriginal = payload.causes.findIndex((c) => c.correct === true);
  const final = engine.applyChoice({
    payload,
    step: declared.nextStep,
    choice: engine.parseChoice({
      payload,
      step: declared.nextStep,
      itemState: declared.itemState,
      choice: { option_index: toDisplayIndex(declared.nextStep.orderMap, correctOriginal) }
    }),
    itemState: declared.itemState,
    elapsedSeconds: 0,
    expired: false
  });

  const spent = keyActions.reduce((sum, a) => sum + a.cost, 0);
  const remaining = Math.max(0, payload.budget - spent);
  const expected =
    70 + Math.round((20 * remaining) / payload.budget) + Math.round((10 * keyActions.length) / keyActions.length);
  assert.strictEqual(final.itemPoints, expected);
  assert.strictEqual(final.effect.keys_found, keyActions.length);
});

test('incident: ngân sách là phút mô phỏng, không phải đồng hồ thật (BR-03b)', () => {
  const engine = getEngine('incident');
  const payload = payloadsOf('incident')[0];
  const started = engine.startItem(payload, seededRng(31));
  const correctOriginal = payload.causes.findIndex((c) => c.correct === true);

  const declared = engine.applyChoice({
    payload,
    step: started.step,
    choice: { declareCause: true },
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(32)
  });

  const grade = (elapsedSeconds) =>
    engine.applyChoice({
      payload,
      step: declared.nextStep,
      choice: { causeOriginal: correctOriginal },
      itemState: declared.itemState,
      elapsedSeconds,
      expired: false
    }).itemPoints;

  /* Ngồi nghĩ 1 giây hay 1 tiếng đồng hồ thật đều ra cùng một điểm. */
  assert.strictEqual(grade(1), grade(3600));
});

test('incident: không cho lặp lại một action đã thực hiện', () => {
  const engine = getEngine('incident');
  const payload = payloadsOf('incident')[0];
  const started = engine.startItem(payload, seededRng(31));
  const first = payload.actions[0];

  const outcome = engine.applyChoice({
    payload,
    step: started.step,
    choice: engine.parseChoice({
      payload,
      step: started.step,
      itemState: started.itemState,
      choice: { action_id: first.id }
    }),
    itemState: started.itemState,
    elapsedSeconds: 0,
    expired: false,
    rng: seededRng(33)
  });

  expectAppError('INVALID_CHOICE', () =>
    engine.parseChoice({
      payload,
      step: outcome.nextStep,
      itemState: outcome.itemState,
      choice: { action_id: first.id }
    })
  );
  expectAppError('INVALID_CHOICE', () =>
    engine.parseChoice({
      payload,
      step: outcome.nextStep,
      itemState: outcome.itemState,
      choice: { action_id: first.id, declare_cause: true }
    })
  );
  expectAppError('INVALID_CHOICE', () =>
    engine.parseChoice({ payload, step: outcome.nextStep, itemState: outcome.itemState, choice: {} })
  );
});

test('incident: prompt không bao giờ lộ action nào là manh mối quyết định', () => {
  const engine = getEngine('incident');
  const payload = payloadsOf('incident')[0];
  const started = engine.startItem(payload, seededRng(31));
  const prompt = engine.buildPrompt({
    payload,
    step: started.step,
    itemState: started.itemState,
    isItemStart: true
  });

  const keys = collectKeys(prompt);
  assert.ok(!keys.has('key'), 'không được gửi cờ key');
  assert.ok(!keys.has('result'), 'không được gửi result của action chưa làm');
  assert.strictEqual(prompt.budget.remaining, payload.budget);
  assert.strictEqual(prompt.can_declare_cause, true);
});

/* ------------------------------------------------------------------ scoring */

test('scoring: trung bình, làm tròn và clamp 0-100', () => {
  assert.deepStrictEqual(computeRoundScore([100, 90, 80]), { score: 90, voidedContent: false });
  assert.deepStrictEqual(computeRoundScore([0]), { score: 0, voidedContent: false });
  assert.deepStrictEqual(computeRoundScore([100, 100]), { score: 100, voidedContent: false });
  /* Điểm item vượt 100 không xảy ra với công thức hiện tại, nhưng clamp vẫn phải giữ
   * để một công thức sai không bao giờ ghi được số ngoài khoảng vào DB. */
  assert.deepStrictEqual(computeRoundScore([120, 120]), { score: 100, voidedContent: false });
  /* BR-04: mọi item bị void thì KHÔNG chấm 0, trả null để tầng trên giữ điểm cũ. */
  assert.deepStrictEqual(computeRoundScore([]), { score: null, voidedContent: true });
});

/* ------------------------------------------- mọi item trong bank đều chơi được */

test('mọi item trong bank viết tay đều mở được step đầu tiên', () => {
  for (const row of LEGACY) {
    const engine = getEngine(row.game_id);
    const started = engine.startItem(row.payload, seededRng(99));
    assert.ok(started.step.kind.startsWith(row.game_id), row.game_id);
    const prompt = engine.buildPrompt({
      payload: row.payload,
      step: started.step,
      itemState: started.itemState,
      isItemStart: true
    });
    assert.ok(prompt && typeof prompt === 'object');
  }
});
