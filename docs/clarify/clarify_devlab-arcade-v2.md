# Clarification Report — DevLab Arcade v2

**Ngày**: 2026-08-17
**Người yêu cầu**: chủ project (chịu trách nhiệm hạ tầng và chi phí)
**Ticket**: chưa có
**Trạng thái**: BLOCKER đã đóng hết — đủ điều kiện chuyển sang viết spec

---

## 1. Yêu cầu

Nâng DevLab Arcade từ web app static (mở `index.html` bằng `file://` là chạy, điểm lưu trong
`localStorage`) thành ứng dụng client-server:

- Host trên Render, public internet
- Đăng ký tài khoản + đăng nhập
- Ghi nhận điểm từng game theo user
- Bảng xếp hạng tổng across 4 game, **có tính cạnh tranh / khen thưởng**
- DB Postgres trên Neon
- Đổi giao diện sang phong cách 2D game sáng (Mario / Evoland / Stardew Valley / Nexomon)
- Ngân hàng câu hỏi do AI tự sinh

---

## 2. Quyết định đã chốt

| # | Điểm | Quyết định | Người quyết |
|---|---|---|---|
| B1 | Tính chất leaderboard | **Có tính cạnh tranh / khen thưởng** → chấm điểm bắt buộc server-side | Chủ project |
| B2 | Nguồn nội dung | **AI sinh hoàn toàn từ mô tả chung**, không paste nội dung thật của khách hàng | Chủ project |
| B3 | Phạm vi truy cập | **Public internet** | Chủ project |
| B4 | Chế độ offline | **Bỏ hẳn** `file://`, chuyển hẳn sang server | Chủ project |
| B5 | Sở hữu hạ tầng | Tài khoản Render/Neon **của chủ project**, chủ project chịu trách nhiệm và chi phí | Chủ project |
| N1 | Công bằng đề thi | **Pool lớn**, mỗi lượt bốc theo cùng công thức | Chủ project |
| N2 | Seed cho AI | AI sinh hư cấu hoàn toàn — **không** đưa case thật từ Backlog cho AI | Chủ project |
| N3 | Kiểm duyệt câu hỏi | **Publish thẳng**, không human review | Chủ project |
| N4 | Điều kiện đăng ký | **Đăng ký thoải mái**, không giới hạn | Chủ project |
| N5 | Chi phí AI | **Chỉ dùng AI free, tuyệt đối không trả phí**. Câu đã sinh ghi vào DB để tránh lặp | Chủ project |
| N6 | Độ khó | **Bỏ hẳn khái niệm độ khó**, chỉ 1 mức duy nhất | Chủ project |
| N7 | Cơ chế chống trùng | **Hạn ngạch** theo `category` + `lang` | Chủ project |
| N8 | AI provider | **Gemini 2.5 Flash** | Chủ project |

**Ghi nhận trách nhiệm** (phục vụ yêu cầu "có thể giải trình" của tiêu chuẩn NTA): chủ project là
người quyết định host public internet, bỏ human review, mở đăng ký tự do, và là người sở hữu tài
khoản Render/Neon cũng như chịu chi phí phát sinh.

---

## 3. Rủi ro đã được nêu và chấp nhận

Ba điểm dưới đây đã được nêu rõ trước khi chốt và chủ project quyết định tiến hành. Ghi lại để
sau này không phải tranh luận lại từ đầu.

### 3.1 Publish thẳng + tính điểm thật

AI sinh sai đáp án là chuyện **sẽ** xảy ra, không phải có thể. Với phần thưởng, một câu sai đủ
để mất niềm tin vào cả bảng xếp hạng.

**Biện pháp giảm thiểu — không cần người, không tốn tiền** (đề xuất đưa vào spec):

- **Validator máy trước khi vào pool.** Kiểm theo đúng ràng buộc `README.md:30-75`:
  - Bug Hunt: `answerLines` nằm trong khoảng số dòng của `code`; `category` thuộc `BUG_HUNT_CATEGORIES`
  - Spec Detective: đúng 1 `followUp.options[].good === true`
  - Incident: đúng 1 `causes[].correct === true`
  - PROD Roulette: mọi `next` trỏ node tồn tại; mọi nhánh đều tới được node `end: true`
  - Câu nào fail → tự loại, không vào pool, không cần ai duyệt
