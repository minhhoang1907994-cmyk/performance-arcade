# DevLab Arcade

Bốn bài tập dạng game, dựa trên tình huống có thật trong quy trình làm việc. Dùng để warm-up đầu buổi họp team, onboarding người mới, hoặc luyện solo 10 phút.

## Chạy

Mở `index.html` bằng trình duyệt. Không cần cài đặt, không cần server, không có build step.

Điểm và lịch sử lưu trong `localStorage` của trình duyệt — mỗi máy một bảng điểm riêng, không có leaderboard chung.

## Bốn game

| Game | Rèn kỹ năng | Cách chơi |
|---|---|---|
| 🐞 Bug Hunt | Code review | Chỉ đúng dòng có bug trong snippet và gọi tên loại bug. Có tính điểm tốc độ (60s/câu). |
| 🔍 Spec Detective | Đọc & chất vấn spec | Khoanh vùng cụm từ mơ hồ trong spec, rồi chọn câu hỏi làm rõ đáng gửi khách nhất. Chọn nhầm bị trừ điểm. |
| ☠️ PROD Roulette | An toàn production | Kịch bản phân nhánh khi thao tác trên PROD. Bắt đầu 100 điểm, mỗi lựa chọn rủi ro trừ dần. |
| 🚨 Incident Escape Room | Xử lý sự cố | Mỗi hành động điều tra tốn thời gian giả lập. Tìm đúng nguyên nhân gốc trước khi hết ngân sách phút. |

## Thay nội dung bằng case thật của team

Toàn bộ nội dung nằm trong `data/`, tách hẳn khỏi code game. Sửa file, tải lại trang là xong.

```
data/bug-hunt.data.js        12 câu  — snippet PHP / JS / Java / Python / SQL
data/spec-detective.data.js   6 case — đoạn spec kèm điểm mơ hồ và lý do
data/prod-roulette.data.js    3 kịch bản phân nhánh
data/incident.data.js         3 sự cố kèm hành động điều tra và nguyên nhân
```

Nội dung mẫu hiện tại là case generic. Giá trị thật đến khi thay bằng bug đã fix trong Backlog, spec đã từng gây tranh cãi với khách, và sự cố team đã gặp — lúc đó game vừa là bài tập vừa là nơi lưu lesson learned.

### Thêm một câu Bug Hunt

```js
{
  id: 'bh-13',
  lang: 'PHP / Laravel',
  level: 'Trung bình',
  title: 'Tiêu đề ngắn gọn',
  code: [ 'dòng 1', 'dòng 2' ],   // mỗi phần tử là một dòng
  answerLines: [2],                // đánh số từ 1, liệt kê được nhiều dòng đều tính đúng
  category: 'null-check',          // phải khớp id trong BUG_HUNT_CATEGORIES
  explanation: 'Vì sao đây là bug và nó nổ ra khi nào.',
  fix: 'Cách sửa cụ thể.'
}
```

### Thêm một case Spec Detective

`segments` nối lại thành đoạn spec. Segment có `a: true` là điểm mơ hồ cần tìm, `r` là lý do hiện ra sau khi chấm. Segment không mơ hồ vẫn bấm được và bị trừ 10 điểm — cần có để người chơi không chọn tất cả cho chắc. `followUp.options` phải có đúng một phương án `good: true`.

### Thêm một kịch bản PROD Roulette

Đồ thị node: mỗi `option` có `risk` (điểm trừ), `feedback` (hiện ngay sau khi chọn) và `next` trỏ tới node kế. Node kết thúc đặt `end: true` kèm `tone` (`good` / `mixed` / `bad`) và `verdict`.

### Thêm một sự cố Incident

`actions` gồm cả hành động hữu ích lẫn hành động tốn thời gian vô ích — chính lựa chọn giữa hai loại đó mới là bài tập. Đánh `key: true` cho hành động dẫn tới manh mối quyết định. `causes` phải có đúng một `correct: true`.

## Cấu trúc

```
index.html                 nạp data → game → khung app
css/styles.css             có sẵn theme sáng/tối, nút đổi ở góc phải
js/app.js                  hub, điều hướng, lưu điểm, màn hình kết quả
js/games/*.js              mỗi game tự đăng ký vào window.DevLabGames
data/*.js                  ngân hàng nội dung
```

Thêm game mới: tạo file trong `js/games/`, push một object `{ id, icon, name, tagline, skill, duration, start(mount, api) }` vào `window.DevLabGames`, khai báo `<script>` trong `index.html` trước `js/app.js`. Khi kết thúc gọi `api.finish({ score, breakdown, notes })` với `score` từ 0 đến 100.

Data để ở `.js` thay vì `.json` là có chủ đích: mở bằng `file://` thì `fetch()` một file JSON bị CORS chặn, còn `<script src>` chạy bình thường.

## Cách dùng trong team

- **Đầu buổi họp**: chiếu Bug Hunt lên màn hình, cả team cùng đoán, 10 phút.
- **Onboarding**: PROD Roulette trước khi cấp quyền truy cập production.
- **Sau incident thật**: viết thêm một kịch bản vào `incident.data.js` — bài học ở lại lâu hơn nhiều so với một trang post-mortem không ai đọc lại.
