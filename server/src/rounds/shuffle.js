'use strict';

/* Xáo thứ tự lựa chọn và ánh xạ ngược (BR-08, BR-17).
 *
 * order_map[i] = chỉ số GỐC trong payload của lựa chọn hiển thị ở vị trí i.
 * Chỉ lưu thứ tự, không lưu nội dung — nội dung dựng lại từ content_items.payload.
 *
 * Lý do phải xáo phía server: bản v1 học được bằng smoke test rằng để nguyên thứ tự
 * trong data thì đáp án tốt luôn nằm đầu, bấm bừa vẫn 95-100 điểm.
 */

function shuffledIndexes(length, rng = Math.random) {
  const out = [];
  for (let i = 0; i < length; i += 1) out.push(i);
  /* Fisher-Yates, duyệt từ cuối về đầu. */
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/* Danh sách KHÔNG được xáo (segment của Spec Detective là văn bản spec, đảo thứ tự
 * là đọc không ra nghĩa) vẫn có order_map để mọi step dùng chung một cách ánh xạ. */
function identityIndexes(length) {
  const out = [];
  for (let i = 0; i < length; i += 1) out.push(i);
  return out;
}

function toOriginalIndex(orderMap, displayIndex) {
  if (!Number.isInteger(displayIndex)) return null;
  if (displayIndex < 0 || displayIndex >= orderMap.length) return null;
  return orderMap[displayIndex];
}

function toDisplayIndex(orderMap, originalIndex) {
  return orderMap.indexOf(originalIndex);
}

module.exports = { shuffledIndexes, identityIndexes, toOriginalIndex, toDisplayIndex };
