'use strict';

/* Validator Incident.
 * Ràng buộc gốc: README.md:55-57 và js/games/incident.js:83,133,156-158.
 *
 * Ràng buộc đáng chú ý nhất là "tổng cost của các action key phải nằm trong budget".
 * Không có nó thì AI sinh được kịch bản mà người chơi không thể lấy hết manh mối
 * quyết định dù chơi tối ưu — keyBonus vĩnh viễn không đạt tối đa và ngân sách hết
 * trước khi tới bước chọn nguyên nhân.
 */

const {
  isPlainObject,
  isNonEmptyString,
  isPositiveInt,
  checkKeys,
  requireString,
  requireArray,
  countFlag,
  requireOptionalBoolean,
  result
} = require('./shared');

const SCHEMA = {
  required: ['title', 'severity', 'budget', 'brief', 'actions', 'causes'],
  optional: []
};
const ACTION_SCHEMA = { required: ['id', 'label', 'cost', 'result'], optional: ['key'] };
const CAUSE_SCHEMA = { required: ['t', 'why'], optional: ['correct'] };

function validateActions(actions, budget, errors) {
  const seenIds = new Set();
  let keyCostTotal = 0;
  let keyCount = 0;

  actions.forEach((action, i) => {
    const path = `payload.actions[${i}]`;
    if (!checkKeys(action, ACTION_SCHEMA, path, errors)) return;

    requireString(action, 'label', path, errors);
    requireString(action, 'result', path, errors);

    if (!isNonEmptyString(action.id)) {
      errors.push(`${path}.id: phải là chuỗi không rỗng`);
    } else if (seenIds.has(action.id)) {
      errors.push(`${path}.id: "${action.id}" bị trùng với action khác`);
    } else {
      seenIds.add(action.id);
    }

    if (!isPositiveInt(action.cost)) {
      errors.push(`${path}.cost: phải là số nguyên > 0 (phút mô phỏng)`);
    }

    if (!requireOptionalBoolean(action, 'key', path, errors)) return;
    if (action.key === true) {
      keyCount += 1;
      if (isPositiveInt(action.cost)) keyCostTotal += action.cost;
    }
  });

  if (keyCount === 0) {
    errors.push('payload.actions: cần tối thiểu 1 action có key=true, đang có 0');
  }

  if (isPositiveInt(budget) && keyCostTotal > budget) {
    errors.push(
      `payload.actions: tổng cost của action key là ${keyCostTotal} phút, vượt budget ${budget} — ` +
        'người chơi không thể lấy hết manh mối dù chơi tối ưu'
    );
  }
}

function validateCauses(causes, errors) {
  causes.forEach((cause, i) => {
    const path = `payload.causes[${i}]`;
    if (!checkKeys(cause, CAUSE_SCHEMA, path, errors)) return;
    requireString(cause, 't', path, errors);
    requireString(cause, 'why', path, errors);
    requireOptionalBoolean(cause, 'correct', path, errors);
  });

  const correctCount = countFlag(causes, 'correct');
  if (correctCount !== 1) {
    errors.push(`payload.causes: cần đúng 1 cause có correct=true, đang có ${correctCount}`);
  }
}

function validate(payload) {
  const errors = [];
  if (!checkKeys(payload, SCHEMA, 'payload', errors)) return result(errors);

  for (const key of ['title', 'severity', 'brief']) {
    requireString(payload, key, 'payload', errors);
  }

  if (!isPositiveInt(payload.budget)) {
    errors.push('payload.budget: phải là số nguyên > 0 (phút mô phỏng)');
  }

  if (requireArray(payload, 'actions', 'payload', errors, 3)) {
    validateActions(payload.actions, payload.budget, errors);
  }
  if (requireArray(payload, 'causes', 'payload', errors, 2)) {
    validateCauses(payload.causes, errors);
  }

  return result(errors);
}

module.exports = { validate, SCHEMA };
