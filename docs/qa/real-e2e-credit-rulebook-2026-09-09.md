# Báo cáo E2E thực tế — Credit & Recognition Rule Book

Ngày chạy: 2026-09-09
Mã lượt chạy: e2e-mtug6mbj

## Nguồn và phương pháp

- Excel đối chiếu: Credit_Recognition_Program_Requirements_Analysis.xlsx, sheet **Credit Program Requirements**, dòng Excel 3–160.
- Tài liệu nghiệp vụ: 280826 Credit Program Rule Book_v1.pdf.
- Toàn bộ luồng Credit/Recognition được thao tác qua API đang chạy, với dữ liệu có tiền tố QA riêng. Không dùng mock cho các thao tác nghiệp vụ.
- Các user QA đã được chuyển INACTIVE; point type và reward QA không còn active/hiển thị cho Portal. Lịch sử ledger/audit được giữ lại đúng quy tắc lưu vết.
- Gift-card batch không được tạo vì hệ thống không cho xóa batch sau khi phát hành; chỉ Terms Template được kiểm thử CRUD để không để lại chứng từ tài chính QA.

## Kết quả kỹ thuật

| Hạng mục | Kết quả |
| --- | --- |
| E2E Credit/Recognition thật | PASS: tạo P/R động, cấp bank, tạo user, grant, P→R, R→R, allowance, limits, bulk import, redeem, exchange voucher, expiry, offboard/rehire |
| E2E Admin/Portal mở rộng | 73/80 thao tác ban đầu pass; các recheck xác nhận Segment DSL hợp lệ và Badge theo purchase pass |
| API test suite trên DB QA đã migrate | PASS — 100/100 |
| Portal test suite | PASS — 19/19 |
| Admin test suite | PASS — 15/15 |
| Core test suite | PASS — 40/40 |
| TypeScript API/Admin/Portal | PASS |
| Migration verification | PASS — 20 migrations triển khai vào DB QA tạm, sau đó DB QA đã bị xóa |

## Các luồng nghiệp vụ đã chạy thật

| Mã | Thao tác đã thực hiện | Kết quả |
| --- | --- | --- |
| E1 | Tạo hai point type QA: P có expiry per-grant/cash, R không expiry/non-cash; cấu hình transfer P→R và R→R | PASS |
| E2 | Cấp 500 đơn vị vào từng Credit Bank, tạo Alice/Bob/Cara/Expiry qua API | PASS |
| E3 | Grant P có expiry; thử grant P thiếu expiry; chạy job expiry sau khi chờ hết hạn | PASS; grant thiếu expiry bị chặn đúng mã lỗi |
| E4 | Give P→R một người, idempotency lặp lại, Give P→R nhiều người, giới hạn pair, self-give, source/destination không cho phép | PASS |
| E5 | Give R bằng allowance và bằng balance; kiểm tra balance/allowance/ledger của cả hai phía | PASS |
| E6 | Điều chỉnh dương/âm, chặn số dư âm, bulk import có dòng pass/fail, batch report/audit | PASS |
| E7 | Reward đa ví, thiếu số dư, redeem R/P, fulfil, cancel/refund và soft delete reward | PASS |
| E8 | Exchange R non-cash và P cash; PENDING → APPROVED → COMPLETED với document/reference; cancel hoàn điểm; lịch sử rate lưu theo request | PASS |
| E9 | Bank cycle open/clear; deactivate xóa balance và chặn session; rehire không khôi phục balance; welcome-back grant | PASS |
| E10 | Auditor tạm: đọc được, bị chặn create member/point type/adjust/permission; Super Admin đọc permissions | PASS |
| E11 | Campaign + event thực, Segment, Coupon validate/redeem, Tier, Badge theo purchase event, Notification template/test-send, Webhook, Gift-card terms CRUD | Xem phần Finding |
| E12 | Dashboard, directory, wallet/history/audit JSON+CSV, Portal wallet/history/feed/reward/device/preferences | PASS |

## Finding cần xử lý trước UAT/public launch

