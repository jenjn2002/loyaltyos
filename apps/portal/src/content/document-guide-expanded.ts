/**
 * Focused, bilingual customer procedures. These entries deliberately keep one
 * member task per article so each article can receive its own real UI capture.
 * The admin documentation editor currently owns publication and uploaded images.
 */

interface GuideScenario {
  title: string;
  when: string;
  steps: string[];
  expected: string;
  help?: string;
}

interface GuideLocaleContent {
  title: string;
  section: string;
  route: string;
  purpose: string;
  prerequisites?: string;
  steps: string[];
  result: string;
  notes: string[];
  scenarios: GuideScenario[];
  imageAlt?: string;
}

interface GuideArticleContent {
  vi: GuideLocaleContent;
  en: GuideLocaleContent;
}

export interface GuideArticle {
  id: string;
  audience: "CUSTOMER" | "ADMIN";
  slug: string;
  status: "DRAFT" | "PUBLISHED";
  sortOrder: number;
  imageKey: string | null;
  imageData: string | null;
  content: GuideArticleContent;
}

function article(
  slug: string,
  sortOrder: number,
  imageKey: string,
  vi: GuideLocaleContent,
  en: GuideLocaleContent,
): GuideArticle {
  return {
    id: `customer-${slug}`,
    audience: "CUSTOMER",
    slug,
    status: "PUBLISHED",
    sortOrder,
    imageKey,
    imageData: null,
    content: { vi, en },
  };
}

