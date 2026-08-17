/* Spec Detective - tìm điểm mơ hồ trong spec.
 * segments: nối lại thành đoạn spec. Segment có a=true là điểm mơ hồ cần tìm.
 * Segment không mơ hồ vẫn bấm được — bấm nhầm bị trừ điểm (chống chiến thuật chọn tất cả).
 */
window.SPEC_DETECTIVE_CASES = [
  {
    id: 'sd-01',
    title: 'Xử lý đơn hàng',
    source: 'Trích requirement khách gửi qua email',
    segments: [
      { t: 'Hệ thống phải xử lý đơn hàng ' },
      {
        t: 'nhanh chóng',
        a: true,
        r: 'Không có con số. Nhanh là bao nhiêu giây? Đo ở server hay tính cả thời gian client render? Với tải bao nhiêu đơn/phút?'
      },
      { t: ' và gửi email xác nhận cho khách hàng ' },
      {
        t: 'ngay lập tức',
        a: true,
        r: 'Đồng bộ hay qua queue? Nếu SMTP lỗi thì retry mấy lần, trong bao lâu? "Ngay lập tức" mà đồng bộ sẽ làm chậm luôn cả API đặt hàng.'
      },
      { t: '. Nếu quá trình gửi mail thất bại thì ' },
      {
        t: 'thông báo cho người quản trị',
        a: true,
        r: 'Ai là "người quản trị" — role admin trong hệ thống, hay một địa chỉ cố định? Kênh nào (email/Slack/Backlog)? Lỗi mức nào mới báo?'
      },
      { t: ' để xử lý.' }
    ],
    followUp: {
      question: 'Câu hỏi làm rõ nào nên gửi khách hàng TRƯỚC tiên?',
      options: [
        {
          t: 'Ngưỡng "nhanh chóng" cụ thể là bao nhiêu giây, đo ở điểm nào, và với bao nhiêu đơn đồng thời?',
          good: true,
          why: 'Chốt được con số đo được thì mới thiết kế được kiến trúc (sync hay queue) và mới viết được test. Đây là điểm ảnh hưởng lớn nhất tới effort.'
        },
        {
          t: 'Email xác nhận dùng template nào, có logo công ty không?',
          good: false,
          why: 'Câu hỏi hợp lệ nhưng là chi tiết trình bày, không ảnh hưởng kiến trúc. Hỏi ở vòng sau.'
        },
        {
          t: 'Chúng tôi sẽ xử lý trong vòng 3 giây, anh/chị thấy ổn không?',
          good: false,
          why: 'Tự đưa con số rồi hỏi xác nhận là ép khách chấp nhận giả định của mình. Khách gật cho xong, tới UAT mới vỡ.'
        }
      ]
    }
  },
  {
    id: 'sd-02',
    title: 'Quên mật khẩu',
    source: 'Trích spec màn hình SCR_012',
    segments: [
      { t: 'Khi người dùng bấm "Quên mật khẩu", hệ thống gửi email chứa link đặt lại. Link có hiệu lực trong ' },
      {
        t: 'một khoảng thời gian hợp lý',
        a: true,
        r: 'Con số bắt buộc phải chốt: 15 phút hay 24 giờ là hai thiết kế bảo mật khác nhau. Không chốt thì dev tự đoán.'
      },
      { t: '. Sau khi đặt lại thành công, ' },
      {
        t: 'người dùng được đăng nhập lại',
        a: true,
        r: 'Tự động đăng nhập luôn, hay bắt về màn login? Các session đang mở trên thiết bị khác có bị huỷ không? Đây là điểm bảo mật, không phải chi tiết UI.'
      },
      { t: '. Nếu email không tồn tại trong hệ thống thì ' },
      {
        t: 'hiển thị thông báo lỗi',
        a: true,
        r: 'Báo rõ "email không tồn tại" là để lộ danh sách user (account enumeration). Cần chốt với khách: ưu tiên UX hay ưu tiên bảo mật?'
      },
      { t: '.' }
    ],
    followUp: {
      question: 'Điểm nào cần đưa vào Q&A sheet với mức ưu tiên cao nhất?',
      options: [
        {
          t: 'Cách hiển thị khi email không tồn tại — vì liên quan tới lộ thông tin tài khoản',
          good: true,
          why: 'Đây là rủi ro bảo mật, sửa sau khi release rất khó vì khách đã quen luồng. Phải chốt trước khi code.'
        },
        {
          t: 'Màu của nút "Gửi lại email"',
          good: false,
          why: 'Chi tiết UI, không chặn implement.'
        },
        {
          t: 'Không cần hỏi, cứ theo chuẩn chung của các hệ thống khác',
          good: false,
          why: '"Chuẩn chung" mỗi người hiểu một kiểu. Không có ghi chép thì tới UAT khách bảo sai là mình chịu.'
        }
      ]
    }
  },
  {
    id: 'sd-03',
    title: 'Upload ảnh sản phẩm',
    source: 'Trích ticket Backlog',
    segments: [
      { t: 'Người bán có thể tải lên ảnh sản phẩm. Hệ thống hỗ trợ ' },
      {
        t: 'các định dạng ảnh thông dụng',
        a: true,
        r: 'Liệt kê cụ thể: jpg/png/webp/heic/gif? HEIC từ iPhone rất hay bị bỏ sót rồi phát sinh bug sau release.'
      },
      { t: ', dung lượng ' },
      {
        t: 'không quá lớn',
        a: true,
        r: 'Cần số MB cụ thể để cấu hình nginx/PHP và validate phía client. Không có số thì mỗi tầng một giới hạn khác nhau.'
      },
      { t: '. Ảnh sẽ được ' },
      {
        t: 'tự động tối ưu',
        a: true,
        r: 'Tối ưu là resize, nén, hay đổi format? Kích thước đích bao nhiêu? Có giữ bản gốc không? Ảnh hưởng trực tiếp tới chi phí lưu trữ.'
      },
      { t: ' và hiển thị ở trang chi tiết sản phẩm.' }
    ],
    followUp: {
      question: 'Ngoài 3 điểm trên, điều gì trong spec này chưa được nhắc tới mà chắc chắn sẽ phát sinh?',
      options: [
        {
          t: 'Số lượng ảnh tối đa mỗi sản phẩm và thứ tự sắp xếp ảnh',
          good: true,
          why: 'Spec chỉ nói "ảnh sản phẩm" số ít/số nhiều không rõ. Giới hạn số lượng và thứ tự hiển thị luôn được hỏi ở buổi UAT đầu tiên.'
        },
        {
          t: 'Tên biến dùng để lưu đường dẫn ảnh',
          good: false,
          why: 'Chi tiết implement, không thuộc phạm vi spec nghiệp vụ.'
        },
        {
          t: 'Không thiếu gì, spec đã đủ để code',
          good: false,
          why: 'Spec 3 câu cho tính năng upload là chưa đủ. Bỏ qua bước hỏi bây giờ, cái giá phải trả nằm ở giai đoạn test.'
        }
      ]
    }
  },
  {
    id: 'sd-04',
    title: 'Báo cáo doanh thu theo tháng',
    source: 'Trích biên bản họp với khách',
    segments: [
      { t: 'Quản lý có thể xuất báo cáo doanh thu ' },
      {
        t: 'theo tháng',
        a: true,
        r: 'Tháng theo timezone nào? Khách ở Nhật, server ở Singapore — đơn lúc 8h sáng ngày 1 có thể rơi vào tháng trước. Ranh giới tháng phải chốt bằng văn bản.'
      },
      { t: ' ra file Excel. Báo cáo gồm ' },
      {
        t: 'tổng doanh thu',
        a: true,
        r: 'Doanh thu tính trước hay sau thuế? Có trừ đơn đã huỷ / hoàn tiền không? Phí ship có tính vào không? Ba cách hiểu ra ba con số khác nhau.'
      },
      { t: ' và số lượng đơn hàng, sắp xếp theo ngày. File được gửi tới email của người yêu cầu ' },
      {
        t: 'sau khi xử lý xong',
        a: true,
        r: 'Không nói gì về trường hợp dữ liệu lớn: timeout bao lâu, có màn hình theo dõi tiến độ không, chạy nền hay chờ đồng bộ?'
      },
      { t: '.' }
    ],
    followUp: {
      question: 'Cách xử lý nào đúng khi phát hiện "tổng doanh thu" mơ hồ?',
      options: [
        {
          t: 'Ghi vào Q&A sheet kèm 3 phương án tính và ví dụ số liệu cụ thể cho khách chọn',
          good: true,
          why: 'Đưa lựa chọn kèm ví dụ số giúp khách quyết nhanh, và có bằng chứng bằng văn bản khi con số bị thắc mắc lúc vận hành.'
        },
        {
          t: 'Chọn cách phổ biến nhất rồi ghi chú trong code là "theo giả định"',
          good: false,
          why: 'Giả định nằm trong code thì khách không bao giờ đọc. Tới lúc lệch số thì không ai chịu trách nhiệm.'
        },
        {
          t: 'Hỏi miệng BrSE trong buổi daily',
          good: false,
          why: 'Không có bản ghi. BrSE nhớ một kiểu, khách nhớ một kiểu, sau 3 tháng không ai xác nhận được.'
        }
      ]
    }
  },
  {
    id: 'sd-05',
    title: 'Phân quyền quản trị',
    source: 'Trích spec chức năng',
    segments: [
      { t: 'Tài khoản Admin có thể ' },
      {
        t: 'quản lý người dùng',
        a: true,
        r: '"Quản lý" gồm những thao tác nào? Xem / tạo / sửa / khoá / xoá / đổi mật khẩu hộ / xem lịch sử? Mỗi thao tác là một quyền riêng.'
      },
      { t: ' trong hệ thống. Khi Admin ' },
      {
        t: 'xoá một người dùng',
        a: true,
        r: 'Xoá mềm hay xoá cứng? Dữ liệu người dùng đã tạo (đơn hàng, bình luận) xử lý thế nào? Có khôi phục được không?'
      },
      { t: ', hệ thống ghi lại lịch sử thao tác. Admin ' },
      {
        t: 'không thể tự xoá tài khoản của mình',
        r: 'Điểm này rõ ràng và kiểm chứng được — không phải điểm mơ hồ. Spec có câu rõ thì đừng đánh dấu, chọn bừa là bị trừ điểm.'
      },
      { t: '.' }
    ],
    followUp: {
      question: 'Vì sao "Admin không thể tự xoá tài khoản của mình" KHÔNG phải điểm mơ hồ?',
      options: [
        {
          t: 'Vì nó phát biểu một quy tắc cụ thể, viết được test case xác nhận đúng/sai ngay',
          good: true,
          why: 'Tiêu chí nhận biết điểm mơ hồ: có viết được test case pass/fail rõ ràng từ câu đó không. Viết được thì không mơ hồ.'
        },
        {
          t: 'Vì đó là quy tắc chung mọi hệ thống đều có',
          good: false,
          why: '"Mọi hệ thống đều có" là suy đoán. Lý do đúng nằm ở chỗ câu văn đủ cụ thể để kiểm chứng, không phải ở thông lệ.'
        },
        {
          t: 'Vì nó không ảnh hưởng tới database',
          good: false,
          why: 'Mức độ ảnh hưởng không liên quan tới việc câu văn có mơ hồ hay không.'
        }
      ]
    }
  },
  {
    id: 'sd-06',
    title: 'Thông báo khi có thay đổi đơn hàng',
    source: 'Trích yêu cầu bổ sung giữa sprint',
    segments: [
      { t: 'Khi trạng thái đơn hàng thay đổi, gửi thông báo cho ' },
      {
        t: 'những người liên quan',
        a: true,
        r: 'Ai là "liên quan"? Người đặt, người nhận, người bán, nhân viên phụ trách? Danh sách này quyết định luôn cấu trúc bảng và query.'
      },
      { t: ' qua ' },
      {
        t: 'kênh phù hợp',
        a: true,
        r: 'Email, SMS, push, hay in-app? Mỗi kênh là một tích hợp riêng, chi phí và effort khác hẳn nhau. SMS còn tốn tiền thật mỗi tin.'
      },
      { t: '. Nếu gửi thất bại thì ' },
      {
        t: 'thử lại',
        a: true,
        r: 'Thử lại mấy lần, giãn cách bao lâu, quá số lần thì làm gì? Không chốt thì hoặc là không retry, hoặc là retry vô hạn làm nghẽn queue.'
      },
      { t: '. Người dùng có thể tắt thông báo trong phần Cài đặt.' }
    ],
    followUp: {
      question: 'Yêu cầu bổ sung giữa sprint như thế này nên xử lý ra sao?',
      options: [
        {
          t: 'Làm rõ 3 điểm trên, ước tính lại effort, rồi trao đổi với PM về việc điều chỉnh scope sprint',
          good: true,
          why: 'Yêu cầu nghe ngắn nhưng "kênh phù hợp" có thể là nhiều tuần tích hợp. Làm rõ rồi mới estimate, estimate rồi mới cam kết.'
        },
        {
          t: 'Nhận vào sprint luôn vì nghe có vẻ nhỏ, chi tiết tính sau',
          good: false,
          why: 'Đây là cách sprint vỡ. Một câu spec ba dòng có thể chứa cả tích hợp SMS provider.'
        },
        {
          t: 'Từ chối thẳng vì ngoài scope',
          good: false,
          why: 'Từ chối không kèm phân tích thì mất uy tín với khách. Đưa con số effort rồi để PM/khách quyết mới là cách chuyên nghiệp.'
        }
      ]
    }
  }
];
