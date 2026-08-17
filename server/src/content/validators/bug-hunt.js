'use strict';

/* Validator Bug Hunt.
 * Ràng buộc gốc: README.md:30-45 và js/games/bug-hunt.js:134-147.
 * Field `level` đã bị bỏ theo quyết định N6 — payload còn `level` là AI bám schema cũ.
 */

const { BUG_HUNT_CATEGORY_IDS } = require('../categories');
const {
  isNonEmptyString,
  checkKeys,
  requireString,
  requireArray,
  result
} = require('./shared');

const SCHEMA = {
  required: ['lang', 'title', 'code', 'answerLines', 'category', 'explanation', 'fix'],
  optional: []
};

function validate(payload) {
  const errors = [];
  if (!checkKeys(payload, SCHEMA, 'payload', errors)) return result(errors);

  for (const key of ['lang', 'title', 'explanation', 'fix']) {
    requireString(payload, key, 'payload', errors);
  }

  /* code: mảng chuỗi, giữ nguyên cả dòng rỗng vì đó là một phần của snippet */
  let codeLength = 0;
  if (requireArray(payload, 'code', 'payload', errors, 1)) {
    codeLength = payload.code.length;
    payload.code.forEach((line, i) => {
      if (typeof line !== 'string') errors.push(`payload.code[${i}]: phải là chuỗi`);
    });
  }

  /* answerLines: đánh số từ 1, phải nằm trong phạm vi số dòng thật của snippet.
   * Đây là lỗi AI hay mắc nhất — sinh code 10 dòng rồi trỏ đáp án vào dòng 99.
   */
  if (requireArray(payload, 'answerLines', 'payload', errors, 1)) {
    const seen = new Set();
    payload.answerLines.forEach((line, i) => {
      if (!Number.isInteger(line)) {
        errors.push(`payload.answerLines[${i}]: phải là số nguyên`);
        return;
      }
      if (line < 1 || (codeLength > 0 && line > codeLength)) {
        errors.push(
          `payload.answerLines[${i}]: dòng ${line} nằm ngoài phạm vi 1..${codeLength} của code`
        );
      }
      if (seen.has(line)) errors.push(`payload.answerLines: dòng ${line} bị lặp`);
      seen.add(line);
    });
  }

  /* category phải khớp bảng tham chiếu — nếu không, chip loại bug sẽ không bao giờ
   * chọn đúng được và người chơi mất trắng 30 điểm dù đọc ra bug.
   */
  if ('category' in payload) {
    if (!isNonEmptyString(payload.category)) {
      errors.push('payload.category: phải là chuỗi không rỗng');
    } else if (!BUG_HUNT_CATEGORY_IDS.has(payload.category)) {
      errors.push(
        `payload.category: "${payload.category}" không có trong BUG_HUNT_CATEGORIES`
      );
    }
  }

  return result(errors);
}

module.exports = { validate, SCHEMA };
