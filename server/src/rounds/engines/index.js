'use strict';

/* Registry engine — mỗi game một máy trạng thái step, thuần hàm, không đụng DB.
 *
 * Tách như vậy để test được luật chơi mà không cần Postgres, và để tầng service chỉ
 * còn lo transaction chứ không lẫn luật của 4 game.
 */

const { GAME_IDS } = require('../../content/categories');

const ENGINES = {
  'bug-hunt': require('./bug-hunt'),
  'spec-detective': require('./spec-detective'),
  'prod-roulette': require('./prod-roulette'),
  incident: require('./incident')
};

function getEngine(gameId) {
  return ENGINES[gameId] || null;
}

module.exports = { ENGINES, getEngine, GAME_IDS };
