'use strict';

/* Danh sách loại bug của Bug Hunt.
 *
 * Đây là bảng tham chiếu, KHÔNG nằm trong content_items.payload — spec section 5.3
 * quy định `categories` gửi cho client lấy từ đây chứ không lấy từ item, để payload
 * của item không mang sẵn đáp án.
 *
 * Giữ dạng hằng số phía server cùng lý do với GAME_CATALOG (spec 4.1): không có UI
 * nào sửa danh sách này, và mỗi lần thêm loại bug đều kéo theo sửa prompt sinh đề.
 *
 * Nguồn gốc: data/bug-hunt.data.js:5-15 của bản v1.
 */

const BUG_HUNT_CATEGORIES = [
  { id: 'sql-injection', label: 'SQL Injection' },
  { id: 'xss', label: 'XSS / Không escape output' },
  { id: 'n-plus-1', label: 'N+1 Query' },
  { id: 'null-check', label: 'Thiếu null / empty check' },
  { id: 'race-condition', label: 'Race condition' },
  { id: 'logic-error', label: 'Sai logic nghiệp vụ' },
  { id: 'resource-leak', label: 'Rò rỉ tài nguyên' },
  { id: 'authorization', label: 'Thiếu kiểm tra quyền' },
  { id: 'type-coercion', label: 'So sánh / ép kiểu sai' },
  { id: 'error-handling', label: 'Nuốt lỗi / error handling sai' }
];

const BUG_HUNT_CATEGORY_IDS = new Set(BUG_HUNT_CATEGORIES.map((c) => c.id));

const GAME_IDS = ['bug-hunt', 'spec-detective', 'prod-roulette', 'incident'];

module.exports = { BUG_HUNT_CATEGORIES, BUG_HUNT_CATEGORY_IDS, GAME_IDS };
