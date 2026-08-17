'use strict';

/* Validator Spec Detective.
 * Ràng buộc gốc: README.md:47-49 và js/games/spec-detective.js:121,150.
 *
 * Hai ràng buộc quyết định tính chơi được:
 *  - phải có ít nhất một segment mơ hồ, nếu không totalAmb = 0 và công thức
 *    60 * found / totalAmb chia cho 0
 *  - followUp phải có ĐÚNG một option good, nếu không việc chấm 40 điểm vô nghĩa
 */

const {
  isPlainObject,
  isNonEmptyString,
  checkKeys,
  requireString,
  requireArray,
  countFlag,
  requireOptionalBoolean,
  result
} = require('./shared');

const SCHEMA = { required: ['title', 'source', 'segments', 'followUp'], optional: [] };
const SEGMENT_SCHEMA = { required: ['t'], optional: ['a', 'r'] };
const FOLLOW_UP_SCHEMA = { required: ['question', 'options'], optional: [] };
const OPTION_SCHEMA = { required: ['t', 'why'], optional: ['good'] };

function validateSegments(segments, errors) {
  let ambiguousCount = 0;

  segments.forEach((seg, i) => {
    const path = `payload.segments[${i}]`;
    if (!checkKeys(seg, SEGMENT_SCHEMA, path, errors)) return;
    requireString(seg, 't', path, errors);

    if (!requireOptionalBoolean(seg, 'a', path, errors)) return;

    /* `r` bắt buộc với segment mơ hồ, TUỲ CHỌN với segment rõ ràng.
     *
     * Trên segment rõ ràng, `r` là lời giải thích riêng hiện ra khi người chơi bấm
     * nhầm (js/games/spec-detective.js:115 — `seg.r || 'Đoạn này đủ rõ…'`). Đây là
     * tính năng có chủ đích chứ không phải dữ liệu thừa: nó dạy người chơi vì sao
     * đoạn đó KHÔNG mơ hồ, thay cho câu mặc định chung chung.
     */
    if (seg.a === true) {
      ambiguousCount += 1;
      if (!isNonEmptyString(seg.r)) {
        errors.push(`${path}.r: segment mơ hồ bắt buộc có lý do không rỗng`);
      }
    } else if ('r' in seg && !isNonEmptyString(seg.r)) {
      errors.push(`${path}.r: nếu có thì phải là chuỗi không rỗng`);
    }
  });

  if (ambiguousCount === 0) {
    errors.push('payload.segments: cần tối thiểu 1 segment có a=true, đang có 0');
  }
}

function validateFollowUp(followUp, errors) {
  const path = 'payload.followUp';
  if (!checkKeys(followUp, FOLLOW_UP_SCHEMA, path, errors)) return;
  requireString(followUp, 'question', path, errors);

  if (!requireArray(followUp, 'options', path, errors, 2)) return;

  followUp.options.forEach((opt, i) => {
    const optPath = `${path}.options[${i}]`;
    if (!checkKeys(opt, OPTION_SCHEMA, optPath, errors)) return;
    requireString(opt, 't', optPath, errors);
    requireString(opt, 'why', optPath, errors);
    requireOptionalBoolean(opt, 'good', optPath, errors);
  });

  const goodCount = countFlag(followUp.options, 'good');
  if (goodCount !== 1) {
    errors.push(`${path}.options: cần đúng 1 option có good=true, đang có ${goodCount}`);
  }
}

function validate(payload) {
  const errors = [];
  if (!checkKeys(payload, SCHEMA, 'payload', errors)) return result(errors);

  requireString(payload, 'title', 'payload', errors);
  requireString(payload, 'source', 'payload', errors);

  if (requireArray(payload, 'segments', 'payload', errors, 2)) {
    validateSegments(payload.segments, errors);
  }
  if ('followUp' in payload && isPlainObject(payload.followUp)) {
    validateFollowUp(payload.followUp, errors);
  } else if ('followUp' in payload) {
    errors.push('payload.followUp: phải là object');
  }

  return result(errors);
}

module.exports = { validate, SCHEMA };
