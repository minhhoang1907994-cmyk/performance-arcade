# Deploy lên Render + Neon

Hướng dẫn cho **trạng thái code hiện tại**: API auth + `/health` + `/api/v1/games`.
Chưa có round/step engine, chưa nối Gemini, chưa phục vụ frontend tĩnh.

Deploy lúc này không phải để người dùng vào chơi — mà để **xác nhận hạ tầng chạy được**
trước khi viết phần lõi: Neon kết nối được không, migration chạy được không, Render build
được không, cold start mất bao lâu. Đây cũng là cách trả lời Q8 trong spec.

---

## Trước khi bắt đầu — kiểm tra an toàn PROD

Project không có Staging (ghi trong spec section 15), nên mọi thứ lên Render là public
internet ngay. Rà soát side-effect ra ngoài hệ thống của code hiện tại:

| Kênh gửi ra ngoài | Trạng thái |
|---|---|
| Email (verify / reset mật khẩu) | **Không có** — BR-12 cấm, không có SMTP client trong `package.json` |
| Gọi Gemini | **Chưa nối** — pipeline sinh đề chưa viết |
| SMS / push / webhook / giao dịch | Không có |

Không có hành động không thu hồi được. Rollback đơn giản: xoá service trên Render, xoá
database trên Neon. Dữ liệu duy nhất là tài khoản test do chính bạn tạo.

**Vẫn nên làm**: tạo **hai database Neon riêng** (`devlab_dev` và `devlab_prod`) ngay từ
đầu, thay vì dùng chung một cái. Chi phí như nhau, và nó biến "test trên PROD" thành
"test trên dev" mà không cần dựng thêm hạ tầng.

---

## Bước 1 — Neon

1. Tạo project trên https://neon.com, chọn region gần Render nhất
2. Tạo hai database: `devlab_dev` và `devlab_prod`
3. Lấy **hai** chuỗi kết nối cho `devlab_prod`:

| Loại | Hostname | Dùng cho |
|---|---|---|
| **Pooled** | có `-pooler` | Runtime của app (`DATABASE_URL` trên Render) |
| **Unpooled** | không có `-pooler` | Chạy migration |

Dạng chuỗi:

```
postgresql://<user>:<password>@ep-xxx-pooler.<region>.aws.neon.tech/devlab_prod?sslmode=require&channel_binding=require
```

**Vì sao migration phải dùng chuỗi unpooled**: chuỗi pooled đi qua PgBouncer ở chế độ
transaction. Migration của chúng ta chạy nguyên khối `BEGIN … COMMIT` trong một câu lệnh
và đó là kiểu dễ vướng nhất với connection pooler. App lúc chạy thì ngược lại — nhiều
kết nối ngắn, đúng thứ pooler sinh ra để phục vụ.

> `src/db/pool.js` đặt `ssl: { rejectUnauthorized: true }` cho mọi host không phải
> localhost. Đây là mức chặt hơn `sslmode=require` trong chuỗi kết nối: `require` chỉ
> bắt buộc mã hoá chứ **không** xác minh chứng chỉ. Nếu TLS lỗi, đừng tắt xác minh —
> tìm nguyên nhân trước.

---

## Bước 2 — Chạy migration từ máy bạn

Làm trước khi deploy. Chạy tại máy đơn giản hơn nhiều so với chờ shell trên Render, và
`migrate.js` chạy lại nhiều lần vẫn an toàn (có bảng `schema_migrations` theo dõi).

```bash
cd server

export DATABASE_URL="<chuỗi UNPOOLED của devlab_prod>"
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
export BOOTSTRAP_ADMIN_EMAIL="ban@congty.com"
export BOOTSTRAP_ADMIN_PASSWORD="<mật khẩu mạnh, tối thiểu 10 ký tự>"

npm ci
npm run migrate       # tạo 9 bảng + admin đầu tiên
npm run seed:legacy   # nạp 24 mục nội dung viết tay
```

Giữ lại `JWT_SECRET` vừa sinh — bước 3 cần đúng giá trị đó.

Kiểm nhanh:

```bash
node -e "
const {Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
p.query(\"SELECT game_id, count(*)::int FROM content_items WHERE status='active' GROUP BY game_id ORDER BY 1\")
 .then(r=>{console.table(r.rows);return p.end();});
"
```

Kỳ vọng: `bug-hunt 12`, `incident 3`, `prod-roulette 3`, `spec-detective 6`.

---

## Bước 3 — Render

Repo đã có `render.yaml` ở gốc nên dùng đường Blueprint:

