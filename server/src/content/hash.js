'use strict';

/* Content hash — nguồn duy nhất cho content_items.content_hash (BR-06).
 * Chuẩn hoá payload trước khi băm để hai payload giống nhau về nội dung nhưng
 * khác thứ tự khoá vẫn ra cùng một hash.
 */

const crypto = require('node:crypto');

/* Sắp xếp khoá của object theo thứ tự lexicographic, đệ quy.
 * Mảng GIỮ NGUYÊN thứ tự — với Bug Hunt thứ tự dòng code là một phần nội dung,
 * với PROD Roulette thứ tự option ảnh hưởng cách đọc kịch bản.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalize(value[key]);
  }
  return out;
}

function canonicalJson(payload) {
  return JSON.stringify(canonicalize(payload));
}

function contentHash(payload) {
  return crypto.createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

module.exports = { canonicalize, canonicalJson, contentHash };
