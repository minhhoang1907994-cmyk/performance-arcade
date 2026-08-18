# DevLab Arcade v2 — Specification

## 1. Tổng quan (Overview)

- **Mục đích**: Chuyển DevLab Arcade từ web app static (điểm lưu `localStorage`, mở `file://` là chạy) sang ứng dụng client-server có tài khoản, chấm điểm phía server, bảng xếp hạng toàn công ty và ngân hàng câu hỏi do AI sinh tự động.
- **Actor**: Player (nhân viên công ty), Guest (khách chưa đăng nhập), Admin (chủ project), System (cron sinh đề)
- **Priority**: High
- **Phase**: Spec này bao P1–P3. P4 (UI pixel-art) tách spec riêng — xem mục 21
- **Ngày soạn**: 2026-08-17
- **Version**: 1.4
- **Input**: `docs/clarify/clarify_devlab-arcade-v2.md`

## 2. User Story

> As a **developer trong công ty**, I want to **chơi 4 game rèn kỹ năng bằng tài khoản của mình và thấy thứ hạng của mình so với đồng nghiệp**, so that **việc luyện tập có động lực cạnh tranh và tôi theo dõi được tiến bộ của bản thân qua thời gian**.

> As a **admin**, I want to **ngân hàng câu hỏi tự bổ sung bằng AI mà không tốn phí**, so that **nội dung không cạn sau vài lượt chơi và tôi không phải ngồi viết tay từng câu**.

## 3. Actors & Permissions

| Actor | Quyền | Điều kiện |
|---|---|---|
| Guest | read (hub, danh sách game, leaderboard) | Không cần đăng nhập |
| Guest | play (round có `is_guest = true`, **không** vào leaderboard, tự xoá sau 24h) | Bật cờ `ALLOW_ANONYMOUS_PLAY` — xem BR-16 |
| Player | play + ghi điểm + xem lịch sử của mình | Đã đăng nhập |
| Player | report một content item là sai | Đã đăng nhập, chỉ report item mình vừa gặp |
| Admin | ẩn/khôi phục content item, xem generation log, reset mật khẩu người dùng | `users.role = 'admin'` |
| System (cron) | tạo content item, dọn round quá hạn, dọn item `rejected` | Chạy trong process server, không qua HTTP |

## 4. Entity Schema

### 4.1 Entities bị ảnh hưởng

| Entity | Thao tác | Ghi chú |
|---|---|---|
| `users` | CREATE / READ / UPDATE | New table |
| `auth_sessions` | CREATE / READ / DELETE | New table |
| `content_items` | CREATE / READ / UPDATE / DELETE | New table — thay thế `data/*.js` |
| `game_rounds` | CREATE / READ / UPDATE | New table — giữ state của lượt đang chơi |
| `round_items` | CREATE / READ / UPDATE | New table |
| `round_steps` | CREATE / READ / UPDATE | New table — từng bước tương tác, giữ `served_at` và thứ tự đã xáo |
| `content_reports` | CREATE / READ | New table |
| `generation_runs` | CREATE / READ | New table |
| `leaderboard_best` | CREATE / READ / UPDATE | New table — cache best-score, cập nhật bằng UPSERT (section 15) |

Toàn bộ là bảng mới — project hiện không có DB. **Không có bảng `games`**: metadata 4 game (`icon`, `name`, `tagline`, `skill`, `duration`) là hằng số phía server (`GAME_CATALOG`), vì không có UI nào sửa chúng và chúng gắn liền với code của từng game.

### 4.2 Schema chi tiết

**`users`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `email` | citext | NO | | UNIQUE | Định danh đăng nhập |
| `display_name` | varchar(60) | NO | | | Tên hiển thị trên leaderboard |
| `password_hash` | text | NO | | | bcrypt/argon2 |
| `role` | varchar(16) | NO | `'player'` | CHECK IN ('player','admin') | |
| `is_active` | boolean | NO | `true` | | Admin khoá tài khoản gian lận |
| `created_at` | timestamptz | NO | `now()` | | |
| `updated_at` | timestamptz | NO | `now()` | | |

Indexes: `uq_users_email` UNIQUE on `(email)`

**Bootstrap admin**: migration tạo 1 user `role = 'admin'` từ biến môi trường `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD`. Nếu email đã tồn tại thì nâng quyền thay vì tạo mới. Không có endpoint HTTP nào tạo admin.

**`auth_sessions`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK | |
| `user_id` | bigint | NO | | FK → `users.id` | |
| `refresh_token_hash` | text | NO | | UNIQUE | Chỉ lưu hash, không lưu token gốc |
| `expires_at` | timestamptz | NO | | | |
| `revoked_at` | timestamptz | YES | `null` | | |
| `user_agent` | text | YES | | | Audit |
| `ip` | inet | YES | | | Audit |
| `created_at` | timestamptz | NO | `now()` | | |

Indexes: `idx_auth_sessions_user` on `(user_id, revoked_at)`

Foreign Keys: `fk_auth_sessions_user`: `user_id` → `users.id` (CASCADE)

**`content_items`** (new) — ngân hàng nội dung cho cả 4 game

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `game_id` | varchar(24) | NO | | CHECK IN ('bug-hunt','spec-detective','prod-roulette','incident') | Khớp `id` trong `window.DevLabGames` |
| `category` | varchar(40) | NO | `''` | | Bug Hunt: khớp `BUG_HUNT_CATEGORIES[].id`. 3 game còn lại: chủ đề nghiệp vụ. `''` = chưa phân loại |
| `lang` | varchar(24) | NO | `''` | | Chỉ Bug Hunt dùng. `''` với 3 game còn lại |
| `payload` | jsonb | NO | | | Nội dung game-specific — xem 4.4 |
| `content_hash` | char(64) | NO | | UNIQUE | SHA-256 của payload đã chuẩn hoá — chặn trùng y hệt |
| `source` | varchar(16) | NO | | CHECK IN ('handwritten','ai') | |
| `status` | varchar(16) | NO | `'active'` | CHECK IN ('active','hidden','rejected') | `rejected` = fail validator; `hidden` = bị report hoặc admin ẩn |
| `generation_run_id` | bigint | YES | | FK → `generation_runs.id` | Null với `handwritten` |
| `served_count` | integer | NO | `0` | | Tăng 1 mỗi khi item được gán vào một `round_items` (kể cả round khách). Dùng để phát hiện item bị bốc lệch so với phần còn lại của pool |
| `report_count` | integer | NO | `0` | | Ngưỡng tự ẩn |
| `created_at` | timestamptz | NO | `now()` | | |

Indexes:
- `uq_content_items_hash` UNIQUE on `(content_hash)`
- `idx_content_items_pool` on `(game_id, status)` — truy vấn bốc đề
- `idx_content_items_quota` on `(game_id, category, lang)` WHERE `status = 'active'` — đếm hạn ngạch

> **`category` và `lang` là NOT NULL DEFAULT `''`** thay vì nullable. Lý do: `WHERE lang = NULL` không bao giờ khớp trong SQL, nên nếu để nullable thì đếm hạn ngạch (BR-06) sẽ luôn ra 0 cho 3 game không dùng `lang` và hạn ngạch mất tác dụng hoàn toàn.

**Chú thích thiết kế**: `docs/clarify/clarify_devlab-arcade-v2.md` mục 6 ghi "4 cấu trúc khác nhau hoàn toàn — không gộp chung một bảng được". Điều đó đúng với schema **quan hệ thuần**; ở đây dùng `jsonb` cho phần game-specific và giữ cột chung cho phần cross-cutting (hạn ngạch, dedup, status, report). Validator vẫn tách riêng theo `game_id`.

**`game_rounds`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | PK | |
| `user_id` | bigint | YES | `null` | FK → `users.id` | Null khi `is_guest = true` |
| `is_guest` | boolean | NO | `false` | | Round khách — không vào leaderboard, cron xoá sau 24h |
| `guest_ip` | inet | YES | | | Chỉ dùng để rate limit round khách |
| `game_id` | varchar(24) | NO | | | |
| `status` | varchar(16) | NO | `'in_progress'` | CHECK IN ('in_progress','finished','abandoned') | |
| `state` | jsonb | NO | `'{}'` | | State quyền lực của lượt đang chơi — xem 4.3 |
| `score` | smallint | YES | `null` | CHECK 0–100 | Chỉ có giá trị khi `finished` |
| `started_at` | timestamptz | NO | `now()` | | |
| `last_activity_at` | timestamptz | NO | `now()` | | Cron dọn round quá 2h |
| `finished_at` | timestamptz | YES | | | |

Constraints:
- `ck_game_rounds_owner`: `(is_guest = true AND user_id IS NULL) OR (is_guest = false AND user_id IS NOT NULL)`
- `ck_game_rounds_guest_ip`: `(is_guest = false AND guest_ip IS NULL) OR is_guest = true`
- `uq_game_rounds_one_active` UNIQUE on `(user_id)` WHERE `status = 'in_progress' AND user_id IS NOT NULL` — enforce BR-10 ở tầng DB, chặn race khi hai tab cùng mở round

Indexes: `idx_game_rounds_best` on `(user_id, game_id, score DESC)` WHERE `status = 'finished' AND is_guest = false`