- **Nút "câu này sai"** cho người chơi; vượt ngưỡng báo cáo thì tự ẩn khỏi pool và hoàn điểm lượt dính câu đó
- **Log câu bị báo sai** để cải thiện prompt — nếu không, cùng một loại lỗi sẽ sinh lại mãi

### 3.2 Đăng ký thoải mái + public + khen thưởng

Chấm điểm server-side chặn được sửa điểm, **không** chặn được một người tạo nhiều tài khoản.

**Biện pháp giảm thiểu**: xếp hạng bằng **best-score mỗi game** thay vì XP cộng dồn. Tài khoản
clone không còn lợi thế vì chơi 100 lượt cũng chỉ lấy điểm cao nhất. Đây vừa là công thức
ranking vừa là biện pháp chống farm.

### 3.3 Free tier có điều khoản riêng

Free tier Gemini ghi rõ prompt/response **có thể được Google dùng để cải thiện sản phẩm**. Nhờ
quyết định N2 (AI sinh hư cấu hoàn toàn, không paste nội dung thật) nên rủi ro này gần như bằng 0
— nhưng đây là lý do nữa để N2 không được vi phạm về sau.

---

## 4. Lựa chọn AI provider — dữ liệu so sánh

Tra ngày 2026-08-17. **Hạn mức free thay đổi liên tục — kiểm tra lại trang chính thức trước khi
thiết kế cron.**

### 4.1 Loại trừ

**Claude / Anthropic không có free tier.** Opus 5 $5/$25 mỗi triệu token, Sonnet 5 $3/$15,
Haiku 4.5 $1/$5. Không có mức $0 → bị loại theo ràng buộc N5.

### 4.2 So sánh

| Provider | Model | Giới hạn free | Điểm mạnh | Điểm yếu |
|---|---|---|---|---|
| **Gemini** | 2.5 Flash | 10 RPM · 250 req/ngày · 250K TPM | Chất lượng cao nhất nhóm free; context 1M; structured output theo JSON schema | Free tier có thể dùng data cải thiện sản phẩm |
| | 2.5 Pro | 5 RPM · 100 req/ngày | Mạnh nhất | Quota thấp |
| | 2.5 Flash-Lite | 15 RPM · 1000 req/ngày | Quota cao nhất | Yếu, không hợp Bug Hunt |
| **Groq** | `llama-3.3-70b-versatile` | 30 RPM · 1000 req/ngày · 12K TPM · 100K token/ngày | Nhanh, quota request rộng | TPM chật cho prompt dài |
| | `openai/gpt-oss-120b` | 30 RPM · 1000 req/ngày · 8K TPM · 200K token/ngày | Token/ngày gấp đôi | TPM 8K |
| **Cerebras** | Llama 4 Scout, Qwen3 32B | 30 RPM · 1 triệu token/ngày | Token/ngày rộng nhất | **Context chặn 8192 token** |

### 4.3 Quyết định: Gemini 2.5 Flash (chính), Groq `llama-3.3-70b` (dự phòng)

**Lý do chọn:**

- Chất lượng đủ để sinh code có bug cố ý kèm metadata đáp án chính xác
- Context 1M thoải mái cho PROD Roulette (đồ thị node phân nhánh, mỗi kịch bản ~5-6KB)
- Structured output theo JSON schema khớp thẳng với validator — yếu tố quyết định khi đã bỏ human review
- 250 req/ngày dư gấp nhiều lần nhu cầu

**Lý do không chọn Cerebras** dù token/ngày rộng nhất: cap context 8192 chặn đúng 2 trong 4 game.
`data/prod-roulette.data.js` nặng 17KB cho 3 kịch bản — sinh một kịch bản hoàn chỉnh trong 8K
token (input + output) là chật.

**Rate limit không phải ràng buộc thật.** Bug Hunt lấy 8 câu mỗi lượt
(`js/games/bug-hunt.js:5`); pool mục tiêu 100 câu/game × 4 game = 400 mục. Với 250 req/ngày thì
nạp đầy pool trong 2 ngày, sau đó cron bổ sung mỗi ngày vài chục câu là dư.