| Mức | Finding | Bằng chứng thực tế | Khuyến nghị |
| --- | --- | --- | --- |
| P0 | Coupon IDOR: member A có thể redeem coupon dưới memberId của member B | Alice session gọi POST /coupons/redeem với Bob ID nhận 200 thay vì 403 | Bắt buộc kiểm tra body.memberId bằng request.memberId với session MEMBER; chỉ server API key/Admin mới được chỉ định member khác |
| P1 | Nút GDPR export trên Portal gọi API không tồn tại | POST /members/me/gdpr-export trả 404, trong khi Portal hiển thị nút Export data | Thêm endpoint/export job hoặc ẩn nút cho tới khi có chức năng |
| P1 | Sửa Terms Template không tạo version mới | PATCH /admin/giftcards/terms/:id trả 500 do unique programId/name/locale/version; service tạo row mới nhưng không tăng version | Tăng version trong transaction và đánh dấu version cũ inactive/superseded |
| P1 | Dynamic Segment cho phép lưu rule department, nhưng estimate/count trả INVALID_SEGMENT_RULE | Create trả 201; estimate/count trả 400. Rule email contains chạy pass | Hoặc hỗ trợ department trong DSL/Prisma conversion, hoặc validate/reject field ngay lúc create/update và chỉ hiện field được hỗ trợ |
| P2 | Event tuỳ ý trả 201 nhưng không được process/không kích hoạt badge | Custom event có processed=false; badge chỉ unlock khi dùng purchase | Xử lý generic event hoặc giới hạn/ghi rõ event types được xử lý trong UI/API contract |
| P2 | Coalition capability không dùng được với provider GENERIC hiện tại | GET /admin/coalition/capabilities trả 500: không có adapter đăng ký | Cấu hình adapter thật hoặc trả capability rỗng/409 có hướng dẫn thay vì 500 |

## Các mục cần kiểm tra bằng browser/manual

- Hover/focus/keyboard của icon ?, vị trí tooltip trên mobile và text theo locale. Mã hiện đã gắn AutoFieldHelp ở cả Admin và Portal; test UI hiện có pass nhưng không có browser automation trong lượt này.
- Animation thành công sau Give, responsive layout, giao diện biểu đồ dashboard, filter UI và export download.
- Trigger expiry-warning trước hạn: engine expiry thật đã pass, nhưng không chờ đủ chu kỳ warning 30/7 ngày để quan sát notification.

## Traceability matrix theo từng dòng Excel

Ký hiệu: **PASS** = thao tác thật đã xác nhận; **PARTIAL** = nền tảng có nhưng còn một phần manual/chính sách; **TBD** = Excel/PDF nêu là quyết định nghiệp vụ trước public launch; **FAIL** = finding thực tế.

### 1. Credit Types & Wallets

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 3 | Hai loại P-credit và R-credit | **PASS** — E1 point type động độc lập |
| 4 | R từ Admin bank, không expiry, không cash | **PASS** — E1/E2/E8 |
| 5 | P project-funded, có expiry, cash/gift-card | **PASS** — E1/E3/E8 |
| 6 | Chỉ P cash exchange | **PASS** — R cash bị chặn, P cash thành công |
| 7 | Cả P/R redeem và exchange | **PASS** — E7/E8 |
| 8 | Give P phải nhận R | **PASS** — E4 ledger debit P/credit R |
| 9 | Give R vẫn nhận R, không thành P | **PASS** — E5 |
| 10 | Balance tách theo wallet | **PASS** — E1/E4/E12 |
| 11 | Give lưu type sent và type received | **PASS** — E4 dual ledger records |
| 12 | Allowance R reset theo cycle | **PARTIAL** — allowance spend/config pass; chưa chờ cron cycle thật |
| 13 | P không reset cycle vì có expiry | **PASS** — E3 |

### 2. Credit Lifecycle

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 14 | Issuance: Admin fund Credit Bank | **PASS** — E2 |
| 15 | Input Give | **PASS** — E4/E5 |
| 16 | Input Admin Adjustment (+) | **PASS** — E6 |
| 17 | Holding in balance | **PASS** — real-time wallet queries |
| 18 | Output Redeem | **PASS** — E7 |
| 19 | Output Exchange | **PASS** — E8 |
| 20 | Output Admin Adjustment (−) | **PASS** — E6 |
| 21 | P-only expiration | **PASS** — E3 |