**`round_items`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `round_id` | uuid | NO | | FK → `game_rounds.id` (CASCADE) | |
| `item_seq` | smallint | NO | | | Thứ tự item trong lượt, từ 1 |
| `content_item_id` | bigint | NO | | FK → `content_items.id` (RESTRICT) | |
| `points` | smallint | YES | | CHECK 0–100 | Điểm của item, tính khi item hoàn tất |
| `voided` | boolean | NO | `false` | | `true` khi content item bị ẩn → loại khỏi tính điểm |
| `started_at` | timestamptz | NO | `now()` | | |
| `completed_at` | timestamptz | YES | | | |

Indexes: `uq_round_items_seq` UNIQUE on `(round_id, item_seq)`

> Với game 1 item/lượt (PROD Roulette, Incident): `round_items.points` bằng đúng `game_rounds.score`.

**`round_steps`** (new) — từng bước tương tác

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `round_id` | uuid | NO | | FK → `game_rounds.id` (CASCADE) | Trùng lặp có chủ đích để index nhanh |
| `round_item_id` | bigint | NO | | FK → `round_items.id` (CASCADE) | |
| `step_seq` | smallint | NO | | | Thứ tự bước trong cả lượt, từ 1 |
| `kind` | varchar(32) | NO | | | Xem 4.5 |
| `order_map` | smallint[] | NO | `'{}'` | | **Thứ tự đã xáo**: phần tử thứ `i` là chỉ số gốc trong `payload` của lựa chọn hiển thị ở vị trí `i`. Ví dụ `{2,0,1}` nghĩa là option client thấy đầu tiên là `payload.options[2]`. Dùng để map ngược `option_index` (BR-17) |
| `content_snapshot_hash` | char(64) | NO | | | `content_items.content_hash` tại thời điểm phát. Phát hiện item bị sửa giữa lượt |
| `served_at` | timestamptz | NO | `now()` | | **Mốc tính bonus tốc độ và hạn khoá step của Bug Hunt** (BR-03a) |
| `expires_at` | timestamptz | YES | | | `served_at + 60s` với `bug-hunt.identify`; `null` với mọi step khác |
| `answered_at` | timestamptz | YES | | | |
| `choice` | jsonb | YES | | | Lựa chọn client gửi lên |
| `effect` | jsonb | YES | | | Kết quả bước: `points_delta` / `risk_delta` / `budget_spent` |

Indexes: `uq_round_steps_seq` UNIQUE on `(round_id, step_seq)`

> **Không lưu nguyên payload đã gửi.** BR-17 chỉ cần biết thứ tự đã xáo, và `order_map` (một mảng vài số nguyên) đủ cho việc đó. Lưu cả nội dung sẽ nhân đoạn code của Bug Hunt lên 8 lần mỗi lượt chơi — trên Neon free tier đây là bảng phình nhanh nhất. Cần tái hiện chính xác màn hình đã hiển thị thì dựng lại từ `content_items.payload` + `order_map`.

**`content_reports`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `content_item_id` | bigint | NO | | FK → `content_items.id` (CASCADE) | |
| `user_id` | bigint | NO | | FK → `users.id` (CASCADE) | Guest không được report |
| `round_item_id` | bigint | YES | | FK → `round_items.id` (SET NULL) | Chỉ report item mình vừa gặp |
| `reason` | varchar(32) | NO | | CHECK IN ('wrong_answer','ambiguous','duplicate','offensive','other') | |
| `note` | varchar(500) | YES | | | |
| `created_at` | timestamptz | NO | `now()` | | |

Indexes: `uq_content_reports_once` UNIQUE on `(content_item_id, user_id)` — BR-14

**`generation_runs`** (new)

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `id` | bigserial | NO | | PK | |
| `game_id` | varchar(24) | NO | | | |
| `provider` | varchar(24) | NO | `'gemini'` | | |
| `model` | varchar(64) | NO | | | `gemini-2.5-flash` |
| `prompt_version` | varchar(16) | NO | | | BR-13 |
| `requested` | smallint | NO | | | |
| `accepted` | smallint | NO | `0` | | |
| `rejected_validator` | smallint | NO | `0` | | |
| `rejected_duplicate` | smallint | NO | `0` | | |
| `rejected_quota` | smallint | NO | `0` | | |
| `error` | text | YES | | | |
| `started_at` | timestamptz | NO | `now()` | | |
| `finished_at` | timestamptz | YES | | | |

**`leaderboard_best`** (new) — cache best-score, nguồn duy nhất cho `/leaderboard`

| Column | Type | Nullable | Default | Constraint | Description |
|---|---|---|---|---|---|
| `user_id` | bigint | NO | | PK (cùng `game_id`), FK → `users.id` (CASCADE) | |
| `game_id` | varchar(24) | NO | | PK (cùng `user_id`) | |
| `best_score` | smallint | NO | | CHECK 0–100 | |
| `best_round_id` | uuid | YES | `null` | FK → `game_rounds.id` ON DELETE SET NULL | Truy vết. **Bắt buộc nullable**: `ON DELETE SET NULL` trên cột NOT NULL sẽ fail lúc runtime, đúng vào cron dọn round khách hằng ngày |
| `updated_at` | timestamptz | NO | `now()` | | |

Indexes: `idx_leaderboard_best_game` on `(game_id, best_score DESC)`

Cập nhật bằng UPSERT trong cùng transaction với sự kiện làm đổi best-score — xem section 15. Có thể dựng lại toàn bộ từ `game_rounds` nếu lệch.

### 4.3 Cấu trúc `game_rounds.state`

State quyền lực của lượt đang chơi, chỉ server đọc/ghi. Không bao giờ gửi xuống client.

```json
{
  "item_ids": [1042, 1077],              // thứ tự content item đã bốc
  "current_item_seq": 1,
  "current_step_seq": 3,
  "current_item": {                      // state cục bộ của item đang chơi, reset khi sang item mới
    "seg_points": 45,                    // spec-detective: điểm phần segments, chờ cộng followUp
    "node_id": "n2",                     // prod-roulette: node hiện tại
    "risk_total": 20,                    // prod-roulette: rủi ro cộng dồn
    "taken_action_ids": ["a1", "a3"],    // incident: action đã chọn
    "spent": 7                           // incident: phút mô phỏng đã dùng
  }
}
```

Chỉ các khoá liên quan tới `game_id` hiện tại được dùng; phần còn lại vắng mặt. **State cục bộ của item nằm trong `current_item` và bị reset khi chuyển sang item kế** — với Spec Detective (4 item/lượt) nếu để `seg_points` ở cấp round thì item sau sẽ đọc nhầm điểm của item trước.

### 4.4 Hình dạng lượt chơi và công thức chấm điểm

Toàn bộ đã verify từ source — **port nguyên công thức hiện có**, không thay đổi cách chấm.

| Game | Item/lượt | Step/item | Thời gian | Điểm mỗi item | Điểm lượt | Nguồn |
|---|---|---|---|---|---|---|
| `bug-hunt` | 8 | 1 | 60s đồng hồ thật mỗi step | `50` nếu đúng dòng `+ 30` nếu đúng loại `+ round(20 × remain / 60)` chỉ khi cả hai đúng | trung bình 8 item | `bug-hunt.js:5,6,136,137,195` |
| `spec-detective` | 4 | 2 | không | `max(0, round(60 × found / totalAmb) − 10 × falsePos) + 40` nếu chọn đúng followUp | trung bình 4 item | `spec-detective.js:5,121,150,185` |
| `prod-roulette` | 1 | biến thiên (độ dài đường đi) | không | `max(0, 100 − Σ risk)` | = điểm item | `prod-roulette.js:86` |
| `incident` | 1 | biến thiên (n action + 1 cause) | ngân sách **mô phỏng**, không phải đồng hồ thật | `(correct ? 70 : 0) + (correct ? round(20 × remain / budget) : 0) + round(10 × keysFound / totalKeys)` | = điểm item | `incident.js:156,157,158` |

`remain` của Incident = `budget − Σ cost` của các action đã chọn — **phút mô phỏng**, không liên quan thời gian thật.

### 4.5 Cấu trúc `payload` và các loại step

**`bug-hunt`** — 1 step: `bug-hunt.identify` (bỏ field `level` theo quyết định N6)

```json
{ "lang": "PHP / Laravel", "title": "…", "code": ["dòng 1", "dòng 2"],
  "answerLines": [4], "category": "sql-injection",
  "explanation": "…", "fix": "…" }
```

**`spec-detective`** — 2 step: `spec-detective.segments` → `spec-detective.follow_up`

```json
{ "title": "…", "source": "…",
  "segments": [{ "t": "…" }, { "t": "…", "a": true, "r": "…" }],
  "followUp": { "question": "…",
    "options": [{ "t": "…", "good": true, "why": "…" }] } }
```

**`prod-roulette`** — n step: `prod-roulette.node` lặp đến khi gặp node `end`

```json
{ "title": "…", "brief": "…", "start": "n1",
  "nodes": { "n1": { "text": "…", "options": [
    { "t": "…", "risk": 0, "feedback": "…", "next": "n2" }] },
    "nEnd": { "end": true, "tone": "good", "title": "…", "verdict": "…" } } }
```

**`incident`** — n step: `incident.action` lặp → `incident.cause`

```json
{ "title": "…", "severity": "Cao", "budget": 30, "brief": "…",
  "actions": [{ "id": "a1", "label": "…", "cost": 4, "key": true, "result": "…" }],
  "causes": [{ "t": "…", "correct": true, "why": "…" }] }
```

## 5. API Contract