### 4.4 Cần tự xác nhận trước khi code

- [ ] Đọc ToS Gemini: free tier có cho phép dùng trong sản phẩm nội bộ đặt trên host public không
- [ ] Kiểm tra lại hạn mức trên trang chính thức (số liệu trong tài liệu này có thời hạn)
- [ ] API key chỉ nằm ở server, đọc từ env của Render, không bao giờ xuống client

---

## 5. Chưa rõ — cần làm rõ trước khi viết spec

### 5.1 IMPORTANT

- [ ] **Phương thức đăng nhập: email + password tự quản, hay OAuth Google/Microsoft?** → Chủ project
  > Nếu tự quản password sẽ có luồng verify email / quên mật khẩu → **gửi email thật ra ngoài**.
  > Theo `nta-prod-safety.md` điểm 4, đây là hành động không thu hồi được, phải chặn/sandbox kênh
  > gửi trước khi test. OAuth tránh được hoàn toàn nhóm rủi ro này.
- [ ] **Chốt công thức xếp hạng.** → Chủ project
  > Đề xuất best-score mỗi game (xem mục 3.2). Hiện tại XP là cộng dồn (`js/app.js:83`), 5 mốc rank
  > ở `js/app.js:10-16`.
- [ ] **Con số hạn ngạch chống trùng cụ thể** (ví dụ tối đa N câu mỗi tổ hợp `category` × `lang`) → Chủ project
- [ ] **Pool tối thiểu bao nhiêu câu mỗi game trước khi bật khen thưởng?** → Chủ project
  > Bug Hunt lấy 8 câu/lượt; pool 20 câu thì chơi 3 lượt là gặp lại hết.
- [ ] **Sinh đề theo cron hay theo lượt chơi?** → Chủ project
  > Với free tier có rate limit, cron nạp pool dần là hướng an toàn; sinh theo lượt chơi sẽ đụng
  > trần và người chơi phải chờ.
- [ ] **Ngân hàng viết tay hiện có giữ hay bỏ?** (12 câu Bug Hunt, 6 case Spec Detective, 3 kịch bản
  PROD Roulette, 3 sự cố Incident) → Chủ project
  > Đây là nội dung đã verify, nên giữ làm nền và để AI bổ sung.
- [ ] **Đồng hồ Bug Hunt phải chuyển server-side.** → Dev
  > Bonus tốc độ 20 điểm tính theo thời gian còn lại (`js/games/bug-hunt.js:136`). Client đếm giờ
  > thì sửa `remain = 999` là ăn trọn bonus. Server phát câu hỏi kèm timestamp, tính lúc nhận đáp án.
- [ ] **Đáp án chỉ trả về sau khi submit, theo từng câu.** → Dev
  > Cả 4 game hiện hiện giải thích ngay sau khi trả lời (`js/games/bug-hunt.js:160-165`) — đó là
  > giá trị học tập chính, không bỏ được. Nhưng không được nạp trước cả bộ đáp án.
- [ ] **Backend stack là gì?** (repo chưa có `package.json`) → Chủ project / Dev
- [ ] **Giới hạn free tier Render và Neon** (ngủ đông, số connection, cold start) → cần verify
  > Nếu service ngủ đông thì lần mở đầu buổi họp phải chờ — đúng use case quan trọng nhất bị ảnh hưởng.
- [ ] **Số user thật và tần suất chơi** → Chủ project
- [ ] **Xử lý điểm đang có trong localStorage của mọi người**: bỏ hay import? → Chủ project
- [ ] **Còn cho chơi ẩn danh không?** → Chủ project
  > Use case chính trong `README.md` là "chiếu lên màn hình đầu buổi họp, cả team cùng đoán". Bắt
  > login trước khi chơi sẽ cản đúng use case đó.
- [ ] **Phạm vi đổi UI pixel-art** → Chủ project
  > `css/styles.css` có 34 CSS variable và 2 theme. `CLAUDE.md` ghi ràng buộc **font code phải tắt
  > ligature** (`css/styles.css:199-201`) — font pixel-art thường không có bộ monospace đủ tốt để
  > hiển thị code review chính xác. Khối code trong Bug Hunt có thể cần giữ font hiện tại.
