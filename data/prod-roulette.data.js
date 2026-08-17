/* PROD Roulette - kịch bản phân nhánh về thao tác trên môi trường PRODUCTION.
 * Mỗi lựa chọn cộng điểm rủi ro. Điểm cuối = 100 - tổng rủi ro.
 * Nội dung dựa trên các tình huống đã từng gây incident thật.
 */
window.PROD_ROULETTE_SCENARIOS = [
  {
    id: 'pr-01',
    title: 'Test tính năng tặng voucher',
    brief:
      'Project không có môi trường Staging. PM nhờ bạn test nhanh tính năng "tặng voucher sinh nhật" ' +
      'ngay trên PRODUCTION vì sáng mai khách nghiệm thu.',
    start: 'n1',
    nodes: {
      n1: {
        text: 'Bạn mở màn hình quản trị trên PROD. Việc đầu tiên bạn làm là gì?',
        options: [
          {
            t: 'Rà soát xem tính năng này có gửi gì ra ngoài hệ thống không (email, SMS, push, webhook)',
            risk: 0,
            feedback: 'Đúng thứ tự. Side-effect ra ngoài là thứ không thể hoàn tác — phải biết trước khi bấm.',
            next: 'n2'
          },
          {
            t: 'Tạo một user test rồi bấm thử luôn, chỉ một bản ghi thì ảnh hưởng gì',
            risk: 45,
            feedback: '"Chỉ một bản ghi" là câu nói phổ biến nhất trước mỗi incident. Bạn chưa biết tính năng làm gì khi bấm.',
            next: 'nSend'
          },
          {
            t: 'Nhắn PM xin approval bằng văn bản trên Backlog trước đã',
            risk: 5,
            feedback: 'Approval bằng văn bản là đúng, nhưng chưa đủ. Approval không ngăn được email gửi nhầm.',
            next: 'n2'
          }
        ]
      },
      n2: {
        text:
          'Bạn phát hiện: khi voucher được tạo, hệ thống gửi email VÀ SMS thật cho chủ tài khoản, ' +
          'qua provider production. Bây giờ làm gì?',
        options: [
          {
            t: 'Tắt kênh gửi thật bằng feature flag, hoặc trỏ provider sang sandbox trước khi test',
            risk: 0,
            feedback: 'Chặn từ gốc. Đây là biện pháp duy nhất thực sự an toàn khi có side-effect không thu hồi được.',
            next: 'n3'
          },
          {
            t: 'Dùng email và số điện thoại nội bộ của mình, provider vẫn để nguyên production',
            risk: 20,
            feedback:
              'Chấp nhận được nếu chắc chắn danh sách người nhận chỉ có mình bạn. Rủi ro nằm ở chỗ: ' +
              'nếu logic chọn người nhận sai (query thừa điều kiện), tin nhắn bay tới người dùng thật.',
            next: 'n3'
          },
          {
            t: 'Chạy thử một lần xem thực tế có gửi không rồi tính tiếp',
            risk: 60,
            feedback: 'Đây chính là cách incident xảy ra: dùng PROD để kiểm chứng giả thuyết về PROD.',
            next: 'nSend'
          }
        ]
      },
      n3: {
        text: 'Test xong, tính năng chạy đúng. Trên PROD giờ có 3 voucher test và 1 tài khoản test. Bạn làm gì?',
        options: [
          {
            t: 'Xoá ngay trong session này, rồi chạy lại đúng filter đã dùng để tạo để xác nhận sạch',
            risk: 0,
            feedback: 'Dọn ngay + xác nhận bằng chính query đã tạo. Không dựa vào trí nhớ.',
            next: 'n4'
          },
          {
            t: 'Ghi vào TODO, mai đầu giờ dọn',
            risk: 35,
            feedback: 'Mai bạn sẽ có việc khác. Dữ liệu test bị bỏ quên trên PROD là incident đã xảy ra thật ở team.',
            next: 'nLeft'
          },
          {
            t: 'Để nguyên, voucher hết hạn sau 7 ngày là tự biến mất',
            risk: 50,
            feedback: 'Hết hạn không có nghĩa là không hiển thị. Khách hàng vẫn nhìn thấy trong 7 ngày đó.',
            next: 'nLeft'
          }
        ]
      },
      n4: {
        text: 'Đã dọn sạch và xác nhận bằng query. Bước cuối cùng?',
        options: [
          {
            t: 'Nhờ một đồng nghiệp kiểm tra lại, ghi kết quả test + xác nhận đã dọn vào ticket',
            risk: 0,
            feedback: 'Nguyên tắc 4 mắt. Người thứ hai bắt được thứ mình đã quen mắt bỏ qua.',
            next: 'endGood'
          },
          {
            t: 'Báo PM là test xong, chuyển ticket sang Done',
            risk: 15,
            feedback: 'Thiếu bản ghi lại việc đã thao tác gì trên PROD. Khi có sự cố sau này, không ai truy được.',
            next: 'endOk'
          }
        ]
      },
      nSend: {
        end: true,
        tone: 'bad',
        title: 'Hệ thống đã gửi email và SMS thật',
        verdict:
          'Tính năng chạy đúng như thiết kế: nó gửi thông báo trúng thưởng tới người dùng thật. ' +
          'Không có thao tác nào rút lại được tin đã gửi. Đây không phải rủi ro dữ liệu (dọn là xong) — ' +
          'đây là hành động không thể thu hồi. Team phải quyết định: hoặc triển khai chương trình thật ' +
          'để giữ uy tín, hoặc xin lỗi hàng loạt người dùng. Cả hai đều tốn tiền thật.'
      },
      nLeft: {
        end: true,
        tone: 'bad',
        title: 'Dữ liệu test bị khách hàng nhìn thấy',
        verdict:
          'Sáng hôm sau khách vào hệ thống, thấy voucher test hiển thị trong danh sách khuyến mãi đang chạy ' +
          'và gửi ảnh chụp màn hình vào group. Việc dọn dẹp mất 5 phút, nhưng uy tín mất nhiều hơn thế. ' +
          'Quy tắc: dọn ngay trong cùng session, không để "làm sau".'
      },
      endOk: {
        end: true,
        tone: 'mixed',
        title: 'An toàn, nhưng không để lại dấu vết',
        verdict:
          'Không có sự cố nào xảy ra. Điểm còn thiếu là bản ghi: lần sau ai đó hỏi "hôm đó đã đụng gì trên PROD", ' +
          'không ai trả lời được. Ghi lại thao tác trên PROD tốn 2 phút và cứu bạn ở lần điều tra sự cố tiếp theo.'
      },
      endGood: {
        end: true,
        tone: 'good',
        title: 'Xử lý đúng quy trình',
        verdict:
          'Rà soát side-effect trước, chặn kênh gửi thật, dọn ngay và xác nhận bằng query, có người thứ hai review, ' +
          'có bản ghi trên ticket. Đây là cách duy nhất để test trên PROD mà vẫn ngủ ngon. ' +
          'Song song đó, hãy đề xuất dựng Staging — checklist con người chỉ là giải pháp tạm.'
      }
    }
  },
  {
    id: 'pr-02',
    title: 'Đặt lịch đăng bài trên PROD',
    brief:
      'Khách báo lỗi tính năng đặt lịch đăng bài không chạy. Bạn cần tái hiện trên PROD ' +
      'vì local không có dữ liệu giống thật.',
    start: 'n1',
    nodes: {
      n1: {
        text: 'Bạn cần tạo một bài viết có lịch đăng để tái hiện lỗi. Bạn đặt tiêu đề là gì?',
        options: [
          {
            t: '[TEST-DO-NOT-PUBLISH] kiem tra loi dat lich 2026-08-17',
            risk: 0,
            feedback: 'Có marker nhận diện + ngày. Ai nhìn cũng biết là dữ liệu test và tìm lại được bằng search.',
            next: 'n2'
          },
          {
            t: 'Thông báo bảo trì hệ thống ngày 20/08',
            risk: 40,
            feedback: 'Nội dung trông y như thật. Nếu lọt ra ngoài, khách hàng sẽ tin đó là thông báo chính thức.',
            next: 'n2'
          },
          {
            t: 'test',
            risk: 15,
            feedback: 'Có ý thức đánh dấu nhưng quá mờ nhạt. Search "test" ra hàng trăm kết quả lẫn dữ liệu thật.',
            next: 'n2'
          }
        ]
      },
      n2: {
        text: 'Trước khi lưu, bạn thấy có tuỳ chọn trạng thái: Công khai / Riêng tư / Bản nháp. Chọn gì?',
        options: [
          {
            t: 'Bản nháp, rồi kiểm tra xem cơ chế đặt lịch có xử lý bản nháp không',
            risk: 5,
            feedback: 'An toàn nhất. Rủi ro duy nhất: nếu bug chỉ xảy ra với bài công khai thì chưa tái hiện được.',
            next: 'n3'
          },
          {
            t: 'Riêng tư — vẫn chạy qua luồng đặt lịch nhưng không ai ngoài mình thấy',
            risk: 0,
            feedback: 'Cân bằng tốt giữa tái hiện đúng luồng và không lộ ra ngoài.',
            next: 'n3'
          },
          {
            t: 'Công khai, vì bug chỉ xuất hiện với bài công khai',
            risk: 35,
            feedback:
              'Nếu bắt buộc phải công khai để tái hiện, đó là lúc cần dừng lại và xin approval bằng văn bản, ' +
              'kèm hẹn giờ dọn ngay sau khi xong.',
            next: 'n3'
          }
        ]
      },
      n3: {
        text: 'Bạn đặt lịch đăng lúc 15:00. Trước khi rời màn hình, bạn viết sẵn thứ gì?',
        options: [
          {
            t: 'Rollback plan cụ thể: xoá bài ID nào, ở bảng nào, kiểm tra lại bằng query nào',
            risk: 0,
            feedback: 'Viết trước khi thao tác, không phải nghĩ sau khi xong. Đây là điểm khác biệt giữa cẩn thận và may mắn.',
            next: 'n4'
          },
          {
            t: 'Đặt báo thức 15:30 để nhớ quay lại kiểm tra',
            risk: 20,
            feedback: 'Tốt hơn không có gì, nhưng báo thức nhắc bạn nhớ — nó không nói cho bạn biết phải xoá cái gì.',
            next: 'n4'
          },
          {
            t: 'Không cần, bài có marker rồi, lát nữa tìm lại dễ',
            risk: 30,
            feedback: 'Marker giúp tìm, không giúp nhớ. 15:00 bạn có thể đang họp và quên hẳn việc này.',
            next: 'n4'
          }
        ]
      },
      n4: {
        text: '15:00 bài đăng thành công, bạn đã tái hiện được lỗi và có đủ log. Giờ là 15:05, bạn đang họp.',
        options: [
          {
            t: 'Xin 2 phút rời họp, dọn ngay theo rollback plan đã viết',
            risk: 0,
            feedback: '2 phút bây giờ rẻ hơn rất nhiều so với một buổi xin lỗi khách.',
            next: 'endGood'
          },
          {
            t: 'Dọn ngay sau khi họp xong lúc 16:00',
            risk: 25,
            feedback: 'Một tiếng là đủ để khách hàng nhìn thấy. Rủi ro không lớn nhưng hoàn toàn tránh được.',
            next: 'endOk'
          },
          {
            t: 'Bài để riêng tư nên không gấp, cuối ngày dọn',
            risk: 20,
            feedback: 'Nếu chắc chắn là riêng tư thì rủi ro thấp. Vấn đề là "cuối ngày" rất hay biến thành "tuần sau".',
            next: 'endOk'
          }
        ]
      },
      endGood: {
        end: true,
        tone: 'good',
        title: 'Tái hiện được lỗi, PROD sạch',
        verdict:
          'Có marker, chọn trạng thái hạn chế hiển thị, viết rollback plan trước, dọn ngay khi xong. ' +
          'Bạn vừa lấy được log cần thiết mà không để lại dấu vết nào cho khách nhìn thấy.'
      },
      endOk: {
        end: true,
        tone: 'mixed',
        title: 'Không có sự cố, nhưng nhờ may',
        verdict:
          'Lần này không ai kịp nhìn thấy. Khoảng trống giữa "xong việc" và "dọn dẹp" chính là chỗ ' +
          'các incident chui vào. Rút ngắn khoảng đó về 0 là việc trong tầm kiểm soát của bạn.'
      }
    }
  },
  {
    id: 'pr-03',
    title: 'Migration gấp chiều thứ Sáu',
    brief:
      '16:30 thứ Sáu. Khách yêu cầu thêm một cột vào bảng orders để kịp báo cáo sáng thứ Hai. ' +
      'Bảng có 12 triệu bản ghi.',
    start: 'n1',
    nodes: {
      n1: {
        text: 'Phản hồi đầu tiên của bạn với yêu cầu này?',
        options: [
          {
            t: 'Trả lời: làm được, nhưng đề xuất chạy sáng thứ Hai hoặc tối nay sau giờ cao điểm, kèm lý do',
            risk: 0,
            feedback:
              'Không từ chối, đưa phương án kèm lý do kỹ thuật. Deploy chiều thứ Sáu nghĩa là nếu vỡ, ' +
              'không có ai trực cuối tuần để sửa.',
            next: 'n2'
          },
          {
            t: 'Nhận luôn, chỉ là thêm một cột thôi mà',
            risk: 30,
            feedback: 'ALTER TABLE trên 12 triệu bản ghi có thể khoá bảng nhiều phút. Không có "chỉ là" ở quy mô này.',
            next: 'n2'
          },
          {
            t: 'Từ chối vì nguyên tắc không deploy thứ Sáu',
            risk: 15,
            feedback: 'Nguyên tắc đúng, nhưng từ chối không kèm phương án thay thế sẽ đẩy khách vào thế bí.',
            next: 'n2'
          }
        ]
      },
      n2: {
        text: 'Khách đồng ý chạy lúc 21:00. Trước khi chạy, bạn chuẩn bị gì?',
        options: [
          {
            t: 'Đo thời gian chạy trên bản sao dữ liệu tương đương, viết sẵn câu lệnh rollback, backup trước khi chạy',
            risk: 0,
            feedback: 'Biết trước migration mất bao lâu là khác biệt giữa "chờ 3 phút" và "hoảng loạn sau 20 phút".',
            next: 'n3'
          },
          {
            t: 'Backup database rồi chạy, có gì thì restore',
            risk: 20,
            feedback:
              'Backup là bắt buộc nhưng chưa đủ. Restore 12 triệu bản ghi mất bao lâu? Dữ liệu phát sinh ' +
              'trong lúc đó xử lý sao?',
            next: 'n3'
          },
          {
            t: 'Chạy thẳng, thêm cột nullable thì không mất dữ liệu',
            risk: 40,
            feedback: 'Không mất dữ liệu không có nghĩa là không gây downtime. Khoá bảng orders là dừng luôn việc bán hàng.',
            next: 'n3'
          }
        ]
      },
      n3: {
        text: '21:00 bạn chạy migration. Sau 4 phút vẫn chưa xong, monitoring bắt đầu báo API timeout.',
        options: [
          {
            t: 'Kiểm tra tiến độ migration trước khi quyết định — huỷ giữa chừng có thể để lại trạng thái dở dang',
            risk: 0,
            feedback: 'Đúng. Ctrl+C một ALTER TABLE đang chạy có thể tốn thêm thời gian rollback hơn là để nó chạy nốt.',
            next: 'n4'
          },
          {
            t: 'Huỷ ngay lập tức để API hồi phục',
            risk: 25,
            feedback:
              'Phản xạ dễ hiểu nhưng nguy hiểm: huỷ giữa chừng khiến DB phải rollback, thường lâu hơn ' +
              'thời gian còn lại của chính migration.',
            next: 'n4'
          },
          {
            t: 'Chờ thêm, đằng nào cũng lỡ rồi',
            risk: 20,
            feedback: 'Chờ có thể đúng, nhưng chờ mà không biết còn bao lâu thì là đánh bạc, không phải quyết định.',
            next: 'n4'
          }
        ]
      },
      n4: {
        text: 'Migration hoàn tất lúc 21:06. API trở lại bình thường. Bạn làm gì tiếp?',
        options: [
          {
            t: 'Kiểm tra smoke test luồng đặt hàng, ghi lại toàn bộ timeline và downtime vào ticket, báo team',
            risk: 0,
            feedback: 'Ghi lại downtime 6 phút là dữ liệu để lần sau ước tính đúng và để thuyết phục khách về cửa sổ bảo trì.',
            next: 'endGood'
          },
          {
            t: 'Đóng máy, thứ Hai kiểm tra',
            risk: 30,
            feedback: 'Chưa xác nhận luồng nghiệp vụ còn chạy đúng. Cột mới có thể phá vỡ query SELECT * ở chỗ khác.',
            next: 'endOk'
          }
        ]
      },
      endGood: {
        end: true,
        tone: 'good',
        title: 'Có kiểm soát từ đầu tới cuối',
        verdict:
          'Bạn đã đàm phán được thời điểm hợp lý, đo trước, có backup và rollback, không hoảng khi quá giờ dự kiến, ' +
          'và ghi lại số liệu cho lần sau. 6 phút downtime có kế hoạch tốt hơn nhiều so với 30 giây may mắn.'
      },
      endOk: {
        end: true,
        tone: 'mixed',
        title: 'Chạy xong nhưng chưa xác nhận',
        verdict:
          'Migration thành công về mặt kỹ thuật. Nhưng "ALTER TABLE chạy xong" và "hệ thống vẫn hoạt động đúng" ' +
          'là hai việc khác nhau. Smoke test 5 phút là thứ ngăn bạn nhận cuộc gọi sáng thứ Hai.'
      }
    }
  }
];
