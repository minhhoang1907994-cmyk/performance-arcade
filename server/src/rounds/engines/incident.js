'use strict';

/* Engine Incident Escape Room — 1 item / lượt, n step `incident.action` rồi 1 step
 * `incident.cause`.
 *
 * Công thức port từ js/games/incident.js:156-158 (BR-18):
 *   (correct ? 70 : 0) + (correct ? round(20 × remain / budget) : 0) + round(10 × keysFound / totalKeys)
 *
 * `remain` là PHÚT MÔ PHỎNG (budget − Σ cost), không phải đồng hồ thật (BR-03b).
 * Người chơi ngồi nghĩ 10 phút thật cũng không mất điểm thời gian ở game này.
 *
 * `key` không bao giờ gửi cho client, kể cả sau khi chơi xong (spec 5.3) — biết action
 * nào là manh mối quyết định thì lần chơi sau chỉ cần bấm đúng những action đó.
 */

const { AppError } = require('../../http/errors');
const { isPlainObject } = require('../../content/validators/shared');
const { shuffledIndexes, toOriginalIndex, toDisplayIndex } = require('../shuffle');

const ITEMS_PER_ROUND = 1;
const ACTION = 'incident.action';
const CAUSE = 'incident.cause';

function startItem(payload, rng) {
  return {
    itemState: { taken_action_ids: [], spent: 0 },
    step: {
      /* Xáo một lần lúc vào kịch bản rồi giữ nguyên thứ tự đó cho mọi step action:
       * manh mối quyết định không phải lúc nào cũng nằm đầu danh sách, nhưng danh sách
       * nhảy vị trí sau mỗi lần bấm thì không đọc được. */
      kind: ACTION,
      orderMap: shuffledIndexes(payload.actions.length, rng),
      timeLimitSeconds: null
    }
  };
}

function buildPrompt({ payload, step, itemState, isItemStart }) {
  if (step.kind === CAUSE) {
    return {
      causes: step.orderMap.map((original, index) => ({ index, t: payload.causes[original].t }))
    };
  }

  const taken = new Set(itemState.taken_action_ids);
  const prompt = {
    title: payload.title,
    severity: payload.severity,
    budget: { total: payload.budget, remaining: payload.budget - itemState.spent },
    actions: step.orderMap.map((original) => {
      const action = payload.actions[original];
      return { id: action.id, label: action.label, cost: action.cost, taken: taken.has(action.id) };
    }),
    can_declare_cause: true
  };
  if (isItemStart) prompt.brief = payload.brief;
  return prompt;
}

function parseChoice({ payload, step, itemState, choice }) {
  if (!isPlainObject(choice)) {
    throw new AppError('VALIDATION_ERROR', { details: 'choice: phải là object' });
  }

  if (step.kind === CAUSE) {
    const original = toOriginalIndex(step.orderMap, choice.option_index);
    if (original === null) {
      throw new AppError('INVALID_CHOICE', { details: 'choice.option_index: ngoài phạm vi' });
    }
    return { causeOriginal: original };
  }

  const declare = choice.declare_cause === true;
  const hasActionId = choice.action_id !== undefined && choice.action_id !== null;

  if (declare === hasActionId) {
    throw new AppError('INVALID_CHOICE', {
      details: 'choice: cần đúng một trong hai — action_id hoặc declare_cause'
    });
  }
  if (declare) return { declareCause: true };

  const original = payload.actions.findIndex((action) => action.id === choice.action_id);
  if (original === -1) {
    throw new AppError('INVALID_CHOICE', { details: 'choice.action_id: không có trong kịch bản' });
  }
  /* Mỗi action chỉ làm được một lần (js/games/incident.js:133 disable nút đã dùng).
   * Không chặn thì gọi lặp là trừ sạch ngân sách, hoặc tệ hơn — cộng dồn manh mối. */
  if (itemState.taken_action_ids.indexOf(choice.action_id) !== -1) {
    throw new AppError('INVALID_CHOICE', { details: 'choice.action_id: action này đã thực hiện' });
  }
  return { actionOriginal: original };
}