- [ ] **Phần thưởng cụ thể là gì, ai duyệt, chu kỳ nào?** → Chủ project / PM
- [ ] **Luồng "sau incident thật viết thêm kịch bản" trong `README.md` còn giữ không?** → Chủ project
  > Nếu còn thì cần đường nhập tay song song với AI.

### 5.2 NICE-TO-KNOW

- [ ] Leaderboard tách theo team/phòng ban? → *Assume: 1 bảng chung*
- [ ] Reset theo mùa/sprint? → *Assume: không, tích luỹ vĩnh viễn*
- [ ] Nickname/avatar? → *Assume: dùng tên từ tài khoản*
- [ ] Manager xem "ai chưa chơi PROD Roulette" (dùng cho onboarding)? → *Assume: không có trong phase này*

---

## 6. Impact Scan

Repo chưa có `docs/spec/`. Scan dựa trên source code.

| Module | Liên quan thế nào | Rủi ro | Cần làm gì |
|---|---|---|---|
| `js/app.js` | Toàn bộ state (`loadState`/`saveState`/`recordPlay`, `js/app.js:56-90`) chuyển từ localStorage sang API | **HIGH** | Viết lại layer state; thêm xử lý lỗi mạng — hiện chỉ có `try/catch` nuốt lỗi vì localStorage không bao giờ fail lâu |
| `js/games/*.js` (4 file) | Chấm điểm chuyển lên server → contract `api.finish` (`js/app.js:226-233`) đổi | **HIGH** | Thiết kế lại contract trước, rồi sửa đồng loạt 4 file |
| `data/*.js` (4 file) | Bị thay hoàn toàn bởi AI + DB | **HIGH** | 4 cấu trúc khác nhau hoàn toàn — không gộp chung một bảng `questions` được |
| Validator nội dung (mới) | Cửa duy nhất chặn lỗi AI khi không có human review | **HIGH** | Viết theo đúng ràng buộc `README.md:30-75`; đây là thành phần cần test kỹ nhất |
| Bảng pool + hạn ngạch (mới) | Lưu câu đã sinh, chặn trùng theo `category` × `lang` | **HIGH** | Schema riêng cho từng game |
| Prompt sinh đề (mới) | Quyết định chất lượng toàn bộ nội dung game | **HIGH** | Cần versioning — đổi prompt là đổi chất lượng đề, ảnh hưởng công bằng của bảng xếp hạng đang chạy |
| Endpoint gọi Gemini (mới) | Public, có rate limit | **HIGH** | Auth bắt buộc + rate limit + quota; chốt trước khi deploy lần đầu |
| Công thức ranking | Từ "vấn đề thiết kế" thành **biện pháp chống gian lận** vì N4 | **HIGH** | Chốt sớm, trước cả việc thiết kế bảng điểm |
| `css/styles.css` | Đổi toàn bộ theme sang pixel-art | **HIGH** | Giữ riêng `.code` / `--mono` / `font-variant-ligatures: none` (`css/styles.css:199-201`) |
| Đồng hồ Bug Hunt | Bonus tốc độ phải chuyển server-side | **MEDIUM** | Thiết kế cùng lúc với luồng phát đề |
| Cơ chế báo câu sai (mới) | Bù cho việc bỏ human review | **MEDIUM** | Gắn với hoàn điểm — ảnh hưởng bảng xếp hạng |
| `index.html` | Thứ tự script cố định data → games → app không còn đúng nếu có build step | **MEDIUM** | Quyết định có bundler không trước khi sửa |
| `CLAUDE.md` | 4/8 quy tắc project bị vô hiệu (không dependency, không build, ES5, `file://`) | **MEDIUM** | Cập nhật cùng lúc với quyết định B4, không để lệch |
| `README.md` | Đang hướng dẫn team tự thêm case vào `data/*.js` | **MEDIUM** | Viết lại theo luồng mới (AI sinh + validator) |
| `.gitignore` / secrets | Có `DATABASE_URL`, `GEMINI_API_KEY`, secret Render | **MEDIUM** | `.env*` đã ignore sẵn; cần thêm `.env.example` và quy trình cấp credential |
| `docs/diagram/*` | 2 diagram hiện tại mô tả kiến trúc cũ | **LOW** | Vẽ lại sau khi chốt kiến trúc mới |

