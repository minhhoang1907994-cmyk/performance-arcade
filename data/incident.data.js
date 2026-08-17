/* Incident Escape Room - drill xử lý sự cố có giới hạn thời gian.
 * Mỗi hành động tốn thời gian giả lập. Mục tiêu: tìm đúng nguyên nhân trước khi hết ngân sách phút.
 * key: true là hành động dẫn tới manh mối quyết định (dùng để chấm phần "đường đi").
 */
window.INCIDENT_SCENARIOS = [
  {
    id: 'ic-01',
    title: 'API trả 500 sau khi deploy',
    severity: 'Cao',
    budget: 30,
    brief:
      '20:15. Team deploy v2.4.0 lúc 20:00. Alert báo tỉ lệ lỗi 500 trên POST /api/orders nhảy lên 87%. ' +
      'Khách hàng không đặt được hàng. Bạn là người trực.',
    actions: [
      {
        id: 'a1',
        label: 'Đọc log lỗi ứng dụng 15 phút gần nhất',
        cost: 4,
        key: true,
        result:
          'RuntimeException: config value services.payment.secret is null — OrderController.php:88. ' +
          'Lỗi lặp lại ở mọi request tới /api/orders.'
      },
      {
        id: 'a2',
        label: 'So sánh diff giữa v2.3.9 và v2.4.0',
        cost: 6,
        key: true,
        result:
          'PR #412 thêm tích hợp webhook thanh toán, có đọc config(\'services.payment.secret\'). ' +
          'File .env.example đã được cập nhật thêm PAYMENT_WEBHOOK_SECRET.'
      },
      {
        id: 'a3',
        label: 'SSH vào server production, kiểm tra file .env',
        cost: 3,
        key: true,
        result:
          'Không có dòng PAYMENT_WEBHOOK_SECRET trong .env của production. ' +
          'File .env lần sửa cuối cách đây 2 tháng.'
      },
      {
        id: 'a4',
        label: 'Restart application service',
        cost: 4,
        result: 'Service khởi động lại bình thường. Lỗi 500 vẫn nguyên. Mất 4 phút không thu được thông tin gì.'
      },
      {
        id: 'a5',
        label: 'Kiểm tra CPU / RAM / disk của server',
        cost: 4,
        result: 'CPU 18%, RAM 42%, disk còn 60%. Hoàn toàn bình thường — không phải vấn đề tài nguyên.'
      },
      {
        id: 'a6',
        label: 'Kiểm tra kết nối và tải của database',
        cost: 3,
        result: 'Kết nối tốt, latency 2ms, số connection 12/100. Database không liên quan.'
      },
      {
        id: 'a7',
        label: 'Gọi dev đã thực hiện deploy',
        cost: 5,
        result:
          'Dev đang trên đường về, trả lời qua chat: "Em test local ok mà, không hiểu sao". ' +
          'Không cung cấp thêm thông tin nào hữu ích.'
      },
      {
        id: 'a8',
        label: 'Rollback về v2.3.9',
        cost: 8,
        result:
          'Lỗi 500 chấm dứt, khách đặt hàng lại được. Nhưng chưa biết nguyên nhân, ' +
          'và tính năng webhook thanh toán chưa lên được.'
      },
      {
        id: 'a9',
        label: 'Đọc nginx error log',
        cost: 4,
        result: '502 Bad Gateway upstream — chỉ phản ánh việc app trả lỗi, không thêm manh mối gì mới.'
      }
    ],
    causes: [
      {
        t: 'Biến môi trường PAYMENT_WEBHOOK_SECRET chưa được thêm vào .env của production',
        correct: true,
        why:
          'Quy trình deploy cập nhật code nhưng không cập nhật .env trên server. .env.example có, ' +
          'production không có. Bài học: mọi PR thêm biến môi trường phải có bước xác nhận đã set trên từng môi trường ' +
          'trước khi merge, và ứng dụng nên fail-fast lúc khởi động thay vì ném lỗi ở request đầu tiên.'
      },
      {
        t: 'Database quá tải do lượng đơn hàng tăng đột biến',
        correct: false,
        why: 'Số liệu database hoàn toàn bình thường, và lỗi xuất hiện đúng ngay sau thời điểm deploy chứ không theo tải.'
      },
      {
        t: 'Code v2.4.0 có lỗi cú pháp không được phát hiện lúc build',
        correct: false,
        why: 'Lỗi cú pháp thì service không khởi động được. Ở đây service chạy bình thường và chỉ một endpoint lỗi.'
      },
      {
        t: 'CDN đang cache bản build cũ gây xung đột',
        correct: false,
        why: 'CDN không can thiệp vào lỗi phía server ở endpoint POST. Log ứng dụng đã chỉ thẳng vào config null.'
      }
    ]
  },
  {
    id: 'ic-02',
    title: 'Hệ thống chậm dần rồi treo',
    severity: 'Cao',
    budget: 35,
    brief:
      'Ba ngày nay lặp lại một hiện tượng: mỗi sáng hệ thống chạy nhanh, tới trưa response time tăng dần, ' +
      'khoảng 2 tiếng sau khi khởi động thì timeout hàng loạt. Restart xong lại bình thường. ' +
      'Hôm nay khách hàng đã gửi công văn phàn nàn.',
    actions: [
      {
        id: 'b1',
        label: 'Xem biểu đồ response time theo thời gian',
        cost: 4,
        key: true,
        result:
          'Response time tăng tuyến tính kể từ thời điểm service khởi động, KHÔNG tương quan với đường traffic. ' +
          'Đây là dấu hiệu của rò rỉ tài nguyên tích luỹ, không phải quá tải.'
      },
      {
        id: 'b2',
        label: 'Kiểm tra số connection đang mở tới database',
        cost: 3,
        key: true,
        result:
          'max_connections = 100. Hiện tại 98 và tăng đều đặn theo thời gian, không giảm kể cả lúc ít người dùng.'
      },
      {
        id: 'b3',
        label: 'Đọc slow query log',
        cost: 5,
        result:
          'Có vài query khoảng 200ms ở màn hình báo cáo. Chậm nhưng không đủ để giải thích hiện tượng ' +
          'toàn hệ thống treo sau 2 tiếng.'
      },
      {
        id: 'b4',
        label: 'Kiểm tra traffic có tăng bất thường không',
        cost: 3,
        result: 'Traffic tuần này gần như trùng khít tuần trước. Không có đợt tăng đột biến nào.'
      },
      {
        id: 'b5',
        label: 'Đọc lại các thay đổi code được merge tuần này',
        cost: 6,
        key: true,
        result:
          'PR #388 thêm job xuất báo cáo, tự mở connection bằng tay thay vì dùng connection pool của framework. ' +
          'Trong hàm có một nhánh return sớm khi không có dữ liệu — nhánh đó bỏ qua lệnh đóng connection.'
      },
      {
        id: 'b6',
        label: 'Theo dõi mức sử dụng RAM của process',
        cost: 3,
        result: 'RAM tăng đều theo thời gian chạy, khớp với giả thuyết rò rỉ tài nguyên nhưng chưa chỉ ra được ở đâu.'
      },
      {
        id: 'b7',
        label: 'Tăng max_connections lên 300',
        cost: 5,
        result:
          'Thời gian tới lúc treo kéo dài từ 2 tiếng thành khoảng 6 tiếng. Hiện tượng vẫn lặp lại — ' +
          'đã xác nhận đây chỉ là nới trần, không phải sửa nguyên nhân.'
      },
      {
        id: 'b8',
        label: 'Restart service để hệ thống hoạt động lại',
        cost: 4,
        result: 'Hệ thống hồi phục ngay. Đồng hồ đếm ngược 2 tiếng lại bắt đầu chạy.'
      },
      {
        id: 'b9',
        label: 'Kiểm tra cấu hình cache Redis',
        cost: 4,
        result: 'Redis hoạt động bình thường, hit rate 91%, bộ nhớ ổn định. Không liên quan.'
      }
    ],
    causes: [
      {
        t: 'Job xuất báo cáo rò rỉ connection: nhánh return sớm không đóng connection đã mở',
        correct: true,
        why:
          'Mỗi lần job chạy mà không có dữ liệu là một connection bị bỏ rơi. Tích luỹ đủ 100 là toàn hệ thống ' +
          'không lấy được connection nữa. Sửa: dùng connection pool của framework, hoặc bọc trong try/finally ' +
          'để đóng trong mọi nhánh thoát.'
      },
      {
        t: 'Traffic tăng đột biến vượt quá năng lực hệ thống',
        correct: false,
        why: 'Traffic được xác nhận bằng phẳng, và triệu chứng bám theo thời gian chạy chứ không bám theo tải.'
      },
      {
        t: 'Slow query ở màn hình báo cáo làm nghẽn database',
        correct: false,
        why: 'Query 200ms không gây treo toàn hệ thống. Nó nằm cùng khu vực code với nguyên nhân thật nên dễ bị đổ lỗi nhầm.'
      },
      {
        t: 'max_connections cấu hình quá thấp cho quy mô hệ thống',
        correct: false,
        why: 'Thử nghiệm nâng lên 300 chỉ kéo dài thời gian tới lúc sập. Nếu là nguyên nhân thật, hệ thống đã ổn định hẳn.'
      }
    ]
  },
  {
    id: 'ic-03',
    title: 'Khách hàng không nhận được email',
    severity: 'Trung bình',
    budget: 30,
    brief:
      'Khách báo: ba ngày nay nhân viên của họ không nhận được email thông báo đơn hàng mới. ' +
      'Log hệ thống ghi nhận tất cả đều "gửi thành công". Không ai đổi code trong hai tháng qua.',
    actions: [
      {
        id: 'c1',
        label: 'Đọc log gửi mail của ứng dụng',
        cost: 3,
        result: 'Toàn bộ đều nhận phản hồi 250 OK từ SMTP provider. Về phía ứng dụng, email đã được nhận để gửi đi.'
      },
      {
        id: 'c2',
        label: 'Đăng nhập dashboard của email provider',
        cost: 5,
        key: true,
        result:
          'Tỉ lệ bounce 32% trong 3 ngày qua (bình thường dưới 2%). Tài khoản đang bị gắn cảnh báo. ' +
          'Chi tiết bounce: "550 SPF check failed".'
      },
      {
        id: 'c3',
        label: 'Gửi thử một email tới hộp thư cá nhân của mình',
        cost: 4,
        result: 'Nhận được bình thường trong vòng 5 giây (Gmail). Nếu chỉ test bằng cách này sẽ kết luận sai là "không có lỗi".'
      },
      {
        id: 'c4',
        label: 'Gửi thử tới một địa chỉ thuộc domain của khách hàng',
        cost: 4,
        key: true,
        result: 'Không nhận được, cũng không nằm trong thư mục spam. Mail bị từ chối ngay ở tầng mail server của khách.'
      },
      {
        id: 'c5',
        label: 'Tra bản ghi DNS SPF / DKIM / DMARC của domain gửi',
        cost: 5,
        key: true,
        result:
          'Bản ghi SPF vẫn chỉ liệt kê dải IP của provider CŨ. Tháng trước team đã đổi sang provider mới ' +
          'nhưng chưa cập nhật DNS. DMARC đặt policy reject.'
      },
      {
        id: 'c6',
        label: 'Kiểm tra hàng đợi gửi mail có tồn đọng không',
        cost: 3,
        result: 'Queue rỗng, mọi job đều đã xử lý xong và đánh dấu thành công.'
      },
      {
        id: 'c7',
        label: 'Kiểm tra lịch sử thay đổi code phần gửi mail',
        cost: 5,
        result: 'Commit cuối cùng chạm vào module mail cách đây 2 tháng. Không có thay đổi nào trùng thời điểm sự cố.'
      },
      {
        id: 'c8',
        label: 'Nhờ khách kiểm tra thư mục spam và bộ lọc',
        cost: 4,
        result: 'Khách xác nhận không có trong spam, và không có rule lọc nào chặn domain của chúng ta.'
      },
      {
        id: 'c9',
        label: 'Kiểm tra cài đặt nhận thông báo của tài khoản khách',
        cost: 3,
        result: 'Tất cả tài khoản đều đang bật nhận thông báo email. Không phải do người dùng tự tắt.'
      }
    ],
    causes: [
      {
        t: 'Bản ghi SPF chưa cập nhật sau khi đổi email provider, mail server phía khách từ chối nhận',
        correct: true,
        why:
          'Provider mới gửi từ dải IP chưa có trong SPF. Domain khách đặt DMARC policy reject nên loại thẳng, ' +
          'không vào cả spam. Ứng dụng vẫn thấy 250 OK vì provider đã nhận email — thất bại xảy ra ở chặng sau đó. ' +
          'Bài học: đổi hạ tầng gửi mail phải kèm bước cập nhật DNS và theo dõi bounce rate.'
      },
      {
        t: 'Code gửi mail bị lỗi sau một lần cập nhật',
        correct: false,
        why: 'Không có thay đổi nào ở module mail trong 2 tháng, và log ứng dụng cho thấy tiến trình gửi vẫn chạy đúng.'
      },
      {
        t: 'Hàng đợi bị nghẽn nên email chưa thực sự được gửi đi',
        correct: false,
        why: 'Queue rỗng và mọi job đều hoàn tất. Email đã rời khỏi hệ thống của chúng ta.'
      },
      {
        t: 'Người dùng phía khách đã tắt nhận thông báo trong phần cài đặt',
        correct: false,
        why: 'Đã kiểm tra: tất cả tài khoản đều bật. Đây là giả thuyết dễ chọn khi muốn đẩy trách nhiệm sang phía khách.'
      }
    ]
  }
];
