-- DevLab Arcade v2 — migration khởi tạo
-- Theo docs/spec/devlab-arcade-v2.md v1.3 section 4.2 (9 bảng).
--
-- Thứ tự tạo bảng theo chiều phụ thuộc FK:
--   users → auth_sessions → generation_runs → content_items
--   → game_rounds → round_items → round_steps → content_reports → leaderboard_best
--
-- Chạy trên devlab_dev trước, chỉ đưa lên devlab_prod sau khi đã verify.

BEGIN;

-- citext: email không phân biệt hoa thường mà vẫn UNIQUE được.
-- gen_random_uuid() là hàm built-in từ PostgreSQL 13, không cần pgcrypto.
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- users

CREATE TABLE users (
    id            bigserial     PRIMARY KEY,
    email         citext        NOT NULL,
    display_name  varchar(60)   NOT NULL,
    password_hash text          NOT NULL,
    role          varchar(16)   NOT NULL DEFAULT 'player',
    is_active     boolean       NOT NULL DEFAULT true,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_role  CHECK (role IN ('player', 'admin'))
);

-- --------------------------------------------------------- auth_sessions

CREATE TABLE auth_sessions (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            bigint      NOT NULL,
    refresh_token_hash text        NOT NULL,
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz,
    user_agent         text,
    ip                 inet,
    created_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_auth_sessions_token UNIQUE (refresh_token_hash),
    CONSTRAINT fk_auth_sessions_user  FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id, revoked_at);

-- ------------------------------------------------------- generation_runs

CREATE TABLE generation_runs (
    id                  bigserial   PRIMARY KEY,
    game_id             varchar(24) NOT NULL,
    provider            varchar(24) NOT NULL DEFAULT 'gemini',
    model               varchar(64) NOT NULL,
    prompt_version      varchar(16) NOT NULL,
    requested           smallint    NOT NULL,
    accepted            smallint    NOT NULL DEFAULT 0,
    rejected_validator  smallint    NOT NULL DEFAULT 0,
    rejected_duplicate  smallint    NOT NULL DEFAULT 0,
    rejected_quota      smallint    NOT NULL DEFAULT 0,
    error               text,
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,

    CONSTRAINT ck_generation_runs_game CHECK (
        game_id IN ('bug-hunt', 'spec-detective', 'prod-roulette', 'incident')
    )
);

-- ---------------------------------------------------------- content_items

CREATE TABLE content_items (
    id                bigserial   PRIMARY KEY,
    game_id           varchar(24) NOT NULL,
    -- category/lang là NOT NULL DEFAULT '' chứ không nullable: `WHERE lang = NULL`
    -- không bao giờ khớp, nên nếu nullable thì đếm hạn ngạch (BR-06) luôn ra 0 với
    -- 3 game không dùng lang và hạn ngạch mất tác dụng hoàn toàn.
    category          varchar(40) NOT NULL DEFAULT '',
    lang              varchar(24) NOT NULL DEFAULT '',
    payload           jsonb       NOT NULL,
    content_hash      char(64)    NOT NULL,
    source            varchar(16) NOT NULL,
    status            varchar(16) NOT NULL DEFAULT 'active',
    generation_run_id bigint,
    served_count      integer     NOT NULL DEFAULT 0,
    report_count      integer     NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_content_items_hash UNIQUE (content_hash),
    CONSTRAINT ck_content_items_game CHECK (
        game_id IN ('bug-hunt', 'spec-detective', 'prod-roulette', 'incident')
    ),
    CONSTRAINT ck_content_items_source CHECK (source IN ('handwritten', 'ai')),
    CONSTRAINT ck_content_items_status CHECK (status IN ('active', 'hidden', 'rejected')),
    CONSTRAINT fk_content_items_run FOREIGN KEY (generation_run_id)
        REFERENCES generation_runs (id) ON DELETE SET NULL
);

CREATE INDEX idx_content_items_pool ON content_items (game_id, status);

CREATE INDEX idx_content_items_quota ON content_items (game_id, category, lang)
    WHERE status = 'active';

-- ------------------------------------------------------------ game_rounds