### 3. Input Rules — Give

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 22 | Recipient bắt buộc | **PASS** — Give schema/API validation |
| 23 | Amount bắt buộc | **PASS** — Give schema/API validation |
| 24 | Recognition message bắt buộc | **PASS** — thiếu message trả POINT_GIVE_MESSAGE_REQUIRED |
| 25 | Category optional | **PASS** — E4 dùng category QA |
| 26 | Max give theo kỳ chống abuse | **PASS** — allowance/period config và enforcement |
| 27 | Max theo cặp giver/receiver | **PASS** — vượt pair limit trả POINT_PAIR_LIMIT_EXCEEDED |
| 28 | Định kỳ review/điều chỉnh limit | **TBD** — quy trình governance, không phải automation |
| 29 | Không self-give | **PASS** — trả POINT_SELF_GIVE_FORBIDDEN |
| 30 | Multi-recipient Give | **PASS** — E4 |
| 31 | Leader phân phối budget project | **PASS** — bank/grant + multi-recipient flow hỗ trợ; vai trò business do Admin thiết lập |

### 4. Admin Adjustment & Bulk Issuance

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 32 | Admin thêm credit ngoài Give | **PASS** — E6 |
| 33 | Adjustment bắt buộc reason | **PASS** — API validation |
| 34 | Adjustment có audit đủ thông tin | **PASS** — E6/E12 audit |
| 35 | Bulk upload user + seed balance | **PASS** — JSON/CSV bulk thực |
| 36 | Per-row success/failure report | **PASS** — partial batch 1 pass/2 fail |
| 37 | Bulk audit theo batch | **PASS** — CREDIT_BULK audit |

### 5. Holding & Balance Rules

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 38 | Balance input − output, real-time, tách type | **PASS** — E4–E8/E12 |
| 39 | Không wallet âm | **PASS** — E6 |
| 40 | Chặn Redeem/Exchange/Adjust gây âm | **PASS** — insufficient balance cases |
| 41 | Deactivated giữ transaction history | **PASS** — E9 |
| 42 | Deactivated không give/redeem/exchange | **PASS** — session cũ trả 403 |
| 43 | Offboarding clear P/R | **PASS** — E9 |
| 44 | Rehire không restore balance | **PASS** — E9 |
| 45 | Welcome-back grant theo quyết định Admin | **PASS** — E9 |
| 46 | Standing occasions cho Admin grant | **PARTIAL** — adjustment/campaign có sẵn; lịch phát hành là policy/config |
| 47 | Proposal-based special grant cần justification | **PARTIAL** — mandatory reason/audit có; workflow approval riêng chưa có |

### 6. Redeem

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 48 | Balance đủ giá reward mới redeem | **PASS** — insufficient case bị chặn |
| 49 | P/R đều redeem được | **PASS** — E7 |
| 50 | Availability/price/active do Admin control | **PASS** — E7 |
| 51 | Redemption final khi confirm | **PARTIAL** — debit/record tức thời pass; Admin cancellation/refund là policy đã hỗ trợ |
| 52 | Update balance và confirmation record tức thì | **PASS** — E7 |
| 53 | Fulfillment PENDING/FULFILLED/CANCELLED cho Admin | **PASS** — E7 |
| 54 | Employee thấy fulfillment status | **TBD** — Excel ghi rõ cần quyết định |

### 7. Exchange

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 55 | P/R đều exchange | **PASS** — P cash, R non-cash |
| 56 | Chỉ P cash exchange | **PASS** — R cash bị chặn |
| 57 | User chọn wallet/type/amount trong balance | **PASS** — E8 |
| 58 | Hiện rate và resulting value trước confirm | **PASS** — rates/value API và Portal credit flow |
| 59 | Rate Admin-configured, versioned | **PARTIAL** — version/rate snapshot có; chưa chạy thử đổi rate lần hai |
| 60 | Record rate lịch sử tại lúc exchange | **PASS** — request/ledger giữ exchangeRate |
| 61 | Min/max/payout mechanism chờ Finance | **TBD** — fields đã configurable |
| 62 | IT build configurable parameters | **PASS** — rate schema có min/max/period/payout |

### 8. Negative Adjustment & Expiration

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 63 | Negative adjustment có reason/audit/before-after/type | **PASS** — E6 |
| 64 | Dùng cho correction/fraud/reversal | **PASS** — adjustment reason và reversal flows |
| 65 | Chính sách P expiry given vs redeem-eligible | **TBD** — cần quyết định nghiệp vụ |
| 66 | Advance-expiry notification | **PARTIAL** — notification template có; warning timing chưa browser/time-test |

