'use strict';

/* Helper dùng chung cho 4 validator.
 *
 * Nguyên tắc: validator là lớp kiểm soát chất lượng DUY NHẤT (quyết định N3 —
 * publish thẳng, không human review). Vì vậy mặc định là chặt: field lạ cũng bị
 * từ chối, vì nó nghĩa là AI không bám schema, và theo allowlist BR-02 field đó
 * cũng sẽ bị lược khi gửi client — giữ lại chỉ tạo dữ liệu chết.
 */

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/* Kiểm field bắt buộc / field lạ cho một object. */
function checkKeys(obj, { required, optional }, path, errors) {
  if (!isPlainObject(obj)) {
    errors.push(`${path}: phải là object`);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in obj)) errors.push(`${path}.${key}: thiếu field bắt buộc`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: field lạ, không có trong schema`);
  }
  return true;
}

function requireString(obj, key, path, errors) {
  if (key in obj && !isNonEmptyString(obj[key])) {
    errors.push(`${path}.${key}: phải là chuỗi không rỗng`);
  }
}

function requireArray(obj, key, path, errors, minLength) {
  if (!(key in obj)) return false;
  if (!Array.isArray(obj[key])) {
    errors.push(`${path}.${key}: phải là mảng`);
    return false;
  }
  if (obj[key].length < minLength) {
    errors.push(`${path}.${key}: cần tối thiểu ${minLength} phần tử, đang có ${obj[key].length}`);
    return false;
  }
  return true;
}

/* Đếm số phần tử có flag === true. Dùng cho các ràng buộc "đúng một". */
function countFlag(list, flag) {
  return list.filter((x) => isPlainObject(x) && x[flag] === true).length;
}

/* Flag boolean tuỳ chọn: vắng mặt = false.
 *
 * Chấp nhận cả `false` tường minh lẫn việc bỏ hẳn field. Bank viết tay của v1 dùng
 * cả hai kiểu — `correct: false` / `good: false` viết rõ, còn `key` và `a` chỉ xuất
 * hiện khi true — nên validator không được ép một kiểu duy nhất.
 */
function requireOptionalBoolean(obj, key, path, errors) {
  if (key in obj && typeof obj[key] !== 'boolean') {
    errors.push(`${path}.${key}: phải là true hoặc false`);
    return false;
  }
  return true;
}

function flagIsTrue(obj, key) {
  return isPlainObject(obj) && obj[key] === true;
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

module.exports = {
  isPlainObject,
  isNonEmptyString,
  isPositiveInt,
  isNonNegativeInt,
  checkKeys,
  requireString,
  requireArray,
  countFlag,
  requireOptionalBoolean,
  flagIsTrue,
  result
};