---

## 7. Bắt buộc xuất ra cuối cùng

### 7.1 TOP 3 điểm dễ bị bỏ sót nguy hiểm nhất

1. **Chấm điểm và đáp án hiện đều nằm ở client.** Cả 4 game tự tính điểm rồi gọi `api.finish({score})`
   (`js/games/bug-hunt.js:209`, `spec-detective.js:187`, `prod-roulette.js:88`, `incident.js:169`),
   và đáp án nằm sẵn trong `window.BUG_HUNT_QUESTIONS` v.v. Nếu chỉ thêm login mà không chuyển chấm
   điểm lên server thì leaderboard vô nghĩa ngay ngày đầu.
2. **AI sinh sai đáp án là chuyện chắc chắn xảy ra**, và đã bỏ human review nên validator máy là lớp
   kiểm soát duy nhất. Không có validator = không có kiểm soát chất lượng nào.
3. **Chống trùng bằng so khớp chính xác không chặn được trùng về ý.** AI sinh 50 câu SQL Injection sẽ
   ra 50 biến thể khác chữ nhưng cùng một bài học — người chơi nhận ra ngay lượt thứ ba. Đó là lý do
   chọn hạn ngạch thay vì chỉ hash nội dung.

### 7.2 TOP 3 điều cần xác nhận trước với khách hàng / PM

1. Phần thưởng cụ thể là gì và ai duyệt — quyết định mức đầu tư chống gian lận
2. Phương thức đăng nhập (OAuth hay tự quản password) — quyết định có phát sinh gửi email thật không
3. Điều khoản free tier Gemini có cho phép dùng trong sản phẩm nội bộ trên host public không

### 7.3 Các file cần đọc trước khi implement

| File | Lý do |
|---|---|
| `js/app.js:56-90` | Toàn bộ state hiện tại — phần bị thay thế bởi API |
| `js/app.js:226-233` | Contract Shell ↔ Game — phải thiết kế lại trước khi sửa game |
| `js/app.js:238` | Chỗ clamp score 0–100 |
| `js/games/bug-hunt.js:126-190` | Hàm `lockIn` — nơi chấm điểm và tính bonus tốc độ, phần phải tách lên server |
| `js/games/*.js` (dòng `api.finish`) | 4 điểm chấm điểm cần chuyển lên server |
| `data/*.js` (4 file) | 4 cấu trúc dữ liệu khác nhau — input để thiết kế schema và prompt |
| `README.md:30-75` | Đặc tả ràng buộc từng loại data — input trực tiếp để viết validator |
| `js/games/bug-hunt.js:5` | `QUESTIONS_PER_ROUND = 8` — quyết định pool tối thiểu |
| `css/styles.css:1-30`, `:199-201` | 34 CSS variable và ràng buộc ligature — giới hạn khi đổi theme |
| `CLAUDE.md` | 4 quy tắc sắp bị đổi, phải đổi có chủ đích |
| `docs/diagram/module/detail-shell-game-contract.drawio` | Sơ đồ contract hiện tại |

### 7.4 Luận điểm cần trao đổi với PM

- Yêu cầu này nghe như "thêm login + leaderboard" nhưng thực chất là **viết lại kiến trúc**: từ
  static 100% client sang client-server có DB, auth, chống gian lận, và pipeline sinh nội dung bằng
  AI. Effort không cùng bậc với v1.
- Ba yêu cầu **có khen thưởng** + **AI tự sinh đề** + **public internet** khi ghép lại tạo ra ràng
  buộc mà từng cái riêng lẻ không có: đề phải công bằng, đáp án phải được kiểm chứng, endpoint phải
  được bảo vệ. Đây mới là phần khó nhất, không phải login hay leaderboard.
