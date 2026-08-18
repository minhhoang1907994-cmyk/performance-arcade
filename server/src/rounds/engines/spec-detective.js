'use strict';

/* Engine Spec Detective — 4 item / lượt, mỗi item 2 step, không có đồng hồ.
 *
 * step 1 `spec-detective.segments`   → chọn các cụm từ mơ hồ
 * step 2 `spec-detective.follow_up`  → chọn câu hỏi làm rõ đáng gửi nhất
 *
 * Công thức port từ js/games/spec-detective.js:121,150 (BR-18):
 *   max(0, round(60 × found / totalAmb) − 10 × falsePos) + 40 nếu chọn đúng followUp
 *
 * Segments KHÔNG xáo (đảo thứ tự thì đoạn spec đọc không ra nghĩa), options của
 * followUp thì BẮT BUỘC xáo theo BR-08.
 */

const { AppError } = require('../../http/errors');
const { isPlainObject } = require('../../content/validators/shared');
const { shuffledIndexes, identityIndexes, toOriginalIndex, toDisplayIndex } = require('../shuffle');

const ITEMS_PER_ROUND = 4;
const SEGMENTS = 'spec-detective.segments';
const FOLLOW_UP = 'spec-detective.follow_up';

/* Câu mặc định khi segment rõ ràng không có `r` riêng — js/games/spec-detective.js:115. */
const CLEAR_SEGMENT_REASON =
  'Đoạn này đủ rõ để viết được test case, không phải điểm mơ hồ.';

function startItem(payload) {
  return {
    itemState: { seg_points: 0 },
    step: {
      kind: SEGMENTS,
      orderMap: identityIndexes(payload.segments.length),
      timeLimitSeconds: null
    }
  };
}

function buildPrompt({ payload, step }) {
  if (step.kind === SEGMENTS) {
    return {
      title: payload.title,
      source: payload.source,
      segments: step.orderMap.map((original, index) => ({
        index,
        t: payload.segments[original].t
      }))
    };
  }

  return {
    question: payload.followUp.question,
    options: step.orderMap.map((original, index) => ({
      index,
      t: payload.followUp.options[original].t
    }))
  };
}

function parseChoice({ step, choice }) {
  if (!isPlainObject(choice)) {
    throw new AppError('VALIDATION_ERROR', { details: 'choice: phải là object' });
  }

  if (step.kind === SEGMENTS) {
    const raw = choice.segment_indexes;
    if (!Array.isArray(raw)) {
      throw new AppError('INVALID_CHOICE', { details: 'choice.segment_indexes: phải là mảng' });
    }
    /* Chọn trùng một segment hai lần không phải lỗi của người chơi (client có thể gửi
     * lặp), nhưng đếm hai lần thì trừ oan điểm — nên khử trùng thay vì từ chối. */
    const originals = new Set();
    for (const displayIndex of raw) {
      const original = toOriginalIndex(step.orderMap, displayIndex);
      if (original === null) {
        throw new AppError('INVALID_CHOICE', {
          details: `choice.segment_indexes: ${JSON.stringify(displayIndex)} ngoài phạm vi`
        });
      }
      originals.add(original);
    }
    return { pickedOriginals: originals };
  }

  const original = toOriginalIndex(step.orderMap, choice.option_index);
  if (original === null) {
    throw new AppError('INVALID_CHOICE', { details: 'choice.option_index: ngoài phạm vi' });
  }
  return { optionOriginal: original };
}

function applySegments({ payload, step, choice, itemState, rng }) {
  const picked = choice.pickedOriginals;
  let totalAmbiguous = 0;
  let found = 0;
  let falsePositives = 0;
  const ambiguousIndexes = [];
  const reasons = [];

  payload.segments.forEach((segment, original) => {
    const displayIndex = toDisplayIndex(step.orderMap, original);
    if (segment.a === true) {
      totalAmbiguous += 1;
      ambiguousIndexes.push(displayIndex);
      if (picked.has(original)) found += 1;
      reasons.push({ index: displayIndex, r: segment.r });
    } else if (picked.has(original)) {
      falsePositives += 1;
      reasons.push({ index: displayIndex, r: segment.r || CLEAR_SEGMENT_REASON });
    }
  });

  /* totalAmbiguous >= 1 do validator đảm bảo — không chia cho 0. */
  const segPoints = Math.max(
    0,
    Math.round((60 * found) / totalAmbiguous) - 10 * falsePositives
  );

  return {
    reveal: {
      ambiguous_indexes: ambiguousIndexes.slice().sort((a, b) => a - b),
      reasons: reasons.sort((a, b) => a.index - b.index)
    },
    effect: {
      points_delta: segPoints,
      found,
      total_ambiguous: totalAmbiguous,
      false_positives: falsePositives
    },
    itemState: { ...itemState, seg_points: segPoints },
    nextStep: {
      kind: FOLLOW_UP,
      orderMap: shuffledIndexes(payload.followUp.options.length, rng),
      timeLimitSeconds: null
    },
    itemPoints: null
  };
}

function applyFollowUp({ payload, step, choice, itemState }) {
  const options = payload.followUp.options;
  const chosen = options[choice.optionOriginal];
  const good = chosen.good === true;
  const followPoints = good ? 40 : 0;
  const goodOriginal = options.findIndex((option) => option.good === true);

  return {
    reveal: {
      good_index: toDisplayIndex(step.orderMap, goodOriginal),
      explanations: step.orderMap.map((original, index) => ({
        index,
        why: options[original].why
      }))
    },
    effect: { points_delta: followPoints, good },
    itemState,
    nextStep: null,
    itemPoints: (itemState.seg_points || 0) + followPoints
  };
}

function applyChoice(context) {
  return context.step.kind === SEGMENTS ? applySegments(context) : applyFollowUp(context);
}

function buildSummary(items) {
  return {
    breakdown: items.map((item, i) => ({
      /* Ngưỡng 70 lấy nguyên từ js/games/spec-detective.js:150. */
      ok: item.points >= 70,
      text: `Case ${i + 1} · ${item.payload.title}`,
      pts: item.points
    })),
    notes: [
      {
        tone: '',
        title: 'Cách dùng ngoài đời',
        body:
          'Tiêu chí nhận biết điểm mơ hồ: từ câu văn đó, bạn có viết được một test case pass/fail rõ ràng không. ' +
          'Không viết được thì đó là câu cần hỏi lại — và hỏi bằng văn bản (Q&A sheet, Backlog), không hỏi miệng.'
      }
    ]
  };
}

module.exports = {
  id: 'spec-detective',
  itemsPerRound: ITEMS_PER_ROUND,
  startItem,
  buildPrompt,
  parseChoice,
  applyChoice,
  buildSummary
};
