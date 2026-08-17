/* Bug Hunt - ngân hàng câu hỏi.
 * Thay nội dung ở đây bằng bug thật của team (lấy từ Backlog / commit fix).
 * answerLines: đánh số từ 1, có thể liệt kê nhiều dòng đều được tính đúng.
 */
window.BUG_HUNT_CATEGORIES = [
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

window.BUG_HUNT_QUESTIONS = [
  {
    id: 'bh-01',
    lang: 'PHP / Laravel',
    level: 'Dễ',
    title: 'API tìm user theo email',
    code: [
      'public function search(Request $request)',
      '{',
      "    $email = $request->query('email');",
      '    $sql = "SELECT id, name FROM users WHERE email = \'" . $email . "\'";',
      '    $rows = DB::select($sql);',
      '',
      '    return response()->json($rows);',
      '}'
    ],
    answerLines: [4],
    category: 'sql-injection',
    explanation:
      'Input từ query string được nối thẳng vào câu SQL. Người dùng gửi ' +
      "email=x' OR '1'='1 là đọc được toàn bộ bảng users.",
    fix: "DB::select('SELECT id, name FROM users WHERE email = ?', [$email]); hoặc dùng Eloquent: User::where('email', $email)->get();"
  },
  {
    id: 'bh-02',
    lang: 'PHP / Laravel',
    level: 'Dễ',
    title: 'Danh sách bài viết kèm tác giả',
    code: [
      "$posts = Post::where('status', 'published')",
      "    ->orderBy('created_at', 'desc')",
      '    ->limit(50)',
      '    ->get();',
      '',
      'foreach ($posts as $post) {',
      '    echo $post->author->name;',
      '}'
    ],
    answerLines: [1, 7],
    category: 'n-plus-1',
    explanation:
      'Query lấy 50 post là 1 câu, nhưng mỗi lần truy cập $post->author lại bắn thêm 1 query. ' +
      'Tổng 51 query. Danh sách càng dài càng chậm tuyến tính.',
    fix: "Post::with('author')->where('status', 'published')->...->get();"
  },
  {
    id: 'bh-03',
    lang: 'JavaScript',
    level: 'Dễ',
    title: 'Hiển thị số sản phẩm trong giỏ',
    code: [
      'async function renderCart(userId) {',
      "  const res = await fetch('/api/cart/' + userId);",
      '  const cart = await res.json();',
      '',
      "  document.querySelector('#cart-count').textContent = cart.items.length;",
      '}'
    ],
    answerLines: [5],
    category: 'null-check',
    explanation:
      'Khi giỏ rỗng, API thường trả items = null hoặc bỏ hẳn field. cart.items.length ném ' +
      "TypeError và chặn luôn phần render phía sau. Dòng 2 cũng thiếu check res.ok, nhưng lỗi nổ ra ở dòng 5.",
    fix: 'const count = cart.items?.length ?? 0; — và kiểm tra res.ok trước khi parse JSON.'
  },
  {
    id: 'bh-04',
    lang: 'JavaScript',
    level: 'Trung bình',
    title: 'Áp mã giảm giá',
    code: [
      'function applyDiscount(input, total) {',
      '  const code = input.trim();',
      '',
      '  if (code == 0) {',
      '    return total;',
      '  }',
      '  return total * 0.9;',
      '}'
    ],
    answerLines: [4],
    category: 'type-coercion',
    explanation:
      "So sánh lỏng: '' == 0 trả về true, nên khi user không nhập gì thì hàm return total (đúng vô tình). " +
      "Nhưng '0' == 0 cũng true, và ' ' == 0 cũng true — mã hợp lệ bắt đầu bằng số 0 sẽ bị bỏ qua im lặng.",
    fix: "if (code === '') { return total; } — luôn dùng === và so sánh đúng kiểu."
  },
  {
    id: 'bh-05',
    lang: 'Java',
    level: 'Trung bình',
    title: 'Đọc file config',
    code: [
      'public String readConfig(String path) throws IOException {',
      '    BufferedReader reader = new BufferedReader(new FileReader(path));',
      '    StringBuilder sb = new StringBuilder();',
      '',
      '    String line;',
      '    while ((line = reader.readLine()) != null) {',
      '        sb.append(line);',
      '    }',
      '    return sb.toString();',
      '}'
    ],
    answerLines: [2],
    category: 'resource-leak',
    explanation:
      'reader không bao giờ được đóng. Nếu readLine ném exception thì file handle rò rỉ. ' +
      'Hàm gọi nhiều lần trong vòng lặp sẽ dẫn tới "Too many open files".',
    fix: 'try (BufferedReader reader = new BufferedReader(new FileReader(path))) { ... }'
  },
  {
    id: 'bh-06',
    lang: 'PHP / Laravel',
    level: 'Trung bình',
    title: 'Cập nhật profile',
    code: [
      'public function update(Request $request, $id)',
      '{',
      '    $profile = Profile::findOrFail($id);',
      '',
      '    $profile->fill($request->validated());',
      '    $profile->save();',
      '',
      '    return response()->json($profile);',
      '}'
    ],
    answerLines: [3],
    category: 'authorization',
    explanation:
      'Chỉ cần đăng nhập là sửa được profile của bất kỳ ai bằng cách đổi $id trên URL (IDOR). ' +
      'Validate input không thay thế được kiểm tra quyền sở hữu.',
    fix: "abort_if($profile->user_id !== auth()->id(), 403); hoặc dùng Policy: $this->authorize('update', $profile);"
  },
  {
    id: 'bh-07',
    lang: 'JavaScript / Node',
    level: 'Khó',
    title: 'Tạo đơn hàng từ giỏ',
    code: [
      'async function createOrder(userId, cartId) {',
      '  const existing = await Order.findOne({ cartId: cartId });',
      '',
      '  if (existing) {',
      '    return existing;',
      '  }',
      '  return await Order.create({ userId: userId, cartId: cartId });',
      '}'
    ],
    answerLines: [2, 7],
    category: 'race-condition',
    explanation:
      'Check-then-act: user double-click hoặc client retry, hai request cùng chạy qua findOne trước khi ' +
      'request nào kịp create. Kết quả là 2 đơn hàng trùng — loại bug chỉ xuất hiện trên PROD lúc tải cao.',
    fix: 'Đặt unique index trên cartId và bắt lỗi duplicate key, hoặc dùng upsert / transaction có lock.'
  },
  {
    id: 'bh-08',
    lang: 'SQL',
    level: 'Trung bình',
    title: 'Lọc đơn hàng theo trạng thái',
    code: [
      'SELECT o.id, o.total',
      'FROM orders o',
      "WHERE o.status = 'paid'",
      "   OR o.status = 'shipped'",
      "  AND o.created_at >= '2026-01-01';"
    ],
    answerLines: [4, 5],
    category: 'logic-error',
    explanation:
      'AND có độ ưu tiên cao hơn OR, nên điều kiện thực tế là: status = paid, HOẶC ' +
      '(status = shipped AND created_at >= 2026-01-01). Toàn bộ đơn paid từ mọi năm đều lọt vào.',
    fix: "WHERE (o.status = 'paid' OR o.status = 'shipped') AND o.created_at >= '2026-01-01';"
  },
  {
    id: 'bh-09',
    lang: 'JavaScript',
    level: 'Dễ',
    title: 'Render bình luận',
    code: [
      'function renderComment(comment, list) {',
      "  const box = document.createElement('div');",
      "  box.className = 'comment';",
      '',
      '  box.innerHTML = comment.body;',
      '  list.appendChild(box);',
      '}'
    ],
    answerLines: [5],
    category: 'xss',
    explanation:
      'comment.body do người dùng nhập, gán thẳng vào innerHTML là stored XSS. ' +
      'Một comment chứa thẻ img onerror là chiếm được session của mọi người xem trang.',
    fix: 'box.textContent = comment.body; — nếu bắt buộc cho phép HTML thì sanitize bằng thư viện (DOMPurify).'
  },
  {
    id: 'bh-10',
    lang: 'Python',
    level: 'Dễ',
    title: 'Đồng bộ user sang hệ thống ngoài',
    code: [
      'def sync_user(user_id):',
      '    try:',
      '        payload = build_payload(user_id)',
      '        api.push(payload)',
      '        mark_synced(user_id)',
      '    except:',
      '        pass'
    ],
    answerLines: [6, 7],
    category: 'error-handling',
    explanation:
      'except trần nuốt cả KeyboardInterrupt lẫn lỗi thật, rồi pass nên không log gì. ' +
      'User không đồng bộ được mà hệ thống vẫn báo "chạy bình thường" — bug này chỉ lộ ra khi khách hàng phàn nàn.',
    fix: 'except RequestException as e: logger.exception("sync failed user_id=%s", user_id) — và cân nhắc retry / đẩy vào dead-letter queue.'
  },
  {
    id: 'bh-11',
    lang: 'JavaScript',
    level: 'Khó',
    title: 'Kiểm tra token hết hạn',
    code: [
      'function isExpired(token) {',
      '  const now = new Date();',
      '  const expiredAt = new Date(token.expired_at);',
      '',
      '  return now.getTime() > expiredAt.getTime() + 1000 * 60 * 60 * 9;',
      '}'
    ],
    answerLines: [5],
    category: 'logic-error',
    explanation:
      'Cộng cứng 9 tiếng để "bù timezone JST". Khi server đổi sang UTC, hoặc khi expired_at đã ' +
      'là ISO string có timezone, token sống thêm 9 tiếng ngoài ý muốn. Bug bảo mật ẩn dưới dạng bug timezone.',
    fix: 'return Date.now() > new Date(token.expired_at).getTime(); — chuẩn hoá mọi mốc thời gian về UTC ở tầng lưu trữ.'
  },
  {
    id: 'bh-12',
    lang: 'PHP / Laravel',
    level: 'Dễ',
    title: 'Tính tổng tiền đơn hàng',
    code: [
      '$total = 0;',
      '',
      "foreach ($request->input('items') as $item) {",
      "    $total += $item['price'] * $item['qty'];",
      '}',
      '',
      'return $total;'
    ],
    answerLines: [3],
    category: 'null-check',
    explanation:
      'Nếu request không có items (client cũ, hoặc body rỗng), input() trả null và foreach trên null ' +
      'ném TypeError ở PHP 8. Không validate trước khi lặp là lỗi lặp lại nhiều nhất trong review.',
    fix: "foreach ($request->input('items', []) as $item) — và validate 'items' => 'required|array' ở Form Request."
  }
];