- **Đề xuất chia phase:**
  - **P1** — hosting + auth + chấm điểm server-side, dùng ngân hàng đề viết tay đã có (chỉ chuyển chỗ)
  - **P2** — AI sinh đề + validator máy + cơ chế báo câu sai
  - **P3** — bật khen thưởng chính thức
  - **P4** — UI pixel-art (độc lập hoàn toàn, làm song song được, không nên để nó chặn phần còn lại)
  - Bật khen thưởng trước khi P2 ổn định là mời tranh cãi.

### 7.5 Điểm nguy hiểm nếu cứ tiến hành với yêu cầu hiện tại

- Assumption ngầm: "có tài khoản là điểm đáng tin" — sai, vì điểm vẫn do client gửi lên nếu chưa
  chuyển chấm điểm lên server
- Assumption ngầm: "chấm điểm server-side là đủ chống gian lận" — không chặn được nhiều tài khoản,
  không chặn được bonus tốc độ nếu đồng hồ vẫn ở client
- Assumption ngầm: "AI free = không có giới hạn" — mọi free tier đều có trần
- Assumption ngầm: "lưu câu cũ vào DB là hết trùng" — chỉ đúng với trùng y hệt từng ký tự
- Mâu thuẫn trực tiếp với convention đã ghi trong `CLAUDE.md` và `README.md:6` — phải cập nhật có
  chủ đích, không đổi ngầm
- **Chưa có môi trường Staging.** Theo `nta-prod-safety.md`, test auth + AI generation trên chính
  PROD khi chưa có staging là tình huống đã từng gây incident. "Kênh gửi thật" ở đây gồm cả email
  đăng ký lẫn lời gọi Gemini tốn quota.

### 7.6 Điểm còn thiếu theo tiêu chuẩn chất lượng NTA

| Tiêu chí | Đánh giá |
|---|---|
| **Tuân thủ deadline** | Chưa có deadline nào được nêu — không đánh giá được, cần PM cho mốc |
| **Giảm sai sót** | Validator máy là bắt buộc, không phải tuỳ chọn, khi đã bỏ human review. Công thức ranking và cách xử lý điểm cũ chưa chốt → dễ phải migrate dữ liệu lần hai |
| **Không gây khó khăn cho công đoạn sau** | Bỏ chế độ `file://` mà không thông báo sẽ làm người dùng cũ mất cách chơi offline. `README.md` phần "cách dùng trong team" cần viết lại |
| **Ngăn ngừa tái phát** | Cần log câu bị người chơi báo sai để cải thiện prompt — nếu không thì cùng loại lỗi sinh lại mãi. Bài học "test trên PROD không có staging" đã có trong rule, lần này phải chuẩn bị môi trường trước |
| **Có thể giải trình trách nhiệm** | Đã ghi rõ ở mục 2: chủ project quyết định host public, bỏ human review, mở đăng ký tự do, sở hữu hạ tầng và chịu chi phí |

---

## 8. Bước tiếp theo

**BLOCKER đã đóng hết.** Đủ điều kiện chuyển sang viết spec.

1. Chạy `/nta-spec:nta-spec-write` với tài liệu này làm input
2. Trước khi viết spec, chốt thêm 3 điểm IMPORTANT có ảnh hưởng kiến trúc:
   - Phương thức đăng nhập (OAuth vs tự quản password)
   - Công thức xếp hạng (khuyến nghị: best-score mỗi game)
   - Backend stack
3. Song song: xác nhận ToS Gemini free tier và kiểm tra lại hạn mức Render/Neon
4. Sau khi có spec: vẽ lại diagram trong `docs/diagram/` cho kiến trúc mới

---

## Phụ lục — Nguồn tham khảo

- Gemini API rate limits (chính thức): https://ai.google.dev/gemini-api/docs/rate-limits
- Groq rate limits (chính thức): https://console.groq.com/docs/rate-limits
- Groq services agreement: https://console.groq.com/docs/legal/services-agreement
- So sánh free LLM API: https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Danh sách free LLM API: https://github.com/amardeeplakshkar/awesome-free-llm-apis

*Hạn mức free tier thay đổi liên tục. Số liệu trong tài liệu này tra ngày 2026-08-17 — kiểm tra lại
trang chính thức trước khi thiết kế cron.*