1. Push code lên GitHub/GitLab (xem mục "Trước khi push" bên dưới)
2. Render Dashboard → **New** → **Blueprint** → chọn repo
3. Render đọc `render.yaml` và hỏi giá trị cho 4 biến `sync: false`:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Chuỗi **POOLED** của `devlab_prod` (có `-pooler`) |
| `JWT_SECRET` | Chuỗi đã sinh ở bước 2 |
| `BOOTSTRAP_ADMIN_EMAIL` | Email admin |
| `BOOTSTRAP_ADMIN_PASSWORD` | Mật khẩu admin |

4. Apply. Render chạy `npm ci` rồi `npm start` với `rootDir: server`.

Cấu hình đáng chú ý trong `render.yaml`:

- `healthCheckPath: /health` — endpoint này thật sự query DB (`SELECT 1`), nên nó xác nhận
  cả app lẫn kết nối Neon chứ không chỉ "process còn sống"
- `server/.nvmrc` ghim Node 22
- `plan: free`

### Nếu muốn migration chạy tự động mỗi lần deploy

Thêm vào `render.yaml`:

```yaml
    preDeployCommand: npm run migrate
```

`preDeployCommand` chạy sau build, trước khi start. Migration của chúng ta idempotent nên
an toàn. **Chưa verify `preDeployCommand` có dùng được trên plan free hay không** — nếu
Render báo lỗi thì bỏ dòng này và giữ cách chạy tay ở bước 2.

---

## Bước 4 — Xác nhận sau deploy

```bash
BASE="https://<tên-service>.onrender.com"

# 1. Health — phải trả {"status":"ok"}; "degraded" nghĩa là app sống nhưng không tới được Neon
curl -s $BASE/health

# 2. Pool nội dung — xác nhận seed đã vào đúng DB mà app đang trỏ tới
curl -s "$BASE/api/v1/games" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  for(const g of JSON.parse(s).games) console.log(g.id, g.pool_available, g.playable);
});"

# 3. Admin đăng nhập được
curl -s -X POST "$BASE/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"ban@congty.com","password":"<mật khẩu admin>"}' -i | head -20
```

Ở bước 3, kiểm cookie `devlab_refresh` trong response header phải có cả `HttpOnly` **và**
`Secure`. `Secure` chỉ bật khi `NODE_ENV=production` — `render.yaml` đã đặt sẵn.

### Đo cold start (trả lời Q8)

```bash
# Gọi lần đầu sau một thời gian dài không dùng
time curl -s -o /dev/null $BASE/health
# Gọi lại ngay
time curl -s -o /dev/null $BASE/health
```

Chênh lệch giữa hai lần chính là chi phí cold start. Con số này quan trọng vì use case
chính trong `README.md` là "chiếu lên màn hình đầu buổi họp" — nếu phải chờ quá lâu thì
đó là vấn đề thật, và là dữ liệu để quyết định có nâng plan hay không.

Free tier của Render có cơ chế ngủ đông khi không có traffic. **Chưa verify con số cụ
thể** — xem trang pricing hiện hành, hoặc đơn giản là đo bằng lệnh trên.

---

## Trước khi push

```bash
cd D:/performance-arcade
git status --short
```

Xác nhận **không** có `.env` và `node_modules/` trong danh sách. Cả hai đã nằm trong
`.gitignore` từ đầu, nhưng kiểm một lần vẫn hơn:

```bash
git check-ignore -v server/.env server/node_modules
```

Nếu cả hai dòng đều in ra rule khớp thì an toàn.

---

## Rollback

| Tình huống | Xử lý |
|---|---|
| Deploy hỏng | Render → Deploys → chọn deploy trước → Rollback |
| Schema hỏng | Không có migration down. Xoá database `devlab_prod` trên Neon, tạo lại, chạy lại bước 2 |
| Lộ secret | Sinh `JWT_SECRET` mới trên Render (mọi access token hiện tại chết ngay); đổi mật khẩu Neon và cập nhật `DATABASE_URL` |

Vì chưa có người dùng thật và chưa có dữ liệu cần giữ, xoá sạch làm lại là lựa chọn hợp lệ
ở giai đoạn này. Điều đó sẽ khác đi ngay khi có tài khoản thật đầu tiên — nên viết
migration down từ `002` trở đi.

---

## Cái gì CHƯA hoạt động sau khi deploy

- **Không chơi được game nào** — round/step engine chưa viết. `POST /api/v1/rounds` chưa tồn tại
- **Không có giao diện** — app chỉ phục vụ API. `index.html` hiện tại vẫn là bản v1 chạy
  `file://` và chưa gọi API
- **`my_best` luôn `null`** trong `/api/v1/games` — chờ `leaderboard_best`
- **Không tự sinh câu hỏi** — pool đứng yên ở 24 mục viết tay cho tới khi nối Gemini

Deploy giai đoạn này là để verify hạ tầng, không phải để mở cho người dùng.
