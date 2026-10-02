export type AdminGuideTopic = {
  id: string;
  title: string;
  group: string;
  route: string;
  image: "dashboard" | "members" | "table" | "wallet" | "bank" | "roles" | "automation" | "campaign" | "project" | "reward" | "export" | "settings";
  purpose: string;
  prerequisites?: string;
  steps: string[];
  result: string;
  notes?: string[];
};

export const adminGuide: AdminGuideTopic[] = [
  {
    id: "dashboard", title: "Dashboard và dashboard riêng", group: "Tổng quan và quản trị", route: "/", image: "dashboard",
    purpose: "Xem chỉ số vận hành và thêm widget dựng sẵn vào dashboard cá nhân; không tạo truy vấn hoặc biểu đồ tùy ý.",
    steps: ["Mở Dashboard và đọc thời gian/phạm vi của từng thẻ số liệu.", "Chọn Customize dashboard; trong khung hiện trên trang, chọn Metric và nhập Title nếu muốn.", "Chọn Add widget để thêm và tự lưu widget; dùng biểu tượng xóa trên thẻ để gỡ widget không cần.", "Đối chiếu metric với trang chi tiết liên quan; dashboard không có thao tác kéo/thả sắp xếp."],
    result: "Layout được lưu vào tài khoản Admin và đồng bộ giữa các thiết bị; widget không thay thế Ledger hoặc báo cáo chi tiết.",
    notes: ["Dashboard có thể khác nhau tùy dữ liệu và quyền xem.", "Nếu số tổng không khớp kỳ vọng, mở định nghĩa chỉ số và kiểm tra ngày, loại điểm, trạng thái giao dịch."],
  },
  {
    id: "roles-permissions", title: "Roles & permissions", group: "Tổng quan và quản trị", route: "/permissions", image: "roles",
    purpose: "Tạo vai trò quản trị riêng và cấp quyền theo nhóm tính năng, để mỗi nhân viên chỉ truy cập đúng phần việc cần thiết.",
    prerequisites: "Cần quyền quản lý phân quyền. Quyền truy cập admin và quyền trên từng chức năng được kiểm tra riêng.",
    steps: ["Mở Roles & permissions; chọn một role để xem hoặc chỉnh quyền.", "Tạo role mới với tên mô tả công việc, ví dụ Người duyệt chiến dịch.", "Mở từng nhóm tính năng giống taskbar, rồi bật quyền xem hoặc quản lý cần thiết.", "Lưu role, gán role cho tài khoản admin phù hợp và đăng nhập thử bằng tài khoản có phạm vi thấp."],
    result: "Menu và các thao tác được kiểm soát theo capability của role; thay đổi quyền có thể áp dụng ngay hoặc sau khi tải lại phiên.",
    notes: ["Cấp quyền tối thiểu cần dùng; quyền manage thường cho phép thay đổi dữ liệu.", "Không xóa hoặc hạ quyền tài khoản quản trị cuối cùng khi chưa xác nhận còn người quản trị khác."],
  },
  {
    id: "members", title: "Members và hồ sơ thành viên", group: "Thành viên và dữ liệu", route: "/members", image: "members",
    purpose: "Tìm thành viên, xem trạng thái/hồ sơ, kiểm tra ví và lịch sử; các trường tùy chỉnh giúp lưu dữ liệu phục vụ phân nhóm.",
    steps: ["Tìm bằng tên, email hoặc mã thành viên; dùng bộ lọc để thu hẹp danh sách.", "Mở hồ sơ thành viên để xem thông tin, trường tùy chỉnh, ví và giao dịch.", "Chọn Edit để sửa các trường được phép, sau đó lưu và kiểm tra lịch sử nếu cần.", "Khi cần dừng tài khoản, dùng thao tác Deactivate theo quy trình nội bộ; chỉ dùng Delete nếu đã xác nhận hậu quả."],
    result: "Hồ sơ cập nhật được lưu và hành động quản trị có thể xuất hiện trong Logs/Ledger tùy loại thao tác.",
    notes: ["Deactivate giữ lịch sử nhưng xóa số dư hiện hành; kích hoạt lại không tự khôi phục số dư đã xóa.", "Delete không xóa lịch sử giao dịch đã phát sinh nhưng loại thành viên khỏi danh sách hoạt động và xóa số dư ví.", "Email không được đảm bảo là duy nhất ở tầng dữ liệu; không dùng email thay cho memberId khi cần xác định chính xác bản ghi."],
  },
  {
    id: "member-fields", title: "Member fields", group: "Thành viên và dữ liệu", route: "/member-fields", image: "members",
    purpose: "Tạo các thuộc tính bổ sung của thành viên như ngày sinh, phòng ban hoặc mã nội bộ; có thể dùng field phù hợp trong segment/event.",
    steps: ["Mở Member fields và tạo field với tên hiển thị, key ổn định và kiểu dữ liệu phù hợp.", "Chọn có bắt buộc hay không và cấu hình các tùy chọn của kiểu dữ liệu nếu có.", "Lưu, cập nhật hồ sơ thành viên hoặc mẫu import để điền giá trị.", "Dùng field đó trong Rule Builder hoặc event nếu kiểu dữ liệu được hỗ trợ."],
    result: "Field mới xuất hiện trong các màn hình được thiết kế để sử dụng custom field.",
    notes: ["Chọn kiểu Date cho ngày tháng cần lọc/trigger; không lưu ngày dưới dạng text tùy ý.", "Đổi key sau khi đã có dữ liệu có thể làm mất liên kết điều kiện cũ; nên tạo key mới thay vì đổi tùy tiện."],
  },
  {
    id: "member-import", title: "Import hoặc cập nhật hàng loạt thành viên", group: "Thành viên và dữ liệu", route: "/credits/import", image: "table",
    purpose: "Tạo thành viên mới hoặc cập nhật hồ sơ/số dư qua tệp, đồng thời cho phép chọn trường sẽ được nhập.",
    prerequisites: "Chuẩn bị CSV, XLSX hoặc JSON với header rõ ràng; sao lưu bản dữ liệu trước các đợt cập nhật lớn.",
    steps: ["Mở Member import, tải file mẫu hoặc chọn file dữ liệu.", "Chọn các trường cần import. Trường mandatory được đánh dấu sẵn và không thể bỏ chọn.", "Kiểm tra nhận diện header, mapping cột, định dạng ngày/điểm và chế độ create/update.", "Editable import preview chỉ cho sửa nội dung file đã đọc; đây không phải bước dry-run hay validation.", "Chỉ chọn Import members khi đã sẵn sàng ghi dữ liệu; thao tác này cập nhật dữ liệu ngay. Sau đó xem kết quả thành công/thất bại và kiểm tra một số member."],
    result: "Email bắt buộc khi tạo mới; memberId có thể dùng để định danh bản ghi cập nhật. Trường bị bỏ chọn không được ghi từ file.",
    notes: ["Các cột balance_CODE đặt số dư đích; cột point_CODE dùng để cộng/trừ phát sinh điểm. Không hoán đổi hai quy ước này.", "Tệp không có trường status thường không yêu cầu đổi status. Header bị thiếu/sai hoặc point type không tồn tại cần sửa trước khi chạy lại.", "Import điểm có thể thay đổi số dư thật; thử trên một nhóm nhỏ và đối chiếu ledger trước khi import lớn."],
  },
  {
    id: "point-types", title: "Point type registry và hạn dùng", group: "Điểm, ví và sổ cái", route: "/point-types", image: "wallet",
    purpose: "Định nghĩa các loại điểm, cách hiển thị và những thao tác nào được phép: issue, chuyển, đổi reward, exchange, expiry và bank.",
    steps: ["Mở Point type registry để xem các loại điểm; tạo mới hoặc mở Edit.", "Đặt tên/mã/đơn vị và trạng thái; cấu hình hiển thị cho customer.", "Chọn expiry policy, khả năng chuyển/đổi và các quy tắc liên quan.", "Nếu cho phép chuyển điểm, cấu hình ma trận loại nguồn → loại đích, tỷ lệ và giới hạn.", "Lưu rồi kiểm tra trên campaign, wallet adjustment hoặc customer portal tùy cấu hình."],
    result: "Point type là nền tảng cho số dư, giao dịch và các luồng issue. Ma trận chuyển không tự cho phép các đích chưa cấu hình.",
    notes: ["AFTER_DAYS tính theo ngày tạo point type, không khởi động lại khi mỗi grant được nhận; FIXED_DATE dùng cùng mốc ngày; PER_GRANT dùng hạn riêng cho từng grant; NEVER không đặt hạn.", "Nếu mốc expiry đã qua, grant mới thuộc loại đó có thể không hợp lệ.", "Thay đổi policy có thể ảnh hưởng các giao dịch mới; kiểm tra tác động với số dư hiện có trước khi lưu."],
  },
  {
    id: "wallet-adjustments", title: "Wallet adjustments", group: "Điểm, ví và sổ cái", route: "/credits/wallets", image: "wallet",
    purpose: "Điều chỉnh số điểm của một thành viên bằng thao tác có lý do, để sửa sai hoặc ghi nhận nghiệp vụ được cho phép.",
    prerequisites: "Cần quyền wallet manage; kiểm tra member và point type trước khi xác nhận.",
    steps: ["Mở Wallet adjustments, tìm member và chọn đúng point type.", "Chọn Add hoặc Remove, nhập số nguyên điểm và lý do rõ ràng.", "Kiểm tra phần xác nhận; Add có thể cần bank khả dụng, Remove trả điểm về bank theo quy tắc hiện tại.", "Xác nhận rồi tra Ledger theo member, actor hoặc thời gian."],
    result: "Số dư ví và ledger được cập nhật cùng lý do; adjustment được ghi nhận là giao dịch quản trị.",
    notes: ["Không dùng adjustment thay cho campaign nếu cần audience, event, claim hoặc báo cáo campaign.", "Kiểm tra dấu +/- và point type kỹ; thao tác điều chỉnh có thể ảnh hưởng điểm spendable ngay lập tức."],
  },
  {
    id: "issuance-rules", title: "Point issuance rules", group: "Điểm, ví và sổ cái", route: "/issuance-rules", image: "automation",
    purpose: "Đây là trang hướng dẫn/điểm vào cho cơ chế cấp điểm; event định nghĩa khi nào sự kiện xảy ra, campaign định nghĩa audience, điểm và chính sách phê duyệt.",
    steps: ["Mở Point issuance để phân biệt campaign standing cho dịp thường lệ với campaign Approval required cho dịp ngoại lệ.", "Chọn Open campaign builder để tạo campaign và cấu hình audience, event/trigger, point type, số điểm, claim/auto và ngân sách.", "Nếu cần event mới, mở Configure event definitions để tạo occurrence; quay lại campaign và chọn event đó.", "Với campaign ngoại lệ, chọn Approval required, ghi justification và Submit for approval; với campaign standing, lưu/activate theo quy trình."],
    result: "Không có rule cấp điểm độc lập được tạo ở trang này; quá trình tự động được cấu hình bằng Event definition + Campaign.",
    notes: ["Phê duyệt campaign áp dụng cho cấu hình, audience, lịch và ngân sách campaign; khác với proposal cấp điểm cho một member.", "Draft hoặc pending approval chưa phát điểm."],
  },
  {
    id: "banks-cycles", title: "Banks và bank cycles", group: "Điểm, ví và sổ cái", route: "/credits/banks", image: "bank",
    purpose: "Quản lý quỹ điểm trung tâm, các lần nạp và chu kỳ phân bổ; đóng cycle không xóa số điểm chưa sử dụng.",
    steps: ["Chọn point type và xem số bank hiện có.", "Khi nạp bank, nhập số điểm cùng lý do để tạo bản ghi funding.", "Mở cycle với mốc thời gian/ghi chú; theo dõi opening, các giao dịch trong kỳ và allocation.", "Khi đóng, nhập lý do đóng và xác nhận người thực hiện.", "Mở chi tiết cycle để rà các giao dịch và số closing; phần chưa sử dụng vẫn ở bank."],
    result: "Cycle đóng được lưu cùng thời gian, actor, lý do và lịch sử giao dịch. Allocated thể hiện tổng ròng sau các khoản trả/hoàn đủ điều kiện.",
    notes: ["Adjustment REMOVE và hoàn điểm dự án có thể trả điểm về bank/cycle theo loại giao dịch.", "Không dùng số gross issue thay cho allocated ròng khi đối chiếu cycle.", "Fund bank tạo lịch sử bank funding, không phải giao dịch ví của member."],
  },
  {
    id: "ledger", title: "Ledger và lịch sử bank funding", group: "Điểm, ví và sổ cái", route: "/credits/ledger", image: "table",
    purpose: "Đối soát giao dịch điểm và nguồn tiền của hệ thống: ai thao tác, cho member nào, loại điểm gì, nguồn/lý do và số dư sau.",
    steps: ["Mở Ledger và chọn nhóm giao dịch hoặc bộ lọc bank funding.", "Lọc theo thời gian, actor/action, member/email, point type hoặc cycle.", "Đọc các cột actor, action type, target employee/member, source, reason, amount, balance after và thời điểm.", "Mở chi tiết dòng để xem metadata nghiệp vụ; xuất dữ liệu qua Data export nếu cần file báo cáo."],
    result: "Ledger là nguồn đối chiếu phát sinh; Logs tập trung vào hành động trong ứng dụng và payload audit.",
    notes: ["Member email giúp nhận diện người nhận nhưng nên đối chiếu thêm memberId khi có email trùng.", "Nếu dòng bank funding không gắn target member thì đây có thể là giao dịch quỹ, không phải thiếu dữ liệu member."],
  },
  {
    id: "segments", title: "Segments: phân nhóm member", group: "Phân nhóm và thành tích", route: "/segments", image: "table",
    purpose: "Tạo nhóm động bằng điều kiện member hoặc nhóm static do admin chọn thủ công; campaign và tier có thể dùng segment tùy cấu hình.",
    steps: ["Mở Segments; chọn tạo dynamic segment hoặc static segment.", "Với dynamic, thêm điều kiện theo thông tin member/số dư/sự kiện được hỗ trợ và chọn AND hoặc OR.", "Xem estimated members, lưu rồi mở danh sách thành viên khớp để kiểm tra.", "Với static, tìm kiếm member, chọn từng người hoặc Select all trong phạm vi kết results rồi lưu."],
    result: "Dynamic segment được tính lại theo dữ liệu; static segment giữ danh sách thành viên đã chọn.",
    notes: ["Kiểm tra múi giờ/ngày và kiểu dữ liệu khi lọc date.", "Xem kỹ danh sách member trước khi gắn segment vào campaign phát điểm."],
  },
  {
    id: "recognition-categories", title: "Recognition categories", group: "Phân nhóm và thành tích", route: "/credits/categories", image: "members",
    purpose: "Quản lý danh mục lý do/cách ghi nhận được thành viên chọn khi gửi recognition; giúp hoạt động trao điểm có ngữ cảnh dễ hiểu.",
    steps: ["Mở Recognition categories trong nhóm Automation & governance.", "Tạo tên/nhãn danh mục và chọn trạng thái active nếu muốn hiển thị cho member.", "Lưu, rồi kiểm tra Give Recognition ở customer portal bằng một luồng thử phù hợp."],
    result: "Danh mục đang bật xuất hiện trong thao tác recognition; danh mục không hoạt động không nên dùng cho giao dịch mới.",
    notes: ["Danh mục chỉ phân loại lý do, không tự thay đổi tỷ lệ hay quyền chuyển điểm.", "Đặt nhãn rõ ràng để member và người kiểm tra hiểu cùng một ý."],
  },
  {
    id: "tiers-badges", title: "Tiers và Badges", group: "Phân nhóm và thành tích", route: "/tiers", image: "table",
    purpose: "Tiers biểu diễn cấp bậc dựa trên ngưỡng nhiều loại điểm; badges biểu diễn điều kiện/thành tích riêng.",
    steps: ["Với Tier, đặt tên/màu/thứ tự và thêm một hay nhiều ngưỡng theo point type.", "Chọn AND nếu phải đạt tất cả điều kiện hoặc OR nếu chỉ cần đạt một điều kiện.", "Với Badge, mở Badges → tạo mới, thêm mô tả/ảnh và các điều kiện; chọn AND/OR.", "Lưu rồi xem phần customer preview và kiểm tra một member mẫu đạt/chưa đạt."],
    result: "Customer thấy hạng/tiến độ theo các điều kiện đã cấu hình; badge đủ điều kiện được mở tự động, một số badge có thể chỉ cấp thủ công.",
    notes: ["Không nhầm badge với reward/điểm: chỉ cấp thêm lợi ích nếu cấu hình riêng ghi rõ.", "Kiểm tra đơn vị điểm và logic AND/OR trước khi kích hoạt."],
  },
  {
    id: "events", title: "Event definitions", group: "Automation, campaign và duyệt", route: "/event-definitions", image: "automation",
    purpose: "Định nghĩa thời điểm/sự kiện để campaign có thể chạy tự động, như đăng ký mới, ngày sinh theo field ngày, ngày cố định, check-in, manual hoặc event tích hợp.",
    steps: ["Tạo event definition với key duy nhất, tên hiển thị và loại occurrence.", "Với annual member date, chọn field kiểu Date hoặc ngày tạo account theo nhu cầu; đặt timezone và quy tắc ngày đặc biệt nếu có.", "Với ngày cố định, chọn ngày một lần hoặc lặp hàng năm; với check-in/manual/external, đọc mô tả trigger.", "Lưu event ở trạng thái inactive để kiểm tra cấu hình; sau xác nhận, activate.", "Chọn event trong campaign và theo dõi kết quả ở trạng thái issuance."],
    result: "Event active có thể kích hoạt campaign gắn với nó. Scheduled events được kiểm tra định kỳ; registration được gửi lúc tạo member; event external cần được hệ thống tích hợp báo cáo.",
    notes: ["Đặt tên event không tự phát sinh event external.", "Manual là thao tác chạy một lần do admin thực hiện sau quy trình phù hợp, không phải nút điểm danh customer.", "Inactive event không nên được kỳ vọng sẽ issue campaign."],
  },
  {
    id: "campaigns", title: "Campaigns: tự động cấp hoặc chờ member claim", group: "Automation, campaign và duyệt", route: "/campaigns", image: "campaign",
    purpose: "Tạo chương trình thưởng theo audience, event và point type; có thể là campaign mặc định hoặc campaign yêu cầu phê duyệt.",
    steps: ["Chọn Create campaign. Ở Occasion, nhập tên, chọn trigger event và policy Standing hoặc Approval required; policy approval yêu cầu justification.", "Ở Recipients, chọn audience/segment cần nhận.", "Ở Reward, chọn point type, award amount, AUTO để tự issue hoặc CLAIM để member tự nhận; cấu hình giới hạn sử dụng nếu cần.", "Ở Schedule, chọn tự chạy hoặc ngày cụ thể; cấu hình lịch theo nhu cầu.", "Ở Review, chọn Calculate Estimate và Recalculate sau khi sửa audience/award. Lưu Draft hoặc Submit for approval; campaign Standing được tạo rồi Activate từ danh sách khi sẵn sàng.", "Theo dõi issuance status và danh sách member; dùng Refresh để lấy trạng thái mới."],
    result: "AUTO phát sinh ví khi event chạy; CLAIM tạo mục chờ nhận. Campaign approval-required chỉ hoạt động sau khi được duyệt và kích hoạt theo quy trình.",
    notes: ["Run campaign now thực sự chạy cấp điểm/tạo claim, không phải preview; chỉ dùng khi đã kiểm tra audience, amount và trạng thái.", "Edit campaign đã duyệt có thể yêu cầu phê duyệt lại.", "Ước lượng impact phụ thuộc audience hiện tại và giới hạn per-member/budget; tính lại sau khi đổi cấu hình.", "Không nhầm budget trống (unlimited) với 0 điểm."],
  },
  {
    id: "workflows-approvals", title: "Workflows và Approval inbox", group: "Automation, campaign và duyệt", route: "/workflows", image: "automation",
    purpose: "Workflow định tuyến các loại yêu cầu có approval handler trong app đến người/role duyệt; Inbox xử lý yêu cầu đang chờ.",
    steps: ["Trong Workflows, chọn action key được hệ thống hỗ trợ và đặt workflow active.", "Thêm các layer, approver user hoặc role và điều kiện ANY, ALL hoặc COUNT theo quy định.", "Lưu; chỉ yêu cầu mới sẽ được tạo theo workflow active hiện tại.", "Trong Approval inbox, mở yêu cầu, đọc chi tiết và dữ liệu liên quan; chỉ người được phân công ở layer hiện tại mới xử lý.", "Chọn Approve hoặc Reject; khi từ chối nhập lý do/bình luận; kiểm tra History sau thao tác."],
    result: "Yêu cầu đi tiếp qua các layer hoặc hoàn tất/từ chối. Người tạo không thể tự duyệt yêu cầu của chính mình.",
    notes: ["Không phải mọi CRUD đều có approval; chỉ action key đã nối với handler mới tạo được yêu cầu.", "Yêu cầu đang chạy giữ snapshot workflow/assignee tại lúc gửi; sửa workflow không tự chuyển người duyệt của yêu cầu cũ.", "Chỉ workflow active áp dụng cho yêu cầu mới."],
  },
  {
    id: "approval-inbox", title: "Approval inbox: xử lý và tra cứu yêu cầu", group: "Automation, campaign và duyệt", route: "/approvals", image: "automation",
    purpose: "Xem các yêu cầu được giao cho bạn ở layer hiện tại, đưa ra quyết định và xem lịch sử phê duyệt.",
    steps: ["Mở Approval inbox hoặc chọn thông báo phê duyệt cần xử lý.", "Mở request, đọc action/subject, người gửi, lý do và dữ liệu chi tiết.", "Approve để chuyển tiếp/hoàn tất theo workflow hoặc Reject và ghi nhận lý do.", "Mở History để kiểm tra các bước và người đã ra quyết định."],
    result: "Badge số chờ duyệt giảm khi thông báo được đánh dấu đã đọc; trạng thái nghiệp vụ chỉ đổi khi quyết định được submit thành công.",
    notes: ["Mở thông báo không đồng nghĩa request đã được approve.", "Chỉ approver đúng ở layer hiện tại mới thao tác được; không tự duyệt yêu cầu của mình."],
  },
  {
    id: "projects", title: "Group projects: kế hoạch, escrow và issue", group: "Automation, campaign và duyệt", route: "/projects", image: "project",
    purpose: "PM lập kế hoạch và xin duyệt ngân sách theo từng loại điểm; sau khi được duyệt, PM mời thành viên, giao task, xác nhận hoàn tất và xin duyệt phân bổ điểm.",
    steps: ["Tạo project plan, điền thông tin dự án, custom fields và ngân sách mong muốn theo từng point type.", "Lưu Draft hoặc Submit for approval; xử lý bình luận/từ chối rồi chỉnh sửa và gửi lại nếu cần.", "Khi kế hoạch được duyệt, activate project để PM mời/enroll member; member cần accept nếu được yêu cầu.", "Tạo task, gán người thực hiện; theo dõi trạng thái tới khi task cần thiết hoàn tất.", "PM xác nhận project hoàn thành rồi nhập phân bổ theo số điểm hoặc phần trăm cho từng member/point type.", "Gửi yêu cầu issue để duyệt; sau khi approve, điểm được cấp từ project escrow. Đóng project để trả phần escrow còn dư về bank."],
    result: "Ngân sách được reserve vào escrow khi duyệt plan; award approval issue từ escrow nên không trừ bank lần thứ hai. Từ chối có thể yêu cầu chỉnh sửa/resubmit.",
    notes: ["Thông tin ngân sách và phân bổ chỉ dành cho admin/PM có quyền phù hợp; không chia sẻ ảnh chụp tài chính với member.", "Không xác nhận hoàn tất khi task còn dang dở.", "Giá trị % được quy đổi theo ngân sách được duyệt; số phân bổ phải hợp lệ theo số nguyên và không vượt quỹ còn lại."],
  },
  {
    id: "rewards", title: "Rewards và redemption history", group: "Campaign, reward và đổi điểm", route: "/rewards", image: "reward",
    purpose: "Tạo catalog phần thưởng, đặt giá theo loại điểm, tồn kho/điều kiện và kiểm tra các redemption/fulfillment.",
    steps: ["Tạo reward với tên, mô tả, ảnh, category, trạng thái và thời gian áp dụng.", "Đặt giá theo từng point type; cấu hình stock hoặc để trống theo ý nghĩa unlimited của form.", "Nếu cần, giới hạn theo tier và kiểm tra trang customer với member đủ/không đủ điều kiện.", "Mở redemption history để tìm member theo tên/email và cập nhật/đối chiếu trạng thái fulfillment."],
    result: "Customer có thể đổi khi reward active, còn đủ điều kiện, còn hàng (nếu giới hạn stock) và có đủ điểm.",
    notes: ["Đổi reward trừ điểm; fulfillment/giao hàng không nhất thiết được tích hợp tự động với hệ thống bên ngoài.", "Không nhập stock 0 nếu ý nghĩa mong muốn là không giới hạn."],
  },
  {
    id: "coupons", title: "Coupons và tạo batch code", group: "Campaign, reward và đổi điểm", route: "/coupons", image: "reward",
    purpose: "Tạo và quản lý batch mã coupon với prefix, số lượng và một số quy tắc sử dụng/hiển thị.",
    steps: ["Mở Coupons hoặc Generate batch.", "Điền tên/prefix, số lượng mã, giới hạn và ngày hiệu lực theo form.", "Kiểm tra preview/tổng số mã trước khi tạo batch.", "Mở batch để xem trạng thái và tải thông tin qua các thao tác được cấp quyền."],
    result: "Mã được tạo trong LoyaltyOS để quản lý. Kết nối checkout/purchase bên ngoài hiện không được giả định trong tài liệu này.",
    notes: ["Bảo vệ file mã như dữ liệu nhạy cảm; chỉ chia sẻ với người nhận có thẩm quyền.", "Kiểm tra ngày bắt đầu/kết thúc để tránh mã dùng ngoài dự kiến."],
  },
  {
    id: "exchange", title: "Exchange vouchers", group: "Campaign, reward và đổi điểm", route: "/credits/exchange", image: "wallet",
    purpose: "Quản lý phiên bản tỷ lệ đổi điểm và các yêu cầu exchange của member qua vòng đời pending/approved/completed/rejected/cancelled.",
    steps: ["Thiết lập tỷ lệ exchange mới; lưu ý cấu hình mới được version hóa.", "Mở request history, lọc trạng thái và mở yêu cầu để kiểm tra point, số lượng, member và tỷ lệ snapshot.", "Approve hoặc Reject theo quyền và quy trình; khi hoàn tất nghiệp vụ bên ngoài, chọn Complete và nhập external completion reference.", "Kiểm tra trạng thái cuối và ledger/notification liên quan."],
    result: "Mỗi yêu cầu giữ tỷ giá snapshot tại lúc tạo. Từ chối/hủy có thể hoàn điểm theo luồng xử lý.",
    notes: ["Exchange voucher là bản ghi kế toán nội bộ; không đồng nghĩa app đã chuyển tiền/thực hiện giao dịch bên ngoài.", "Không hoàn tất nếu chưa có xác nhận nghiệp vụ thực tế hoặc reference theo quy trình tổ chức."],
  },
  {
    id: "logs", title: "Logs và audit trail", group: "Báo cáo và thông báo", route: "/logs", image: "table",
    purpose: "Tra cứu hành động đã thực hiện: ai làm, hành động/tính năng nào, loại actor, thời điểm và chi tiết payload được lưu.",
    steps: ["Mở Logs và dùng bộ lọc từ khóa, actor, action, actor type, feature và khoảng ngày.", "Mở bản ghi để xem chi tiết payload; dùng member/project/campaign ID để lần về màn hình nghiệp vụ.", "Nếu cần file, vào Data export và chọn dataset audit/log nếu quyền cho phép.", "Đối chiếu Logs (hành động) với Ledger (phát sinh điểm) và Approval history (quyết định duyệt)."],
    result: "Ba nguồn trả lời ba câu hỏi khác nhau: thao tác nào đã chạy, điểm đã thay đổi ra sao, và ai đã duyệt.",
    notes: ["Không phải mọi yêu cầu thất bại đều tạo audit record; kiểm tra server log nếu action chưa commit.", "Payload có thể chứa dữ liệu nghiệp vụ; chỉ chia sẻ phần cần thiết."],
  },
  {
    id: "data-export", title: "Data export", group: "Báo cáo và thông báo", route: "/exports", image: "export",
    purpose: "Xuất các trường có tên dễ hiểu từ dataset được phép thay vì nhận dump JSON khó đọc.",
    steps: ["Chọn dataset cần dùng, ví dụ Members, Ledger, Bank cycles, Campaigns, Events hoặc approvals.", "Tích chọn đúng các trường cần xuất và đọc nhãn/giải thích để hiểu cột.", "Áp dụng bộ lọc/phạm vi nếu có; kiểm tra capability yêu cầu và số lượng bản ghi.", "Xuất CSV và mở thử vài dòng trước khi gửi cho người khác."],
    result: "File chỉ chứa các trường đã chọn và phạm vi mà quyền truy cập cho phép.",
    notes: ["Chỉ xuất dữ liệu cần thiết; member balances, email và audit payload có thể nhạy cảm.", "Không có password/token/session secrets trong bộ export.", "Bản export có giới hạn dung lượng/số dòng; chia nhỏ bộ lọc khi vượt giới hạn."],
  },
  {
    id: "notification-templates", title: "Notification templates", group: "Báo cáo và thông báo", route: "/notification-templates", image: "automation",
    purpose: "Quản lý nội dung thông báo theo trigger/kênh và chỉnh sửa nhiều ngôn ngữ cùng lúc; danh sách biến cho biết giá trị có thể chèn.",
    steps: ["Chọn loại thông báo/trigger và channel.", "Xem danh sách biến được hỗ trợ như member.firstName, member.email, campaign.name hoặc points.", "Điền subject/body riêng cho từng locale đang được hệ thống hỗ trợ.", "Lưu và kiểm tra preview nếu có; kiểm tra template dùng cả ngôn ngữ customer hiện chọn."],
    result: "Thông báo phát sinh từ trigger sẽ dùng nội dung theo locale/kênh đã cấu hình.",
    notes: ["Chỉ dùng biến trong danh sách; tên biến tự đặt có thể render rỗng.", "Không đưa mật khẩu, token, mã bí mật hoặc thông tin nhạy cảm vào template."],
  },
  {
    id: "settings", title: "Settings và đăng nhập Microsoft 365", group: "Báo cáo và thông báo", route: "/settings", image: "settings",
    purpose: "Cấu hình các tùy chọn hệ thống như Microsoft 365 sign-in và các tham số tích hợp dành cho quản trị viên.",
    prerequisites: "Cần quyền settings manage; thông tin tenant/client/callback phải do quản trị Microsoft 365/IT cung cấp.",
    steps: ["Mở Settings và chỉ bật Microsoft sign-in sau khi xác nhận tenant, client ID, scope và callback URL.", "Nhập/kiểm tra cấu hình môi trường theo hướng dẫn IT; không lấy secret từ trình duyệt hoặc tài liệu chia sẻ.", "Lưu cấu hình, thử luồng bằng tài khoản được phép và kiểm tra admin approval nếu đó là chính sách tạo admin account.", "Ghi lại người thay đổi và thời điểm theo audit policy."],
    result: "Đăng nhập Microsoft chỉ hoạt động với tenant/callback đã được cấu hình hợp lệ; tạo admin account có thể cần được admin hiện hữu duyệt.",
    notes: ["Không ghi hoặc chụp secret, client secret, token hay recovery code trong Logs/tài liệu.", "Thay đổi sai callback/tenant có thể khóa luồng đăng nhập; giữ tài khoản quản trị dự phòng."],
  },
];