CREATE TABLE game_rounds (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          bigint,
    is_guest         boolean     NOT NULL DEFAULT false,
    guest_ip         inet,
    game_id          varchar(24) NOT NULL,
    status           varchar(16) NOT NULL DEFAULT 'in_progress',
    state            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    score            smallint,
    started_at       timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,

    CONSTRAINT ck_game_rounds_game CHECK (
        game_id IN ('bug-hunt', 'spec-detective', 'prod-roulette', 'incident')
    ),
    CONSTRAINT ck_game_rounds_status CHECK (
        status IN ('in_progress', 'finished', 'abandoned')
    ),
    CONSTRAINT ck_game_rounds_score CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
    CONSTRAINT ck_game_rounds_owner CHECK (
        (is_guest = true AND user_id IS NULL) OR (is_guest = false AND user_id IS NOT NULL)
    ),
    CONSTRAINT ck_game_rounds_guest_ip CHECK (
        (is_guest = false AND guest_ip IS NULL) OR is_guest = true
    ),
    CONSTRAINT fk_game_rounds_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

-- BR-10 ở tầng DB: một user chỉ có tối đa 1 round đang chơi.
-- Chặn race khi hai tab cùng POST /rounds (9.3) — INSERT thứ hai fail, không cần khoá ứng dụng.
CREATE UNIQUE INDEX uq_game_rounds_one_active ON game_rounds (user_id)
    WHERE status = 'in_progress' AND user_id IS NOT NULL;

CREATE INDEX idx_game_rounds_best ON game_rounds (user_id, game_id, score DESC)
    WHERE status = 'finished' AND is_guest = false;

-- Cron dọn round quá 2h (8.1) và round khách quá 24h (BR-16).
CREATE INDEX idx_game_rounds_cleanup ON game_rounds (status, last_activity_at);

-- ------------------------------------------------------------ round_items

CREATE TABLE round_items (
    id              bigserial   PRIMARY KEY,
    round_id        uuid        NOT NULL,
    item_seq        smallint    NOT NULL,
    content_item_id bigint      NOT NULL,
    points          smallint,
    voided          boolean     NOT NULL DEFAULT false,
    started_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,

    CONSTRAINT uq_round_items_seq UNIQUE (round_id, item_seq),
    CONSTRAINT ck_round_items_points CHECK (points IS NULL OR (points BETWEEN 0 AND 100)),
    CONSTRAINT fk_round_items_round FOREIGN KEY (round_id)
        REFERENCES game_rounds (id) ON DELETE CASCADE,
    -- RESTRICT: muốn bỏ một content item thì đặt status='hidden', không xoá.
    -- Xoá sẽ làm mất lịch sử chấm điểm của các round đã chơi.
    CONSTRAINT fk_round_items_content FOREIGN KEY (content_item_id)
        REFERENCES content_items (id) ON DELETE RESTRICT
);

CREATE INDEX idx_round_items_content ON round_items (content_item_id);

-- ------------------------------------------------------------ round_steps

CREATE TABLE round_steps (
    id                    bigserial   PRIMARY KEY,
    round_id              uuid        NOT NULL,
    round_item_id         bigint      NOT NULL,
    step_seq              smallint    NOT NULL,
    kind                  varchar(32) NOT NULL,
    -- order_map[i] = chỉ số gốc trong payload của lựa chọn hiển thị ở vị trí i (BR-17).
    -- Chỉ lưu thứ tự, KHÔNG lưu nội dung — nội dung dựng lại từ content_items.payload.
    order_map             smallint[]  NOT NULL DEFAULT '{}',
    content_snapshot_hash char(64)    NOT NULL,
    served_at             timestamptz NOT NULL DEFAULT now(),
    -- served_at + 60s với bug-hunt.identify; NULL với mọi step khác (BR-03a).
    expires_at            timestamptz,
    answered_at           timestamptz,
    choice                jsonb,
    effect                jsonb,

    CONSTRAINT uq_round_steps_seq UNIQUE (round_id, step_seq),
    CONSTRAINT fk_round_steps_round FOREIGN KEY (round_id)
        REFERENCES game_rounds (id) ON DELETE CASCADE,
    CONSTRAINT fk_round_steps_item FOREIGN KEY (round_item_id)
        REFERENCES round_items (id) ON DELETE CASCADE
);

-- Cron dọn round_steps quá 90 ngày (A8).
CREATE INDEX idx_round_steps_served ON round_steps (served_at);

-- -------------------------------------------------------- content_reports

CREATE TABLE content_reports (
    id              bigserial   PRIMARY KEY,
    content_item_id bigint      NOT NULL,
    user_id         bigint      NOT NULL,
    round_item_id   bigint,
    reason          varchar(32) NOT NULL,
    note            varchar(500),
    created_at      timestamptz NOT NULL DEFAULT now(),

    -- BR-14: mỗi user report một item tối đa một lần.
    CONSTRAINT uq_content_reports_once UNIQUE (content_item_id, user_id),
    CONSTRAINT ck_content_reports_reason CHECK (
        reason IN ('wrong_answer', 'ambiguous', 'duplicate', 'offensive', 'other')
    ),
    CONSTRAINT fk_content_reports_content FOREIGN KEY (content_item_id)
        REFERENCES content_items (id) ON DELETE CASCADE,
    CONSTRAINT fk_content_reports_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_content_reports_round_item FOREIGN KEY (round_item_id)
        REFERENCES round_items (id) ON DELETE SET NULL
);

-- ------------------------------------------------------- leaderboard_best

CREATE TABLE leaderboard_best (
    user_id       bigint      NOT NULL,
    game_id       varchar(24) NOT NULL,
    best_score    smallint    NOT NULL,
    -- Nullable là BẮT BUỘC: ON DELETE SET NULL trên cột NOT NULL sẽ fail lúc runtime,
    -- đúng vào cron dọn round hằng ngày. Cột này chỉ để truy vết, mất giá trị không
    -- ảnh hưởng best_score.
    best_round_id uuid,
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_leaderboard_best PRIMARY KEY (user_id, game_id),
    CONSTRAINT ck_leaderboard_best_score CHECK (best_score BETWEEN 0 AND 100),
    CONSTRAINT ck_leaderboard_best_game CHECK (
        game_id IN ('bug-hunt', 'spec-detective', 'prod-roulette', 'incident')
    ),
    CONSTRAINT fk_leaderboard_best_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_leaderboard_best_round FOREIGN KEY (best_round_id)
        REFERENCES game_rounds (id) ON DELETE SET NULL
);

CREATE INDEX idx_leaderboard_best_game ON leaderboard_best (game_id, best_score DESC);

COMMIT;
