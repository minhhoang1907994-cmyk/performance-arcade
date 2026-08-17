'use strict';

/* Nghiệp vụ auth.
 *
 * BR-12: KHÔNG có luồng gửi email nào ở P1 — không verify, không quên mật khẩu.
 * Người dùng mất mật khẩu thì admin đặt lại qua adminResetPassword().
 */

const { AppError } = require('../http/errors');
const { hashPassword, verifyPassword } = require('./password');
const jwt = require('./jwt');
const repo = require('./repository');

const EMAIL_MAX = 254;
const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 60;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

/* Kiểm dạng email ở mức thực dụng: có đúng một @, hai phía không rỗng, không khoảng
 * trắng. Không dùng regex RFC 5322 — nó dài, khó đọc, và vẫn không thay được việc
 * xác nhận địa chỉ có thật (mà P1 thì không gửi mail nên cũng không xác nhận được). */
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) return null;
  if (/\s/.test(email)) return null;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  if (!email.slice(at + 1).includes('.')) return null;
  return email;
}

function assertRegisterInput({ email, displayName, password }) {
  const details = {};

  const normalized = normalizeEmail(email);
  if (!normalized) details.email = 'Địa chỉ email không hợp lệ';

  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
    details.display_name = `Tên hiển thị cần ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} ký tự`;
  }

  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    details.password = `Mật khẩu cần ${PASSWORD_MIN}–${PASSWORD_MAX} ký tự`;
  }

  if (Object.keys(details).length > 0) throw new AppError('VALIDATION_ERROR', { details });
  return { email: normalized, displayName: name, password };
}

function issueAccessToken(config, user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role },
    config.jwtSecret,
    config.accessTokenTtlSeconds
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role
  };
}

function createAuthService({ pool, config }) {
  async function register(input, meta = {}) {
    const { email, displayName, password } = assertRegisterInput(input);

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await repo.createUser(pool, { email, displayName, passwordHash });
    } catch (err) {
      /* 23505 = unique_violation. Dựa vào constraint DB thay vì SELECT trước rồi INSERT,
       * vì kiểm trước vẫn có khe race giữa hai request đăng ký cùng email. */
      if (err.code === '23505') throw new AppError('EMAIL_TAKEN');
      throw err;
    }

    return issueSession(user, meta);
  }

  async function login({ email, password }, meta = {}) {
    const normalized = normalizeEmail(email);
    const user = normalized ? await repo.findUserByEmail(pool, normalized) : null;

    /* Luôn chạy verifyPassword, kể cả khi không tìm thấy user, để thời gian phản hồi
     * không tiết lộ email nào đã tồn tại. */
    const stored = user ? user.password_hash : DUMMY_HASH;
    const ok = await verifyPassword(typeof password === 'string' ? password : '', stored);

    if (!user || !ok) throw new AppError('UNAUTHORIZED');
    if (!user.is_active) throw new AppError('ACCOUNT_DISABLED');

    return issueSession(user, meta);
  }

  async function issueSession(user, meta) {
    const refreshToken = repo.newRefreshToken();
    await repo.createSession(pool, {
      userId: user.id,
      token: refreshToken,
      ttlSeconds: config.refreshTokenTtlSeconds,
      userAgent: meta.userAgent,
      ip: meta.ip
    });

    return {
      user: publicUser(user),
      accessToken: issueAccessToken(config, user),
      expiresIn: config.accessTokenTtlSeconds,
      refreshToken
    };
  }

  /* Xoay vòng refresh token mỗi lần dùng (A3): session cũ bị thu hồi, cấp session mới.
   * Nhờ vậy một refresh token chỉ dùng được đúng một lần. */
  async function refresh(refreshToken, meta = {}) {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new AppError('UNAUTHORIZED');
    }

    const session = await repo.findLiveSession(pool, refreshToken);
    if (!session) throw new AppError('UNAUTHORIZED');

    const user = await repo.findUserById(pool, session.user_id);
    if (!user) throw new AppError('UNAUTHORIZED');
    if (!user.is_active) throw new AppError('ACCOUNT_DISABLED');

    await repo.revokeSession(pool, session.id);
    return issueSession(user, meta);
  }

  async function logout(refreshToken) {
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) return;
    const session = await repo.findLiveSession(pool, refreshToken);
    if (session) await repo.revokeSession(pool, session.id);
  }

  async function getUserById(id) {
    return repo.findUserById(pool, id);
  }

  /* BR-12: đường duy nhất để lấy lại tài khoản khi quên mật khẩu. */
  async function adminResetPassword(targetUserId, newPassword) {
    if (typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN) {
      throw new AppError('VALIDATION_ERROR', {
        details: { password: `Mật khẩu cần tối thiểu ${PASSWORD_MIN} ký tự` }
      });
    }
    const user = await repo.findUserById(pool, targetUserId);
    if (!user) throw new AppError('NOT_FOUND');

    await repo.updatePasswordHash(pool, user.id, await hashPassword(newPassword));
    const revoked = await repo.revokeAllSessions(pool, user.id);
    return { user: publicUser(user), revoked_sessions: revoked };
  }

  return { register, login, refresh, logout, getUserById, adminResetPassword };
}

/* Hash giả để nhánh "email không tồn tại" vẫn tốn đúng công sức scrypt như nhánh thật.
 * Mật khẩu gốc là một chuỗi random không ai biết, nên không bao giờ verify thành công. */
const DUMMY_HASH =
  'scrypt$16384$8$1$' +
  'AAAAAAAAAAAAAAAAAAAAAA$' +
  'JDF2rTbbYhaz9nOTh3cKMPeCEyzsW8kFuBLZI96jOSvyOEBZUM6vRIL2cyzeMkNQPUxTBGjEA6IHTAiXvV7esA';

module.exports = { createAuthService, normalizeEmail, publicUser };
