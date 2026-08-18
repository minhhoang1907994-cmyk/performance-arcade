# DevLab Arcade — backend

Theo `docs/spec/devlab-arcade-v2.md` v1.4. Giai đoạn hiện tại: **P1 — nội dung, auth,
round/step engine**.

Chỉ có đúng hai dependency: `express` và `pg`, theo quyết định A2. Băm mật khẩu
(scrypt), JWT HS256 và rate limit đều dùng built-in của Node, không thêm thư viện.

## Đã có

```
server/
  migrations/001_init.sql            9 bảng theo spec section 4.2
  scripts/
    extract-legacy-content.js        data/*.js  →  định dạng content_items
    migrate.js                       áp migration + tạo admin đầu tiên
    seed-legacy.js                   nạp 24 mục viết tay vào content_items
  src/
    config.js                        đọc env, kiểm ngay lúc khởi động
    server.js                        điểm khởi động, tắt gọn khi nhận SIGTERM
    db/pool.js                       pool (max 5) + withTransaction
    content/                         hash, categories, 4 validator
    auth/                            password, jwt, repository, service, routes
    rounds/
      engines/                       luật chơi 4 game, thuần hàm, không đụng DB
      shuffle.js                     order_map + ánh xạ ngược (BR-08, BR-17)
      scoring.js                     điểm lượt: trung bình, làm tròn, clamp (BR-04)
      repository.js                  truy vấn round/step/leaderboard_best
      service.js                     transaction, quyền sở hữu, thứ tự step
      routes.js                      POST /rounds, GET /rounds/:id, /steps, /abandon
    http/                            app, errors, cookies, 3 middleware
  test/
    validators.test.js               bộ test vàng + test âm
    auth-crypto.test.js              scrypt, JWT, email, cookie
    rounds-engine.test.js            công thức 4 game + allowlist, không cần DB
    auth-integration.test.js         HTTP thật + Postgres thật (bỏ qua nếu thiếu DATABASE_URL)
    rounds-integration.test.js       chơi hết lượt, hết giờ, double-submit, pool cạn
```

## Chạy

```bash
cd server
npm install
cp .env.example .env      # rồi điền DATABASE_URL và JWT_SECRET

npm test                  # 77 test không cần DB
npm run migrate           # áp migration + tạo admin từ env
npm run seed:legacy       # nạp 24 mục viết tay
npm start
```

Sinh `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Chạy đầy đủ cả integration test

Không có Postgres local thì dùng container tạm:

```bash
docker run -d --rm --name devlab-pg -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=devlab_dev -p 55432:5432 postgres:17-alpine

cd server
DATABASE_URL="postgres://postgres:dev@localhost:55432/devlab_dev" \
JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" \
BOOTSTRAP_ADMIN_EMAIL=admin@devlab.test \
BOOTSTRAP_ADMIN_PASSWORD=admin-pass-123 \
npm test