function applyAction({ payload, step, choice, itemState, rng }) {
  if (choice.declareCause) {
    return {
      reveal: {},
      effect: { points_delta: 0, declared_cause: true },
      itemState,
      nextStep: {
        kind: CAUSE,
        orderMap: shuffledIndexes(payload.causes.length, rng),
        timeLimitSeconds: null
      },
      itemPoints: null
    };
  }

  const action = payload.actions[choice.actionOriginal];
  const nextItemState = {
    taken_action_ids: itemState.taken_action_ids.concat([action.id]),
    spent: itemState.spent + action.cost
  };

  return {
    reveal: { result: action.result },
    effect: { points_delta: 0, action_id: action.id, cost: action.cost },
    itemState: nextItemState,
    /* Giữ nguyên order_map để danh sách action không đổi chỗ giữa các bước. */
    nextStep: { kind: ACTION, orderMap: step.orderMap.slice(), timeLimitSeconds: null },
    itemPoints: null
  };
}

function applyCause({ payload, step, choice, itemState }) {
  const cause = payload.causes[choice.causeOriginal];
  const correct = cause.correct === true;

  const taken = new Set(itemState.taken_action_ids);
  const keyActions = payload.actions.filter((action) => action.key === true);
  const totalKeys = keyActions.length;
  const keysFound = keyActions.filter((action) => taken.has(action.id)).length;

  const remaining = Math.max(0, payload.budget - itemState.spent);
  const timeBonus = correct ? Math.round((20 * remaining) / payload.budget) : 0;
  const keyBonus = Math.round((10 * keysFound) / totalKeys);
  const points = (correct ? 70 : 0) + timeBonus + keyBonus;

  const correctOriginal = payload.causes.findIndex((c) => c.correct === true);

  return {
    reveal: {
      correct_index: toDisplayIndex(step.orderMap, correctOriginal),
      explanations: step.orderMap.map((original, index) => ({
        index,
        why: payload.causes[original].why
      }))
    },
    effect: {
      points_delta: points,
      correct,
      time_bonus: timeBonus,
      key_bonus: keyBonus,
      keys_found: keysFound,
      total_keys: totalKeys,
      remaining,
      spent: itemState.spent
    },
    itemState,
    nextStep: null,
    itemPoints: points
  };
}

function applyChoice(context) {
  return context.step.kind === CAUSE ? applyCause(context) : applyAction(context);
}

function buildSummary(items) {
  const item = items[0];
  const effect = item.steps[item.steps.length - 1].effect || {};
  const correct = Boolean(effect.correct);
  const keysFound = effect.keys_found || 0;
  const totalKeys = effect.total_keys || 0;

  return {
    breakdown: [
      { ok: correct, text: 'Xác định đúng nguyên nhân gốc', pts: correct ? 70 : 0 },
      {
        ok: (effect.time_bonus || 0) > 0,
        text: `Thời gian còn lại: ${effect.remaining || 0} phút`,
        pts: effect.time_bonus || 0
      },
      {
        ok: keysFound === totalKeys,
        text: `Manh mối quyết định: ${keysFound}/${totalKeys}`,
        pts: effect.key_bonus || 0
      }
    ],
    notes: [
      {
        tone: correct ? 'good' : 'bad',
        title: correct ? 'Tìm đúng nguyên nhân' : 'Kết luận sai',
        body: correct
          ? `Bạn tìm được ${keysFound}/${totalKeys} manh mối quyết định. ` +
            'Điều tra theo bằng chứng, không theo linh cảm, là thứ giúp không phải xử lý lại sự cố này lần nữa.'
          : `Bạn tìm được ${keysFound}/${totalKeys} manh mối quyết định trước khi kết luận. ` +
            'Đọc lại phần giải thích ở màn trước: manh mối bạn bỏ qua chính là chỗ chỉ thẳng vào nguyên nhân thật.'
      }
    ]
  };
}

module.exports = {
  id: 'incident',
  itemsPerRound: ITEMS_PER_ROUND,
  startItem,
  buildPrompt,
  parseChoice,
  applyChoice,
  buildSummary
};
