'use strict';

/* Engine PROD Roulette — 1 item / lượt, số step biến thiên theo độ dài đường đi.
 *
 * Công thức port từ js/games/prod-roulette.js:86 (BR-18):
 *   max(0, 100 − Σ risk)
 *
 * `next` của option KHÔNG BAO GIỜ được gửi cho client (spec 5.3): nó lộ cấu trúc đồ
 * thị, từ đó đoán được nhánh nào dẫn thẳng tới node end xấu.
 */

const { AppError } = require('../../http/errors');
const { isPlainObject } = require('../../content/validators/shared');
const { shuffledIndexes, toOriginalIndex } = require('../shuffle');

const ITEMS_PER_ROUND = 1;
const KIND = 'prod-roulette.node';

function startItem(payload, rng) {
  const node = payload.nodes[payload.start];
  return {
    itemState: { node_id: payload.start, risk_total: 0 },
    step: {
      kind: KIND,
      orderMap: shuffledIndexes(node.options.length, rng),
      timeLimitSeconds: null
    }
  };
}

function buildPrompt({ payload, step, itemState, isItemStart }) {
  const node = payload.nodes[itemState.node_id];
  const prompt = {
    text: node.text,
    options: step.orderMap.map((original, index) => ({ index, t: node.options[original].t }))
  };
  /* Bối cảnh kịch bản chỉ gửi ở step đầu — các step sau người chơi đã đọc rồi. */
  if (isItemStart) {
    prompt.title = payload.title;
    prompt.brief = payload.brief;
  }
  return prompt;
}

function parseChoice({ step, choice }) {
  if (!isPlainObject(choice)) {
    throw new AppError('VALIDATION_ERROR', { details: 'choice: phải là object' });
  }
  const original = toOriginalIndex(step.orderMap, choice.option_index);
  if (original === null) {
    throw new AppError('INVALID_CHOICE', { details: 'choice.option_index: ngoài phạm vi' });
  }
  return { optionOriginal: original };
}

function applyChoice({ payload, step, choice, itemState, rng }) {
  const node = payload.nodes[itemState.node_id];
  const option = node.options[choice.optionOriginal];
  const riskTotal = itemState.risk_total + option.risk;
  const nextNode = payload.nodes[option.next];

  /* Chỉ trả feedback và risk của ĐÚNG option đã chọn (spec 5.3) — gửi cả bảng thì
   * người chơi đọc được nước đi tốt nhất mà không cần suy nghĩ ở lần chơi sau. */
  const reveal = { feedback: option.feedback, risk: option.risk };
  const effect = { points_delta: -option.risk, risk: option.risk, choice_text: option.t };
  const nextItemState = { node_id: option.next, risk_total: riskTotal };

  if (nextNode.end === true) {
    reveal.tone = nextNode.tone;
    reveal.title = nextNode.title;
    reveal.verdict = nextNode.verdict;
    effect.end = { tone: nextNode.tone, title: nextNode.title, verdict: nextNode.verdict };
    return {
      reveal,
      effect,
      itemState: nextItemState,
      nextStep: null,
      itemPoints: Math.max(0, 100 - riskTotal)
    };
  }

  return {
    reveal,
    effect,
    itemState: nextItemState,
    nextStep: {
      kind: KIND,
      orderMap: shuffledIndexes(nextNode.options.length, rng),
      timeLimitSeconds: null
    },
    itemPoints: null
  };
}

function buildSummary(items) {
  const item = items[0];
  const lastEffect = item.steps[item.steps.length - 1].effect || {};
  const end = lastEffect.end || { tone: '', title: 'Kết thúc kịch bản', verdict: '' };

  return {
    breakdown: item.steps.map((stepRow, i) => {
      const effect = stepRow.effect || {};
      return {
        ok: effect.risk === 0,
        text: `Bước ${i + 1} · ${effect.choice_text}`,
        pts: -effect.risk
      };
    }),
    notes: [
      {
        /* `mixed` của data không phải tone hợp lệ của màn kết quả — js/games/prod-roulette.js:92
         * quy về chuỗi rỗng. */
        tone: end.tone === 'good' ? 'good' : end.tone === 'bad' ? 'bad' : '',
        title: end.title,
        body: end.verdict
      }
    ]
  };
}

module.exports = {
  id: 'prod-roulette',
  itemsPerRound: ITEMS_PER_ROUND,
  startItem,
  buildPrompt,
  parseChoice,
  applyChoice,
  buildSummary
};
