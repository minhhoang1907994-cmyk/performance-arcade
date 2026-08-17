'use strict';

/* Điểm vào duy nhất của validator.
 *
 * BR-06: một item chỉ vào pool khi qua validator, hash không trùng, và chưa đầy
 * hạn ngạch. Hàm này lo phần đầu tiên. Hai phần còn lại thuộc tầng repository vì
 * chúng cần truy vấn DB.
 */

const { GAME_IDS } = require('../categories');

const VALIDATORS = {
  'bug-hunt': require('./bug-hunt'),
  'spec-detective': require('./spec-detective'),
  'prod-roulette': require('./prod-roulette'),
  incident: require('./incident')
};

function validateContent(gameId, payload) {
  const validator = VALIDATORS[gameId];
  if (!validator) {
    return { ok: false, errors: [`game_id: "${gameId}" không thuộc ${GAME_IDS.join(', ')}`] };
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, errors: ['payload: phải là object'] };
  }
  return validator.validate(payload);
}

module.exports = { validateContent, VALIDATORS };