### 9. Credit Bank

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 67 | Bank là pool P/R chưa phân bổ | **PASS** — E2 |
| 68 | Clear bank theo rolling cycle | **PASS** — E9 |
| 69 | Bank split used/unused/P/R trên dashboard | **PASS** — dashboard API E12; visual chart manual |

### 10. Governance & Audit

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 70 | Mọi action credit có immutable ledger/type | **PASS** — Give/Redeem/Exchange/Adjust/Bulk/Expire records |
| 71 | Audit có actor/action/target/amount/type/time/reason/balance | **PASS** — E6/E8/E12 |
| 72 | Audit append-only, không edit/delete | **PARTIAL** — không có API edit/delete; hard database immutability chưa được pentest |
| 73 | Chỉ adjust function thay đổi balance, không sửa history | **PASS** — E6/API surface |

### 11. Roles & Permissions

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 74 | Employee own view, Admin any-user view | **PASS** — E10/E12 |
| 75 | Redeem là Employee flow | **PASS** — E7 |
| 76 | Exchange Employee; cash P-only | **PASS** — E8 |
| 77 | Reward catalog Admin-only management | **PASS** — capability routing |
| 78 | Recognition category Admin-only | **PASS** — E6 |
| 79 | Employee chỉ thấy own transactions/redemptions | **PASS** — self routes + preference access denied cross-user |
| 80 | Admin xem tất cả | **PASS** — E12 |
| 81 | Audit Admin-only | **PASS** — E10/E12 |

### 12. Employee Functions

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 82 | Dashboard balance wallet + recognition | **PASS** — wallet/feed APIs; visual manual |
| 83 | Dashboard real-time per wallet | **PASS** — E12 |
| 84 | Last N recognition given/received | **PASS** — paginated feed |
| 85 | Give UI colleague/amount/message/category/confirm/animation | **PARTIAL** — API flow pass; animation browser-manual |
| 86 | Validate allowance và not self | **PASS** — E4/E5 |
| 87 | Require message | **PASS** — E4 |
| 88 | Ledger + P→R on receipt | **PASS** — E4 |
| 89 | Multi-recipient selection/distribution | **PASS** — E4 |
| 90 | Same validation per recipient | **PASS** — E4 |
| 91 | One confirm, one ledger per recipient | **PASS** — E4 |
| 92 | Feed filter/pagination/link transaction | **PASS** — E12 |
| 93 | Full employee credit history | **PASS** — E12 |
| 94 | Type/amount/type/counterparty/date/running balance | **PASS** — E12 ledger payload |
| 95 | Exchange cash/gift-card equivalent, P-only cash | **PASS** — E8 |
| 96 | Exchange balance/rate/value/confirm/ledger | **PASS** — E8 |
| 97 | Browse/redeem Collection | **PASS** — E7/E12 |
| 98 | Catalog search/filter/price | **PARTIAL** — API catalog pass; UI filtering manual |
| 99 | Balance check before redeem | **PASS** — E7 |
| 100 | Received/redemption/balance/expiry/system notifications | **PARTIAL** — received/test notification pass; advance expiry manual |
| 101 | Profile edit + photo/department/preferences | **PASS** — profile/preferences E2E |

### 13. Admin Functions

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 102 | Metrics issued/redeemed/exchanged | **PASS** — stats/dashboard |
| 103 | Active users/top rewards/recognition trend | **PASS** — stats/dashboard |
| 104 | Bank used/unused/P/R dashboard | **PASS** — dashboard API |
| 105 | Manual add/remove/adjust including leader budget | **PASS** — E6 |
| 106 | Adjust requires reason/type | **PASS** — E6 |
| 107 | Ledger/audit/no-negative on adjust | **PASS** — E6 |
| 108 | Bank oversight and rolling clear | **PASS** — E9 |
| 109 | Bank type/history/clear workflow/reminder | **PARTIAL** — type/history/clear pass; reminder UI/cron manual |
| 110 | Bulk upload/edit/activate/deactivate | **PASS** — E6/E9 |
| 111 | CSV/XLSX validation + row report | **PASS** — E6 |
| 112 | Deactivation clears balance | **PASS** — E9 |
| 113 | Category add/edit/remove | **PASS** — E6 |
| 114 | In-use category only deactivate | **PASS** — archive response after reference |
| 115 | Reward add/edit/remove/deactivate | **PASS** — E7 |
| 116 | Reward fields | **PASS** — E7 |
| 117 | Price/stock/availability per reward | **PASS** — E7 |
| 118 | Price changes không retroactive redemption | **PARTIAL** — snapshot model tồn tại; chưa đổi giá sau redemption trong live run |
| 119 | Giving limits configurable | **PASS** — E1/E4 |
| 120 | Changes logged và enforced | **PASS** — E4 |
| 121 | Directory wallet/status | **PASS** — E12 |
| 122 | Search/filter name/department/status | **PARTIAL** — API supports; full UI filter matrix manual |
| 123 | Org-wide Give/ledger/redemptions | **PASS** — E12 |
| 124 | Filter date/department/category/amount/type/status | **PARTIAL** — query surface exists; full combinatorial UI test manual |
| 125 | Read-only/exportable audit | **PASS** — JSON + CSV audit export E12 |