export const customerGuideExpanded: GuideArticle[] = [
  // screenshot target: Profile while signed out, password form, optional Microsoft button, then signed-in profile/logout.
  article("how-member-login", 1100, "profile", {
    title: "Đăng nhập và đăng xuất tài khoản thành viên", section: "Bắt đầu", route: "/profile",
    purpose: "Đăng nhập để mở các chức năng dành cho thành viên; Profile là nơi có form đăng nhập khi bạn chưa có phiên hợp lệ.",
    prerequisites: "Bạn cần tài khoản thành viên còn hoạt động và thông tin đăng nhập do tổ chức cấp. Nút Microsoft 365 chỉ xuất hiện nếu chương trình đã bật phương thức này.",
    steps: [
      "Chọn Thêm → Hồ sơ. Khi chưa đăng nhập, trang sẽ hiện form thay vì thông tin cá nhân.",
      "Nhập đúng Username và Password do tổ chức cấp rồi chọn Đăng nhập.",
      "Nếu tổ chức bật Microsoft 365, chọn Tiếp tục với Microsoft 365 và hoàn tất xác thực bằng tài khoản công việc.",
      "Sau khi đăng nhập, thanh dưới có Trang chủ, Điểm, Phần thưởng, Dự án và Thêm. Trong Thêm có Thông báo, Giao dịch, Huy hiệu, Hồ sơ và Hướng dẫn sử dụng.",
      "Khi dùng xong trên thiết bị dùng chung, mở Thêm → Hồ sơ và chọn Đăng xuất.",
    ],
    result: "Thông tin thành viên hiện trong Profile và phiên đăng nhập cho phép mở các trang có yêu cầu xác thực.",
    notes: ["Email có thể không phải Username đăng nhập; dùng đúng thông tin do tổ chức cấp.", "Đăng xuất sẽ xóa phiên trên trình duyệt hiện tại; hãy đóng cửa sổ Microsoft nếu cần kết thúc phiên SSO riêng."],
    scenarios: [
      { title: "Không thấy nút Microsoft 365", when: "Bạn muốn dùng tài khoản công ty nhưng chỉ thấy form Username/Password.", steps: ["Kiểm tra bạn đang ở Profile và chưa đăng nhập.", "Nếu nút vẫn không xuất hiện, dùng mật khẩu hoặc liên hệ quản trị viên để xác nhận Microsoft 365 đã được cấu hình cho chương trình."], expected: "Nút SSO chỉ xuất hiện khi chương trình công bố phương thức Microsoft cho thành viên.", help: "Không gửi mật khẩu công ty qua chat; nhờ quản trị viên kiểm tra cấu hình đăng nhập." },
      { title: "Đăng nhập thất bại hoặc bị đưa về form", when: "Trang báo thông tin không hợp lệ hoặc phiên không được tạo.", steps: ["Nhập lại chính xác Username; tránh tự thay bằng email nếu admin đã cấp username khác.", "Kiểm tra trạng thái tài khoản với quản trị viên rồi thử lại một lần.", "Nếu đăng nhập Microsoft báo tài khoản không khả dụng, gửi thông báo lỗi cho quản trị viên thay vì tạo thêm tài khoản trùng."], expected: "Sau đăng nhập thành công, hồ sơ hiện trong Thêm → Hồ sơ và các chức năng xác thực khả dụng.", help: "Nếu thông tin đúng nhưng vẫn bị trả về form, ghi lại thời điểm và phương thức đăng nhập để admin kiểm tra phiên/API." },
    ],
    imageAlt: "Form đăng nhập thành viên và hồ sơ sau khi đăng nhập",
  }, {
    title: "Member sign-in and sign-out", section: "Getting started", route: "/profile",
    purpose: "Sign in to use member features. Profile contains the sign-in form whenever there is no valid member session.",
    prerequisites: "You need an active member account and the sign-in details issued by your organization. The Microsoft 365 button appears only when the program enables that method.",
    steps: [
      "Select More → Profile. When signed out, the page shows a sign-in form instead of personal details.",
      "Enter the Username and Password issued by your organization, then select Sign in.",
      "If Microsoft 365 is enabled, select Continue with Microsoft 365 and complete authentication with your work account.",
      "After sign-in, the bottom navigation shows Home, Points, Rewards, Projects, and More. More contains Notifications, Transactions, Badges, Profile, and User guide.",
      "When finished on a shared device, open More → Profile and select Sign Out.",
    ],
    result: "Your member details appear in Profile and the session lets you open pages that require authentication.",
    notes: ["Your sign-in Username may differ from your email; use the exact details issued by your organization.", "Logging out clears the session in this browser. Close the Microsoft window too if you need to end its separate SSO session."],
    scenarios: [
      { title: "Microsoft 365 is not shown", when: "You want to use your work account but only see Username and Password.", steps: ["Confirm that you are on Profile and signed out.", "If the button is still missing, use password sign-in or ask your administrator whether Microsoft 365 is configured for members."], expected: "The SSO button appears only when the program exposes Microsoft sign-in to members.", help: "Do not share your work password in chat; ask the administrator to check sign-in configuration." },
      { title: "Sign-in fails or returns to the form", when: "The page rejects the credentials or does not create a session.", steps: ["Enter the exact Username; do not substitute an email unless that is the issued username.", "Ask the administrator to confirm that the member account is active, then retry once.", "If Microsoft reports that the account is unavailable, share the error with your administrator instead of creating a duplicate account."], expected: "After sign-in, Profile is under More and authenticated pages are available from the navigation.", help: "If correct credentials still return to the form, record the time and sign-in method so an administrator can check the session/API." },
    ],
    imageAlt: "Member sign-in form and signed-in profile",
  }),

  // screenshot target: Home balance cards with expiry countdown and the Points page wallet details.
  article("how-point-balances-expiry", 1120, "home", {
    title: "Đọc số dư từng ví và ngày hết hạn", section: "Điểm và ví", route: "/",
    purpose: "Xem số điểm có thể dùng trong từng loại ví và kiểm tra điểm nào sắp hết hạn.",
    prerequisites: "Đăng nhập thành viên. Ví chỉ xuất hiện nếu loại điểm được bật để thành viên xem.",
    steps: [
      "Mở Home và tìm khu vực Balance. Mỗi thẻ là một loại điểm riêng; không cộng P-credit với R-credit thành một số tổng.",
      "Đọc tên ví, số dư và unit label trên cùng một thẻ. Số dư không đồng nghĩa với allowance để Give nếu chương trình tách hai nguồn này.",
      "Đọc dòng hết hạn dưới từng ví: có thể là Does not expire, Expires in N days, Expires today, ngày cố định hoặc expiry được đặt theo từng lần cấp.",
      "Chọn View details hoặc mở Điểm để xem các ví và allowance (nếu có).",
      "Nếu cần biết số điểm đã phát sinh vào/ra, chọn Thêm → Giao dịch; số dư hiện tại không thay thế lịch sử.",
    ],
    result: "Bạn xác định được số dư riêng của từng loại điểm và mốc hết hạn đang áp dụng cho mỗi ví.",
    notes: ["Pending claim chưa nằm trong số dư có thể sử dụng cho Rewards hoặc Give.", "Số ngày còn lại là đếm tới ngày hết hạn đang lưu; chính sách phụ thuộc cấu hình loại điểm của tổ chức."],
    scenarios: [
      { title: "Một ví đang bằng 0", when: "Một loại điểm không có số dư hoặc không xuất hiện trên Home.", steps: ["Mở Điểm để xem các ví thành viên được phép thấy.", "Chọn Thêm → Giao dịch và kiểm tra mục claim đang chờ trên Home.", "Nếu loại điểm vẫn không xuất hiện, hỏi quản trị viên xem loại điểm có được bật cho thành viên không."], expected: "Bạn phân biệt được ví không được hiển thị, ví có số dư 0 và điểm còn đang chờ claim.", help: "Không suy ra điểm bị mất chỉ từ việc không thấy thẻ; yêu cầu admin kiểm tra cấu hình hiển thị và ledger." },
      { title: "Ngày hết hạn có vẻ không đổi", when: "Bạn muốn biết số ngày còn lại có giảm theo ngày hay thời hạn được cộng lại mỗi lần nhận.", steps: ["Đọc ngày/đếm ngược được hiển thị trên ví.", "Nếu cần giải thích quy tắc áp dụng cho một lần nhận cụ thể, ghi lại loại điểm và ngày giao dịch trong Transactions.", "Nhờ admin xác nhận expiry mode của point type; không tự tính lại hạn từ lần nhận gần nhất nếu setting dùng mốc cố định."], expected: "Bạn dùng ngày hết hạn được ứng dụng hiển thị làm mốc và biết khi nào cần admin xác nhận chính sách.", help: "Gửi ảnh ví cùng ngày nhận điểm gần nhất cho admin, không gửi mật khẩu." },
    ],
    imageAlt: "Số dư các loại điểm và nhãn ngày hết hạn trên Home",
  }, {
    title: "Read balances and expiry dates", section: "Points and wallets", route: "/",
    purpose: "Review the spendable balance in each point wallet and check which points are approaching expiry.",
    prerequisites: "Sign in as a member. A wallet appears only when its point type is visible to members.",
    steps: [
      "Open Home and find Balance. Each card is a separate point type; do not add P-credit and R-credit into one total.",
      "Read the wallet name, balance, and unit label on the same card. A balance is not the same as a Give allowance when the program separates those sources.",
      "Read the expiry line under each wallet. It may say Does not expire, Expires in N days, Expires today, show a fixed date, or indicate expiry is set per grant.",
      "Select View details or open Points to inspect wallets and any allowance.",
      "For points added or spent over time, select More → Transactions; the current balance is not a history.",
    ],
    result: "You can identify each point type's separate balance and the expiry currently applied to that wallet.",
    notes: ["Pending claims are not yet part of the balance available for Rewards or Give.", "The remaining-days label counts down to the stored expiry date; the organization's point-type settings determine the expiry policy."],
    scenarios: [
      { title: "A wallet shows zero", when: "A point type has no balance or does not appear on Home.", steps: ["Open Points to see member-visible wallets.", "Select More → Transactions and check any pending claim on Home.", "If the point type is still missing, ask the administrator whether it is enabled for members."], expected: "You can distinguish a hidden wallet, a zero balance, and points still waiting to be claimed.", help: "Do not assume points were lost just because a card is missing; ask an administrator to check visibility settings and the ledger." },
      { title: "The expiry date looks unexpected", when: "You need to know whether days remaining count down or each grant receives a new expiry.", steps: ["Use the date/countdown shown on the wallet.", "For a specific grant, note its point type and transaction date in Transactions.", "Ask an administrator to confirm the point type's expiry mode; do not recalculate from the latest grant if the setting uses a fixed date."], expected: "You use the displayed expiry as the source of truth and know when administrator confirmation is needed.", help: "Share a screenshot of the wallet and the relevant transaction date with the administrator; never share your password." },
    ],
    imageAlt: "Separate point balances and expiry labels on Home",
  }),

  // screenshot target: Home tier card with two point requirements and visible ALL/ANY qualification label.
  article("how-tier-progress", 1140, "home", {
    title: "Đọc điều kiện và tiến độ lên hạng", section: "Điểm và ví", route: "/",
    purpose: "Hiểu hạng hiện tại, hạng kế tiếp và phần điểm còn thiếu theo từng loại điểm.",
    prerequisites: "Chương trình cần cấu hình tier hiện tại và tier kế tiếp; nếu không có tier kế tiếp, thẻ sẽ không hiện thanh tiến độ.",
    steps: [
      "Trên Home, tìm thẻ Your Tier và đọc tên hạng hiện tại.",
      "Nếu có hạng tiếp theo, đọc thanh Progress và từng ô point type: earned / required cho biết tiến độ theo loại điểm; remaining cho biết phần còn thiếu.",
      "Khi có nhiều điều kiện, đọc nhãn Meet all requirements hoặc Meet any requirement. Đây là khác biệt giữa AND và OR; đừng tự cộng các loại điểm khác đơn vị.",
      "Để xem giao dịch làm thay đổi tiến độ, chọn Thêm → Giao dịch và lọc các điểm đã earn/reverse/expire.",
      "Nếu thẻ ghi bạn đang ở hạng cao nhất, sẽ không còn tiến độ lên tier tiếp theo để hiển thị.",
    ],
    result: "Bạn biết điều kiện nào còn thiếu và các điều kiện phải đồng thời đạt hay chỉ cần đạt một điều kiện.",
    notes: ["Thanh tiến độ chung không thay thế từng điều kiện theo point type.", "Điểm chờ claim chưa chắc đã được tính vào earned progress; hãy claim rồi kiểm tra lại."],
    scenarios: [
      { title: "Tiến độ chưa đổi sau khi nhận điểm", when: "Vừa claim hoặc vừa có giao dịch nhưng tier card còn số cũ.", steps: ["Mở Home lại hoặc tải lại dữ liệu sau khi thao tác hoàn tất.", "Kiểm tra giao dịch đã ghi thành công trong Transactions.", "Nếu balance đã cập nhật nhưng requirement vẫn không đổi, gửi tên tier và point type cho admin kiểm tra điều kiện tier."], expected: "Bạn tách được giao dịch chưa ghi nhận khỏi điều kiện tier chưa đạt.", help: "Không quy đổi hoặc cộng các point type bằng tay để dự đoán hạng; tier dùng đúng cấu hình của chương trình." },
      { title: "Không thấy tier card", when: "Home không hiển thị Your Tier.", steps: ["Xác nhận đã đăng nhập và dữ liệu Home đã tải xong.", "Nếu vẫn vắng, hỏi quản trị viên xem tier đang được cấu hình và có áp dụng cho thành viên của bạn không."], expected: "Tier card xuất hiện khi có tier phù hợp để hiển thị.", help: "Chụp Home sau khi tải xong và gửi cho admin nếu cấu hình đã có tier." },
    ],
    imageAlt: "Tier card với tiến độ và từng điều kiện điểm",
  }, {
    title: "Understand tier requirements and progress", section: "Points and wallets", route: "/",
    purpose: "Understand your current tier, the next tier, and the remaining amount for each point requirement.",
    prerequisites: "The program must configure a current and next tier. Without a next tier, the progress bar is not shown.",
    steps: [
      "On Home, find Your Tier and read your current tier name.",
      "If a next tier exists, read Progress and each point-type card: earned / required shows progress for that type; remaining shows what is still needed.",
      "When there are multiple requirements, read Meet all requirements or Meet any requirement. This is the difference between AND and OR; do not add unlike point types together.",
      "To review transactions that changed progress, select More → Transactions and inspect earned, reversed, or expired points.",
      "If the card says you are at the highest tier, there is no next-tier progress to display.",
    ],
    result: "You know which requirement remains and whether all requirements or only one must be met.",
    notes: ["The overall progress bar does not replace the per-point-type requirements.", "Points waiting to be claimed may not count as earned progress; claim them and check again."],
    scenarios: [
      { title: "Progress did not change after points arrived", when: "You just claimed a reward or received a transaction but the tier card looks unchanged.", steps: ["Reopen Home or refresh its data after the action finishes.", "Confirm that the transaction was recorded in Transactions.", "If the balance changed but the requirement did not, send the tier and point-type names to the administrator to check its rule."], expected: "You can distinguish a transaction that did not post from a tier requirement that is still unmet.", help: "Do not manually convert point types to predict a tier; the tier uses the program's configured rules." },
      { title: "The tier card is missing", when: "Home does not show Your Tier.", steps: ["Confirm you are signed in and Home finished loading.", "If it remains absent, ask the administrator whether tiers are configured and apply to your member account."], expected: "A tier card appears when there is an applicable tier to display.", help: "If tiers are configured, send the administrator a screenshot of Home after it has loaded." },
    ],
    imageAlt: "Tier progress with separate point requirements",
  }),

  // screenshot target: Home Points waiting for you card with campaign/amount and the Claim points button, plus post-claim refreshed state.
  article("how-campaign-claim", 1160, "claim", {
    title: "Claim điểm đang chờ từ campaign", section: "Điểm và ví", route: "/",
    purpose: "Nhận phần điểm mà campaign được cấu hình ở chế độ member claim; campaign tự cấp điểm không cần thao tác claim.",
    prerequisites: "Đăng nhập và có ít nhất một claim đang chờ, còn hiệu lực trong mục Points waiting for you trên Home.",
    steps: [
      "Mở Home và tìm Points waiting for you. Thông báo có thể báo campaign mới; thao tác claim được thực hiện trên thẻ này.",
      "Kiểm tra tên campaign, số điểm, loại điểm và thông tin chương trình hiển thị trước khi nhận.",
      "Chọn Claim points một lần và chờ thao tác hoàn tất; không gửi lặp khi nút đang xử lý.",
      "Sau khi danh sách được làm mới, xác nhận claim đã biến mất khỏi danh sách chờ; mở Balance/Điểm và Thêm → Giao dịch để xác nhận ví và giao dịch.",
      "Nếu có nhiều claim, dùng Previous/Next trong chính thẻ để xem các trang còn lại.",
    ],
    result: "Claim hợp lệ được ghi nhận và điểm đi vào loại ví hiển thị trên claim; số pending giảm sau khi dữ liệu làm mới.",
    notes: ["Thông báo chỉ giúp nhận biết cập nhật; không mặc định rằng bấm vào thông báo sẽ claim điểm.", "Nếu campaign đã tự động cấp, không có claim chờ tương ứng; kiểm tra Balance và Transactions."],
    scenarios: [
      { title: "Không thấy campaign cần claim", when: "Home không có thẻ hoặc danh sách không có campaign bạn mong đợi.", steps: ["Tải lại Home và kiểm tra trang claim tiếp theo nếu có.", "Mở chuông góc trên phải hoặc Thêm → Thông báo để đọc cập nhật campaign, rồi quay lại Home.", "Nếu thông báo nói đã tự động cấp, kiểm tra Balance/Điểm và Thêm → Giao dịch thay vì chờ claim."], expected: "Bạn biết claim ở Home, hoặc xác nhận campaign đã cấp tự động/không có claim khả dụng.", help: "Nếu admin xác nhận có claim đang chờ nhưng thẻ vẫn trống, gửi tên campaign và thời điểm thông báo cho admin." },
      { title: "Claim báo lỗi hoặc số dư chưa đổi", when: "Nút báo lỗi, đang quay lâu, hoặc claim biến mất nhưng bạn chưa thấy số dư.", steps: ["Không nhấn lặp ngay; tải lại Home để xem claim còn pending không.", "Mở Thêm → Giao dịch và Điểm để kiểm tra giao dịch/số dư sau khi claim.", "Nếu claim vẫn pending, thử lại một lần; nếu đã hết pending mà không có giao dịch, gửi thời gian, campaign name và ảnh lỗi cho admin."], expected: "Không tạo claim trùng và xác định được thao tác còn chờ hay đã được ghi nhận.", help: "Yêu cầu admin kiểm tra claim/ledger; không gửi mật khẩu hoặc mã xác thực." },
    ],
    imageAlt: "Claim points card trên Home trước khi nhận",
  }, {
    title: "Claim campaign points waiting for you", section: "Points and wallets", route: "/",
    purpose: "Claim a reward when its campaign requires a member action. Campaigns configured for automatic issuance do not need a claim.",
    prerequisites: "Sign in and have an eligible, unexpired claim in Points waiting for you on Home.",
    steps: [
      "Open Home and find Points waiting for you. A notification may tell you about a campaign; the claim action is on this card.",
      "Review the campaign name, amount, point type, and the program information shown before claiming.",
      "Select Claim points once and wait for it to finish; do not submit repeatedly while it is processing.",
      "After the list refreshes, confirm the item left the pending list; open Balance/Points and More → Transactions to verify the wallet and transaction.",
      "If several claims are available, use Previous/Next on the card to view other pages.",
    ],
    result: "A valid claim is recorded and points enter the wallet shown for that claim; the pending count decreases after refresh.",
    notes: ["A notification can announce a campaign; opening it does not necessarily claim points.", "An automatically issued campaign has no matching pending claim; check Balance and Transactions instead."],
    scenarios: [
      { title: "The campaign is not available to claim", when: "Home has no claim card or does not list the campaign you expected.", steps: ["Refresh Home and check another claim page if pagination is available.", "Read the update from the top-right bell or More → Notifications, then return to Home to find Claim points.", "If the notice says points were issued automatically, check Balance/Points and More → Transactions rather than waiting for a claim."], expected: "You know that claims happen on Home, or confirm issuance was automatic/no claim is available.", help: "If an administrator confirms a pending claim exists but the card is empty, share the campaign name and notification time." },
      { title: "Claim failed or the balance did not change", when: "The button reports an error, spins for a long time, or the claim disappears without a visible balance change.", steps: ["Do not click repeatedly; refresh Home to see whether the claim is still pending.", "Check More → Transactions and Points for the transaction/balance after claiming.", "If still pending, retry once. If it is no longer pending but there is no transaction, send the time, campaign name, and error screenshot to an administrator."], expected: "You avoid duplicate requests and determine whether the claim is waiting or recorded.", help: "Ask an administrator to check the claim/ledger; do not share your password or verification code." },
    ],
    imageAlt: "Points waiting for you card before claiming",
  }),

  // screenshot target: Check-in card/button in the not-yet-checked-in state, then successful calendar mark and point/claim notice.
  article("how-daily-check-in", 1180, "checkin", {
    title: "Điểm danh và đọc lịch hoạt động", section: "Điểm và ví", route: "/",
    purpose: "Ghi nhận check-in trong ngày cho event khả dụng và xem những ngày đã tham gia trên lịch dạng ô.",
    prerequisites: "Đăng nhập và có ít nhất một check-in event đang hoạt động, áp dụng cho tài khoản của bạn.",
    steps: [
      "Trên Home, tìm thẻ event có nút Check in today. Nếu chương trình không cung cấp event khả dụng, thẻ sẽ không hiện.",
      "Đọc tên event và campaign/loại điểm/số điểm đang gắn với event; dữ liệu giải thưởng phụ thuộc campaign.",
      "Chọn Check in today một lần và chờ phản hồi trên thẻ.",
      "Ô ngày thành công chuyển màu xanh trên lịch; kiểm tra bộ đếm số ngày hoạt động và thông báo kết quả ngay dưới thẻ.",
      "Nếu kết quả nói điểm đang chờ claim, quay lại Points waiting for you trên Home và làm theo bài Claim campaign points.",
    ],
    result: "Event ghi nhận tối đa một check-in cho ngày event hiện tại; điểm có thể được cộng tự động hoặc chuyển thành claim tùy campaign.",
    notes: ["Múi giờ/ngày áp dụng theo event do chương trình cấu hình.", "Lịch hiển thị hoạt động trong khoảng lịch sử được giao diện cung cấp; check-in không tạo lại dữ liệu cho ngày đã qua."],
    scenarios: [
      { title: "Nút báo đã điểm danh hôm nay", when: "Nút bị khóa hoặc hiện Checked in today.", steps: ["Không cần gửi check-in lần nữa trong ngày đó.", "Kiểm tra ô ngày tương ứng đã được tô màu và xem điểm đã cộng hay đang chờ claim."], expected: "Bạn xác nhận check-in trong ngày đã được ghi nhận.", help: "Nếu ngày trên lịch không khớp với ngày bạn vừa thao tác, chụp thẻ và hỏi admin về múi giờ event." },
      { title: "Không thấy thẻ check-in", when: "Bạn không thấy event hoặc lịch trên Home.", steps: ["Tải lại Home và xác nhận tài khoản đã đăng nhập.", "Nếu vẫn không có, hỏi admin xem event/campaign còn Active, có áp dụng cho bạn và chưa bị tắt không."], expected: "Thẻ chỉ hiển thị cho event đang khả dụng với member.", help: "Không tạo check-in bằng cách gửi request thủ công; gửi tên event cho quản trị viên kiểm tra." },
    ],
    imageAlt: "Nút điểm danh cùng lịch hoạt động sau check-in",
  }, {
    title: "Daily check-in and activity calendar", section: "Points and wallets", route: "/",
    purpose: "Record a check-in for an available event today and review completed days in the contribution-style calendar.",
    prerequisites: "Sign in and have at least one active check-in event available to your account.",
    steps: [
      "On Home, find the event card with a Check in today button. The card is hidden if no event is available to you.",
      "Read the event name and the campaign/point type/amount associated with it; the reward depends on its campaign.",
      "Select Check in today once and wait for the card to respond.",
      "A successful date turns green on the calendar. Check the activity-day count and the result notice below the card.",
      "If the result says points are waiting to be claimed, return to Points waiting for you on Home and follow the Claim campaign points guide.",
    ],
    result: "An event records at most one check-in for its current event date; points may be issued automatically or become a claim, depending on the campaign.",
    notes: ["The event's configured timezone determines the applicable date.", "The calendar shows the history period provided by the interface; check-in cannot create a record for a past day."],
    scenarios: [
      { title: "The button says you already checked in", when: "The button is disabled or reads Checked in today.", steps: ["Do not submit another check-in for that date.", "Confirm the matching calendar cell is green and check whether points were credited or are waiting to be claimed."], expected: "You confirm that today's check-in was recorded.", help: "If the calendar date differs from when you acted, capture the card and ask an administrator about the event timezone." },
      { title: "The check-in card is missing", when: "You cannot see the event or calendar on Home.", steps: ["Refresh Home and confirm you are signed in.", "If it remains missing, ask the administrator whether the event/campaign is active, applies to you, and has not been disabled."], expected: "The card appears only for an event currently available to the member.", help: "Do not create a check-in by sending a manual request; ask an administrator to check the event name." },
    ],
    imageAlt: "Check-in button and activity calendar after checking in",
  }),

  // screenshot target: Points > Give Recognition with source/destination, recipient search, amount/category/message, and confirmation/result.
  article("how-give-recognition", 1200, "wallet", {
    title: "Gửi Give Recognition cho đồng nghiệp", section: "Credits", route: "/credits",
    purpose: "Ghi nhận đồng nghiệp bằng loại điểm và ngân sách mà quản trị viên cho phép.",
    prerequisites: "Đăng nhập; cần có ví được bật Give và ít nhất một loại điểm đích hợp lệ. Message có thể bắt buộc theo cài đặt.",
    steps: [
      "Mở Điểm → Give Recognition. Nếu phần này không xuất hiện, tài khoản/loại điểm hiện không được bật quyền Give.",
      "Chọn Source point type. Nếu thấy Funds from, chọn Owned balance để dùng số dư của mình hoặc Give allowance để dùng hạn mức cấp riêng.",
      "Ở Recipient receives, chọn điểm đích/tỷ lệ được liệt kê; các đích không được admin cho phép sẽ không xuất hiện.",
      "Dùng Search colleagues để tìm người nhận, sau đó chọn người trong danh sách. Nếu được bật, dùng Add recipient để thêm người nhận; mỗi hàng nhập số điểm nguồn và thông điệp riêng tùy chọn.",
      "Nhập Amount theo đơn vị của ví nguồn; đọc Available source và Recipient total để hiểu tỷ lệ chuyển. Nhập Shared message nếu được yêu cầu và chọn Category nếu phù hợp.",
      "Kiểm tra lại người nhận, số điểm, ví nguồn và nội dung. Chọn Confirm & send rồi xác nhận hộp thoại của trình duyệt.",
      "Sau phản hồi thành công, mở Điểm → Hoạt động và Thêm → Giao dịch để xác nhận; allowance/số dư thay đổi theo nguồn đã chọn.",
    ],
    result: "Yêu cầu Give được ghi nhận theo tỷ lệ, allowance, hạn mức cặp người nhận và số người tối đa do admin cấu hình.",
    notes: ["Give allowance khác với số dư sở hữu; dùng allowance không có nghĩa điểm đó đã nằm trong wallet balance của bạn.", "Thông điệp/category có thể được thành viên khác nhìn thấy; không nhập thông tin cá nhân nhạy cảm."],
    scenarios: [
      { title: "Không tìm thấy đồng nghiệp", when: "Danh sách Recipient không có người cần gửi.", steps: ["Nhập tên, email hoặc phòng ban vào Search colleagues.", "Kiểm tra trang kết quả tiếp theo nếu danh sách có phân trang.", "Nếu vẫn không thấy, hỏi admin xem tài khoản người đó còn active và có thuộc cùng chương trình không."], expected: "Chỉ thành viên hiện trong danh sách mới có thể được chọn.", help: "Không chọn người có tên gần giống; xác minh email/phòng ban trước khi gửi." },
      { title: "Nút gửi đang bị khóa hoặc báo lỗi", when: "Thiếu người nhận, số tiền không hợp lệ, thiếu message bắt buộc hoặc không đủ allowance/số dư.", steps: ["Chọn đầy đủ người nhận và kiểm tra Amount lớn hơn 0, không vượt Available source.", "Kiểm tra nguồn/đích point type, bước số tiền và message bắt buộc.", "Nếu thao tác báo lỗi sau xác nhận, mở lại Điểm và Thêm → Giao dịch trước khi thử gửi lần nữa."], expected: "Form chỉ cho gửi dữ liệu hợp lệ; lỗi được xử lý mà không tạo lần Give lặp.", help: "Nếu vẫn bị chặn, gửi mã/lời báo lỗi cho admin kèm tên point type, không gửi nội dung nhạy cảm." },
    ],
    imageAlt: "Form Give Recognition với ví nguồn, người nhận và xác nhận",
  }, {
    title: "Send Give Recognition to a colleague", section: "Credits", route: "/credits",
    purpose: "Recognize a colleague with the point type and funding source allowed by your administrator.",
    prerequisites: "Sign in. You need a wallet with Give enabled and at least one permitted destination type. A message may be required by the point-type setting.",
    steps: [
      "Open Points and expand Give Recognition. If the section is absent, Give is not enabled for your account or point type.",
      "Choose Source point type. If Funds from appears, select Owned balance to use your wallet balance or Give allowance to use a separate allowance.",
      "Under Recipient receives, select an allowed destination type/rate. Destinations not permitted by the administrator are not listed.",
      "Use Search colleagues and select the intended member. If enabled, use Add recipient for additional people; enter source points and an optional per-recipient message for each row.",
      "Enter Amount in the source wallet's units; read Available source and Recipient total to understand the conversion. Add a Shared message if required and choose a Category if appropriate.",
      "Review the recipient, points, funding source, and message. Select Confirm & send and confirm the browser prompt.",
      "After success, review Points → Activity and More → Transactions; the selected balance or allowance changes according to the funding source.",
    ],
    result: "The Give is recorded under the configured conversion rate, allowance, pair limit, and maximum-recipient rules.",
    notes: ["A Give allowance is separate from your owned wallet balance; spending it does not mean those points were already in your wallet.", "Messages/categories may be visible to other members; do not enter sensitive personal information."],
    scenarios: [
      { title: "A colleague is not listed", when: "The Recipient list does not contain the person you want to recognize.", steps: ["Search by name, email, or department.", "Check another result page if the directory is paginated.", "If still missing, ask the administrator whether the member is active and belongs to the same program."], expected: "Only listed members can be selected as recipients.", help: "Do not choose a similar name without confirming their email/department." },
      { title: "Send is disabled or fails", when: "A recipient is missing, amount is invalid, required message is blank, or balance/allowance is insufficient.", steps: ["Select each recipient and ensure Amount is positive and within Available source.", "Check source/destination point types, amount increments, and required message.", "If an error occurs after confirmation, reopen Points and More → Transactions before trying again."], expected: "The form accepts valid data and avoids repeating a Give that may already have posted.", help: "If it remains blocked, send the error text and point type to your administrator; omit sensitive message contents." },
    ],
    imageAlt: "Give Recognition form with source wallet, recipient, and confirmation",
  }),

  // screenshot target: Exchange points form with rate preview/period limit and the submit response documenting Pending; do not imply cash payout.
  article("how-submit-exchange", 1220, "wallet", {
    title: "Tạo yêu cầu Exchange points", section: "Credits", route: "/credits",
    purpose: "Gửi yêu cầu đổi điểm theo tỷ lệ và hình thức payout nội bộ đã được chương trình cấu hình.",
    prerequisites: "Đăng nhập; Exchange points chỉ xuất hiện nếu có tỷ lệ active. Cần đủ số dư và số điểm nằm trong giới hạn đang áp dụng.",
    steps: [
      "Mở Điểm → Đổi điểm và yêu cầu (Exchange points).",
      "Chọn Point type, sau đó chọn Payout type có sẵn (Cash hoặc Non-cash cùng phương thức được ghi cạnh lựa chọn).",
      "Nhập Amount; đọc Preview để kiểm tra giá trị quy đổi và giới hạn theo chu kỳ nếu giao diện hiển thị.",
      "Trước khi gửi, lưu ý hệ thống ghi nhận voucher nội bộ ở trạng thái Pending và trừ điểm khi tạo request; đây không phải lệnh trả tiền tự động.",
      "Chọn Submit exchange request một lần. Đọc document number; theo dõi trong Điểm → Đổi điểm và yêu cầu → My exchange requests.",
    ],
    result: "Một exchange request/voucher được tạo để người có thẩm quyền review; kết quả duyệt/hoàn tất hiển thị trong lịch sử request.",
    notes: ["Cash/Non-cash là thông tin của luồng voucher, không đảm bảo có thanh toán tự động từ ứng dụng.", "Đừng gửi lại khi request đang xử lý; dùng document number để nhận diện yêu cầu."],
    scenarios: [
      { title: "Không có Exchange points hoặc không có loại điểm", when: "Phần Exchange bị ẩn hoặc menu chọn trống.", steps: ["Xác nhận đã đăng nhập và mở đúng mục Điểm.", "Nếu vẫn không có, hỏi admin xem tỷ lệ Exchange đang active cho point type và tài khoản của bạn không."], expected: "Chỉ loại điểm có tỷ lệ active mới xuất hiện trong request form.", help: "Không tự quy đổi theo tỷ lệ cũ; tỷ lệ/giới hạn do admin cấu hình." },
      { title: "Không gửi được số điểm", when: "Nút gửi bị khóa hoặc ứng dụng báo vượt hạn mức/không đủ số dư.", steps: ["Kiểm tra ví của point type được chọn và số dư khả dụng.", "So sánh Amount với mức tối thiểu/tối đa, period limit và giá trị Preview.", "Nếu bạn vừa gửi request, kiểm tra My exchange requests trước khi tạo yêu cầu mới."], expected: "Request hợp lệ nằm trong số dư và điều kiện tỷ lệ hiện tại.", help: "Nếu số dư bị trừ nhưng request chưa xuất hiện, lưu document number/thời gian hoặc thông báo lỗi và liên hệ admin." },
    ],
    imageAlt: "Exchange form with payout type, point estimate, and period limit",
  }, {
    title: "Submit an exchange-points request", section: "Credits", route: "/credits",
    purpose: "Submit a request using the exchange rate and internal payout method configured for the program.",
    prerequisites: "Sign in. Exchange points appears only when an active rate exists. Your balance and amount must meet the current limits.",
    steps: [
      "Open Points and expand Exchange & requests.",
      "Choose a Point type, then an available Payout type (Cash or Non-cash with its listed mechanism).",
      "Enter Amount and read Preview for the converted value and any displayed cycle limit.",
      "Before submitting, note that the app creates an internal voucher in Pending status and deducts points when the request is created; it does not make an automatic payment.",
      "Select Submit exchange request once. Note the document number and track it under Points → Exchange & requests → My exchange requests.",
    ],
    result: "An exchange request/voucher is created for authorized review; its approval/completion status appears in request history.",
    notes: ["Cash/Non-cash describes the voucher workflow and does not guarantee automatic payment by the app.", "Do not resubmit while a request is processing; use its document number to identify it."],
    scenarios: [
      { title: "Exchange or a point type is missing", when: "The Exchange section is hidden or its selector is empty.", steps: ["Confirm you are signed in and viewing Points.", "If still missing, ask the administrator whether an Exchange rate is active for your point type/account."], expected: "Only point types with an active rate appear in the request form.", help: "Do not use an old rate manually; the administrator controls rates and limits." },
      { title: "The amount cannot be submitted", when: "Submit is disabled or the app reports a limit or balance issue.", steps: ["Check the selected point type's available wallet balance.", "Compare Amount with the minimum/maximum, period limit, and Preview.", "If you just submitted a request, check My exchange requests before creating another."], expected: "A valid request fits the available balance and current rate conditions.", help: "If points were deducted but no request appears, retain the document number/time or error text and contact the administrator." },
    ],
    imageAlt: "Exchange form with payout type, estimate, and period limit",
  }),

  // screenshot target: My exchange requests expanded, with PENDING and resolved status plus notes/reference fields.
  article("how-track-exchange", 1240, "wallet", {
    title: "Theo dõi trạng thái yêu cầu Exchange", section: "Credits", route: "/credits",
    purpose: "Biết yêu cầu đổi điểm đang chờ duyệt, đã được duyệt, bị từ chối/hủy hay đã hoàn tất.",
    prerequisites: "Đăng nhập và đã tạo ít nhất một exchange request. Lịch sử nằm trong Điểm → Đổi điểm và yêu cầu.",
    steps: [
      "Mở Điểm → Đổi điểm và yêu cầu; cuộn tới My exchange requests và mở mục này nếu đang thu gọn.",
      "Tìm theo document number, loại điểm, số điểm và badge trạng thái; dùng Previous/Next để xem trang khác.",
      "Đọc Value, Payout, Requested/Approved/Completed timestamps và approval/completion note hoặc reference nếu có.",
      "Nếu trạng thái vẫn Pending, request đang chờ người có thẩm quyền xử lý; không tạo request thứ hai cho cùng nhu cầu.",
      "Sau Rejected/Cancelled, kiểm tra Balance và Transactions xem phần điểm có được hoàn ghi nhận chưa. Sau Completed, đọc ghi chú/reference để biết xử lý đã được đánh dấu xong thế nào.",
    ],
    result: "Bạn có thể nhận biết request theo document number và biết bước xử lý gần nhất được hệ thống ghi nhận.",
    notes: ["Approved không nhất thiết đồng nghĩa Completed; các trạng thái là những bước riêng.", "Ứng dụng lưu voucher và trạng thái; không xem voucher Completed là bằng chứng tự động chuyển tiền nếu chương trình chưa tích hợp thanh toán."],
    scenarios: [
      { title: "Request vẫn Pending", when: "Chưa có Approved/Rejected/Completed.", steps: ["Mở lại My exchange requests và kiểm tra thời gian yêu cầu.", "Mở chuông góc trên phải hoặc Thêm → Thông báo để tìm cập nhật.", "Nếu quá thời gian tổ chức quy định, gửi document number cho admin để kiểm tra approval inbox."], expected: "Request vẫn được định danh, không bị gửi trùng trong lúc chờ.", help: "Chỉ admin/người phê duyệt mới có thể xử lý trạng thái." },
      { title: "Bị từ chối/hủy nhưng điểm chưa quay lại", when: "Request có trạng thái Rejected hoặc Cancelled nhưng số dư chưa phản ánh như bạn mong đợi.", steps: ["Làm mới Điểm rồi kiểm tra đúng point type.", "Mở Thêm → Giao dịch và tìm dòng reversal/refund liên quan tới request.", "Nếu không thấy sau khi trạng thái được cập nhật, gửi document number và dòng giao dịch cho admin."], expected: "Bạn kiểm tra phần hoàn bằng wallet/ledger thay vì chỉ dựa vào nhãn trạng thái.", help: "Không gửi request mới để bù điểm; admin cần xác minh ledger trước." },
    ],
    imageAlt: "Exchange request history showing status and processing notes",
  }, {
    title: "Track an exchange request", section: "Credits", route: "/credits",
    purpose: "See whether an exchange request is awaiting review, approved, rejected/cancelled, or completed.",
    prerequisites: "Sign in and have at least one exchange request. Its history is under Points → Exchange & requests.",
    steps: [
      "Open Points → Exchange & requests, scroll to My exchange requests, and expand it if collapsed.",
      "Find the document number, point type, amount, and status badge; use Previous/Next for other pages.",
      "Read Value, Payout, Requested/Approved/Completed times, and any approval/completion note or reference.",
      "If status is Pending, the request is waiting for authorized review; do not create a duplicate for the same need.",
      "After Rejected/Cancelled, check Balance and Transactions for a recorded refund. After Completed, read the note/reference to understand what the system recorded as finished.",
    ],
    result: "You can identify the request by document number and see the latest processing step recorded by the system.",
    notes: ["Approved does not necessarily mean Completed; they are separate workflow states.", "The app stores a voucher and its status. Do not treat Completed as proof of an automatic cash transfer unless the program has a payment integration."],
    scenarios: [
      { title: "The request remains Pending", when: "There is no Approved/Rejected/Completed status yet.", steps: ["Reopen My exchange requests and check when it was submitted.", "Check the top-right bell or More → Notifications for an update.", "If it exceeds your organization's expected review time, send its document number to the administrator to check the approval inbox."], expected: "The request remains identifiable and is not duplicated while waiting.", help: "Only an authorized administrator/approver can change its workflow status." },
      { title: "Points did not return after rejection/cancellation", when: "The request is Rejected or Cancelled but the balance has not changed as expected.", steps: ["Refresh Points and verify the correct point type.", "Open More → Transactions and look for a reversal/refund associated with the request.", "If no refund entry appears after the status update, send the document number and transaction history to the administrator."], expected: "You verify the refund in the wallet/ledger rather than relying only on the status label.", help: "Do not submit another request to compensate; an administrator should verify the ledger first." },
    ],
    imageAlt: "Exchange request history with state and processing notes",
  }),

  // screenshot target: Points > Activity feed with All, Received by me, and Given by me choices.
  article("how-recognition-feed", 1260, "wallet", {
    title: "Xem Recognition feed", section: "Credits", route: "/credits",
    purpose: "Xem hoạt động Give Recognition và lọc hoạt động theo phạm vi cần tra cứu.",
    prerequisites: "Đăng nhập; mục Hoạt động hiển thị trong Điểm. Feed có thể trống nếu chương trình chưa có hoạt động.",
    steps: [
      "Mở Điểm → Hoạt động; cuộn xuống Recognition feed và mở mục nếu đang thu gọn.",
      "Chọn All recognition để xem feed chương trình; Received by me để xem điểm bạn nhận; Given by me để xem điểm bạn đã gửi.",
      "Đọc tên member hiển thị, số điểm và unit, message, category và thời gian của từng dòng.",
      "Dùng Previous/Next để xem trang trước/sau; việc đổi filter quay về trang đầu.",
      "Nếu cần kiểm tra chính xác số dư của mình sau hoạt động, mở Transactions vì feed và ledger có mục đích khác nhau.",
    ],
    result: "Feed cho biết bối cảnh ghi nhận, còn Transactions cho biết dòng giao dịch và balance after của ví cá nhân.",
    notes: ["All recognition có thể hiển thị hoạt động của thành viên khác trong chương trình; không giả định đây chỉ là feed cá nhân.", "Allowance đã dùng được hiển thị như điểm đã Give theo giao diện; nó không phải điểm được nhận vào ví."],
    scenarios: [
      { title: "Feed không có dòng", when: "Recognition feed báo chưa có hoạt động.", steps: ["Đổi từ Received/Given sang All recognition.", "Xóa các thao tác lọc bằng cách chọn All và kiểm tra trang đầu.", "Nếu giao dịch vừa gửi đã thành công, kiểm tra Thêm → Giao dịch rồi tải lại Điểm."], expected: "Bạn biết feed hiện không có dữ liệu cho filter được chọn hoặc cần chờ đồng bộ hiển thị.", help: "Nếu giao dịch ledger có nhưng feed không xuất hiện, gửi transaction time cho admin kiểm tra." },
      { title: "Số điểm feed khác số dư", when: "Một hoạt động trong feed có số điểm nhưng wallet balance không giống số đó.", steps: ["Kiểm tra point type/unit và chiều Received/Given của dòng.", "Mở Thêm → Giao dịch để xem giao dịch và balance after.", "Không so sánh tổng hoạt động với số dư hiện tại vì số dư gồm nhiều giao dịch."], expected: "Bạn phân biệt được giá trị một recognition với số dư tích lũy.", help: "Gửi ngày, loại điểm và dòng giao dịch liên quan để admin đối soát." },
    ],
    imageAlt: "Recognition feed với bộ lọc All, Received by me và Given by me",
  }, {
    title: "View the Recognition feed", section: "Credits", route: "/credits",
    purpose: "Review Give Recognition activity and filter it to the scope you need.",
    prerequisites: "Sign in. The Activity feed appears under Points and may be empty if the program has no recognition activity.",
    steps: [
      "Open Points → Activity, scroll to Recognition feed, and expand it if collapsed.",
      "Choose All recognition for the program feed, Received by me for points you received, or Given by me for points you sent.",
      "Read the displayed member name, amount and unit, message, category, and timestamp for each entry.",
      "Use Previous/Next to change pages; selecting a filter returns to its first page.",
      "For your exact balance after an activity, open Transactions because the feed and ledger serve different purposes.",
    ],
    result: "The feed provides recognition context; Transactions provides the personal wallet transaction and balance after it.",
    notes: ["All recognition can include other members' activity in the program; do not assume it is a personal-only feed.", "Used allowance is shown as points given; it is not points received into your wallet."],
    scenarios: [
      { title: "The feed is empty", when: "Recognition feed says there is no activity.", steps: ["Switch from Received/Given to All recognition.", "Clear the scope by selecting All and check its first page.", "If a recent Give succeeded, check More → Transactions and refresh Points."], expected: "You can tell whether the selected filter has no matching activity or the feed needs a refresh.", help: "If a ledger entry exists but the feed does not, send the transaction time to an administrator." },
      { title: "Feed amount differs from balance", when: "An activity has an amount that does not match your current wallet balance.", steps: ["Check the point type/unit and whether the entry is Received or Given.", "Open More → Transactions to inspect the transaction and balance after it.", "Do not compare a single activity amount with the current balance, which reflects many transactions."], expected: "You distinguish one recognition amount from an accumulated wallet balance.", help: "Share the date, point type, and related transaction with the administrator for reconciliation." },
    ],
    imageAlt: "Recognition feed with All, Received by me, and Given by me filters",
  }),

  // screenshot target: Transactions filters in a horizontal strip and rows showing campaign/reward source, amount sign and balance after; no expanded-row state.
  article("how-transaction-filters", 1280, "transactions", {
    title: "Lọc và đọc lịch sử Transactions", section: "Điểm và ví", route: "/transactions",
    purpose: "Tra cứu các lần nhận, sử dụng, Give, exchange, adjustment, expiry hoặc reversal đã ghi vào ledger thành viên.",
    prerequisites: "Đăng nhập; lịch sử chỉ hiện giao dịch của tài khoản hiện tại.",
    steps: [
      "Chọn Thêm → Giao dịch ở thanh điều hướng dưới cùng.",
      "Chọn All hoặc một filter: Earn, Redeem, Adjustment, Received by me, Given by me, Give allowance used, Exchange, Expiry, Reversal.",
      "Đọc từng thẻ: tiêu đề/source (ví dụ tên campaign/reward nếu có), lý do hoặc message, ngày, số điểm có dấu +/−, unit và balance after.",
      "Dùng Previous/Next ở cuối trang khi có nhiều kết quả; đổi filter sẽ quay về trang đầu.",
      "Dùng tên source, ngày và point type để đối chiếu với Trang chủ/Điểm hoặc cung cấp cho quản trị viên khi cần hỗ trợ.",
    ],
    result: "Filter chỉ giới hạn các dòng hiển thị; nó không thay đổi số dư. Các dòng giao dịch là nội dung đọc trực tiếp, không có nút mở rộng.",
    notes: ["Dấu cộng/trừ biểu thị tác động của dòng đó; balance after là số dư sau giao dịch, không phải số điểm của giao dịch.", "Yêu cầu Exchange đang Pending theo dõi tại Điểm → Đổi điểm và yêu cầu → My exchange requests; ledger thể hiện phát sinh điểm."],
    scenarios: [
      { title: "Không tìm thấy giao dịch", when: "Filter hiện danh sách rỗng.", steps: ["Chuyển về All để bỏ điều kiện lọc.", "Kiểm tra các loại gần nghĩa, ví dụ Received by me thay vì Earn nếu là recognition.", "Dùng Previous/Next không thay đổi filter; nếu vừa thao tác hãy tải lại trang."], expected: "Bạn xác định được giao dịch có thể nằm dưới filter khác hoặc chưa được ghi nhận.", help: "Nếu thông báo thành công nhưng All vẫn không có dòng, gửi ngày/giờ và tên thao tác cho admin." },
      { title: "Balance after không giống Home", when: "Số dư cuối dòng khác số dư hiện tại.", steps: ["Kiểm tra ngày giao dịch; balance after là số tại thời điểm dòng được ghi.", "Mở trang cuối/gần nhất hoặc bỏ filter để xem các giao dịch phát sinh sau đó.", "Làm mới Trang chủ/Điểm để xem số dư hiện tại."], expected: "Bạn hiểu đây là ảnh chụp số dư theo thứ tự ledger chứ không phải live balance của hôm nay.", help: "Nếu giao dịch mới nhất vẫn mâu thuẫn với wallet hiện tại, gửi ảnh dòng và ví point type cho admin." },
    ],
    imageAlt: "Transactions filters and ledger rows with signed amount and resulting balance",
  }, {
    title: "Filter and read Transactions", section: "Points and wallets", route: "/transactions",
    purpose: "Look up member-ledger entries for points earned, redeemed, given, exchanged, adjusted, expired, or reversed.",
    prerequisites: "Sign in; the history contains transactions for your own account only.",
    steps: [
      "Select More → Transactions in the bottom navigation.",
      "Choose All or a filter: Earn, Redeem, Adjustment, Received by me, Given by me, Give allowance used, Exchange, Expiry, or Reversal.",
      "Read each card: title/source (such as a campaign/reward name when available), reason/message, date, signed amount (+/−), unit, and balance after.",
      "Use Previous/Next at the bottom when there are more results; choosing a filter returns to its first page.",
      "Use source name, date, and point type to compare with Home/Points or provide context to an administrator.",
    ],
    result: "Filters only limit visible entries; they do not change the balance. Transaction cards display their contents directly and have no expand control.",
    notes: ["The sign shows the effect of that entry; balance after is the wallet balance following it, not the entry amount.", "Track a Pending exchange request under Points → Exchange & requests → My exchange requests; the ledger shows point movements."],
    scenarios: [
      { title: "A transaction is not listed", when: "The selected filter returns no rows.", steps: ["Switch to All to remove the filter.", "Check related categories, for example Received by me instead of Earn for recognition.", "Previous/Next does not change the filter; refresh after a recent action."], expected: "You determine whether the transaction is under another filter or has not been recorded.", help: "If the success notice appeared but All is still empty, send the date/time and action name to an administrator." },
      { title: "Balance after differs from Home", when: "The row's ending balance is different from your current balance.", steps: ["Check the transaction date; balance after is the balance at the time that entry was recorded.", "Open All or the latest history page to look for later transactions.", "Refresh Home/Points to see the current balance."], expected: "You understand that this is a historical ledger balance, not today's live wallet balance.", help: "If the newest entry still conflicts with the wallet, share the row and point type with an administrator." },
    ],
    imageAlt: "Transaction filters and ledger entries with signed amount and resulting balance",
  }),

  // screenshot target: top-right bell and More unread badges, notification read controls, and a project link.
  article("how-notification-read-status", 1300, "notifications", {
    title: "Quản lý thông báo đã đọc và chưa đọc", section: "Tài khoản", route: "/notifications",
    purpose: "Theo dõi thông báo phát sinh và quản lý số chưa đọc hiển thị trên chuông góc trên phải và mục Thêm.",
    prerequisites: "Đăng nhập thành viên; số đỏ chỉ xuất hiện khi tài khoản còn thông báo chưa đọc.",
    steps: [
      "Mở trang bằng chuông góc trên phải hoặc chọn Thêm → Thông báo. Số đỏ là số unread, không phải tổng số thông báo.",
      "Đọc subject, nội dung và thời gian. Bấm vào thẻ thông báo sẽ đánh dấu nó đã đọc; một số thông báo dự án có nút View project để mở project tương ứng.",
      "Dùng Mark as read hoặc Mark as unread trên từng thẻ để đổi trạng thái thủ công.",
      "Khi muốn xử lý tất cả, chọn Mark all as read. Danh sách vẫn còn; chỉ trạng thái đọc và số đếm thay đổi.",
      "Dùng Previous/Next để xem các trang khác; số đếm chuông đại diện cho unread của tài khoản, không chỉ trang đang mở.",
    ],
    result: "Sau khi một unread được đánh dấu đọc, bộ đếm giảm; khi bật unread lại, bộ đếm tăng tương ứng sau khi dữ liệu được làm mới.",
    notes: ["Đánh dấu đã đọc không xóa thông báo.", "Email/SMS/push phụ thuộc kênh và cài đặt tổ chức; thông báo trong ứng dụng được quản lý riêng trên trang này."],
    scenarios: [
      { title: "Đã đọc nhưng số đỏ chưa đổi", when: "Bạn đã chọn Mark as read nhưng số đỏ trên chuông góc trên phải hoặc mục Thêm chưa đổi.", steps: ["Chờ danh sách cập nhật rồi quay lại Thông báo hoặc tải lại trang.", "Kiểm tra đúng thông báo đã mất dấu unread; nếu nhiều trang, các thông báo ở trang khác vẫn có thể chưa đọc.", "So sánh header Unread với badge chuông/Thêm sau khi truy vấn được làm mới."], expected: "Badge chỉ phản ánh các mục unread còn lại; thông báo đã đọc vẫn nằm trong danh sách.", help: "Nếu badge vẫn sai sau refresh, chụp header Unread và hai badge điều hướng để admin đối chiếu unread-count API." },
      { title: "Không có liên kết mở từ thông báo", when: "Thẻ chỉ có subject/body, không có nút View project/Open notification.", steps: ["Đọc subject, nội dung và thời gian; không phải mọi loại thông báo đều có deep link.", "Mở chức năng liên quan từ thanh dưới hoặc mục Thêm, ví dụ Điểm hay Trang chủ.", "Dùng document number/campaign/project name trong thông báo để tìm đúng bản ghi."], expected: "Thông báo được xem như nội dung cập nhật ngay cả khi không có liên kết điều hướng.", help: "Không bấm link lạ ngoài hệ thống; chỉ mở liên kết bạn nhận biết được." },
    ],
    imageAlt: "Unread notification badge and read/unread controls",
  }, {
    title: "Manage read and unread notifications", section: "Account", route: "/notifications",
    purpose: "Review updates and manage unread counts shown on the top-right bell and More menu.",
    prerequisites: "Sign in as a member. The red badge appears only when the account has unread notifications.",
    steps: [
      "Open Notifications from the top-right bell or select More → Notifications. The red number is the unread count, not the total number of notifications.",
      "Read the subject, body, and time. Clicking a notification card marks it read; some project notices include View project to open that project.",
      "Use Mark as read or Mark as unread on an individual card to change its state manually.",
      "To process every unread item, select Mark all as read. The list remains; only read state and count change.",
      "Use Previous/Next to view other pages; the bell count covers the account's unread items, not just the current page.",
    ],
    result: "Marking an unread item as read decreases the count; marking it unread again increases the count after data refreshes.",
    notes: ["Marking a notification read does not delete it.", "Email/SMS/push depend on channel and organization settings; in-app notifications are managed separately here."],
    scenarios: [
      { title: "The badge did not change after reading", when: "You selected Mark as read but the top-right bell or More badge still shows the old count.", steps: ["Wait for the list to update, then return to Notifications or refresh the page.", "Confirm the correct item lost its unread marker; unread items on other pages may remain.", "Compare the Unread header with the bell and More badge after the count query refreshes."], expected: "The badges reflect remaining unread items; read notifications stay in the list.", help: "If they remain incorrect after refresh, capture the Unread header and both navigation badges so an administrator can compare the unread-count API." },
      { title: "A notification has no link", when: "The card contains only a subject/body and no View project/Open notification action.", steps: ["Read its subject, body, and time; not every notification includes a deep link.", "Open the relevant page from the bottom navigation or More, such as Points or Home.", "Use the document number/campaign/project name from the notice to locate the record."], expected: "You can use a notification as an update even when it has no navigation link.", help: "Do not open unfamiliar external links; use links you recognize as part of your organization." },
    ],
    imageAlt: "Unread badge and notification read-state controls",
  }),

  // screenshot target: Projects Invitations tab with an active invitation and Accept/Decline actions; separately show a closed invitation.
  article("how-project-invitation", 1320, "projects", {
    title: "Xem và phản hồi lời mời Project", section: "Projects", route: "/projects",
    purpose: "Quyết định tham gia hay từ chối dự án nhóm được PM mời bạn vào.",
    prerequisites: "Đăng nhập và có lời mời project. Chỉ invitation của project đang Active mới nhận phản hồi.",
    steps: [
      "Mở Projects. Chọn Invitations; dùng Search projects nếu danh sách dài.",
      "Mở project và đọc tên, mô tả, Project manager và thông tin ngày được mời. Ngân sách và phân bổ điểm không hiển thị cho member.",
      "Nếu dự án đang Active và bạn muốn tham gia, chọn Accept invitation; nếu không tham gia, chọn Decline.",
      "Chờ thông báo Your response has been saved rồi kiểm tra tab Active hoặc History để xác nhận vị trí mới của dự án.",
      "Mở chuông góc trên phải hoặc Thêm → Thông báo nếu bạn đi tới project từ một thông báo có View project.",
    ],
    result: "Phản hồi được lưu vào membership; lời mời được chấp nhận chuyển sang Active, từ chối được lưu trong History.",
    notes: ["Không thể chấp nhận invitation khi project đã kết thúc/đóng.", "Việc Accept chỉ xác nhận tham gia; không tự tạo task hay đảm bảo nhận điểm."],
    scenarios: [
      { title: "Invitation đã đóng", when: "Project báo invitation closed hoặc nút Accept/Decline không còn.", steps: ["Kiểm tra trạng thái trong chi tiết project.", "Liên hệ PM để hỏi liệu dự án có thể được mở lại hoặc gửi lời mời mới không."], expected: "Invitation kết thúc không bị hiểu nhầm là lỗi nút.", help: "Thành viên không thể tự mở lại project từ trang này." },
      { title: "Project không xuất hiện", when: "Tab Invitations trống dù bạn nhận được thông báo.", steps: ["Chọn đúng tab Invitations, xóa cụm Search và tải lại danh sách.", "Mở lại từ nút View project trong notification nếu có.", "Nếu vẫn không thấy, gửi tên project/thời gian thông báo cho PM hoặc admin."], expected: "Bạn loại trừ filter tìm kiếm và kiểm tra membership hiện tại.", help: "Nếu membership chưa được tạo hoặc đã xóa, PM/admin cần xác nhận lời mời." },
    ],
    imageAlt: "Project invitation with Accept and Decline actions",
  }, {
    title: "Review and respond to a project invitation", section: "Projects", route: "/projects",
    purpose: "Decide whether to join or decline a group project invitation from a project manager.",
    prerequisites: "Sign in and have a project invitation. Only invitations for Active projects can be answered.",
    steps: [
      "Open Projects and select Invitations. Use Search projects if the list is long.",
      "Open the project and read its name, description, Project manager, and invitation date. Budget and point allocations are not visible to members.",
      "If the project is Active and you want to participate, select Accept invitation; otherwise select Decline.",
      "Wait for Your response has been saved, then check Active or History to confirm where the project moved.",
      "If you opened the project from a notification, use View project on the notice from the top-right bell or More → Notifications when available.",
    ],
    result: "Your response is saved to the membership; an accepted invitation moves to Active and a declined one remains in History.",
    notes: ["An invitation cannot be accepted after its project has ended or closed.", "Accepting confirms participation; it does not create tasks or guarantee a point award."],
    scenarios: [
      { title: "The invitation is closed", when: "The project says the invitation is closed or no Accept/Decline actions are available.", steps: ["Check the project status in its details.", "Ask the project manager whether it can be reopened or a new invitation can be sent."], expected: "An ended invitation is recognized as unavailable rather than a broken button.", help: "A member cannot reopen a project from this page." },
      { title: "The project is missing", when: "Invitations is empty although you received a notice.", steps: ["Choose Invitations, clear Search, and refresh the list.", "Reopen from View project in the notification if that link is available.", "If it is still missing, send the project name and notice time to the PM or administrator."], expected: "You rule out a search filter and check the current membership list.", help: "If the membership was not created or has been removed, the PM/administrator must confirm the invitation." },
    ],
    imageAlt: "Project invitation with Accept and Decline buttons",
  }),

  // screenshot target: Accepted active project with assigned tasks, due date/status selector; completed project showing read-only status.
  article("how-project-tasks-completion", 1340, "projects", {
    title: "Cập nhật task và xem project đã hoàn tất", section: "Projects", route: "/projects",
    purpose: "Theo dõi công việc được giao trong từng dự án đã chấp nhận và biết khi nào dự án chuyển sang chỉ đọc.",
    prerequisites: "Bạn đã Accept invitation và project đang Active. Chỉ task được giao cho bạn mới hiện ở My tasks.",
    steps: [
      "Mở Projects → Active, chọn project cần làm; dùng Search projects nếu cần.",
      "Đọc tên task, mô tả và hạn chót nếu có. Thanh tiến độ thể hiện số task Done trên tổng số task của bạn.",
      "Khi bắt đầu làm, đổi task từ To do sang In progress; khi hoàn thành, đổi sang Done.",
      "Sau mỗi lần đổi trạng thái, chờ thông báo Task status updated và kiểm tra trạng thái mới.",
      "Khi PM đánh dấu project hoàn tất/đóng hoặc luồng issue đã sang trạng thái kết thúc, tìm project trong History; task sẽ ở chế độ read-only.",
    ],
    result: "Tiến độ task của bạn được lưu; project hoàn tất vẫn xem được trong History nhưng không còn cho cập nhật task.",
    notes: ["Thành viên chỉ thấy task được giao cho mình; không thể tự tạo hoặc phân công task từ trang Customer.", "Trạng thái trong menu chỉ đi tới phía trước. Nếu lỡ chọn Done, liên hệ PM để được hướng dẫn thay vì kỳ vọng có nút hoàn tác."],
    scenarios: [
      { title: "Không có task được giao", when: "My tasks trống hoặc báo chưa có task.", steps: ["Xác nhận project nằm trong Active và membership được chấp nhận.", "Kiểm tra xem PM đã phân công task cho tài khoản hiện tại chưa.", "Hỏi PM về task; thành viên không thể tự thêm task ở Customer."], expected: "Danh sách chỉ hiện công việc đã được PM giao cho bạn.", help: "Nếu PM xác nhận giao task nhưng danh sách chưa cập nhật, refresh project rồi báo project name cho admin." },
      { title: "Task hoặc project không còn chỉnh sửa được", when: "Dropdown status biến mất hoặc báo project tasks are read-only after completion.", steps: ["Đọc project status và kiểm tra History.", "Nếu status đã Completed/Closed/Issue pending/Issued, chỉ xem dữ liệu từ trang này.", "Nếu trạng thái hoàn tất do nhầm lẫn, liên hệ PM/admin; member không thể mở khóa task."], expected: "Bạn hiểu trạng thái read-only là do vòng đời project chứ không phải thao tác sai.", help: "Gửi project name và task title cho PM để họ xác nhận bước xử lý tiếp theo." },
    ],
    imageAlt: "Assigned project task status and read-only project after completion",
  }, {
    title: "Update tasks and view completed projects", section: "Projects", route: "/projects",
    purpose: "Track work assigned to you in accepted projects and understand when a project becomes read-only.",
    prerequisites: "You accepted the invitation and the project is Active. My tasks shows only tasks assigned to you.",
    steps: [
      "Open Projects → Active and select the project. Use Search projects if needed.",
      "Read each task title, description, and due date when shown. Progress counts your Done tasks over your assigned tasks.",
      "When you start work, change a task from To do to In progress; when finished, change it to Done.",
      "After each change, wait for Task status updated and confirm its new status.",
      "When the PM completes/closes the project or the issue workflow reaches a terminal state, find it under History; tasks become read-only.",
    ],
    result: "Your task progress is saved; completed projects remain viewable in History but no longer allow task updates.",
    notes: ["Members see only tasks assigned to them and cannot create or assign tasks from Customer.", "The menu only moves statuses forward. If you set Done by mistake, ask the PM what to do rather than expecting an undo control."],
    scenarios: [
      { title: "No tasks are assigned", when: "My tasks is empty or says there are no tasks.", steps: ["Confirm the project is Active and your membership is accepted.", "Check with the PM whether a task has been assigned to your account.", "Ask the PM about the task; members cannot add a task from Customer."], expected: "The list contains only work assigned to you by the PM.", help: "If the PM confirms an assignment but it is missing, refresh the project and tell the administrator its name." },
      { title: "A task or project is no longer editable", when: "The status dropdown is gone or the app says project tasks are read-only after completion.", steps: ["Read the project status and check History.", "If the status is Completed/Closed/Issue pending/Issued, this page is view-only.", "If it was completed by mistake, contact the PM/administrator; members cannot unlock tasks."], expected: "You understand that read-only follows the project lifecycle rather than a failed action.", help: "Give the PM the project name and task title so they can confirm the next step." },
    ],
    imageAlt: "Assigned task statuses and a read-only completed project",
  }),

  // screenshot target: Rewards category chips, wishlist heart and active wishlist view, including an unavailable/out-of-stock example.
  article("how-browse-rewards-wishlist", 1360, "rewards", {
    title: "Duyệt Rewards, lọc danh mục và dùng Wishlist", section: "Rewards", route: "/rewards",
    purpose: "Tìm phần thưởng phù hợp, lưu reward quan tâm và quay lại danh sách yêu thích.",
    prerequisites: "Đăng nhập. Reward chỉ xuất hiện nếu đang active và có thể được member nhìn thấy.",
    steps: [
      "Mở Rewards; dùng các chip category để lọc danh mục hoặc chọn All để bỏ lọc.",
      "Đọc tên, hình ảnh, giá và nhãn Out of stock nếu được hiển thị; chạm vào reward để mở chi tiết.",
      "Chọn biểu tượng trái tim trên reward để thêm/bỏ khỏi wishlist.",
      "Chọn biểu tượng trái tim trên tiêu đề Rewards để bật/tắt chế độ chỉ xem wishlist.",
      "Nếu reward đã bị ẩn hoặc không còn khả dụng, mục đó có thể bị loại khỏi wishlist khi danh sách được tải lại.",
    ],
    result: "Bạn có thể lọc catalog và duyệt những reward đã lưu trên trình duyệt hiện tại.",
    notes: ["Wishlist lưu cục bộ trên trình duyệt; xóa dữ liệu trình duyệt hoặc đổi thiết bị có thể làm danh sách không còn.", "Wishlist chỉ để lưu ý, không giữ tồn kho và không đặt trước reward."],
    scenarios: [
      { title: "Wishlist trống hoặc reward biến mất", when: "Chế độ wishlist không hiện reward bạn đã đánh dấu.", steps: ["Tắt lọc wishlist để xác nhận reward còn trong catalog.", "Kiểm tra reward còn active/không bị ẩn và chọn lại trái tim nếu cần.", "Nếu đã đổi trình duyệt/thiết bị, wishlist cục bộ trước đó có thể không được đồng bộ."], expected: "Bạn biết reward còn khả dụng trong catalog và wishlist không phải dữ liệu tài khoản đồng bộ.", help: "Nếu reward còn active nhưng vẫn không hiện, chụp danh mục và thông báo lỗi để admin kiểm tra." },
      { title: "Reward hết hàng", when: "Thẻ hiện Out of stock hoặc trang chi tiết không cho Redeem.", steps: ["Không gửi lặp thao tác đổi.", "Quay lại danh mục để chọn reward khác hoặc đợi admin cập nhật tồn kho.", "Nếu số dư bị thay đổi dù không có xác nhận đổi thành công, kiểm tra Transactions."], expected: "Bạn tránh nhầm wishlist với đặt trước và không tạo yêu cầu đổi trùng.", help: "Gửi reward name và trạng thái hiển thị cho admin nếu tồn kho có vẻ sai." },
    ],
    imageAlt: "Rewards catalog with categories and wishlist controls",
  }, {
    title: "Browse Rewards, filter categories, and use Wishlist", section: "Rewards", route: "/rewards",
    purpose: "Find an appropriate reward, save items of interest, and return to your favorites.",
    prerequisites: "Sign in. Only active rewards visible to members appear in the catalog.",
    steps: [
      "Open Rewards. Use category chips to filter or select All to clear the category filter.",
      "Read the name, image, price, and any Out of stock label; select a reward to open its details.",
      "Select the heart on a reward card to add/remove it from your wishlist.",
      "Select the heart beside the Rewards heading to toggle wishlist-only mode.",
      "If a reward is hidden or unavailable, it may be removed from the wishlist when the list refreshes.",
    ],
    result: "You can filter the catalog and revisit rewards saved in the current browser.",
    notes: ["Wishlist is stored locally in this browser; clearing browser data or changing devices may remove it.", "A wishlist does not reserve stock or hold a reward for you."],
    scenarios: [
      { title: "The wishlist is empty or a reward disappeared", when: "Wishlist mode does not show an item you previously saved.", steps: ["Turn off wishlist-only mode to confirm the reward remains in the catalog.", "Check whether the reward is still active/visible and select its heart again if appropriate.", "If you changed browser/device, the previous local wishlist may not have synced."], expected: "You know the item is still available in the catalog and that wishlist data is not account-synced.", help: "If the reward is active but missing, capture the catalog and error for an administrator." },
      { title: "A reward is out of stock", when: "The card says Out of stock or its detail page does not allow Redeem.", steps: ["Do not repeatedly submit redemption.", "Return to the catalog to choose another reward or wait for the administrator to update stock.", "If your balance changed without a successful redemption confirmation, check Transactions."], expected: "You do not mistake wishlist for a reservation or create duplicate redemption requests.", help: "Send the reward name and displayed state to the administrator if stock looks incorrect." },
    ],
    imageAlt: "Rewards catalog with category and wishlist controls",
  }),

  // screenshot target: Reward detail with point-type wallet selector, available balance, eligibility/stock, first Redeem action and explicit confirm/cancel.
  article("how-redeem-reward", 1380, "rewards", {
    title: "Đổi một Reward và xác nhận trừ điểm", section: "Rewards", route: "/rewards",
    purpose: "Đổi reward bằng đúng loại ví điểm, sau khi kiểm tra điều kiện, số dư và tồn kho.",
    prerequisites: "Đăng nhập; reward đang khả dụng, bạn đủ điều kiện, còn hàng nếu reward có quản lý stock và có đủ điểm ở ví được chấp nhận.",
    steps: [
      "Trong Rewards, chọn reward để mở trang chi tiết; đọc mô tả, giá và điều kiện.",
      "Ở Pay with wallet, chọn point type được chấp nhận. Dòng Available cho biết số dư có thể dùng trong ví đó.",
      "Kiểm tra trạng thái tồn kho và mọi lý do/điều kiện màu cảnh báo trước khi tiếp tục.",
      "Chọn Redeem để mở bước xác nhận. Đọc lại nội dung rồi chọn Confirm để gửi hoặc Cancel để quay lại mà không gửi.",
      "Sau kết quả thành công, kiểm tra Rewarded trong trang Rewards và Transactions để xác nhận điểm đã dùng.",
    ],
    result: "Một redemption được ghi nhận cho reward và wallet đã chọn; trạng thái fulfillment theo dõi riêng trong Rewarded.",
    notes: ["Khi Confirm, điểm được trừ theo cấu hình redemption; Wishlist không thay thế bước xác nhận.", "Không nhấn Confirm nhiều lần nếu request đang xử lý."],
    scenarios: [
      { title: "Redeem bị khóa", when: "Nút Redeem disabled hoặc trang hiển thị lý do không đủ điều kiện.", steps: ["Kiểm tra ví đã chọn có đủ Available balance không.", "Kiểm tra reward còn stock và account/tier có thỏa điều kiện hiển thị không.", "Nếu reward có nhiều mức giá ví, chọn loại điểm mà bạn có thể sử dụng."], expected: "Nút khả dụng khi reward, wallet, stock và điều kiện thành viên đều hợp lệ.", help: "Nếu số dư/điều kiện đúng nhưng nút vẫn khóa, gửi reward name và ảnh detail cho admin." },
      { title: "Không rõ redemption đã gửi chưa", when: "Trang bị tải lại hoặc mất kết nối ngay sau Confirm.", steps: ["Không Confirm lần nữa ngay.", "Mở Rewards → Rewarded và Transactions để tìm kết quả mới nhất.", "Nếu chưa thấy sau khi tải lại, gửi thời gian và reward name cho admin kiểm tra redemption."], expected: "Bạn tránh đổi trùng khi kết quả request đầu tiên chưa rõ.", help: "Chỉ admin mới xác minh được giao dịch nếu trình duyệt mất phản hồi." },
    ],
    imageAlt: "Reward detail, wallet selection, and redemption confirmation",
  }, {
    title: "Redeem a reward and confirm the points", section: "Rewards", route: "/rewards",
    purpose: "Redeem a reward from the correct point wallet after checking eligibility, balance, and stock.",
    prerequisites: "Sign in; the reward is available, you are eligible, it is in stock if stock is managed, and the accepted wallet has enough points.",
    steps: [
      "In Rewards, select a reward to open its detail page; read its description, price, and conditions.",
      "Under Pay with wallet, choose an accepted point type. Available shows the spendable balance in that wallet.",
      "Check stock and any warning/reason shown before continuing.",
      "Select Redeem to open the confirmation step. Review it, then select Confirm to submit or Cancel to return without submitting.",
      "After success, check Rewarded in Rewards and Transactions to confirm the points used.",
    ],
    result: "A redemption is recorded for the selected reward and wallet; fulfillment is tracked separately under Rewarded.",
    notes: ["Confirm deducts points according to the redemption settings; Wishlist does not replace confirmation.", "Do not select Confirm repeatedly while a request is processing."],
    scenarios: [
      { title: "Redeem is locked", when: "The Redeem button is disabled or the page shows an eligibility reason.", steps: ["Check that the selected wallet has enough Available balance.", "Check reward stock and any account/tier conditions.", "If several wallet prices are listed, choose a point type you can use."], expected: "The action is available when reward, wallet, stock, and member conditions are valid.", help: "If the balance and eligibility look correct but the button remains disabled, send the reward name and detail screenshot to an administrator." },
      { title: "You are not sure whether redemption was submitted", when: "The page reloads or connection drops immediately after Confirm.", steps: ["Do not confirm again immediately.", "Open Rewards → Rewarded and Transactions to find the latest result.", "If it is still missing after refresh, send the time and reward name to an administrator to check the redemption."], expected: "You avoid duplicate redemption while the first result is unknown.", help: "An administrator can verify the transaction if the browser lost its response." },
    ],
    imageAlt: "Reward details, wallet selector, and confirmation before redemption",
  }),

  // screenshot target: Rewards > Rewarded expanded with reward name, points spent, timestamp, and PENDING/FULFILLED/CANCELLED examples.
  article("how-rewarded-fulfillment", 1400, "rewards", {
    title: "Theo dõi Rewarded và trạng thái fulfillment", section: "Rewards", route: "/rewards",
    purpose: "Xem lại reward đã redeem, điểm đã dùng và biết bộ phận phụ trách đã ghi nhận fulfillment tới đâu.",
    prerequisites: "Đăng nhập; đã có redemption hoặc muốn xác nhận Rewards history hiện đang trống.",
    steps: [
      "Mở Rewards và cuộn tới mục Rewarded; mở phần này nếu đang thu gọn.",
      "Đọc reward name, points spent, loại điểm và thời điểm redeemed.",
      "Đọc fulfillment status: Pending nghĩa là còn chờ xử lý; Fulfilled nghĩa là hệ thống đã ghi hoàn tất; Cancelled nghĩa là redemption đã bị hủy theo luồng quản trị.",
      "Dùng Previous/Next trong Rewarded để xem lịch sử ở trang khác.",
      "Nếu cần đối chiếu việc trừ điểm, mở Transactions và tìm reward name/loại điểm tương ứng.",
    ],
    result: "Bạn phân biệt được redemption đã tạo với fulfillment đã hoàn tất; nếu cần giao/hoàn tất ngoài app, status do tổ chức cập nhật.",
    notes: ["Pending không đảm bảo thời gian giao cụ thể; liên hệ người phụ trách reward nếu cần ETA.", "Không tạo redemption thứ hai chỉ vì fulfillment còn Pending."],
    scenarios: [
      { title: "Rewarded không có bản ghi", when: "Mục Rewarded báo chưa có phần thưởng đã đổi.", steps: ["Xác nhận redemption đã được xác nhận thành công chứ không chỉ mới thêm Wishlist.", "Refresh Rewards và kiểm tra các trang lịch sử.", "Nếu có giao dịch trừ điểm trong Transactions nhưng Rewarded trống, gửi thời gian/reward name cho admin."], expected: "Wishlist, request chưa gửi và redemption đã tạo được phân biệt rõ.", help: "Admin cần kiểm tra redemption record và fulfillment history." },
      { title: "Fulfillment đang Pending lâu", when: "Redemption có status Pending và chưa có ghi chú giao hàng.", steps: ["Ghi lại reward name, redeemed time và status.", "Đọc Notifications xem có hướng dẫn tiếp nhận không.", "Liên hệ admin/người phụ trách fulfillment; đừng gửi lại redemption."], expected: "Bạn theo dõi đúng redemption đang chờ xử lý.", help: "Customer không thể tự đổi fulfillment status." },
    ],
    imageAlt: "Rewarded history with fulfillment status and redeemed details",
  }, {
    title: "Track Rewarded and fulfillment status", section: "Rewards", route: "/rewards",
    purpose: "Review redeemed rewards, points spent, and the fulfillment progress recorded by the responsible team.",
    prerequisites: "Sign in; have a redemption or want to confirm that the Rewards history is currently empty.",
    steps: [
      "Open Rewards, scroll to Rewarded, and expand it if collapsed.",
      "Read the reward name, points spent, point type, and redemption time.",
      "Read fulfillment status: Pending means processing is still waiting; Fulfilled means completion was recorded; Cancelled means the redemption was cancelled through the admin workflow.",
      "Use Previous/Next in Rewarded to view other history pages.",
      "To reconcile the point deduction, open Transactions and find the matching reward name/point type.",
    ],
    result: "You can distinguish a created redemption from completed fulfillment; any off-app delivery/completion must be recorded by the organization.",
    notes: ["Pending does not promise a delivery time; contact the reward owner if you need an ETA.", "Do not create another redemption just because fulfillment is still Pending."],
    scenarios: [
      { title: "Rewarded has no record", when: "Rewarded says there are no redeemed rewards.", steps: ["Confirm the redemption was successfully confirmed and was not only added to Wishlist.", "Refresh Rewards and check other history pages.", "If Transactions shows a point deduction but Rewarded is empty, send the time/reward name to the administrator."], expected: "Wishlist, an unsubmitted request, and a created redemption are clearly distinguished.", help: "An administrator must check the redemption record and fulfillment history." },
      { title: "Fulfillment remains Pending", when: "A redemption is Pending and has no delivery note.", steps: ["Record the reward name, redeemed time, and status.", "Read Notifications for any pickup/delivery instructions.", "Contact the administrator/reward owner; do not submit the redemption again."], expected: "You follow up on the correct pending redemption.", help: "Members cannot change fulfillment status themselves." },
    ],
    imageAlt: "Rewarded history with fulfillment states and redemption details",
  }),

  // screenshot target: Badges All/Unlocked/Locked filters with one locked progress bar and one unlocked date.
  article("how-badges-progress", 1420, "badges", {
    title: "Xem Badges và tiến độ thành tích", section: "Thành tích", route: "/badges",
    purpose: "Theo dõi badge đã đạt, badge đang khóa và tiến độ điều kiện hiển thị.",
    prerequisites: "Đăng nhập; chương trình cần có badge để danh sách có mục hiển thị.",
    steps: [
      "Chọn Thêm → Huy hiệu; đọc số badge đã mở khóa trên tổng số badge.",
      "Chọn All, Unlocked hoặc Locked để lọc danh sách.",
      "Với badge Locked có progress bar, đọc currentValue/targetValue; giá trị này mô tả điều kiện mà hệ thống có thể đo được.",
      "Với badge Unlocked, đọc ngày mở khóa nếu được hiển thị.",
      "Hoàn thành hoạt động liên quan rồi tải lại Badges nếu bạn muốn xem tiến độ mới.",
    ],
    result: "Badges cho biết trạng thái đạt/chưa đạt; badge là thành tích riêng và không mặc định cộng điểm.",
    notes: ["Một số badge có thể do admin cấp thủ công nên không có progress bar để tự theo dõi.", "Sự kiện vừa phát sinh có thể chỉ cập nhật badge sau khi hệ thống xử lý xong."],
    scenarios: [
      { title: "Badge chưa mở khóa không có tiến độ", when: "Một badge Locked chỉ hiện biểu tượng/ tên mà không có current/target.", steps: ["Mở mô tả/điều kiện badge nếu có trên màn hình.", "Nếu không có điều kiện hoặc thời điểm cập nhật, hỏi admin xem badge này được cấp thủ công hay tự động."], expected: "Bạn không nhầm badge thủ công với một bộ đếm tự động.", help: "Gửi badge name cho admin để họ hướng dẫn điều kiện; không suy đoán bằng cách tạo giao dịch thử." },
      { title: "Badge chưa cập nhật sau sự kiện", when: "Bạn vừa hoàn tất hoạt động nhưng badge vẫn Locked.", steps: ["Kiểm tra sự kiện đã được ghi nhận trong Thêm → Giao dịch hoặc trang tính năng liên quan.", "Tải lại Huy hiệu sau khi giao dịch hoàn thành.", "Nếu sự kiện đã ghi nhận nhưng badge chưa đổi, gửi badge name và thời gian hoạt động cho admin."], expected: "Bạn xác nhận nguồn hoạt động trước khi yêu cầu kiểm tra badge rule.", help: "Chỉ admin có thể xác minh rule/cập nhật badge trong chương trình." },
    ],
    imageAlt: "Badges filters with progress and unlocked date",
  }, {
    title: "View badges and achievement progress", section: "Achievements", route: "/badges",
    purpose: "Track unlocked badges, locked badges, and any visible progress toward their conditions.",
    prerequisites: "Sign in; the program must have badges for the list to contain entries.",
    steps: [
      "Select More → Badges and read the unlocked count out of the total.",
      "Select All, Unlocked, or Locked to filter the list.",
      "For a Locked badge with a progress bar, read currentValue/targetValue; this describes a condition the system can measure.",
      "For an Unlocked badge, read its unlock date if shown.",
      "Complete the related activity and refresh Badges when you want to check for new progress.",
    ],
    result: "Badges show achievement state; a badge is separate from points and does not automatically award them.",
    notes: ["Some badges may be granted manually by an administrator and therefore have no self-service progress bar.", "A recent event may update a badge only after the system processes it."],
    scenarios: [
      { title: "A locked badge has no progress", when: "A Locked badge shows only an icon/name without current/target values.", steps: ["Read the badge description/condition if one is shown.", "If no condition or update timing is visible, ask the administrator whether it is manually granted or automatic."], expected: "You do not mistake a manual badge for an automatic counter.", help: "Send the badge name to the administrator for its conditions; do not create a test transaction to guess." },
      { title: "A badge did not update after an event", when: "You completed an activity but the badge remains Locked.", steps: ["Confirm the event was recorded in More → Transactions or its related feature.", "Refresh Badges after the transaction completes.", "If the activity is recorded but the badge is unchanged, send its name and activity time to an administrator."], expected: "You confirm the activity source before asking for a badge-rule check.", help: "Only an administrator can verify program rules or update badge configuration." },
    ],
    imageAlt: "Badge filters with progress and an unlocked date",
  }),

  // screenshot target: Profile read-only data, Edit profile fields including custom DATE/SELECT, image file selection and preview/save.
  article("how-edit-profile-photo", 1440, "profile", {
    title: "Sửa thông tin hồ sơ và tải ảnh đại diện", section: "Tài khoản", route: "/profile",
    purpose: "Cập nhật các trường hồ sơ được phép, trường tùy chỉnh và ảnh đại diện của bạn.",
    prerequisites: "Đăng nhập. Chỉ các trường do chương trình cho phép sửa mới có thể thay đổi; một số trường custom do admin cấu hình.",
    steps: [
      "Chọn Thêm → Hồ sơ và xem thông tin hiện tại. Một số trường rỗng có thể không hiện ở chế độ xem.",
      "Chọn Edit profile để mở form; nhập First name, Last name, Department và các trường thành viên tùy chỉnh được cấp.",
      "Chọn loại dữ liệu tương ứng: date picker cho trường DATE, danh sách cho SELECT, checkbox cho BOOLEAN hoặc ô nhập cho text/number.",
      "Ở Profile photo, chọn tệp ảnh từ thiết bị. Kiểm tra preview trước khi lưu; ứng dụng xử lý ảnh rồi hiển thị trong form.",
      "Chọn Save để lưu và chờ hồ sơ tải lại; chọn Cancel để bỏ các thay đổi chưa lưu.",
    ],
    result: "Hồ sơ hiển thị các giá trị đã được lưu; trường bổ sung có thể chỉ hiện khi có giá trị hoặc đang ở chế độ Edit.",
    notes: ["Email đăng nhập/member ID có thể chỉ đọc và do tổ chức quản lý.", "Chọn ảnh bạn có quyền sử dụng. Nếu file không phải ảnh hợp lệ hoặc không đọc được, hãy chọn ảnh khác."],
    scenarios: [
      { title: "Không thấy trường sinh nhật/phòng ban hoặc trường khác", when: "Trường không hiện ở chế độ xem hoặc không có trong form Edit.", steps: ["Chọn Edit profile vì trường rỗng có thể bị ẩn khỏi phần xem.", "Nếu trường vẫn không có trong form, hỏi admin xem Member field đã tạo và được cho phép cập nhật chưa.", "Không tự tạo dữ liệu bằng cách dùng một trường có ý nghĩa khác."], expected: "Trường chỉ hiện ở nơi phù hợp với cấu hình và trạng thái có dữ liệu.", help: "Gửi tên field mong muốn và ảnh form Edit cho admin kiểm tra cấu hình member fields." },
      { title: "Ảnh không tải hoặc không được lưu", when: "Preview không xuất hiện hoặc sau Save ảnh cũ vẫn còn.", steps: ["Chọn tệp ảnh hợp lệ từ thiết bị và chờ preview hoàn tất.", "Nếu hiện lỗi, thử ảnh khác rồi chọn Save một lần.", "Sau khi lưu, tải lại Profile để xác nhận ảnh mới đã được tải từ server."], expected: "Ảnh hợp lệ được lưu trong hồ sơ; ảnh hỏng không thay đổi dữ liệu hiện tại.", help: "Nếu vẫn lỗi, gửi loại file/kích thước và thời gian thử để admin kiểm tra; không gửi ảnh riêng tư qua kênh không được phép." },
    ],
    imageAlt: "Profile editor with custom fields and profile-photo preview",
  }, {
    title: "Edit profile details and upload a photo", section: "Account", route: "/profile",
    purpose: "Update editable profile fields, custom member fields, and your profile photo.",
    prerequisites: "Sign in. Only fields the program allows members to edit can be changed; custom fields are configured by the administrator.",
    steps: [
      "Select More → Profile and review your current information. Some blank fields may be hidden in view mode.",
      "Select Edit profile to open the form; enter First name, Last name, Department, and any available custom fields.",
      "Use the matching input: a date picker for DATE, list for SELECT, checkbox for BOOLEAN, or text/number input.",
      "Under Profile photo, choose an image from your device. Check the preview before saving; the app processes the image and shows it in the form.",
      "Select Save and wait for the profile to reload; select Cancel to discard unsaved edits.",
    ],
    result: "The profile shows saved values; additional fields may appear only when populated or while editing.",
    notes: ["Login email/member ID may be read-only and managed by your organization.", "Choose an image you have permission to use. If a file is not a readable image, choose another one."],
    scenarios: [
      { title: "A birthday/department/custom field is missing", when: "A field is absent in view mode or does not appear in Edit.", steps: ["Select Edit profile because a blank value may be hidden in view mode.", "If the field is still absent from the form, ask the administrator whether the Member field exists and is editable by members.", "Do not put the value into a different field with another meaning."], expected: "A field appears only where its configuration and value allow it.", help: "Send the intended field name and a screenshot of Edit to the administrator to check member-field settings." },
      { title: "The photo does not upload or save", when: "No preview appears or the old photo remains after Save.", steps: ["Choose a supported image file and wait for the preview.", "If an error appears, try another image and select Save once.", "After saving, reload Profile to confirm the new image was fetched from the server."], expected: "A valid photo is saved; an unreadable image does not replace the current profile data.", help: "If it still fails, share the file type/size and attempt time with an administrator; do not send a private photo over an unauthorized channel." },
    ],
    imageAlt: "Profile editor with custom fields and photo preview",
  }),

  // screenshot target: Profile preferences with locale selector, light/dark/auto choices and each notification channel toggle.
  article("how-personal-settings", 1460, "profile", {
    title: "Đổi ngôn ngữ, giao diện và kênh thông báo", section: "Tài khoản", route: "/profile",
    purpose: "Cá nhân hóa ngôn ngữ/giao diện và chọn kênh bên ngoài mà bạn muốn nhận thông báo nếu chương trình hỗ trợ.",
    prerequisites: "Ngôn ngữ và theme có thể chỉnh trên Profile; tùy chọn kênh thông báo cần đăng nhập.",
    steps: [
      "Chọn Thêm → Hồ sơ và cuộn tới Preferences.",
      "Ở Language, chọn English hoặc Tiếng Việt. Giao diện đổi theo lựa chọn; nếu trang chưa đổi hoàn toàn, tải lại sau khi lưu cài đặt.",
      "Ở Theme, chọn Light, Dark hoặc Auto để đổi cách hiển thị trên trình duyệt hiện tại.",
      "Nếu đã đăng nhập, tìm Notification preferences và bật/tắt các kênh Email, SMS, Push hoặc In-app đang được cung cấp.",
      "Đợi trạng thái switch phản hồi rồi rời và quay lại Profile để kiểm tra cài đặt đã được tải lại.",
    ],
    result: "Giao diện hiển thị theo locale/theme đã chọn; kênh opted-in lưu lựa chọn nhận thông báo tương ứng.",
    notes: ["Tắt Email/SMS/Push không đồng nghĩa xóa thông báo trong app; quản lý đã đọc riêng ở Notifications.", "Một kênh có thể không được gửi nếu tổ chức chưa tích hợp/cấu hình kênh đó."],
    scenarios: [
      { title: "Không có Notification preferences", when: "Các công tắc kênh không xuất hiện.", steps: ["Xác nhận đang đăng nhập và Profile đã tải xong.", "Nếu vẫn vắng, hỏi admin xem cài đặt preference/kênh đã được bật cho chương trình chưa."], expected: "Chỉ cài đặt có sẵn cho thành viên mới hiện công tắc.", help: "Không có công tắc không chứng minh một thông báo in-app chưa được tạo; kiểm tra trang Notifications." },
      { title: "Ngôn ngữ hoặc theme quay lại", when: "Sau điều hướng, giao diện không giống lựa chọn vừa chọn.", steps: ["Mở lại Profile để đọc giá trị hiện tại.", "Chọn lại locale/theme và chờ trang cập nhật.", "Nếu theme vẫn cũ trên thiết bị, tải lại trang; nếu locale không lưu, báo admin/support."], expected: "Bạn xác nhận setting hiện tại thay vì dựa vào nhãn vừa bấm.", help: "Gửi loại trình duyệt, lựa chọn và ảnh trước/sau cho support; không cần gửi thông tin đăng nhập." },
    ],
    imageAlt: "Profile language, theme, and notification channel preferences",
  }, {
    title: "Change language, theme, and notification channels", section: "Account", route: "/profile",
    purpose: "Personalize language/theme and choose external notification channels you want to receive when supported by the program.",
    prerequisites: "Language and theme are available in Profile; notification-channel preferences require sign-in.",
    steps: [
      "Select More → Profile and scroll to Preferences.",
      "Under Language, select English or Tiếng Việt. The interface changes to that locale; if a page does not fully update, reload after the setting is applied.",
      "Under Theme, select Light, Dark, or Auto for the current browser display.",
      "When signed in, find Notification preferences and toggle the available Email, SMS, Push, or In-app channels.",
      "Wait for the switch to respond, then leave and reopen Profile to confirm the preference reloads.",
    ],
    result: "The interface uses the selected locale/theme; opted-in channels store your preference for those notification methods.",
    notes: ["Turning off Email/SMS/Push does not delete in-app notifications; manage read status separately in Notifications.", "A channel may not send messages if the organization has not integrated/configured it."],
    scenarios: [
      { title: "Notification preferences are missing", when: "The channel toggles are not displayed.", steps: ["Confirm you are signed in and Profile finished loading.", "If still absent, ask the administrator whether preferences/channels are enabled for the program."], expected: "Only settings available to members show a toggle.", help: "Missing toggles do not prove an in-app notification was not created; check Notifications." },
      { title: "Language or theme reverted", when: "After navigation, the interface does not match your previous selection.", steps: ["Reopen Profile and check the current setting.", "Select the locale/theme again and wait for the page to update.", "If theme still looks old on the device, reload. If locale does not persist, contact support."], expected: "You confirm the active setting instead of relying on the label you last clicked.", help: "Share browser type, setting, and before/after screenshots with support; never send sign-in credentials." },
    ],
    imageAlt: "Profile language, theme, and notification preference controls",
  }),

  // screenshot target: Profile's Export my data action and a sanitized download result; do not capture actual personal data.
  article("how-export-member-data", 1480, "profile", {
    title: "Yêu cầu xuất bản sao dữ liệu cá nhân", section: "Tài khoản", route: "/profile",
    purpose: "Tạo yêu cầu tải bản sao dữ liệu liên quan tới tài khoản thành viên của bạn.",
    prerequisites: "Đăng nhập đúng tài khoản cần xuất; trình duyệt cần cho phép mở/tải file nếu hệ thống trả về liên kết tải.",
    steps: [
      "Chọn Thêm → Hồ sơ bằng tài khoản của chính bạn.",
      "Chọn Export my data và chờ trạng thái xử lý hoàn tất.",
      "Nếu trình duyệt mở tab mới hoặc bắt đầu tải file, chỉ lưu file ở thiết bị/tài khoản lưu trữ được tổ chức cho phép.",
      "Không gửi file chứa dữ liệu cá nhân vào nhóm chat công khai; chỉ chia sẻ theo quy trình bảo mật của tổ chức.",
      "Nếu không có file/link, ghi lại thời điểm và thông báo hiển thị rồi liên hệ quản trị viên/support.",
    ],
    result: "Ứng dụng trả về một liên kết/file xuất nếu yêu cầu được xử lý; đây là bản sao dữ liệu, không chỉnh sửa hồ sơ hiện tại.",
    notes: ["Chỉ export dữ liệu của tài khoản đã đăng nhập.", "Nếu cửa sổ bật lên bị chặn, cho phép pop-up cho website tin cậy rồi yêu cầu export lại khi chưa có kết quả trước đó."],
    scenarios: [
      { title: "Nút đang xử lý nhưng không thấy file", when: "Export my data quay hoặc không có tab/download mới.", steps: ["Kiểm tra danh sách tải xuống và tab mới của trình duyệt.", "Kiểm tra pop-up/download có bị trình duyệt chặn không.", "Nếu vẫn không có kết quả, không bấm liên tục; gửi thời gian yêu cầu cho support."], expected: "Bạn xác nhận file/link đã được trình duyệt nhận trước khi tạo yêu cầu khác.", help: "Admin/support có thể kiểm tra trạng thái GDPR export; không gửi nội dung file trừ khi được yêu cầu qua kênh bảo mật." },
      { title: "Bạn đang đăng nhập nhầm tài khoản", when: "Cần xuất dữ liệu cho account khác.", steps: ["Dừng trước khi chọn Export my data.", "Đăng xuất tài khoản hiện tại rồi đăng nhập đúng thành viên.", "Xác nhận email/member ID trên Profile trước khi tạo export."], expected: "Bản xuất gắn với đúng member account.", help: "Không dùng tài khoản admin để lấy bản export cá nhân của member khác." },
    ],
    imageAlt: "Export my data action on a member Profile",
  }, {
    title: "Request a copy of your member data", section: "Account", route: "/profile",
    purpose: "Request a downloadable copy of the data associated with your member account.",
    prerequisites: "Sign in to the account whose data you want to export. The browser must allow a download/new tab if the app returns a download link.",
    steps: [
      "Select More → Profile while signed in to your own account.",
      "Select Export my data and wait for processing to finish.",
      "If the browser opens a tab or downloads a file, store it only on a device/storage location approved by your organization.",
      "Do not share a file containing personal data in a public chat; use your organization's secure process.",
      "If there is no file/link, record the time and displayed message and contact an administrator/support.",
    ],
    result: "The app returns a download link/file if the request succeeds; it is a copy and does not edit your profile.",
    notes: ["Only data for the signed-in account is exported.", "If a pop-up is blocked, allow pop-ups for the trusted site and retry only when no previous result is available."],
    scenarios: [
      { title: "The button processed but no file appeared", when: "Export my data spins or no new tab/download appears.", steps: ["Check browser downloads and new tabs.", "Check whether the browser blocked a pop-up/download.", "If there is still no result, avoid repeated clicks and send the request time to support."], expected: "You check whether the browser received the file/link before making another request.", help: "An administrator/support agent can check GDPR export status; do not send the file contents unless asked through a secure channel." },
      { title: "You are signed in to the wrong account", when: "You need to export data for another account.", steps: ["Stop before selecting Export my data.", "Log out and sign in as the correct member.", "Confirm the email/member ID on Profile before requesting the export."], expected: "The export is associated with the intended member account.", help: "Do not use an administrator account to export another member's personal data." },
    ],
    imageAlt: "Export my data action on member Profile",
  }),
];