### 5.1 Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | Đăng ký |
| POST | `/api/v1/auth/login` | — | Đăng nhập |
| POST | `/api/v1/auth/refresh` | Refresh cookie | Cấp access token mới |
| POST | `/api/v1/auth/logout` | Bearer | Thu hồi session hiện tại |
| GET | `/api/v1/me` | Bearer | Thông tin user + best score từng game |
| GET | `/api/v1/games` | — | Metadata 4 game (từ `GAME_CATALOG`) + trạng thái pool |
| POST | `/api/v1/rounds` | Bearer hoặc — | Bắt đầu lượt chơi, trả step đầu tiên |
| GET | `/api/v1/rounds/:roundId` | Bearer hoặc — | **Lấy lại step đang chờ** — dùng khi tải lại trang |
| POST | `/api/v1/rounds/:roundId/steps/:stepSeq` | Bearer hoặc — | Gửi lựa chọn cho step, nhận reveal + step kế |
| POST | `/api/v1/rounds/:roundId/abandon` | Bearer hoặc — | Bỏ lượt chơi |
| GET | `/api/v1/leaderboard` | — | Bảng xếp hạng |
| GET | `/api/v1/me/history` | Bearer | Lịch sử lượt chơi của mình |
| POST | `/api/v1/content/:itemId/report` | Bearer | Báo câu sai |
| GET | `/api/v1/admin/generation-runs` | Bearer (admin) | Log sinh đề |
| PATCH | `/api/v1/admin/content/:itemId` | Bearer (admin) | Ẩn / khôi phục item |
| POST | `/api/v1/admin/users/:userId/reset-password` | Bearer (admin) | **Đặt lại mật khẩu** — bắt buộc vì BR-12 không cho gửi email |

> **Không có endpoint `/finish`.** Lượt chơi tự kết thúc khi step cuối được trả lời; response của step đó chứa `summary`. Bỏ `/finish` loại được trạng thái "đã trả lời hết nhưng chưa chốt điểm".

### 5.2 Request/Response chi tiết

**GET /api/v1/games**

Không cần auth. Có Bearer token thì kèm thêm `my_best`.

Response Success (`200`):

```json
{
  "games": [
    {
      "id": "bug-hunt",
      "icon": "🐞",
      "name": "Bug Hunt",
      "tagline": "Đọc đoạn code, chỉ đúng dòng có bug và gọi tên loại bug.",
      "skill": "Code review",
      "duration": "~8 phút",
      "items_per_round": 8,
      "pool_available": 137,
      "playable": true,
      "my_best": 92
    }
  ]
}
```

`playable = pool_available >= items_per_round` (xem 8.4). `my_best` là `null` khi chưa đăng nhập hoặc chưa chơi game đó.

**POST /api/v1/rounds**

Request Headers:

```
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json
```

Không có header `Authorization` → tạo round khách (`is_guest = true`) nếu `ALLOW_ANONYMOUS_PLAY` bật, ngược lại `401`.

Request Body:

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `game_id` | string | YES | IN (4 game ids) | |

Response Success (`201`):

```json
{
  "round_id": "550e8400-e29b-41d4-a716-446655440000",
  "game_id": "bug-hunt",
  "is_guest": false,
  "progress": { "item_seq": 1, "total_items": 8 },
  "step": {
    "step_seq": 1,
    "kind": "bug-hunt.identify",
    "time_limit_seconds": 60,
    "budget": null,
    "prompt": {
      "lang": "PHP / Laravel",
      "title": "Tìm dòng có lỗi",
      "code": ["...", "..."],
      "categories": [{ "id": "sql-injection", "label": "SQL Injection" }]
    }
  }
}
```

`time_limit_seconds` là `null` với 3 game không có đồng hồ thật. `budget` chỉ khác `null` với Incident.

Object `step` còn có `expires_at` (ISO 8601, `null` với 3 game không có đồng hồ). Chỉ `time_limit_seconds` là không đủ: khi người chơi tải lại trang giữa step, server **không** cấp `served_at` mới (BR-03a), nên nếu client đếm lại từ 60 thì đồng hồ hiển thị lệch với mốc khoá cứng phía server và người chơi mất điểm mà không hiểu vì sao.

**GET /api/v1/rounds/:roundId**

Trả đúng shape của `POST /rounds` với step đang chờ. Dùng khi client tải lại trang (access token nằm trong bộ nhớ nên F5 là mất — xem section 13). **Không** tạo `served_at` mới: đồng hồ Bug Hunt vẫn tính từ lần phát đầu tiên, nếu không người chơi cứ F5 là reset giờ.

Khi step đang chờ đã quá `expires_at` (8.2 điều kiện C), response kèm thêm hai field:

| Field | Ý nghĩa |
|---|---|
| `expired_step` | `{ step_seq, reveal }` của step vừa bị chốt 0 điểm |
| `summary` | Chỉ khác `null` khi step quá hạn đó là step cuối — lượt chơi kết thúc ngay trong request này, và `step` là `null` |

**POST /api/v1/rounds/:roundId/steps/:stepSeq**

Request Body:

| Field | Type | Required | Validation | Description |
|---|---|---|---|---|
| `choice` | object | YES | Theo `kind` của step — xem 5.4 | |

Response Success (`200`):

```json
{
  "step_seq": 1,
  "reveal": {
    "answerLines": [4],
    "category": "sql-injection",
    "explanation": "…",
    "fix": "…"
  },
  "effect": { "points_delta": 92, "elapsed_seconds": 12 },
  "progress": { "item_seq": 1, "total_items": 8, "completed": false },
  "next_step": { "step_seq": 2, "kind": "bug-hunt.identify", "time_limit_seconds": 60, "budget": null, "prompt": {} },
  "summary": null
}
```

> `step_seq` chỉ xuất hiện **một chỗ** — trong object `step` / `next_step`, và ở cấp response cho biết step vừa trả lời. Không lặp lại trong `progress` để tránh hai nguồn sự thật.

Khi đây là step cuối: `next_step = null`, `progress.completed = true`, và `summary` có giá trị:

```json
{
  "score": 84,
  "is_personal_best": true,
  "counts_toward_leaderboard": true,
  "breakdown": [{ "ok": true, "text": "Câu 1 · …", "pts": 92 }],
  "notes": [{ "tone": "", "title": "…", "body": "…" }],
  "rank": { "game": 3, "overall": 7 }
}
```

`counts_toward_leaderboard = false` với round khách.

**GET /api/v1/leaderboard**

Query: `?scope=overall|bug-hunt|spec-detective|prod-roulette|incident&limit=50`

```json
{
  "scope": "overall",
  "entries": [
    { "rank": 1, "display_name": "Minh", "total": 372, "games_played": 4,
      "per_game": { "bug-hunt": 95, "spec-detective": 91, "prod-roulette": 96, "incident": 90 } },
    { "rank": 2, "display_name": "Lan", "total": 190, "games_played": 2,
      "per_game": { "bug-hunt": 98, "spec-detective": 92, "prod-roulette": 0, "incident": 0 } }
  ],
  "me": { "rank": 7, "total": 318, "games_played": 4 }
}
```

Game chưa chơi tính **0** trong `total` (A7) và hiện `0` trong `per_game`. `games_played` đi kèm để người xem hiểu vì sao một người điểm từng game rất cao vẫn xếp dưới — thay vì thấy bảng xếp hạng "sai" mà không rõ lý do.

Response Errors:

| HTTP | Error Code | Condition | Message |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Body sai schema | Invalid request payload |
| 400 | `INVALID_CHOICE` | `choice` không hợp với `kind` của step | Choice does not match the current step |
| 401 | `UNAUTHORIZED` | Thiếu / hết hạn access token | Authentication required |
| 401 | `GUEST_PLAY_DISABLED` | Không đăng nhập và `ALLOW_ANONYMOUS_PLAY` tắt | Sign in to play |
| 403 | `FORBIDDEN` | Không đủ quyền (admin endpoint) | Insufficient permission |
| 403 | `ACCOUNT_DISABLED` | `users.is_active = false` | Account has been disabled |
| 404 | `NOT_FOUND` | Round / step / item không tồn tại hoặc không thuộc về caller | Resource not found |
| 409 | `EMAIL_TAKEN` | Email đã đăng ký | Email already registered |
| 409 | `STEP_ALREADY_ANSWERED` | Gửi lại step đã trả lời | This step was already answered |
| 409 | `STEP_EXPIRED` | Gửi sau `round_steps.expires_at` (chỉ Bug Hunt) | Time is up for this step |
| 409 | `STEP_OUT_OF_ORDER` | `stepSeq` không phải step đang chờ | Step submitted out of order |
| 409 | `ROUND_NOT_ACTIVE` | Round `finished` / `abandoned` | Round is no longer active |
| 409 | `ROUND_ALREADY_ACTIVE` | Có round `in_progress` khác (race hai tab) | Another round is already in progress |
| 409 | `ALREADY_REPORTED` | User đã report item này | You already reported this item |
| 422 | `POOL_EXHAUSTED` | Pool không đủ item để mở round | Not enough questions available |
| 429 | `TOO_MANY_REQUESTS` | Vượt rate limit | Too many requests |
| 503 | `GENERATION_UNAVAILABLE` | Gemini lỗi/hết quota (chỉ ảnh hưởng cron) | Content generation temporarily unavailable |

### 5.3 Public projection — allowlist bắt buộc (thay cho blocklist)

Đây là bảng quyền lực của BR-02. Server dựng payload gửi client bằng cách **liệt kê field được phép**; mọi field khác trong `content_items.payload` mặc định không được gửi. Cách này an toàn hơn blocklist vì thêm field mới vào payload sẽ mặc định bị giấu chứ không mặc định bị lộ.

