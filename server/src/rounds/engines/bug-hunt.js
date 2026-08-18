'use strict';

/* Engine Bug Hunt — 8 item / lượt, mỗi item đúng 1 step, đồng hồ thật 60s.
 *
 * Công thức port nguyên từ js/games/bug-hunt.js:136-137 (BR-18):
 *   50 nếu đúng dòng + 30 nếu đúng loại + round(20 × remain / 60) chỉ khi cả hai đúng.
 *
 * Danh sách dòng code và danh sách loại bug KHÔNG xáo: dòng code phải giữ thứ tự để
 * đọc được, còn loại bug lấy từ bảng tham chiếu cố định (spec 5.3) nên thứ tự của nó
 * không phải manh mối đáp án.
 */

const { AppError } = require('../../http/errors');
const { BUG_HUNT_CATEGORIES, BUG_HUNT_CATEGORY_IDS } = require('../../content/categories');
const { isPlainObject } = require('../../content/validators/shared');

const ITEMS_PER_ROUND = 8;
const SECONDS_PER_STEP = 60;
const KIND = 'bug-hunt.identify';

function startItem() {
  return {
    itemState: {},
    step: { kind: KIND, orderMap: [], timeLimitSeconds: SECONDS_PER_STEP }
  };
}

function buildPrompt({ payload }) {
  return {
    lang: payload.lang,
    title: payload.title,
    code: payload.code.slice(),
    /* categories lấy từ bảng tham chiếu, KHÔNG từ item — payload của item mang sẵn
     * `category` là đáp án. */
    categories: BUG_HUNT_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))
  };
}

function parseChoice({ payload, choice }) {
  if (!isPlainObject(choice)) {
    throw new AppError('VALIDATION_ERROR', { details: 'choice: phải là object' });
  }

  /* Cả hai được phép null: đó là trường hợp client tự báo hết giờ (8.2 điều kiện A). */
  const line = choice.line === undefined || choice.line === null ? null : choice.line;
  const categoryId =
    choice.category_id === undefined || choice.category_id === null ? null : choice.category_id;

  if (line !== null) {
    if (!Number.isInteger(line) || line < 1 || line > payload.code.length) {
      throw new AppError('INVALID_CHOICE', {
        details: `choice.line: phải là số nguyên trong 1..${payload.code.length}`
      });
    }
  }
  if (categoryId !== null && !BUG_HUNT_CATEGORY_IDS.has(categoryId)) {
    throw new AppError('INVALID_CHOICE', {
      details: 'choice.category_id: không có trong BUG_HUNT_CATEGORIES'
    });
  }

  return { line, categoryId };
}

function applyChoice({ payload, choice, elapsedSeconds, expired }) {
  /* Hết giờ thì lựa chọn bị VỨT BỎ chứ không chấm (BR-03a) — không thì người chơi
   * tra Google xong mới bấm và giới hạn 60 giây mất ý nghĩa. */
  const line = expired ? null : choice.line;
  const categoryId = expired ? null : choice.categoryId;

  const lineOk = line !== null && payload.answerLines.indexOf(line) !== -1;
  const catOk = categoryId !== null && categoryId === payload.category;

  const remain = expired ? 0 : Math.max(0, SECONDS_PER_STEP - elapsedSeconds);
  const speed = lineOk && catOk ? Math.round((20 * remain) / SECONDS_PER_STEP) : 0;
  const points = (lineOk ? 50 : 0) + (catOk ? 30 : 0) + speed;

  return {
    reveal: {
      answerLines: payload.answerLines.slice(),
      category: payload.category,
      explanation: payload.explanation,
      fix: payload.fix
    },
    effect: {
      points_delta: points,
      elapsed_seconds: elapsedSeconds,
      line_ok: lineOk,
      category_ok: catOk,
      expired: Boolean(expired)
    },
    itemState: {},
    nextStep: null,
    itemPoints: points
  };
}

function buildSummary(items) {
  const breakdown = items.map((item, i) => {
    const effect = item.steps[0].effect || {};
    return {
      ok: Boolean(effect.line_ok && effect.category_ok),
      text: `Câu ${i + 1} · ${item.payload.title} (${item.payload.lang})`,
      pts: item.points
    };
  });

  const missedCat = items.filter((item) => {
    const effect = item.steps[0].effect || {};
    return effect.line_ok && !effect.category_ok;
  }).length;

  const notes = [];
  if (missedCat >= 2) {
    notes.push({
      tone: '',
      title: 'Bạn nhìn ra bug nhưng gọi sai tên',
      body:
        `Có ${missedCat} câu bạn chỉ đúng dòng nhưng phân loại sai. Gọi đúng tên loại bug quan trọng ` +
        'khi viết comment review — người nhận cần biết đây là lỗi bảo mật hay lỗi hiệu năng để ưu tiên sửa.'
    });
  }

  return { breakdown, notes };
}

module.exports = {
  id: 'bug-hunt',
  itemsPerRound: ITEMS_PER_ROUND,
  startItem,
  buildPrompt,
  parseChoice,
  applyChoice,
  buildSummary
};
