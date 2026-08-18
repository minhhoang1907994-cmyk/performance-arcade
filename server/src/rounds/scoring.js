'use strict';

/* Điểm lượt chơi — BR-04.
 *
 * Cả 4 game đều quy về "trung bình điểm các item không bị void", vì 2 game một item
 * thì trung bình của một số chính là số đó. Clamp 0-100 port từ js/app.js:238.
 */

function computeRoundScore(itemPoints) {
  /* Mọi item đều bị void (chỉ xảy ra với 2 game một item khi nội dung bị ẩn):
   * không có gì để chấm. BR-04 nói rõ là GIỮ điểm cũ, không ghi 0 — ghi 0 nghĩa là
   * người chơi bị trừ điểm vì lỗi nội dung của hệ thống. */
  if (itemPoints.length === 0) return { score: null, voidedContent: true };

  const total = itemPoints.reduce((sum, points) => sum + points, 0);
  const average = Math.round(total / itemPoints.length);
  return { score: Math.min(100, Math.max(0, average)), voidedContent: false };
}

module.exports = { computeRoundScore };