| Step kind | Field được gửi trong `prompt` | Field trong `reveal` (sau khi trả lời) | Không bao giờ gửi |
|---|---|---|---|
| `bug-hunt.identify` | `lang`, `title`, `code[]`, `categories[{id,label}]` (từ bảng tham chiếu, không từ item) | `answerLines[]`, `category`, `explanation`, `fix` | — |
| `spec-detective.segments` | `title`, `source`, `segments[{index, t}]` | `ambiguous_indexes[]`, `reasons[{index, r}]` | `a`, `r` trước khi trả lời |
| `spec-detective.follow_up` | `question`, `options[{index, t}]` | `good_index`, `explanations[{index, why}]` | `good`, `why` trước khi trả lời |
| `prod-roulette.node` | `title` + `brief` (chỉ step 1), `text`, `options[{index, t}]` | `feedback` và `risk` của **riêng option đã chọn**; node kết thúc thêm `tone`, `title`, `verdict` | `next` (lộ cấu trúc đồ thị), `risk`/`feedback` của option **không** chọn |
| `incident.action` | `title`, `severity`, `brief` (chỉ step 1), `budget{total,remaining}`, `actions[{id, label, cost, taken}]`, `can_declare_cause` | `result` của **riêng action vừa chọn** | `key` (không bao giờ, kể cả sau khi chơi xong), `result` của action chưa chọn |
| `incident.cause` | `causes[{index, t}]` | `correct_index`, `explanations[{index, why}]` | `correct`, `why` trước khi trả lời |

### 5.4 Shape của `choice` theo từng step kind

| Step kind | `choice` | Ghi chú |
|---|---|---|
| `bug-hunt.identify` | `{ "line": 4, "category_id": "sql-injection" }` | Cả hai có thể `null` khi hết giờ |
| `spec-detective.segments` | `{ "segment_indexes": [1, 3, 5] }` | Index theo thứ tự đã gửi |
| `spec-detective.follow_up` | `{ "option_index": 2 }` | |
| `prod-roulette.node` | `{ "option_index": 0 }` | |
| `incident.action` | `{ "action_id": "a3" }` **hoặc** `{ "declare_cause": true }` | `declare_cause` chuyển sang step `incident.cause` |
| `incident.cause` | `{ "option_index": 1 }` | |

`option_index` và `segment_indexes` tham chiếu **thứ tự đã gửi cho client** (đã xáo), không phải thứ tự gốc trong `payload`. Server map ngược qua `round_steps.order_map` (BR-17).

## 6. Điều kiện tiên quyết (Preconditions)

- [ ] Tài khoản Render và Neon đã tạo, `DATABASE_URL`, `GEMINI_API_KEY`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` đã nạp vào env của Render
- [ ] **Chủ project** đã đọc và chấp nhận ToS free tier Gemini cho mục đích này — **hoàn thành trước khi bắt đầu P2** (Q3)
- [ ] Ngân hàng viết tay hiện có (12 + 6 + 3 + 3 mục) đã migrate vào `content_items` với `source = 'handwritten'`
- [ ] Pool mỗi game đạt ngưỡng A6 trước khi bật khen thưởng
- [ ] Validator có test case cho cả 4 game và pass

## 7. Luồng chính (Main Flow) — chơi một lượt

| # | Actor | Hành động | System Response |
|---|---|---|---|
| 1 | Player | Đăng nhập | Access token (bộ nhớ) + refresh token (httpOnly cookie) |
| 2 | Player | Chọn game ở hub | GET `/api/v1/games` — 4 thẻ game kèm best score của mình |
| 3 | Player | Bấm bắt đầu | POST `/rounds` — server bốc item theo BR-09, tạo `game_rounds` + `round_items` + `round_steps` cho step 1, xáo lựa chọn và lưu `order_map`, ghi `served_at` (+ `expires_at` với Bug Hunt), trả `prompt` theo allowlist 5.3 |
| 4 | Player | Gửi lựa chọn cho step hiện tại | POST `/steps/:seq` — server map `option_index` ngược qua `order_map`, tính `effect`, cập nhật `game_rounds.state`, trả `reveal` + step kế (ghi `served_at` mới) |
| 5 | System | Lặp bước 4 đến khi hết step | Số step biến thiên theo game — xem 4.4 |
| 6 | System | Step cuối được trả lời | Tính điểm item và điểm lượt theo công thức 4.4, clamp 0–100, đặt `status = 'finished'`, cập nhật best-score, invalidate cache leaderboard, trả `summary` |
| 7 | Player | Xem leaderboard | GET `/leaderboard` — xếp theo tổng best-score 4 game |

## 7b. Flow Diagram

```
([Player]) → [Login] → [Hub: chọn game] → [POST /rounds]
                                                 ↓
                                          <Pool đủ item?>
                                          ↓ Yes           ↓ No
                                   [Bốc item]        [422 POOL_EXHAUSTED]
                                          ↓
                       [Xáo lựa chọn, lưu order_map, ghi served_at + expires_at]
                                          ↓
                            [Trả prompt theo allowlist 5.3]
                                          ↓
                                  ([Player chọn])
                                          ↓
                              [POST /steps/:seq]
                                          ↓
                              <Step này đã trả lời?>
                               ↓ Yes                 ↓ No
                    [409 STEP_ALREADY_ANSWERED]  <Quá expires_at?>
                                                  ↓ Yes            ↓ No
                                       [409 STEP_EXPIRED, 0 điểm]  [Map index qua order_map]
                                                       ↓
                                              [Tính effect, cập nhật state]
                                                       ↓
                                              [Trả reveal của riêng lựa chọn]
                                                       ↓
                                                 <Còn step?>
                                          ↓ Yes              ↓ No
                                    (quay lại)      [Tính điểm lượt, clamp 0-100]
                                                            ↓
                                                    <Round khách?>
                                                  ↓ Yes        ↓ No
                                          [Không ghi bảng]  [Cập nhật best-score]
                                                                ↓
                                                    [Invalidate cache leaderboard]
```

Luồng sinh đề (cron, tách biệt):

```
[Cron tick] → [Lấy advisory lock] → <Pool dưới ngưỡng A6?>
                                      ↓ No → [Nhả lock, kết thúc]
                                      ↓ Yes
                              [Đếm hạn ngạch theo category x lang]
                                      ↓
                              [Gọi Gemini 2.5 Flash + JSON schema]
                                      ↓
                              <Validator pass?>
                              ↓ No                    ↓ Yes
                         [status=rejected]     <content_hash trùng?>
                                                ↓ Yes         ↓ No
                                          [rejected_dup]  <Đầy hạn ngạch A5?>
                                                          ↓ Yes      ↓ No
                                                    [rejected_quota] [status=active]
