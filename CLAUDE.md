# DevLab Arcade

Bốn bài tập dạng game (code review, đọc spec, an toàn production, xử lý sự cố) dùng để
warm-up đầu buổi họp team, onboarding, hoặc luyện solo 10 phút.

## Tech Stack
- Language: JavaScript ES5 (IIFE + `'use strict'`, dùng `var` — không `let`/`const`/arrow ở toàn bộ 9 file JS)
- Framework: không có — vanilla DOM API, không dependency, không build step
- Database: không có — `localStorage` (key `devlab-arcade-v1` cho điểm, `devlab-arcade-theme` cho theme)
- Frontend: HTML + CSS thuần, theme sáng/tối bằng CSS variable trên `html[data-theme]`
- Infrastructure: không có — mở `index.html` bằng `file://` là chạy
- Architecture: plugin registry — mỗi game tự đăng ký vào `window.DevLabGames`, `js/app.js` là khung điều phối

Project cố ý **không có** package.json / bundler / server. Đây là ràng buộc thiết kế, không
phải thiếu sót — xem "Quy tắc của project" bên dưới.

## Project Conventions

### Naming
- File, thư mục: kebab-case (`bug-hunt.js`, `spec-detective.data.js`, `prod-roulette.js`)
- File data: `{game-id}.data.js` — luôn khớp với `{game-id}.js` trong `js/games/`
- Biến, hàm: camelCase (`renderQuestion`, `pickedLine`, `stopTimer`)
- Hằng số trong module: SCREAMING_SNAKE_CASE (`QUESTIONS_PER_ROUND`, `SECONDS_PER_QUESTION`, `STORAGE_KEY`)
- Global data trên `window`: SCREAMING_SNAKE_CASE (`BUG_HUNT_QUESTIONS`, `INCIDENT_SCENARIOS`, `PROD_ROULETTE_SCENARIOS`, `SPEC_DETECTIVE_CASES`)
- Game id: kebab-case, khớp tên file (`bug-hunt`, `spec-detective`, `prod-roulette`, `incident`)
- CSS class: kebab-case (`game-card`, `code-line`, `progress-fill`, `btn-row`)
- CSS variable: kebab-case có tiền tố ngữ nghĩa (`--bg-card`, `--text-dim`, `--good-soft`)
- Id trong data phải khớp giữa 2 nơi: `question.category` phải tồn tại trong `BUG_HUNT_CATEGORIES[].id`

### Architecture
Thứ tự nạp script trong `index.html` là bắt buộc: `data/*.js` → `js/games/*.js` → `js/app.js`.

| Layer | Vị trí | Trách nhiệm |
|---|---|---|
| Data | `data/*.js` | Ngân hàng nội dung thuần, gán vào `window.*`. Không có logic |
| Game | `js/games/*.js` | Luật chơi, render, chấm điểm. Push object vào `window.DevLabGames` |
| Shell | `js/app.js` | Hub, điều hướng, `localStorage`, màn hình kết quả, theme |
| Style | `css/styles.css` | Toàn bộ CSS, theme qua CSS variable |

Contract giữa Shell và Game (`js/app.js:226-233`):

```js
window.DevLabGames.push({
  id, icon, name, tagline, skill, duration,
  start: function (mount, api) { /* ... */ }
});
```

`api` cung cấp: `h`, `clear`, `shuffle`, `finish(result)`, `quit()`, `replay()`.
Game kết thúc bằng `api.finish({ score, breakdown, notes })`.

- `score`: 0–100, được clamp lại ở `js/app.js:238`
- `breakdown`: mảng `{ ok, text, pts }`
- `notes`: mảng `{ tone, title, body }` — `tone` là `''` / `'good'` / `'warn'` / `'bad'`

Game **không** tự đụng vào `localStorage` hay DOM ngoài `mount` — việc lưu điểm và điều
hướng thuộc về `js/app.js`.

### DOM Conventions
- Tạo element qua helper `h(tag, attrs, children)` (`js/app.js:19`), không viết HTML string
- `h` hỗ trợ `class`, `text`, `onclick`, `disabled`, còn lại đổ vào `setAttribute`
- Mọi text từ data render qua `textContent` — **không dùng `innerHTML`** (`js/app.js:27`, `js/app.js:35`)
- Xoá nội dung bằng `clear(node)`, không gán `innerHTML = ''`

### Data Conventions
- Data để ở `.js` chứ không `.json`: mở bằng `file://` thì `fetch()` file JSON bị CORS chặn,
  `<script src>` thì không. **Không đổi sang JSON** nếu vẫn muốn giữ tính chất "mở là chạy"
- Mỗi file data mở đầu bằng comment hướng dẫn team thay nội dung mẫu bằng case thật
- Danh sách lựa chọn hiển thị cho người chơi **bắt buộc** xáo bằng `api.shuffle`: nếu để nguyên
  thứ tự trong data, đáp án tốt luôn nằm đầu và bấm bừa vẫn được điểm cao

### Error Handling
- Mọi truy cập `localStorage` bọc trong `try/catch` và bỏ qua lỗi — chế độ riêng tư của trình
  duyệt chặn ghi, khi đó chỉ mất phần lưu điểm, app vẫn chạy (`js/app.js:73-79`, `js/app.js:300`)
- `loadState()` luôn trả về object đủ field, kể cả khi JSON hỏng (`js/app.js:56-71`)
- Game phải xử lý trường hợp ngân hàng data rỗng, hiển thị thông báo thay vì crash
  (`js/games/bug-hunt.js:222-225`)
- Không có network call nên không có error handling cho I/O

### Test Conventions
Chưa có test framework (không có `package.json`). Cách verify đang dùng:

- Syntax: `node --check` từng file JS
- Smoke test: script dựng DOM shim, chơi hết 4 game, assert điểm và luồng
- UI: Playwright ở 1280px và 390px, kiểm tra 0 lỗi console

Khi thêm game mới, tối thiểu phải verify: `node --check` pass, chơi hết 1 lượt ra được màn
hình kết quả, `score` nằm trong 0–100.

## Lệnh thường dùng
```bash
# Chạy: mở trực tiếp, không cần server
start index.html                      # Windows
python -m http.server 8000            # nếu cần http:// (không bắt buộc)

# Kiểm tra syntax toàn bộ JS
node --check js/app.js
for f in js/games/*.js data/*.js; do node --check "$f"; done
```

## Quy tắc của project
- **Không thêm dependency, không thêm build step.** Giá trị cốt lõi là "clone về, mở
  `index.html` là chạy". Mọi đề xuất thêm npm/bundler/framework phải hỏi trước
- **Không dùng `innerHTML`** — data do team tự viết nhưng vẫn render qua `textContent`
- **Không đổi data từ `.js` sang `.json`** — sẽ vỡ khi mở bằng `file://`
- **Xáo thứ tự lựa chọn bằng `api.shuffle`** ở mọi danh sách người chơi phải chọn
- **Font code phải tắt ligature** (`--mono` dùng Cascadia Mono + `font-variant-ligatures: none`):
  font có ligature vẽ `->` thành `→`, `>=` thành `≥` — sai so với code thật đang review
- **Giữ ES5**: `var`, `function`, không arrow / template literal / optional chaining — nhất
  quán với 9 file hiện có
- **Thêm game mới**: tạo `js/games/{id}.js` + `data/{id}.data.js`, khai báo `<script>` trong
  `index.html` **trước** `js/app.js`, kết thúc gọi `api.finish()` với score 0–100
```