docker stop devlab-pg
```

Integration test tự chạy migration và seed, nên không cần chuẩn bị DB trước.

## Vì sao bank viết tay là bộ test vàng

24 mục trong `data/*.js` do người viết và đã chạy đúng trong bản v1. Chúng phải pass
validator 100%. **Mục nào fail nghĩa là validator sai, không phải data sai.**

Nguyên tắc này đã bắt được hai lỗi validator ngay trong lần chạy đầu:

1. `correct` và `good` trong data v1 được viết tường minh cả `true` lẫn `false`, trong
   khi `key` và `a` chỉ xuất hiện khi true. Validator ban đầu ép một kiểu duy nhất.
2. Segment **không** mơ hồ của Spec Detective vẫn được phép có `r`. Đó là lời giải
   thích riêng hiện ra khi người chơi bấm nhầm
   (`js/games/spec-detective.js:115` — `seg.r || 'Đoạn này đủ rõ…'`), không phải dữ
   liệu thừa. Validator ban đầu từ chối nó.

Cả hai đều là hiểu sai đặc tả, và cả hai đều sẽ lọt nếu chỉ test bằng dữ liệu tự bịa.

## Ghi chú thiết kế

- **Validator chặt có chủ đích.** Quyết định N3 là publish thẳng, không human review,
  nên đây là lớp kiểm soát chất lượng duy nhất. Field lạ cũng bị từ chối: nó nghĩa là
  AI không bám schema, và theo allowlist BR-02 field đó cũng sẽ bị lược khi gửi client.
- **PROD Roulette cần duyệt đồ thị**, không chỉ kiểm field. Hai lỗi chí tử chỉ DFS mới
  bắt được: `next` trỏ node không tồn tại (game treo trắng màn hình) và chu trình không
  đi qua node `end` (người chơi đi mãi không hết lượt).
- **Incident kiểm tổng cost của action `key` so với `budget`.** Không có ràng buộc này,
  AI sinh được kịch bản mà người chơi không thể lấy hết manh mối dù chơi tối ưu.
- **`content_hash` giữ nguyên thứ tự mảng.** Thứ tự dòng code và thứ tự option là một
  phần nội dung, không được chuẩn hoá đi — chỉ sắp xếp khoá của object.

## Ghi chú về auth

- **scrypt thay cho bcrypt/argon2**: có sẵn trong Node nên không thêm dependency, và
  không phải native module nên build trên Render không có rủi ro toolchain. Tham số
  cost nằm trong chuỗi hash để sau này tăng cost mà vẫn verify được hash cũ.
- **JWT tự viết** (`src/auth/jwt.js`, ~90 dòng): phạm vi rất hẹp — một thuật toán, token
  do chính server này phát. Hai lỗ hổng kinh điển đều được chặn tường minh và có test:
  alg confusion (`alg: none` bị từ chối) và so sánh chữ ký bằng `timingSafeEqual`.
- **Login không phân biệt "sai mật khẩu" với "email không tồn tại"**: cùng mã lỗi, cùng
  body, và luôn chạy `verifyPassword` kể cả khi không tìm thấy user để thời gian phản hồi
  không tiết lộ email nào đã đăng ký.
- **Refresh token xoay vòng mỗi lần dùng** (A3): dùng lại token cũ bị từ chối. Có test.
- **Rate limit lưu trong bộ nhớ tiến trình** — bộ đếm không chia sẻ giữa các instance.
  Render free tier chạy một instance nên hiện đúng; scale ngang thì phải chuyển sang
  store dùng chung.

## Ghi chú về round/step engine

- **Luật chơi tách khỏi transaction.** `rounds/engines/*` là hàm thuần: nhận payload +
  step + lựa chọn, trả về reveal/effect/step kế. `rounds/service.js` chỉ lo transaction,
  quyền sở hữu và thứ tự step. Nhờ vậy toàn bộ công thức chấm điểm test được không cần
  Postgres, và luật của 4 game không lẫn vào nhau.
- **Bốn game bốn hình dạng khác nhau.** Chỉ Bug Hunt là "một câu một đáp án". Spec
  Detective 2 step mỗi item, PROD Roulette và Incident là chuỗi step biến thiên trong
  một kịch bản. Đừng áp một mô hình chung cho cả bốn.
- **Chỉ Bug Hunt dùng đồng hồ thật.** `expires_at` tính bằng SQL trong chính câu lệnh
  INSERT step, không tính bằng đồng hồ Node — `served_at` mặc định `now()` của cùng câu
  lệnh đó, tính ở hai nơi thì hai mốc lệch nhau và bonus tốc độ chấm sai ở biên.
- **409 `STEP_EXPIRED` không được ném từ trong transaction.** Ném là ROLLBACK, và việc
  chốt step quá hạn ở 0 điểm bị huỷ theo — người chơi F5 lại thì step vẫn treo. Service
  trả cờ về, route dịch thành 409 sau khi đã COMMIT. Có test khẳng định `answered_at`
  thực sự nằm lại trong DB.
- **`round_items` và `content_items` đều có cột `id`.** Trộn hai hàng bằng spread là
  `round_item_id` hoá thành `content_item_id`; FK vẫn tồn tại nên lỗi chỉ nổ ở INSERT
  `round_steps` chứ không nổ ở chỗ gây ra. Ghép tường minh từng field.
- **`order_map` của Incident được chép sang step kế** thay vì xáo lại mỗi bước: danh
  sách hành động nhảy vị trí sau mỗi lần bấm thì không đọc được. Lựa chọn của Incident
  đi bằng `action_id` nên order_map ở đây chỉ phục vụ hiển thị.

## Chưa làm

Leaderboard (`GET /leaderboard`), lịch sử (`GET /me/history`), report câu sai, các endpoint
admin nội dung, cron dọn round quá hạn / round khách, pipeline gọi Gemini.
Xem `docs/spec/devlab-arcade-v2.md` section 5 và 13 Open Questions ở section 18.