```

> SVG chưa sinh được — môi trường hiện tại không có Playwright/browser tool.
> Mermaid source: [assets/devlab-arcade-v2-img1.mmd](assets/devlab-arcade-v2-img1.mmd) (luồng chơi) và
> [assets/devlab-arcade-v2-img2.mmd](assets/devlab-arcade-v2-img2.mmd) (luồng sinh đề).
> Render tại https://mermaid.live rồi lưu SVG cùng thư mục.

## 8. Luồng thay thế (Alternative Flows)

### 8.1 Người chơi bỏ dở lượt chơi

- Điều kiện: đóng tab / mất mạng sau bước 4
- Luồng: round giữ `in_progress`; cron đánh dấu `abandoned` khi `last_activity_at` quá 2 giờ. Người chơi quay lại trong 2 giờ thì `GET /rounds/:id` cho chơi tiếp
- Kết quả: không tính điểm nếu bỏ hẳn

### 8.2 Hết giờ một step (chỉ Bug Hunt)

Game hiện tại **khoá cứng** khi hết 60 giây: `bug-hunt.js:123` gọi `lockIn(true)` và người chơi không trả lời được nữa. Server phải giữ nguyên hành vi đó — nếu cho trả lời không giới hạn thời gian thật thì người chơi tra Google rồi mới bấm, và bảng xếp hạng có khen thưởng mất ý nghĩa.

- **Điều kiện A — client chủ động báo hết giờ**: gửi `{ "line": null, "category_id": null }` trước `expires_at`
  - Luồng: chấm 0 điểm cho step, ghi `answered_at`
  - Kết quả: trả `reveal` bình thường
- **Điều kiện B — request đến sau `expires_at`**: bất kể `choice` là gì
  - Luồng: server **bỏ qua `choice`**, chốt step ở 0 điểm, ghi `answered_at = now()`, trả `409 STEP_EXPIRED`
  - Body của response 409 vẫn kèm `reveal` và `next_step` để client đi tiếp mà không cần gọi thêm
- **Điều kiện C — người chơi bỏ đi rồi quay lại** (mở `GET /rounds/:id` sau khi step đã quá hạn)
  - Luồng: server chốt step quá hạn ở 0 điểm ngay lúc đó và trả về step kế
  - Kết quả: không có step nào treo vô hạn

Ba game còn lại không có `expires_at` nên không bao giờ rơi vào luồng này.

### 8.3 Item bị ẩn giữa chừng vì bị report

- Điều kiện: content item đang nằm trong round dở dang chuyển `status = 'hidden'`
- Luồng: `round_items.voided = true`; khi tính điểm lượt, item bị loại khỏi cả tử số lẫn mẫu số. Round đã `finished` được rescore theo BR-15
- Kết quả: điểm người chơi không bao giờ giảm vì lỗi nội dung

### 8.4 Pool cạn khi mở round

- Điều kiện: số item `active` của game < số item/lượt của game đó (8 / 4 / 1 / 1)
- Luồng: trả `422 POOL_EXHAUSTED`, ghi cảnh báo để admin biết cron không theo kịp
- Kết quả: game đó tạm không chơi được; 3 game còn lại không ảnh hưởng

### 8.5 Gemini hết quota ngày

- Điều kiện: cron nhận 429 từ Gemini
- Luồng: ghi `generation_runs.error`, backoff, thử lại tick sau. **Không** chuyển sang provider trả phí
- Kết quả: pool tạm không tăng; nếu chạm ngưỡng cạn thì rơi vào 8.4

### 8.6 Người chơi tải lại trang giữa lượt

- Điều kiện: F5, access token trong bộ nhớ bị mất
- Luồng: client gọi `/auth/refresh` khi khởi động, rồi `GET /rounds/:roundId` để lấy step đang chờ
- Kết quả: chơi tiếp từ đúng step. Đồng hồ Bug Hunt **không** reset (`served_at` giữ nguyên)

## 9. Luồng lỗi (Exception Flows)

### 9.1 Gửi trùng một step (double-submit)

Server kiểm `round_steps.answered_at IS NULL` trong cùng transaction với UPDATE. Request thứ hai nhận `409 STEP_ALREADY_ANSWERED`, không ghi đè `effect`.

### 9.2 Gửi step không đúng thứ tự

Chỉ chấp nhận `stepSeq` bằng `game_rounds.state.current_step_seq`. Sai → `409 STEP_OUT_OF_ORDER`. Chặn kiểu mở nhiều tab để dồn thời gian.

### 9.3 Hai tab cùng mở round

Unique partial index `uq_game_rounds_one_active` khiến INSERT thứ hai fail ở tầng DB → trả `409 ROUND_ALREADY_ACTIVE` kèm `round_id` đang chạy để client chuyển sang `GET /rounds/:id`. Không dùng "abandon rồi tạo mới" vì tạo race.

### 9.4 `option_index` ngoài phạm vi

Server so với `round_steps.order_map`; ngoài phạm vi → `400 INVALID_CHOICE`, step **không** bị đánh dấu đã trả lời (cho gửi lại).

## 10. Business Rules

- **BR-01**: All scoring is computed server-side. The client never sends a score; it sends only the raw choice.
- **BR-02**: Payloads sent to the client are built from an **allowlist** (section 5.3), not a blocklist. Any field of `content_items.payload` not named in the allowlist for that step kind MUST NOT be sent. Adding a new field to a payload therefore defaults to hidden.
- **BR-03a**: The Bug Hunt speed bonus is computed from `now() - round_steps.served_at`. A client-supplied elapsed time is ignored. `GET /rounds/:id` MUST NOT reset `served_at` or `expires_at`. A step submitted after `expires_at` is **hard-locked at 0 points** — the submitted choice is discarded, not graded. This ports `bug-hunt.js:123`, where the client locks the question at 0 seconds; allowing a late answer would let a player look the answer up, which the 60-second limit exists to prevent.
- **BR-03b**: The Incident time bonus is computed from the **simulated budget** (`budget - sum(cost)` of chosen actions), never from the wall clock.
- **BR-03c**: Spec Detective and PROD Roulette have no time component at all.
- **BR-04**: Round score is computed per game using the formulas in section 4.4, over non-voided items only, then rounded and clamped to 0–100 (ports `js/app.js:238`). **If every item in a round is voided** — possible for the one-item games PROD Roulette and Incident — no score can be computed: keep the previously stored score and mark the round `voided_content = true` in the audit log. Never divide by zero, never write `0`.
- **BR-05**: A user's score for a game is their **highest** finished, non-guest round score for that game. Overall ranking is the sum of the four per-game best scores, where **a game never played counts as 0** (assumption A7). The leaderboard therefore rewards breadth as well as depth: finishing all four games at a middling score outranks one perfect game. `games_played` is returned alongside `total` so this is visible rather than surprising. Cumulative XP is NOT used for ranking.
- **BR-06**: An item enters the pool only if it passes the per-game validator, its `content_hash` is unique, and its `(game_id, category, lang)` quota (A5) is not full.
- **BR-07**: An item whose `report_count` reaches the threshold (A4) is set to `status = 'hidden'` automatically. All `round_items` referencing it are set `voided = true`, and every affected finished round is rescored under BR-15.
- **BR-08**: Every list of choices presented to the player MUST be shuffled server-side before delivery (ports `api.shuffle`, `js/app.js:44`). Applies to PROD Roulette node options, Spec Detective follow-up options, and Incident causes.
- **BR-09**: Item selection for a round is uniform random sampling without replacement from `status = 'active'` items of that game, using one formula for every user. There is no difficulty tier (decision N6).
- **BR-10**: A signed-in user may have at most one `in_progress` round at a time, enforced by a unique partial index. A second concurrent attempt is rejected, not silently resolved.
- **BR-11**: The content generation pipeline MUST NOT be invoked from an HTTP request path. It runs only on a scheduled job holding a Postgres advisory lock, so two overlapping ticks cannot double-generate.
- **BR-12**: The system MUST NOT send any outbound email in Phase 1 — no verification mail, no password-reset mail (assumption A1). Password recovery is `POST /admin/users/:userId/reset-password`, performed by an admin.
- **BR-13**: Generation prompts are versioned (`generation_runs.prompt_version`). Changing a prompt requires a new version value.
- **BR-14**: A user may report a given content item at most once.
- **BR-15**: When a finished round is rescored (BR-07), the stored score becomes `max(previous_score, recomputed_score)`. A content defect must never reduce a player's recorded score.
- **BR-16**: A guest round (`is_guest = true`) is playable but never contributes to `best score`, leaderboard, or history. Cron deletes guest rounds older than 24 hours.
- **BR-17**: The shuffled order of choices sent to the client MUST be persisted in `round_steps.order_map`. Incoming indexes are resolved against that record, never against the raw payload order. The payload content itself is NOT copied into `round_steps` — the order map plus `content_items.payload` reconstructs what the player saw.
- **BR-18**: Scoring formulas are ported verbatim from the existing client implementation (section 4.4). Changing a formula is a separate decision, not part of this migration.

## 11. State Machine

**`game_rounds.status`**

| Trạng thái hiện tại | Event | Trạng thái tiếp theo | Điều kiện |
|---|---|---|---|
| — | POST `/rounds` | `in_progress` | Pool đủ item và không có round active khác |
| `in_progress` | Trả lời step cuối | `finished` | Tự động, không cần gọi `/finish` |
| `in_progress` | POST `/abandon` | `abandoned` | |
| `in_progress` | Cron dọn dẹp | `abandoned` | `last_activity_at` quá 2 giờ |
| `finished` | Rescore (BR-15) | `finished` | Chỉ đổi `score`, không đổi status |

**`content_items.status`**

| Trạng thái hiện tại | Event | Trạng thái tiếp theo | Điều kiện |
|---|---|---|---|
| — | Validator pass | `active` | BR-06 |
| — | Validator fail | `rejected` | Cron xoá sau 30 ngày (S1) |
| `active` | `report_count` ≥ A4 | `hidden` | BR-07 |
| `active` | Admin ẩn | `hidden` | |
| `hidden` | Admin khôi phục | `active` | |

## 12. Security & Authorization

- **Authentication**: Required for history, report, and admin endpoints. `/games` and `/leaderboard` are public read. Round endpoints accept either a Bearer token or an anonymous guest round (BR-16).
- **Authorization**: Role check on `/admin/*`. Round endpoints verify ownership: a signed-in caller must own the round. A guest round is identified **only** by its `round_id` (a v4 UUID, unguessable). The IP is deliberately NOT part of the ownership check — a player switching from wifi to mobile data would otherwise lose an in-progress round. `guest_ip` is used for rate limiting only, as its name says.
- **Rate limiting**:
  - `/auth/login`, `/auth/register`: 10 req / 15 min per IP
  - `/rounds` (signed in): 20 req / hour per user
  - `/rounds` (guest): 10 req / hour per IP
  - `/steps`: 300 req / hour per user or IP
  - Global: 300 req / 15 min per IP
- **Input validation**: Every body validated against a schema before business logic. All DB access parameterized — no string-concatenated SQL.
- **Secrets**: `DATABASE_URL`, `GEMINI_API_KEY`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD` read from environment only. Never sent to the client, never logged. `.env*` is already gitignored.
- **Sensitive data**: `password_hash` and `refresh_token_hash` are never returned by any endpoint and are masked in logs.
- **Token/session**: Access token JWT, 15 min TTL, in memory only. Refresh token opaque, 14 days, httpOnly + Secure + SameSite=Lax cookie, hash-only in DB, rotated on every refresh.
- **XSS**: The front-end renders all data via `textContent` (`js/app.js:27`, `:35`). This MUST be preserved — AI-generated content is untrusted input.
- **Anti-cheat**: server-side scoring (BR-01), allowlist projection (BR-02), server clock (BR-03a), simulated budget (BR-03b), persisted shuffle order (BR-17), ordered submission (9.2), single active round (BR-10).
- **Rủi ro tồn dư — liệt kê pool**: vì đăng ký tự do (N4) và cho chơi khách (BR-16), một script có thể mở nhiều round để đọc dần `reveal` của toàn bộ pool rồi dùng tài khoản thật chơi điểm tuyệt đối. Rate limit chỉ làm chậm chứ không chặn. Đây là hệ quả trực tiếp của N4 và đã được chấp nhận ở `docs/clarify/clarify_devlab-arcade-v2.md` mục 3.2. Nếu sau này siết đăng ký thì rủi ro này giảm theo.

## 13. Integration Contract (Frontend)

- **Client-side storage**: Access token in a JS variable only. Refresh token in an httpOnly cookie — the front-end never reads it. Do NOT put tokens in `localStorage`.
- **Bootstrap on page load**: On every load, call `/auth/refresh` first. On success, if a round id is held in `sessionStorage`, call `GET /rounds/:roundId` to resume. Only then render the hub.
- **Token lifecycle**: Access token 15 min. On `401`, call `/auth/refresh` once and retry the original request. If refresh fails → clear state, show login.
- **Concurrent requests**: A single in-flight refresh promise must be shared. Two parallel 401s must not trigger two refresh calls (refresh rotates the token; the second would fail).
- **Error handling**: `409 STEP_EXPIRED` → **không phải lỗi để hiện popup**: đọc `reveal` và `next_step` trong body và đi tiếp như một câu hết giờ bình thường. `409 STEP_ALREADY_ANSWERED` → keep the state already shown (duplicate submit). `409 ROUND_ALREADY_ACTIVE` → switch to `GET /rounds/:id` from the returned id. `422 POOL_EXHAUSTED` → "game này đang tạm hết câu hỏi". `429` → show retry-after.
- **Retry strategy**: Retry only on network errors and `5xx`, max 2 attempts with backoff. Never auto-retry `/steps` on `4xx` — the choice was already recorded.
- **Loading states**: `/rounds` and `/steps` need a spinner (they hit the DB and may be slow on a cold Neon connection).
- **Optimistic update**: Not allowed for scoring. Points are displayed only after the server responds — that is the point of BR-01.
- **Timer display**: The client counts down for UX only. The authoritative elapsed time is the server's. The client MUST still submit after local timeout so the server can record it.
- **Index handling**: Send back exactly the `index` values the server sent. Do not sort or re-order options locally — the server resolves indexes against its own record (BR-17).

## 14. Audit & Logging

| Event | Log level | Destination | Fields |
|---|---|---|---|
| Register | INFO | app log | user_id, ip, user_agent |
| Login success | INFO | app log | user_id, ip, user_agent |
| Login failed | WARN | app log | email (masked), ip, reason |
| Token refresh | DEBUG | app log | user_id, session_id |
| Round finished | INFO | app log | user_id or guest, game_id, round_id, score |
| Step out of order / duplicate | WARN | app log | user_id, round_id, step_seq — possible cheating signal |
| Content report | INFO | DB `content_reports` + app log | user_id, content_item_id, reason |
| Item auto-hidden | WARN | app log | content_item_id, report_count |
| Round rescored | INFO | app log | round_id, old_score, new_score |
| Generation run | INFO | DB `generation_runs` | game_id, model, prompt_version, accepted/rejected counts |
| Generation error | ERROR | DB + app log | game_id, error |
| Admin action | INFO | app log | admin_user_id, action, target_id |
| Admin password reset | WARN | app log | admin_user_id, target_user_id |

**Retention** (A8) — cron dọn theo lịch, xếp theo tốc độ phình của từng bảng:

| Dữ liệu | Giữ | Lý do |
|---|---|---|
| `round_steps` | **90 ngày** | Bảng phình nhanh nhất (mỗi lượt Bug Hunt sinh 8 dòng). Sau 90 ngày xoá step, giữ `game_rounds` + `round_items` nên lịch sử và best-score không mất |
| `game_rounds`, `round_items` của user thật | Vĩnh viễn | Cần cho best-score và lịch sử; mỗi lượt chỉ vài dòng |
| `game_rounds` khách | 24 giờ | BR-16 |
| `content_items` `status = 'rejected'` | 30 ngày | Số đếm đã nằm trong `generation_runs` nên không mất thống kê |
| `generation_runs`, `content_reports` | Vĩnh viễn | Dung lượng nhỏ, cần cho việc cải thiện prompt |
| Application log | Mặc định của Render | |

## 15. Non-functional Requirements

- **Performance**: `/steps` target p95 < 400 ms. `/leaderboard` target p95 < 500 ms.
- **Leaderboard cache**: dùng **bảng thường** `leaderboard_best (user_id, game_id, best_score, updated_at)` với PK `(user_id, game_id)`, cập nhật bằng UPSERT trong cùng transaction với: (a) round `finished` của user thật, (b) rescore theo BR-15, (c) admin ẩn/khôi phục item. Round khách không đụng bảng này.
  > **Không dùng materialized view.** `REFRESH MATERIALIZED VIEW CONCURRENTLY` không chạy được bên trong transaction block của Postgres, còn bản không CONCURRENTLY thì khoá toàn view — cả hai đều hỏng yêu cầu "cập nhật trong cùng transaction". Bảng thường + UPSERT cho cập nhật tăng dần, chi phí O(1) mỗi lượt chơi.
- **Scalability**: Expected concurrency is low (see Q9). Known bottleneck is Neon connection count on the free tier — use a connection pool with a low max.
- **Availability**: Best-effort. If the Render free tier spins the service down when idle, the first request after idle is slow — this directly affects the "open it at the start of a meeting" use case (Q8).
- **Security**: See section 12. No formal compliance requirement (internal tool, no customer data — decision N2 guarantees no customer content reaches the DB or the AI provider).
- **Accessibility**: Out of scope for this phase — covered by the P4 UI spec.
- **Backward compatibility**: BREAKING. The `file://` offline mode is removed (decision B4). Existing `localStorage` scores are not migrated (Q7).
- **Cost**: Hard constraint — zero paid AI spend (decision N5). Generation must stay inside Gemini free tier limits.

## 16. Edge Cases

### Security

- [x] Client gửi score trực tiếp → không endpoint nào nhận score (BR-01)
- [x] Đọc đáp án từ payload → allowlist projection (BR-02, 5.3)
- [x] Đọc `key` của Incident để biết action nào quan trọng → `key` không bao giờ gửi (5.3)
- [x] Đọc `next` của PROD Roulette để dựng lại đồ thị → `next` không bao giờ gửi (5.3)
- [x] Sửa đồng hồ ăn bonus tốc độ → server dùng `served_at` (BR-03a)
- [x] F5 liên tục để reset đồng hồ → `GET /rounds/:id` không tạo `served_at` mới (BR-03a)
- [x] Sắp xếp lại option phía client để đoán đáp án → server map qua `order_map` (BR-17)
- [x] Tra Google trong lúc đồng hồ Bug Hunt chạy → step khoá cứng ở 60s, trả lời sau đó không được tính (BR-03a)
- [x] Mở nhiều tab dồn thời gian → single active round + ordered submission (BR-10, 9.2, 9.3)
- [ ] Liệt kê toàn bộ pool bằng nhiều round rồi chơi điểm tuyệt đối → **rủi ro tồn dư đã chấp nhận** (section 12, hệ quả của N4 + BR-16)
- [ ] Brute force login → rate limit 10/15min per IP; chưa có account lockout (Q11)

### Timing & State

- [x] Access token hết hạn giữa lượt → refresh rồi retry (section 13)
- [x] Double-submit một step → 409, không ghi đè (9.1)
- [x] Bỏ dở lượt → `abandoned` sau 2h, quay lại trong 2h thì chơi tiếp (8.1, 8.6)
- [x] Hết giờ một step Bug Hunt → server khoá cứng 0 điểm, `409 STEP_EXPIRED`, vẫn trả reveal (8.2, BR-03a)
- [x] Rời đi rồi quay lại khi step đã quá hạn → chốt 0 điểm lúc đó, không có step treo (8.2 điều kiện C)
- [x] Server crash giữa round → `last_activity_at` quá 2h, cron dọn (8.1)

### Data Integrity

- [x] Item bị ẩn giữa round → `voided`, loại khỏi tử số lẫn mẫu số (8.3)
- [x] Rescore làm tụt điểm → `max(cũ, mới)` (BR-15)
- [x] Trùng nội dung y hệt → UNIQUE trên `content_hash` (BR-06)
- [ ] Trùng về ý (khác chữ, cùng bài học) → hạn ngạch A5 giảm nhẹ, không chặn tuyệt đối
- [x] Xoá content item đang được tham chiếu → FK RESTRICT trên `round_items.content_item_id`; muốn bỏ item thì đặt `hidden`, không xoá
- [x] Xoá user → CASCADE xuống `auth_sessions` và `content_reports`; `game_rounds` thì **cần quyết** (Q12)

### Concurrency

- [x] Hai tab cùng refresh token → shared in-flight promise (section 13)
- [x] Hai tab cùng mở round → unique partial index → 409 (9.3)
- [x] Hai request cùng chấm một step → transaction + kiểm `answered_at` (9.1)
- [x] Cron chạy chồng → Postgres advisory lock (BR-11)

### External Dependencies

- [x] Gemini hết quota / lỗi → log, backoff, không chuyển provider trả phí (8.5)
- [x] Pool cạn → 422, game khác không ảnh hưởng (8.4)
- [ ] Neon ngủ đông / hết connection → connection pool + retry; chưa verify hành vi free tier (Q8)
- [ ] Render cold start → lần mở đầu buổi họp bị chờ (Q8)

## 17. Test Scenarios

### Happy Path

1. Đăng ký → đăng nhập → chơi hết 8 step Bug Hunt → nhận `summary` → thấy tên mình trên leaderboard đúng vị trí
2. Chơi lượt thứ hai điểm thấp hơn → best-score **không** giảm (BR-05)
3. Chơi đủ 4 game → tổng leaderboard bằng đúng tổng 4 best-score
4. Chơi PROD Roulette: chọn hết nhánh rủi ro 0 → điểm 100; chọn nhánh rủi ro 45 + 20 → điểm 35 (BR-18, `prod-roulette.js:86`)
5. Chơi Incident: chọn 3 action rồi `declare_cause`, chọn đúng nguyên nhân → điểm = 70 + bonus thời gian mô phỏng + bonus key (BR-03b, `incident.js:156-158`)

### Edge Cases

1. Gửi cùng `stepSeq` hai lần → lần hai 409, `effect` không đổi
2. Gửi `stepSeq = 3` khi đang chờ `2` → 409 `STEP_OUT_OF_ORDER`
3. Bug Hunt: chờ quá 60s rồi gửi **đáp án đúng** → `409 STEP_EXPIRED`, step chốt **0 điểm**, `choice` bị bỏ qua; response vẫn kèm `reveal` và `next_step` (8.2 điều kiện B)
3b. Bug Hunt: gửi `{ "line": null, "category_id": null }` **trước** 60s → 0 điểm, `200`, không phải 409 (8.2 điều kiện A)
3c. Bug Hunt: rời đi 5 phút rồi gọi `GET /rounds/:id` → step quá hạn được chốt 0 điểm ngay, trả về step kế, không có step nào treo (8.2 điều kiện C)
4. Hai tab cùng POST `/rounds` → tab thứ hai nhận 409 `ROUND_ALREADY_ACTIVE` kèm `round_id`
5. F5 giữa lượt → `GET /rounds/:id` trả đúng step đang chờ, đồng hồ **không** reset
6. Report một item đủ ngưỡng A4 → item `hidden`, round finished chứa item đó rescore, điểm **không giảm** (BR-15)
7. Pool còn 5 item khi Bug Hunt cần 8 → 422 `POOL_EXHAUSTED`; PROD Roulette (cần 1) vẫn chơi được
8. Round khách chơi xong → `summary.counts_toward_leaderboard = false`, không xuất hiện trên bảng xếp hạng
9. `option_index` = 99 khi chỉ có 3 option → 400 `INVALID_CHOICE`, gửi lại đúng vẫn được chấp nhận
10. User chơi 2/4 game với điểm 98 và 92 → `total = 190`, `games_played = 2`, xếp **dưới** user chơi đủ 4 game mỗi game 60 điểm (`total = 240`) — đúng theo A7
11. Xoá một round đang được `leaderboard_best.best_round_id` trỏ tới → DELETE thành công, cột về `null`, `best_score` giữ nguyên (blocker #1 của review 1.1)
12. Cron dọn round khách chạy khi có guest round từng là best-round → không lỗi NOT NULL violation

### Security Tests

1. Gọi `POST /rounds/:id/steps/1` với `roundId` của user khác → 404 (không phải 403, tránh lộ tồn tại)
2. Kiểm `prompt` của mọi step kind **không** chứa field nào ngoài allowlist 5.3 — đặc biệt `key`, `result` chưa chọn, `next`, `risk` của option chưa chọn, `good`, `correct`, `a`, `r`, `why`
3. Kiểm `reveal` của `incident.action` chỉ chứa `result` của action vừa chọn, không chứa `key`
4. Gửi `elapsed_seconds` trong body `/steps` → server bỏ qua hoàn toàn
5. Gọi `/admin/*` bằng token `role = 'player'` → 403
6. Đăng ký với `display_name` chứa payload XSS → leaderboard render qua `textContent`, không thực thi
7. 11 lần login sai liên tiếp từ một IP → lần 11 nhận 429
8. Gửi `option_index` theo thứ tự gốc trong DB thay vì thứ tự đã nhận → chấm sai/đúng theo `order_map`, không lộ lợi thế

### Generation Tests

1. Gemini trả JSON thiếu `explanation` → validator reject, `status = 'rejected'`, không vào pool
2. Bug Hunt có `answerLines: [99]` trong khi `code` chỉ 10 dòng → reject
3. PROD Roulette có `next` trỏ node không tồn tại → reject
4. PROD Roulette có nhánh không tới được node `end` → reject
5. Incident có 2 `causes.correct = true` → reject
6. Spec Detective có 0 hoặc 2 `followUp.options.good = true` → reject
7. Sinh item trùng `content_hash` → `rejected_duplicate`, đếm đúng trong `generation_runs`
8. Tổ hợp `(bug-hunt, sql-injection, PHP / Laravel)` đã đầy hạn ngạch A5 → `rejected_quota`
9. Hai tick cron chạy chồng → tick thứ hai không lấy được advisory lock, thoát ngay, không sinh trùng

### Performance Tests

1. 20 người chơi đồng thời, mỗi người 1 round → `/steps` p95 < 400 ms, không lỗi connection pool

## 18. Open Questions

- [ ] **Q2**: Xác nhận công thức xếp hạng BR-05 (tổng best-score 4 game)? → Chủ project
- [ ] **Q3**: Đọc ToS free tier Gemini, xác nhận cho phép dùng trong app nội bộ trên host public. **Owner: chủ project. Hạn: trước khi bắt đầu P2** → Chủ project
- [ ] **Q7**: Điểm đang có trong `localStorage` — bỏ (khuyến nghị) hay cho import lần đầu login? → Chủ project
- [ ] **Q8**: Free tier Render và Neon có ngủ đông / giới hạn connection không? → Cần verify
- [ ] **Q9**: Bao nhiêu người dùng thật và tần suất chơi? → Chủ project
- [ ] **Q10**: Xác nhận bật `ALLOW_ANONYMOUS_PLAY` (BR-16)? Bật thì giữ được use case "chiếu màn hình đầu buổi họp" nhưng tăng bề mặt liệt kê pool → Chủ project
- [ ] **Q11**: Có cần account lockout sau N lần login sai, hay rate limit theo IP là đủ? → Chủ project
- [ ] **Q12**: Xoá user thì `game_rounds` xử lý thế nào — RESTRICT, hay ẩn danh hoá để giữ lịch sử leaderboard? → Chủ project
- [ ] **Q14**: Cron chạy tần suất nào và sinh tối đa bao nhiêu item mỗi lần? → Chủ project
- [ ] **Q15**: Ngân hàng viết tay giữ làm nền (khuyến nghị) hay bỏ hẳn? → Chủ project
- [ ] **Q16**: Luồng "sau incident thật viết thêm kịch bản" trong `README.md` còn giữ không? Nếu còn cần UI nhập tay cho admin → Chủ project
- [ ] **Q17**: Phần thưởng cụ thể là gì, ai duyệt, chu kỳ nào? → Chủ project / PM
- [ ] **Q18**: Xác nhận mô hình step giữ state trong `game_rounds.state` (DB) thay vì server memory? Cần thiết nếu Render có nhiều instance hoặc restart → Dev
- [ ] **Q21**: Xác nhận giá trị A5 (hạn ngạch) và A6 (pool tối thiểu) dưới đây? → Chủ project

> Q4, Q5, Q6, Q19, Q20 của phiên bản 1.0 đã được chốt thành A5, A6, A4, BR-15, BR-16.

**Giả định và quyết định** (đánh dấu rõ để dễ đảo ngược):

- **A1 — ĐÃ CHỐT (2026-08-17, chủ project)**: Email + password, **không có luồng gửi email nào** ở P1. Quên mật khẩu → admin reset qua `POST /admin/users/:userId/reset-password`. Lý do: né hoàn toàn nhóm rủi ro "hành động không thu hồi được" của `nta-prod-safety.md`. *Đánh đổi đã chấp nhận: admin phải reset mật khẩu thủ công; nếu số lần reset trở nên phiền thì OAuth Google là đường nâng cấp, đổi được mà không đụng schema `users` ngoài việc thêm cột provider.*
- **A2 — ĐÃ CHỐT (2026-08-17, chủ project)**: Backend Node.js + Express, Postgres qua `pg` với connection pool. Lý do: một ngôn ngữ cho cả frontend lẫn backend, và Render có runtime Node sẵn nên không cần Docker.
- **A3**: Access token 15 phút, refresh token 14 ngày, rotation mỗi lần refresh.
- **A4**: Ngưỡng report tự ẩn = 3.
- **A5**: Hạn ngạch = **8 item** mỗi tổ hợp `(game_id, category, lang)`. Với Bug Hunt (10 category × ~5 lang) trần lý thuyết ~400 câu; 3 game còn lại `lang = ''` nên trần = 8 × số category.
- **A6**: Pool tối thiểu trước khi bật khen thưởng = **5 lần kích thước lượt**: Bug Hunt 40, Spec Detective 20, PROD Roulette 5, Incident 5. Dưới ngưỡng này cron ưu tiên sinh thêm; leaderboard vẫn chạy nhưng khen thưởng chưa bật.
- **A7**: Xếp hạng tổng tính **game chưa chơi = 0**, một bảng duy nhất cho mọi người. Kèm `games_played` để minh bạch. Lý do chọn thay vì "chỉ xếp hạng người đủ 4 game": giữ một bảng duy nhất, và khuyến khích chơi đủ 4 kỹ năng thay vì luyện mỗi một game — đúng mục đích của công cụ.
- **A8**: Retention — `round_steps` giữ 90 ngày, `game_rounds`/`round_items` của user thật giữ vĩnh viễn, round khách 24 giờ, item `rejected` 30 ngày. Bảng đầy đủ ở section 14.

## 19. Dependencies & Impact

**Phụ thuộc vào**:

- Tài khoản Render + Neon đã cấp và có credential (B5)
- Gemini API key free tier (N8)
- Ngân hàng viết tay hiện có, dùng làm pool khởi đầu cho P1

**Ảnh hưởng đến**:

| Module | Ảnh hưởng |
|---|---|
| `js/app.js:56-90` | State layer thay bằng API client |
| `js/app.js:226-233` | Contract Shell ↔ Game đổi: game không tự chấm điểm, nhận step từ server |
| `js/games/bug-hunt.js:126-190` | Bỏ `lockIn` chấm điểm, giữ render + gửi choice |
| `js/games/spec-detective.js:121,150` | Bỏ tính `segPts`/`followPts`, chuyển 2 bước thành 2 step |
| `js/games/prod-roulette.js:86` | Bỏ cộng dồn `risk` phía client, mỗi node là 1 step |
| `js/games/incident.js:83,156-158` | Bỏ cộng dồn `spent` và tính score, mỗi action là 1 step |
| `data/*.js` (4 file) | Xoá, thay bằng `content_items` |
| `index.html` | Bỏ 4 thẻ `<script src="data/…">` |
| `README.md` | Viết lại phần hướng dẫn thêm case và phần "cách dùng trong team" |
| `CLAUDE.md` | 4/8 quy tắc bị vô hiệu (không dependency, không build, ES5, `file://`) |
| `docs/diagram/*` | 2 diagram mô tả kiến trúc cũ, cần vẽ lại |

**Migration cần thiết**: YES — tạo 9 bảng mới, seed `content_items` từ 4 file `data/*.js` với `source = 'handwritten'`, tạo bootstrap admin từ env.

**Breaking change**: YES — bỏ chế độ chạy offline `file://`. Điểm trong `localStorage` không mang sang (trừ khi Q7 quyết khác).

## 20. Change Log

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-08-17 | — | Initial draft từ `docs/clarify/clarify_devlab-arcade-v2.md` |
| 1.1 | 2026-08-17 | — | Sửa toàn bộ 6 blocker + 8 warning + 4 suggestion của `/nta-spec-review`. Thay đổi lớn: (1) API chuyển từ mô hình item sang **step**, thêm `round_steps`, `game_rounds.state`, `GET /rounds/:id`, bỏ `/finish`; (2) BR-02 chuyển từ blocklist sang **allowlist** (section 5.3 mới); (3) tách BR-03 thành 03a/03b/03c vì Incident dùng ngân sách mô phỏng chứ không phải đồng hồ thật; (4) thêm section 4.4 công thức chấm điểm verify từ source; (5) guest play dùng `user_id` nullable + `is_guest`; (6) thêm BR-15 (rescore không giảm điểm), BR-16 (guest), BR-17 (lưu thứ tự đã xáo), BR-18 (port nguyên công thức); (7) `category`/`lang` NOT NULL DEFAULT `''`; (8) thêm A5/A6, endpoint admin reset password, `ALREADY_REPORTED`, bootstrap admin, unique partial index chống race, advisory lock cho cron, retention 30 ngày cho item `rejected`. Hai điểm phát hiện khi tự kiểm bản 1.1: (9) BR-04 bổ sung xử lý trường hợp **mọi item của lượt đều bị void** (chia cho 0 với 2 game 1-item); (10) leaderboard cache đổi từ materialized view sang **bảng thường `leaderboard_best` + UPSERT**, vì `REFRESH MATERIALIZED VIEW CONCURRENTLY` không chạy được trong transaction block của Postgres |
| 1.2 | 2026-08-17 | — | Sửa 2 blocker + 6 warning + 3 suggestion của lần review bản 1.1. **Blocker**: (1) `leaderboard_best.best_round_id` đổi sang nullable — `ON DELETE SET NULL` trên cột NOT NULL sẽ fail lúc cron dọn round khách; (2) **Bug Hunt hết 60s giờ khoá cứng ở server** (`409 STEP_EXPIRED`, 0 điểm, bỏ qua `choice`) — bản 1.1 cho trả lời không giới hạn thời gian thật, vừa lệch `bug-hunt.js:123` vừa mở đường tra Google trong bảng xếp hạng có thưởng; thêm cột `round_steps.expires_at`. **Warning**: (3) A7 chốt game chưa chơi tính 0 + trả `games_played`; (4) `round_steps.order_map` đổi thành `order_map smallint[]` + `content_snapshot_hash` để không nhân bản nội dung; (5) A8 retention `round_steps` 90 ngày; (6) bỏ IP khỏi ownership của round khách, chỉ dùng rate limit; (7) thêm response shape cho `GET /games`; (8) ghi rõ khi nào tăng `served_count`. **Suggestion**: (9) bỏ `step_seq` trùng trong `progress`; (10) `state` gom phần cục bộ vào `current_item` để Spec Detective 4 item không đọc nhầm điểm item trước; (11) thêm `ck_game_rounds_guest_ip` |
| 1.4 | 2026-08-18 | — | Hai bổ sung phát hiện khi implement round/step engine, không đổi quyết định nào đã chốt: (1) object `step` thêm `expires_at` — chỉ `time_limit_seconds` thì client không dựng lại được đồng hồ đúng sau khi F5, vì BR-03a cấm cấp `served_at` mới; (2) `GET /rounds/:id` thêm `expired_step` và `summary` cho luồng 8.2 điều kiện C, vì khi step quá hạn là step cuối thì lượt chơi kết thúc ngay trong chính request đó và không còn step nào để trả |
| 1.3 | 2026-08-17 | — | Không đổi nội dung kỹ thuật. Chủ project xác nhận giữ nguyên **A1** (email + password, không gửi email, admin reset tay) và **A2** (Node.js + Express) — cả hai chuyển từ *giả định* sang *quyết định đã chốt* kèm ngày và người quyết. Đóng Q1 và Q13. Số Open Questions còn 13 |

---

## 21. Tóm tắt xác nhận *(Dành cho team review — xoá trước khi gửi khách hàng)*

**Tính năng**: DevLab Arcade v2 — thêm tài khoản, chấm điểm phía server, bảng xếp hạng công ty, và ngân hàng câu hỏi do AI sinh.

**Mục đích**: v1 chỉ lưu điểm trên từng máy nên không có động lực cạnh tranh, và ngân hàng câu hỏi viết tay cạn sau vài lượt chơi. v2 giải quyết cả hai.

**Những điểm cần team xác nhận:**

- [ ] **Mô hình step (section 5)** — chỉ Bug Hunt là "một câu một đáp án". Spec Detective 2 bước/case, PROD Roulette và Incident là chuỗi bước biến thiên trong 1 kịch bản. API phải theo step, không theo item
- [ ] **BR-02 allowlist (section 5.3)** — server chỉ gửi field có tên trong bảng; thêm field mới vào payload mặc định bị giấu
- [ ] **BR-03a/b/c** — Bug Hunt dùng đồng hồ thật, Incident dùng ngân sách mô phỏng, 2 game còn lại không có thời gian
- [ ] **BR-05** — xếp hạng bằng tổng best-score 4 game, không dùng XP cộng dồn
- [ ] **BR-12 + A1** — P1 không gửi email nào; quên mật khẩu thì admin reset tay qua endpoint riêng
- [ ] **BR-15** — rescore sau khi ẩn item lấy `max(cũ, mới)`, điểm không bao giờ giảm vì lỗi nội dung
- [ ] **BR-03a — Bug Hunt khoá cứng ở 60 giây.** Trả lời sau ngưỡng bị bỏ qua, chốt 0 điểm. Giữ đúng hành vi game hiện tại và chặn việc tra cứu đáp án giữa chừng
- [ ] **A5 = 8 item/tổ hợp, A6 = 5× kích thước lượt** — hai con số này quyết định khi nào bật khen thưởng
- [ ] **A7 — game chưa chơi tính 0 điểm** trong xếp hạng tổng. Người chơi đủ 4 game mức trung bình sẽ xếp trên người chơi 1 game điểm tuyệt đối. Đây là lựa chọn có chủ đích (khuyến khích luyện đủ 4 kỹ năng), kèm `games_played` để minh bạch
- [ ] **A8 — retention**: `round_steps` giữ 90 ngày, round khách 24 giờ, item `rejected` 30 ngày
- [ ] **Rủi ro tồn dư** — liệt kê pool bằng nhiều round vẫn khả thi do đăng ký tự do (N4); rate limit chỉ làm chậm

**Ảnh hưởng đến phần khác:**

- Toàn bộ `js/app.js`, 4 file `js/games/*.js` (cả 4 đều phải bỏ phần chấm điểm), 4 file `data/*.js`, `index.html`, `README.md`, `CLAUDE.md`, 2 diagram

**Không nằm trong scope lần này:**

- **P4 — UI pixel-art**: tách spec riêng, làm song song được
- Leaderboard theo team/phòng ban
- Reset leaderboard theo mùa/sprint
- Avatar
- Báo cáo cho manager
- Nhập tay content qua UI admin (phụ thuộc Q16)
