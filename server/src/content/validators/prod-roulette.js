'use strict';

/* Validator PROD Roulette.
 * Ràng buộc gốc: README.md:51-53 và js/games/prod-roulette.js:60-90.
 *
 * Đây là validator phức tạp nhất vì payload là một ĐỒ THỊ, không phải danh sách.
 * Hai lỗi chí tử mà chỉ duyệt đồ thị mới bắt được:
 *  - option.next trỏ tới node không tồn tại  → game treo trắng màn hình
 *  - có chu trình không đi qua node end       → người chơi đi mãi không hết lượt
 */

const {
  isPlainObject,
  isNonEmptyString,
  isNonNegativeInt,
  checkKeys,
  requireString,
  requireArray,
  result
} = require('./shared');

const SCHEMA = { required: ['title', 'brief', 'start', 'nodes'], optional: [] };
const DECISION_SCHEMA = { required: ['text', 'options'], optional: [] };
const END_SCHEMA = { required: ['end', 'tone', 'title', 'verdict'], optional: [] };
const OPTION_SCHEMA = { required: ['t', 'risk', 'feedback', 'next'], optional: [] };
const TONES = new Set(['good', 'mixed', 'bad']);

function isEndNode(node) {
  return isPlainObject(node) && node.end === true;
}

function validateEndNode(node, path, errors) {
  if (!checkKeys(node, END_SCHEMA, path, errors)) return;
  requireString(node, 'title', path, errors);
  requireString(node, 'verdict', path, errors);
  if (!TONES.has(node.tone)) {
    errors.push(`${path}.tone: phải thuộc {good, mixed, bad}, đang là ${JSON.stringify(node.tone)}`);
  }
}

function validateDecisionNode(node, path, nodeIds, errors) {
  if (!checkKeys(node, DECISION_SCHEMA, path, errors)) return;
  requireString(node, 'text', path, errors);
  if (!requireArray(node, 'options', path, errors, 2)) return;

  node.options.forEach((opt, i) => {
    const optPath = `${path}.options[${i}]`;
    if (!checkKeys(opt, OPTION_SCHEMA, optPath, errors)) return;
    requireString(opt, 't', optPath, errors);
    requireString(opt, 'feedback', optPath, errors);
    if (!isNonNegativeInt(opt.risk)) {
      errors.push(`${optPath}.risk: phải là số nguyên >= 0`);
    }
    if (!isNonEmptyString(opt.next)) {
      errors.push(`${optPath}.next: phải là chuỗi không rỗng`);
    } else if (!nodeIds.has(opt.next)) {
      errors.push(`${optPath}.next: trỏ tới node "${opt.next}" không tồn tại`);
    }
  });
}

/* DFS phát hiện chu trình và xác nhận mọi nhánh kết thúc ở node end.
 * `onStack` là các node đang nằm trên đường đi hiện tại — gặp lại nghĩa là có chu trình.
 */
function walk(nodes, startId, errors) {
  const visited = new Set();
  const onStack = new Set();

  function dfs(id, trail) {
    if (onStack.has(id)) {
      errors.push(`payload.nodes: chu trình không đi qua node end — ${[...trail, id].join(' → ')}`);
      return;
    }
    if (visited.has(id)) return;

    const node = nodes[id];
    if (!node) {
      errors.push(`payload.nodes: node "${id}" được tham chiếu nhưng không tồn tại`);
      return;
    }

    visited.add(id);
    if (isEndNode(node)) return;

    if (!Array.isArray(node.options) || node.options.length === 0) {
      errors.push(`payload.nodes.${id}: node không phải end mà cũng không có option — nhánh chết`);
      return;
    }

    onStack.add(id);
    for (const opt of node.options) {
      if (isPlainObject(opt) && isNonEmptyString(opt.next)) {
        dfs(opt.next, [...trail, id]);
      }
    }
    onStack.delete(id);
  }

  dfs(startId, []);
  return visited;
}

function validate(payload) {
  const errors = [];
  if (!checkKeys(payload, SCHEMA, 'payload', errors)) return result(errors);

  requireString(payload, 'title', 'payload', errors);
  requireString(payload, 'brief', 'payload', errors);

  if (!isPlainObject(payload.nodes)) {
    errors.push('payload.nodes: phải là object map từ node id sang node');
    return result(errors);
  }

  const nodeIds = new Set(Object.keys(payload.nodes));
  if (nodeIds.size < 2) {
    errors.push(`payload.nodes: cần tối thiểu 2 node (1 quyết định + 1 end), đang có ${nodeIds.size}`);
  }

  if (!isNonEmptyString(payload.start)) {
    errors.push('payload.start: phải là chuỗi không rỗng');
  } else if (!nodeIds.has(payload.start)) {
    errors.push(`payload.start: trỏ tới node "${payload.start}" không tồn tại`);
  }

  for (const [id, node] of Object.entries(payload.nodes)) {
    const path = `payload.nodes.${id}`;
    if (!isPlainObject(node)) {
      errors.push(`${path}: phải là object`);
      continue;
    }
    if (isEndNode(node)) validateEndNode(node, path, errors);
    else validateDecisionNode(node, path, nodeIds, errors);
  }

  const endCount = Object.values(payload.nodes).filter(isEndNode).length;
  if (endCount === 0) {
    errors.push('payload.nodes: không có node nào có end=true — lượt chơi không bao giờ kết thúc');
  }

  if (nodeIds.has(payload.start)) {
    const visited = walk(payload.nodes, payload.start, errors);
    const unreachable = [...nodeIds].filter((id) => !visited.has(id));
    if (unreachable.length > 0) {
      errors.push(
        `payload.nodes: node không tới được từ start — ${unreachable.join(', ')} (nội dung chết)`
      );
    }
  }

  return result(errors);
}

module.exports = { validate, SCHEMA };
