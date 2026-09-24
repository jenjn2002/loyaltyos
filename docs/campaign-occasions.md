# Cấp điểm theo dịp

Trong **Định nghĩa sự kiện**, tạo khóa, tên và quy tắc phát sinh. Chính sách phê duyệt được chọn ở campaign:

- **Onboarding**: ngày tạo tài khoản hoặc trường DATE tùy chỉnh, cộng số ngày chờ. Chỉ áp dụng cho tài khoản tạo từ khi campaign bắt đầu.
- **Ngày hằng năm của member**: mỗi năm trùng ngày/tháng của một trường DATE, dùng cho birthday, work anniversary hoặc ngày cá nhân khác.
- **Ngày cố định hằng năm**: chọn ngày/tháng và múi giờ.
- **Ngày diễn ra một lần**: chọn ngày cụ thể và múi giờ.
- **Sự kiện bên ngoài**: hệ thống tích hợp gửi `/api/v1/events` với memberId, event key đã khai báo và khóa chống trùng.

Các quy tắc lịch chạy mỗi phút; ngày/tháng được xác định theo múi giờ cấu hình (mặc định Asia/Ho_Chi_Minh). Với ngày 29/2, có thể chọn chỉ chạy năm nhuận, chạy ngày 28/2 hoặc ngày 1/3 trong năm không nhuận.

Trong **Campaigns**, chọn sự kiện, policy (`Standing` hoặc `Approval required`), segment, loại điểm, số điểm cố định, giới hạn mỗi member và ngân sách. Tier được chọn thông qua điều kiện `currentTier` trong segment. Điểm tuân thủ ngân hàng và hạn sử dụng của loại điểm; với hạn theo từng lần cấp, nhập số ngày hạn điểm trong campaign.

Dịp thường lệ chạy khi campaign hoạt động và nằm trong thời gian hiệu lực. Campaign `Approval required` được lưu nháp, cần lý do và thao tác **Gửi duyệt** ở danh sách campaign. Event external và one-time luôn yêu cầu approval; event scheduled có thể chạy standing hoặc yêu cầu approval. Cấu hình workflow `CAMPAIGN_ISSUANCE_PROPOSAL` và người duyệt trước. Sau bước duyệt cuối cùng, campaign được bật; từ chối giữ campaign tắt. Sửa nội dung campaign đã duyệt yêu cầu duyệt lại, campaign đang chờ duyệt không được sửa. `POINT_ISSUANCE_PROPOSAL` vẫn dành riêng cho cấp thủ công một member.

Các event external chỉ nhận report từ integration khi event definition đang active. Event scheduled không nhận report thủ công qua Events API; scheduler là nguồn phát sinh duy nhất. Nếu event đã gắn với campaign, tạo event mới để không thay đổi quy tắc đang có.

Lịch chạy ghi nhận mỗi campaign/member/lần phát sinh đúng một lần; số dư, trừ ngân hàng và lịch sử campaign được ghi trong cùng giao dịch. Ledger ghi nguồn `campaign:<id>`. Lỗi ngân hàng/hạn điểm được ghi trong log worker `campaigns.occasions` và được thử lại.