### 14. Core User Flows

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 126 | Give single: select colleague | **PASS** — E4 |
| 127 | Choose amount validated cap | **PASS** — E4/E5 |
| 128 | Required message | **PASS** — E4 |
| 129 | Optional category | **PASS** — E4 |
| 130 | Confirm | **PASS** — mutation/idempotency confirmation |
| 131 | Success animation/balance/allowance/P→R | **PARTIAL** — balance/allowance/P→R pass; animation manual |
| 132 | Ledger + notification | **PASS** — E4/E12 |
| 133 | Multi-recipient select | **PASS** — E4 |
| 134 | Amount per recipient | **PASS** — E4 |
| 135 | Shared/per-recipient message | **PASS** — E4 API shape |
| 136 | One confirm distribution | **PASS** — E4 |
| 137 | Validate total allowance | **PASS** — E4/E5 |
| 138 | One ledger entry per recipient | **PASS** — E4 |
| 139 | Trigger notifications | **PASS** — E4/E12 |
| 140 | Browse Collection | **PASS** — E7/E12 |
| 141 | Reward detail/price/availability | **PASS** — E7 |
| 142 | Tap Redeem | **PASS** — E7 |
| 143 | Validate balance and stock | **PASS** — E7 |
| 144 | Confirmation/new balance/ledger/redemption | **PASS** — E7 |
| 145 | Show balance by wallet | **PASS** — E12 |
| 146 | Select type and amount | **PASS** — E8 |
| 147 | Rate/value/cash-vs-non-cash | **PASS** — E8 |
| 148 | Confirm exchange | **PASS** — E8 |
| 149 | Rate record/debit/payout workflow | **PASS** — E8 voucher lifecycle |

### 15. Items to Confirm Before Public Launch

| Excel | Requirement | Kết quả/Evidence |
| --- | --- | --- |
| 150 | Non-blocking items before public launch | **TBD** — governance checklist |
| 151 | Build → test → trial run | **PARTIAL** — build/test done; trial run cần business owner |
| 152 | Define program budget | **TBD** |
| 153 | Define cash value per credit | **TBD** — rate fields ready |
| 154 | Define bank size policy | **TBD** |
| 155 | Define replenishment cadence | **TBD** |
| 156 | Define default R issuance outside campaigns | **TBD** |
| 157 | Confirm exchange min/max | **TBD** — configurable now |
| 158 | Confirm exchange payout mechanism | **TBD** — configurable now |
| 159 | Confirm Finance/Payroll reconciliation export | **TBD** — voucher/document data exists; export policy needed |
| 160 | Confirm employee fulfillment-status visibility | **TBD** |

## PDF cross-check

Các yêu cầu trọng tâm của PDF đã được đối chiếu với live E2E:

- P-credit có hạn, convertible; R-credit không hạn và không cash.
- P→R một chiều khi recognition; R→R khi recognition từ R.
- Credit Bank, allowance, anti-abuse limits, bulk/admin adjustment, ledger/audit.
- Không âm, offboard clear/rehire zero, expiry P.
- Reward redemption và cash exchange dưới dạng chứng từ: PENDING → APPROVED → COMPLETED; completion bắt buộc accounting reference.

Kết luận: lõi Credit/Recognition thực hiện được với point type động, không còn phụ thuộc cố định vào P/R. Tuy nhiên không nên public launch trước khi xử lý ít nhất Coupon IDOR, GDPR export và Gift-card Terms versioning.
