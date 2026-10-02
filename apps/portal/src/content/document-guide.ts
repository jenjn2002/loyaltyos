export type CustomerGuideTopic = {
  id: string;
  title: string;
  area: string;
  image: "home" | "claim" | "checkin" | "wallet" | "transactions" | "notifications" | "projects" | "rewards" | "badges" | "profile";
  purpose: string;
  steps: string[];
  result: string;
  notes?: string[];
};

export const customerGuide: CustomerGuideTopic[] = [
  {
    id: "home-balance",
    title: "Trang chủ, số dư và hạng thành viên",
    area: "Bắt đầu",
    image: "home",
    purpose: "Xem nhanh số dư của từng loại điểm, tiến độ lên hạng, các điểm đang chờ nhận và những hoạt động đang mở cho bạn.",
    steps: [
      "Đăng nhập bằng tài khoản thành viên được cấp, rồi mở Trang chủ.",
      "Xem từng ví điểm riêng; loại điểm và đơn vị hiển thị theo cấu hình chương trình.",
      "Nếu có mục điểm đang chờ nhận, mở mục đó để xem campaign, số điểm và hạn nhận trước khi quyết định claim.",
      "Xem hạng hiện tại và điều kiện lên hạng. Nếu hạng có nhiều điều kiện điểm, từng điều kiện được hiển thị riêng.",
    ],
    result: "Trang chủ là nơi tổng quan; lịch sử đầy đủ nằm ở Thêm → Giao dịch, còn thao tác về điểm nằm ở Điểm hoặc Phần thưởng.",
    notes: ["Số điểm pending chưa phải số dư có thể dùng.", "Điểm có ngày hết hạn sẽ có ghi chú số ngày còn lại; chính sách hết hạn phụ thuộc cấu hình loại điểm."],
  },
  {
    id: "claim-points",
    title: "Nhận điểm từ campaign",
    area: "Điểm và ví",
    image: "claim",
    purpose: "Một campaign có thể tự cộng điểm vào ví hoặc yêu cầu thành viên chủ động nhận (claim) trước khi điểm được ghi nhận.",
    steps: [
      "Trên Trang chủ, mở thẻ Điểm đang chờ nhận hoặc mở chuông ở góc trên / Thêm → Thông báo để tìm campaign.",
      "Kiểm tra tên campaign, loại điểm, số điểm và thời hạn nhận.",
      "Nhấn Nhận điểm / Claim để xác nhận. Không cần claim nếu campaign đã tự động cấp điểm.",
      "Mở Điểm để kiểm tra số dư hoặc Thêm → Giao dịch để kiểm tra giao dịch mới.",
    ],
    result: "Claim thành công sẽ ghi điểm vào đúng ví theo campaign; trạng thái chờ nhận được gỡ khỏi danh sách.",
    notes: ["Nút claim chỉ xuất hiện với phần thưởng còn hiệu lực và đang chờ nhận.", "Không nhấn nhiều lần nếu màn hình đang xử lý; làm mới trang để kiểm tra trạng thái trước."],
  },
  {
    id: "checkin",
    title: "Điểm danh nhận điểm",
    area: "Điểm và ví",
    image: "checkin",
    purpose: "Nếu chương trình có mở campaign điểm danh, bạn có thể ghi nhận hoạt động trong ngày và xem lịch hoạt động dạng ô màu.",
    steps: [
      "Mở Trang chủ và tìm thẻ Điểm danh. Thẻ chỉ hiện khi chương trình điểm danh đang được bật.",
      "Xem loại điểm và phần thưởng đang áp dụng, sau đó nhấn Điểm danh hôm nay.",
      "Kiểm tra lịch: ngày điểm danh thành công được tô màu; màn hình hiển thị tổng số ngày trong khoảng lịch sử.",
      "Nếu campaign dùng chế độ claim, mở phần điểm đang chờ nhận để hoàn tất claim.",
    ],
    result: "Mỗi event chỉ ghi nhận một lần trong ngày theo múi giờ của event. Cách ghi điểm có thể là tự động hoặc chờ claim.",
    notes: ["Không thấy thẻ điểm danh nghĩa là hiện không có campaign điểm danh khả dụng cho bạn.", "Không thể điểm danh bù cho ngày cũ bằng nút này."],
  },
  {
    id: "transactions",
    title: "Lịch sử giao dịch",
    area: "Điểm và ví",
    image: "transactions",
    purpose: "Theo dõi điểm đã nhận, sử dụng, chuyển, đổi, điều chỉnh, hết hạn hoặc được hoàn lại; dòng giao dịch giải thích nguồn gốc bằng tên dễ hiểu.",
    steps: [
      "Mở Thêm ở thanh điều hướng dưới cùng, rồi chọn Giao dịch.",
      "Chọn bộ lọc phù hợp như Earn, Redeem, Adjustment, Received by me, Given by me, Exchange, Expiry hoặc Reversal.",
      "Mở rộng một dòng để đọc campaign/reward/người thực hiện, ghi chú, thời gian, số điểm và số dư sau giao dịch.",
      "Nếu vừa thực hiện thao tác, làm mới danh sách để xem trạng thái mới nhất.",
    ],
    result: "Lịch sử chỉ đọc; nếu cần giải thích giao dịch lạ, gửi ngày, loại điểm và mã giao dịch cho quản trị viên.",
    notes: ["Các bộ lọc chỉ giới hạn danh sách hiển thị, không thay đổi số dư.", "Yêu cầu đổi điểm đang chờ duyệt có thể đã trừ điểm tạm thời; trạng thái xem tại Thêm → Thông báo hoặc Điểm → Exchange & requests."],
  },
  {
    id: "credits",
    title: "Điểm: gửi recognition và đổi điểm",
    area: "Điểm và ví",
    image: "wallet",
    purpose: "Tùy cấu hình, trang Điểm cho phép gửi recognition cho đồng nghiệp hoặc gửi yêu cầu đổi điểm theo tỷ lệ đã thiết lập.",
    steps: [
      "Mở Điểm; chỉ các thao tác mà chương trình cho phép mới xuất hiện.",
      "Với Give Recognition, chọn ví nguồn, số dư hoặc allowance nếu được bật, loại điểm nhận hợp lệ và người nhận.",
      "Nhập số điểm và thông điệp/category nếu được yêu cầu; xem trước tỷ lệ quy đổi, giới hạn và tổng điểm nhận.",
      "Kiểm tra lại người nhận và nội dung rồi xác nhận. Đọc kết quả để biết giao dịch đã ghi nhận hay đang chờ.",
      "Với Exchange, chọn hình thức và số điểm, xem trước rồi gửi yêu cầu; theo dõi trạng thái tại Thông báo hoặc lịch sử exchange.",
    ],
    result: "Chuyển điểm tuân theo loại điểm đích, tỷ lệ, hạn mức theo chu kỳ và giới hạn người nhận do admin cấu hình. Yêu cầu exchange trừ điểm khi gửi; nếu bị từ chối hoặc hủy, điểm được hoàn theo quy trình.",
    notes: ["Exchange voucher là ghi nhận nội bộ, không phải cam kết chi tiền hoặc thanh toán tự động.", "Nếu giao dịch exchange bị từ chối hoặc hủy, điểm được hoàn theo quy trình của hệ thống.", "Không gửi thông tin nhạy cảm trong thông điệp ghi nhận."],
  },
  {
    id: "notifications",
    title: "Thông báo và trạng thái đã đọc",
    area: "Tài khoản",
    image: "notifications",
    purpose: "Thông báo giúp theo dõi campaign cần claim, yêu cầu trao đổi điểm, cập nhật dự án và các kết quả liên quan đến tài khoản.",
    steps: [
      "Nhấn chuông ở góc trên bên phải hoặc mở Thêm → Thông báo; số đỏ biểu thị số thông báo chưa đọc.",
      "Mở một thông báo để xem nội dung và đi tới trang liên quan nếu có liên kết.",
      "Dùng Đánh dấu đã đọc / Chưa đọc trên từng thẻ để quản lý trạng thái.",
      "Dùng Đánh dấu tất cả đã đọc nếu muốn dọn toàn bộ thông báo chưa đọc.",
    ],
    result: "Số đỏ giảm theo từng thông báo được đánh dấu đã đọc; trạng thái chưa đọc có thể bật lại từ thẻ thông báo.",
    notes: ["Thông báo đã đọc vẫn còn trong danh sách; chỉ trạng thái và số đếm thay đổi.", "Không thấy email hoặc SMS không có nghĩa là thao tác thất bại; kênh gửi phụ thuộc cấu hình thông báo."],
  },
  {
    id: "projects",
    title: "Dự án nhóm và nhiệm vụ",
    area: "Tài khoản",
    image: "projects",
    purpose: "Trang Projects cho thành viên xem lời mời, tham gia dự án và cập nhật các nhiệm vụ được giao. Ngân sách và phân bổ điểm là thông tin quản trị riêng.",
    steps: [
      "Mở Projects, xem các tab lời mời, đang tham gia và lịch sử.",
      "Mở lời mời để xem tên dự án, nội dung và các thông tin được chia sẻ; chọn Chấp nhận hoặc Từ chối.",
      "Với dự án đã tham gia, mở nhiệm vụ của bạn và cập nhật TODO → IN_PROGRESS → DONE khi thực hiện.",
      "Theo dõi trạng thái dự án. Khi PM hoàn tất dự án, dự án hiển thị Complete và các thao tác cập nhật bị khóa.",
    ],
    result: "PM xác nhận hoàn thành dự án sau khi công việc xong; việc ghi nhận điểm cho thành viên thuộc luồng phê duyệt riêng.",
    notes: ["Thành viên không xem được ngân sách, escrow hay số điểm chia cho từng người.", "Nếu lời mời hết hiệu lực hoặc không còn tồn tại, liên hệ PM để được mời lại."],
  },
  {
    id: "rewards",
    title: "Đổi Rewards",
    area: "Sử dụng điểm",
    image: "rewards",
    purpose: "Rewards hiển thị các phần thưởng đang khả dụng và số điểm/loại điểm cần dùng để đổi.",
    steps: [
      "Mở Rewards để duyệt danh mục; chọn reward để xem mô tả, giá, tồn kho và điều kiện.",
      "Kiểm tra ví được yêu cầu, số dư hiện tại, giới hạn hạng thành viên và trạng thái còn hàng.",
      "Chọn Redeem, xác nhận ví/chi phí và gửi yêu cầu.",
      "Theo dõi kết quả trong mục Rewarded / lịch sử đổi thưởng; mở chi tiết để xem trạng thái fulfillment.",
    ],
    result: "Khi đổi thành công, điểm bị trừ theo xác nhận và reward xuất hiện trong lịch sử. Khâu giao/fulfillment có thể cần xử lý riêng.",
    notes: ["Wishlist được lưu trên trình duyệt hiện tại.", "Reward bị ẩn, hết hàng hoặc không đủ điều kiện sẽ không thể đổi.", "Không xem trạng thái fulfillment là xác nhận đã giao nếu trạng thái chưa hoàn tất."],
  },
  {
    id: "badges",
    title: "Badges và thành tích",
    area: "Sử dụng điểm",
    image: "badges",
    purpose: "Badges cho biết các thành tích thành viên đã đạt và những mục tiêu chưa mở khóa.",
    steps: [
      "Mở Thêm → Huy hiệu, rồi chọn Tất cả, Đã mở khóa hoặc Chưa mở khóa.",
      "Mở một badge để đọc mô tả và điều kiện đang hiển thị.",
      "Hoàn thành hoạt động đáp ứng điều kiện; hệ thống tự cập nhật nếu badge được cấu hình tự động.",
    ],
    result: "Badge đã mở khóa được lưu trong hồ sơ thành tích. Một số badge chỉ do quản trị viên cấp thủ công.",
    notes: ["Tiến độ có thể cập nhật sau khi sự kiện liên quan được xử lý.", "Badge không đồng nghĩa với phần thưởng điểm, trừ khi chương trình ghi rõ."],
  },
  {
    id: "profile",
    title: "Hồ sơ và tùy chọn cá nhân",
    area: "Tài khoản",
    image: "profile",
    purpose: "Quản lý một số thông tin hồ sơ, ảnh đại diện, ngôn ngữ, giao diện, lựa chọn nhận thông báo và tải bản sao dữ liệu cá nhân.",
    steps: [
      "Mở Thêm → Hồ sơ; kiểm tra email, điện thoại, phòng ban và các trường tùy chỉnh đang hiển thị.",
      "Nhấn Edit để sửa thông tin được phép; chọn tệp ảnh nếu muốn cập nhật ảnh đại diện.",
      "Nhấn Save để lưu hoặc Cancel để bỏ thay đổi.",
      "Chọn ngôn ngữ, chế độ sáng/tối/tự động và tùy chọn kênh thông báo nếu có.",
      "Dùng Export my data để yêu cầu tải bản sao dữ liệu cá nhân.",
    ],
    result: "Thay đổi được lưu vào hồ sơ thành viên và hiển thị lại sau khi tải dữ liệu mới.",
    notes: ["Email đăng nhập có thể do tổ chức quản lý và không sửa được tại đây.", "Chỉ tải ảnh bạn có quyền sử dụng; ảnh được xử lý lại trước khi lưu.", "Tùy chọn nhận thông báo không thay đổi việc hệ thống lưu thông báo trong ứng dụng."],
  },
];
