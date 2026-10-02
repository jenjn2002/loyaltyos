import type { GuideArticle, GuideLocaleContent, GuideScenario } from "./document-types";

type LocaleDraft = GuideLocaleContent;

function article(
  slug: string,
  sortOrder: number,
  imageKey: string,
  vi: LocaleDraft,
  en: LocaleDraft,
): GuideArticle {
  return {
    id: "admin-" + slug,
    audience: "ADMIN",
    slug,
    status: "PUBLISHED",
    sortOrder,
    imageKey,
    imageData: null,
    content: { vi, en },
  };
}

/**
 * Focused Admin procedures intended to supplement, not replace, the existing
 * overview articles. Screenshot targets are comments for the capture/upload
 * pass; imageData remains null until an actual UI screenshot is uploaded.
 */
export const expandedAdminGuideArticles: GuideArticle[] = [
  // screenshot target: /campaigns/new, Occasion step with a trigger event and Standing campaign policy.
  article("how-campaign-standing", 1100, "campaign",
    {
      title: "Tạo campaign thường lệ (Standing)", section: "Campaigns", route: "/campaigns/new",
      purpose: "Tạo chương trình cấp điểm cho dịp thường lệ đã được cấu hình, như onboarding hoặc ngày kỷ niệm.",
      prerequisites: "Cần quyền campaign.manage; point type phải active và event cần dùng phải được tạo, active. Hãy kiểm tra segment trước nếu không muốn áp dụng cho toàn bộ member.",
      steps: [
        "Mở Campaigns → Create campaign. Ở Occasion, nhập tên campaign và chọn trigger event đang active.",
        "Trong Campaign policy, chọn Standing campaign.",
        "Ở Recipients, chọn segment nếu cần và chọn Automatic issue để tự cấp điểm hoặc Member claim để member tự nhận.",
        "Ở Reward, chọn point type active, nhập số điểm thưởng và cấu hình giới hạn mỗi member/stacking nếu cần.",
        "Để Max Budget trống nếu muốn không giới hạn; ở Schedule, giữ lịch tự động hoặc chọn Specific date và ngày kết thúc nếu cần.",
        "Ở Review, chọn Calculate Estimate để xem số member/điểm dự kiến; bấm Recalculate sau khi sửa audience hoặc award.",
        "Chọn Save as draft nếu chưa sẵn sàng; nếu tạo ngay, chọn Create Campaign. Sau đó activate campaign trong danh sách khi muốn bắt đầu.",
      ],
      result: "Campaign lưu với chính sách Standing. Khi event tương ứng phát sinh và campaign đang active, hệ thống cấp điểm hoặc tạo claim theo chế độ đã chọn.",
      notes: ["Standing chỉ dành cho dịp được xem là thường lệ; event đặc biệt ngoài danh sách nên dùng Approval required.", "Campaign nháp hoặc chưa active chưa phát điểm.", "Point type đã hết hạn hoặc bị archive có thể không dùng được cho campaign mới."],
      scenarios: [
        { title: "Không thấy event cần chọn", when: "Event không hiện trong Trigger event.", steps: ["Mở Event definitions và kiểm tra event đã lưu và Active chưa.", "Kiểm tra lại kiểu event; event external chỉ dùng khi hệ thống tích hợp gửi event."], expected: "Event active xuất hiện để chọn sau khi tải lại builder.", help: "Nếu event vừa được tạo, tải lại trang Campaign builder; nếu vẫn thiếu, kiểm tra event có bị inactive hoặc trùng key không." },
        { title: "Audience impact bằng 0", when: "Campaign không tìm được member đủ điều kiện.", steps: ["Mở segment và xem danh sách member đang khớp.", "Kiểm tra status, ngày hiệu lực và điều kiện event của audience."], expected: "Ước lượng phản ánh đúng nhóm member dự kiến trước khi activate." },
      ],
      imageAlt: "Bước Occasion hiển thị trigger event và chính sách Standing campaign.",
    },
    {
      title: "Create a standing campaign", section: "Campaigns", route: "/campaigns/new",
      purpose: "Create a point award for a configured recurring occasion such as onboarding or a member anniversary.",
      prerequisites: "You need campaign.manage. The point type must be active and the event must already exist and be active. Review the segment first if the award should not target every member.",
      steps: [
        "Open Campaigns → Create campaign. On Occasion, enter the campaign name and choose an active trigger event.",
        "Under Campaign policy, select Standing campaign.",
        "On Recipients, select a segment if needed and choose Automatic issue or Member claim.",
        "On Reward, select an active point type, enter the award, and configure per-member limits and stacking if needed.",
        "Leave Max Budget blank for no limit. On Schedule, keep the automatic schedule or choose Specific date and an optional end date.",
        "On Review, select Calculate Estimate to see projected members/points; select Recalculate after changing the audience or award.",
        "Select Save as draft if not ready, or Create Campaign to create it now. Then activate it from the campaign list when it should begin.",
      ],
      result: "The campaign is saved as Standing. When its event occurs while the campaign is active, LoyaltyOS issues points or creates claims according to the selected delivery mode.",
      notes: ["Use Standing only for regular occasions; unusual company events should use Approval required.", "A draft or inactive campaign does not issue points.", "An expired or archived point type may not be available for a new campaign."],
      scenarios: [
        { title: "The event is missing", when: "The desired event is not listed under Trigger event.", steps: ["Open Event definitions and confirm the event is saved and Active.", "Check its occurrence type; an external event also requires an integration to report it."], expected: "The active event appears after reopening or refreshing the builder.", help: "If it remains missing, check that it is not inactive and that its key is unique." },
        { title: "Estimated audience is zero", when: "No members currently match the campaign audience.", steps: ["Open the segment and inspect its matching members.", "Check member status, campaign dates, and event eligibility."], expected: "The estimate reflects the intended audience before activation." },
      ],
      imageAlt: "Occasion step showing the trigger event and Standing campaign policy.",
    }),

  // screenshot target: /campaigns/new, Approval required policy and justification field.
  article("how-campaign-approval", 1110, "campaign",
    {
      title: "Tạo campaign cần phê duyệt", section: "Campaigns và approvals", route: "/campaigns/new",
      purpose: "Dùng cho campaign ngoại lệ, chẳng hạn chiến dịch đặc biệt hoặc ngày công ty không nằm trong dịp thường lệ.",
      prerequisites: "Cần campaign.manage và workflow Campaign issuance proposal đang active với approver hợp lệ. Hãy có event, point type và audience trước khi gửi.",
      steps: [
        "Tạo campaign. Ở Occasion, nhập tên và chọn event dành cho dịp ngoại lệ; trong Campaign policy, chọn Approval required.",
        "Điền Justification cụ thể trong Campaign policy: mục đích, nhóm nhận và lý do cần cấp điểm.",
        "Ở Recipients, chọn segment/audience nếu cần và chế độ Automatic issue hoặc Member claim.",
        "Ở Reward, chọn point type active, nhập award, giới hạn mỗi member, budget và stacking nếu cần; để budget trống nếu unlimited.",
        "Ở Schedule, giữ Run automatically after approval hoặc chọn Specific date và ngày kết thúc nếu cần.",
        "Ở Review, dùng Calculate Estimate/Recalculate để cập nhật số member và điểm dự kiến sau lần chỉnh cuối.",
        "Chọn Save as draft để lưu nháp hoặc Submit for approval để gửi yêu cầu; chỉ nút thứ hai tạo approval request.",
        "Theo dõi trạng thái trong Approval inbox. Sau khi được duyệt, kiểm tra trạng thái campaign và activate nếu đang chờ kích hoạt.",
        "Nếu bị từ chối, đọc comment, sửa campaign và gửi lại; chỉnh sửa campaign đã duyệt cũng cần approval mới.",
      ],
      result: "Campaign có trạng thái chờ duyệt cho đến khi approver ra quyết định; sau khi duyệt, campaign mới có thể được kích hoạt và chạy.",
      notes: ["Approval campaign là duyệt cấu hình/chương trình; khác với request issue điểm cho một member.", "Không gửi justification chung chung như ‘bonus’; cần nội dung giúp approver đánh giá được mục đích.", "Kết quả duyệt không đồng nghĩa member đã nhận điểm; dùng bài theo dõi issuance để kiểm tra."],
      scenarios: [
        { title: "Không gửi được request", when: "Submit báo workflow chưa cấu hình hoặc không tìm thấy approver.", steps: ["Mở Workflows và tạo/activate workflow cho Campaign issuance proposal.", "Gán approver active hoặc role có thành viên active rồi gửi lại."], expected: "Campaign chuyển sang trạng thái chờ xử lý trong Approval inbox.", help: "Yêu cầu đã gửi vẫn giữ snapshot workflow tại thời điểm gửi; thay workflow không tự sửa request cũ." },
        { title: "Campaign bị từ chối", when: "Approval inbox trả request về với comment.", steps: ["Mở campaign và đọc rejection comment.", "Sửa justification hoặc cấu hình được góp ý.", "Submit for approval lại từ campaign."], expected: "Một lần gửi duyệt mới xuất hiện trong lịch sử." },
      ],
      imageAlt: "Campaign builder đang chọn Approval required và nhập justification.",
    },
    {
      title: "Create an approval-required campaign", section: "Campaigns and approvals", route: "/campaigns/new",
      purpose: "Use this flow for an exceptional campaign, such as a special initiative or company date outside the regular occasions.",
      prerequisites: "You need campaign.manage and an active Campaign issuance proposal workflow with valid approvers. Have the event, point type, and audience ready before submitting.",
      steps: [
        "Create a campaign. On Occasion, enter its name, choose the event for the exceptional occasion, and select Approval required under Campaign policy.",
        "Enter a specific Justification under Campaign policy, describing the purpose, target group, and reason for the award.",
        "On Recipients, select an audience/segment if needed and choose Automatic issue or Member claim.",
        "On Reward, select an active point type, enter the award, per-member limit, budget, and stacking if needed; leave budget blank for unlimited.",
        "On Schedule, keep Run automatically after approval or choose Specific date and an optional end date.",
        "Use Calculate Estimate/Recalculate on Review to refresh projected members and points after your last edits.",
        "Choose Save as draft to keep a draft or Submit for approval to create the approval request.",
        "Track the decision in Approval inbox. After approval, check the campaign status and activate it if activation is still required.",
        "If rejected, read the comment, revise the campaign, and submit again. Editing an approved campaign requires a new approval.",
      ],
      result: "The campaign remains pending until an approver decides. After approval, it can be activated and run.",
      notes: ["Campaign approval reviews the program configuration; it is not an individual member point-grant request.", "A vague justification does not help reviewers assess the request.", "Approval does not prove that members received points; use the issuance status procedure."],
      scenarios: [
        { title: "Submission has no approver", when: "The submit action reports that a workflow or approver is unavailable.", steps: ["Open Workflows and activate a Campaign issuance proposal workflow.", "Assign an active user or a role with active members, then resubmit."], expected: "The campaign appears as pending in Approval inbox.", help: "Requests already submitted keep their workflow snapshot; changing a workflow does not rewrite an existing request." },
        { title: "Campaign rejected", when: "Approval inbox shows a rejection comment.", steps: ["Open the campaign and read the reviewer comment.", "Revise the justification or configuration requested.", "Submit the campaign for approval again."], expected: "A new submission appears in approval history." },
      ],
      imageAlt: "Campaign builder with Approval required selected and the justification field visible.",
    }),

  // screenshot target: /campaigns list with issuance-status dialog, showing claims and issued rows.
  article("how-campaign-run-monitor", 1120, "campaign",
    {
      title: "Chạy campaign ngay và kiểm tra kết quả", section: "Campaigns", route: "/campaigns",
      purpose: "Chủ động chạy campaign active và xác định member nào đã được cấp điểm, còn claim hay bị bỏ qua.",
      prerequisites: "Cần quyền Run campaigns. Chỉ chạy khi campaign active và đã kiểm tra event, audience, award, mode và giới hạn; Run campaign now có thể ghi điểm thật hoặc tạo claim.",
      steps: [
        "Trong danh sách Campaigns, tìm campaign và xác nhận trạng thái Active cùng trạng thái approval đã được duyệt/không yêu cầu.",
        "Mở menu của campaign và chọn Run campaign now; không dùng thao tác này để xem trước.",
        "Đọc kết quả số member được xử lý và số grants/claims mới; ghi nhận nếu hệ thống trả lỗi.",
        "Mở lại menu → View issuance status để xem Issued members, Total points issued và Pending claims.",
        "Đọc từng dòng member, email, department, points, status, event và thời điểm; dùng Refresh nếu cần cập nhật.",
        "Nếu mode là Claim, member chỉ có điểm sau khi tự claim; pending claim không được tính là điểm đã issue.",
      ],
      result: "Issuance status phản ánh số grant đã tạo và số claim còn chờ. Dữ liệu member đã xóa không nên được hiểu là claim còn hoạt động; đối chiếu member hiện tại khi cần.",
      notes: ["Run now không phải preview và có thể tạo giao dịch không thể hoàn tác trực tiếp.", "Max uses per member, budget, stacking và event eligibility có thể khiến một số member không nhận thêm grant.", "Đối soát điểm thực tế bằng Ledger; bảng campaign giải thích kết quả theo member."],
      scenarios: [
        { title: "Nút Run campaign now bị khóa", when: "Menu hiển thị nhưng thao tác disabled.", steps: ["Kiểm tra campaign có active không.", "Kiểm tra approval status là APPROVED hoặc NOT_REQUIRED và role có quyền Run campaigns."], expected: "Nút chỉ khả dụng khi trạng thái và quyền cho phép." , help: "Campaign pending, rejected, inactive hoặc vượt quyền không thể chạy thủ công." },
        { title: "Số Pending claims không như dự kiến", when: "Campaign dùng Claim nhưng số pending khác với số người tham gia.", steps: ["Xem bảng từng member và trạng thái claim.", "Đối chiếu member đã xóa/không còn active và giới hạn per-member."], expected: "Chỉ claim hợp lệ còn chờ được tính là pending." , help: "Dùng Refresh để tải lại dữ liệu; không cộng pending claims vào total points issued." },
      ],
      imageAlt: "Issuance status của campaign với tổng grant, claim chờ và bảng member.",
    },
    {
      title: "Run a campaign now and check issuance", section: "Campaigns", route: "/campaigns",
      purpose: "Manually run an active campaign and determine which members received points, still have a claim, or were skipped.",
      prerequisites: "You need the Run campaigns capability. Run only after checking the active campaign, event, audience, award, delivery mode, and limits. Run campaign now can create real point transactions or claims.",
      steps: [
        "Find the campaign in Campaigns and verify it is Active and approved or approval is not required.",
        "Open its menu and select Run campaign now; this is not a preview.",
        "Read the processed-member and new-grant/claim counts, and note any reported error.",
        "Open the menu again and select View issuance status to inspect issued members, total points, and pending claims.",
        "Review each row's member, email, department, points, status, event, and timestamp; select Refresh for current results.",
        "For Claim mode, points are credited only after the member claims them; a pending claim is not an issued balance.",
      ],
      result: "Issuance status separates created grants from pending claims. If a listed member was deleted, verify the current member record before treating that claim as actionable.",
      notes: ["Run now is not a preview and may create transactions that cannot simply be undone.", "Per-member limits, budget, stacking, and event eligibility can prevent additional grants.", "Use Ledger to reconcile actual point movements; the campaign table explains results by member."],
      scenarios: [
        { title: "Run campaign now is disabled", when: "The menu action is visible but unavailable.", steps: ["Confirm the campaign is active.", "Confirm approval is APPROVED or NOT_REQUIRED and your role has Run campaigns."], expected: "The action is available only when state and permission allow it.", help: "Pending, rejected, inactive, or unauthorized campaigns cannot be run manually." },
        { title: "Pending claim count looks wrong", when: "The campaign uses Claim mode but the pending total differs from expected.", steps: ["Inspect member rows and their claim status.", "Check for deleted/inactive members and per-member limits."], expected: "Only valid claims that remain unclaimed count as pending.", help: "Refresh the status. Do not add pending claims to total points issued." },
      ],
      imageAlt: "Campaign issuance status showing grants, pending claims, and member rows.",
    }),

  // screenshot target: /event-definitions, event form in Onboarding mode and schedule preview.
  article("how-event-registration-onboarding", 1130, "automation",
    {
      title: "Event registration và onboarding", section: "Event definitions", route: "/event-definitions",
      purpose: "Cấu hình event xảy ra khi member mới được tạo hoặc sau một số ngày kể từ ngày bắt đầu.",
      prerequisites: "Cần event.manage. Nếu dùng onboarding, xác định offset tính từ lúc tạo tài khoản và kiểm tra timezone mặc định của chương trình.",
      steps: ["Chọn Create event definition và nhập Event key duy nhất, Display name và mô tả.", "Chọn Onboarding ở How does this event occur?; nhập Days after starting, dùng 0 nếu muốn ngay ngày tạo.", "Đọc Schedule preview để xác nhận hệ thống sẽ kiểm tra event như mong muốn.", "Save event; kiểm tra event xuất hiện ở tab Inactive/Active phù hợp rồi activate.", "Tạo campaign chọn đúng event, point type, audience và auto/claim mode.", "Tạo member mới hoặc chờ lịch chạy theo cấu hình; theo dõi kết quả trong campaign issuance status."],
      result: "Registration/onboarding event có thể kích hoạt campaign gắn với nó; event definition đơn lẻ không cấp điểm nếu chưa có campaign.",
      notes: ["Onboarding được scheduler kiểm tra định kỳ; đừng hứa thời điểm phát chính xác tức thì nếu mode cấu hình chạy theo lịch.", "Không tạo hai campaign trùng trigger và audience nếu không muốn member nhận nhiều lần.", "Kiểm tra per-member limit nếu campaign chạy cả theo event lẫn Run campaign now."],
      scenarios: [{ title: "Member mới chưa thấy điểm/claim", when: "Đã tạo account nhưng campaign chưa hiện ở member.", steps: ["Xác nhận event definition active và campaign gắn đúng event.", "Kiểm tra campaign đã active/được duyệt, audience bao gồm member và dates còn hiệu lực.", "Nếu delivery mode là Claim, kiểm tra mục claim thay vì số dư."], expected: "Sau khi scheduler xử lý hoặc claim được tạo, trạng thái xuất hiện trong campaign issuance.", help: "Nếu vẫn thiếu, kiểm tra giới hạn, campaign run status và member eligibility trước khi chạy lại." }],
      imageAlt: "Event definition ở chế độ Onboarding với offset và lịch chạy dự kiến.",
    },
    {
      title: "Registration and onboarding events", section: "Event definitions", route: "/event-definitions",
      purpose: "Configure an event that occurs when a member is created or a number of days after joining.",
      prerequisites: "You need event.manage. For onboarding, decide the offset from account creation and verify the intended timezone.",
      steps: ["Select Create event definition and enter a unique Event key, display name, and description.", "Choose Onboarding under How does this event occur? and enter Days after starting; use 0 for the creation day.", "Read Schedule preview and verify the intended timing.", "Save the event, find it under the appropriate Inactive/Active tab, and activate it.", "Create a campaign for this event and select its point type, audience, and automatic or claim delivery.", "Create a test member or wait for the configured schedule, then inspect campaign issuance status."],
      result: "A registration/onboarding event can trigger a linked campaign. An event definition alone does not issue points.",
      notes: ["Onboarding is checked by the scheduler; do not promise immediate issuance if the configured mode is scheduled.", "Avoid duplicate active campaigns for the same trigger and audience unless multiple awards are intended.", "Check per-member limits if the campaign can also be run manually."],
      scenarios: [{ title: "A new member sees no points or claim", when: "An account was created but no reward appears.", steps: ["Confirm the event definition is active and the campaign selects it.", "Check that the campaign is active/approved, the audience includes the member, and dates are valid.", "If delivery is Claim, look for a pending claim rather than a balance increase."], expected: "After the scheduler processes the event or creates a claim, issuance status shows the result.", help: "Before rerunning, check limits, campaign status, and member eligibility." }],
      imageAlt: "Event definition in Onboarding mode with its offset and schedule preview.",
    }),

  // screenshot target: /event-definitions, Annual member date with a DATE member field selected.
  article("how-event-member-date", 1140, "automation",
    {
      title: "Event ngày sinh và ngày kỷ niệm của member", section: "Event definitions", route: "/event-definitions",
      purpose: "Tạo trigger lặp hàng năm dựa trên ngày tạo account hoặc một custom member field kiểu Date.",
      prerequisites: "Cần event.manage. Với birthday/ngày cá nhân, tạo và điền Member field kiểu DATE trước; field phải active và có dữ liệu trên member mục tiêu.",
      steps: ["Mở Event definitions → Create event definition; đặt key và tên để người cấu hình campaign nhận ra.", "Chọn Annual member date; ở Member date field chọn Account creation date hoặc field DATE đã tạo.", "Đặt timezone và chính sách cho ngày 29/2: chỉ năm nhuận, chạy 28/2 hoặc 1/3.", "Đọc Schedule preview để xác nhận đúng field và lịch; Save rồi Activate event.", "Trong Campaign builder, chọn event mới và thiết lập audience, điểm, auto/claim, approval policy.", "Kiểm tra một member có ngày phù hợp và theo dõi issuance; member không có giá trị field sẽ không khớp trigger cá nhân đó."],
      result: "Scheduler kiểm tra ngày thành viên hằng ngày theo timezone. Campaign mới quyết định ai nhận bao nhiêu điểm và nhận tự động hay claim.",
      notes: ["Đổi nhầm field hoặc chọn field TEXT thay vì DATE khiến ngày không chạy đúng.", "Ngày sinh chưa được nhập thì event không thể xác định ngày cho member đó.", "Event và campaign phải active; tạo tên event không tự phát điểm."],
      scenarios: [{ title: "Không thấy custom field trong danh sách", when: "Member date field không có field cần dùng.", steps: ["Mở Member fields và tạo field kiểu Date.", "Lưu, đảm bảo field active, quay lại Event definitions và tải lại."], expected: "Field hiển thị trong lựa chọn Member date field.", help: "Field dạng text/number hoặc field inactive không được dùng như ngày trigger." }],
      imageAlt: "Annual member date event với trường ngày cá nhân, timezone và lựa chọn ngày nhuận.",
    },
    {
      title: "Birthday and member-anniversary events", section: "Event definitions", route: "/event-definitions",
      purpose: "Create a recurring annual trigger based on account creation or a custom Date member field.",
      prerequisites: "You need event.manage. For birthdays or personal dates, create and populate an active DATE member field first.",
      steps: ["Open Event definitions → Create event definition and enter a recognizable key and name.", "Choose Annual member date and select Account creation date or the intended Date field.", "Set the timezone and February 29 policy: leap years only, February 28, or March 1.", "Review Schedule preview, save the event, and activate it.", "In Campaign builder, select this event and configure audience, award, automatic/claim mode, and approval policy.", "Check an eligible member and monitor issuance; members without a field value cannot match that personal-date trigger."],
      result: "The scheduler checks member dates daily in the chosen timezone. The linked campaign decides eligibility, award amount, and delivery mode.",
      notes: ["Selecting a text field instead of a Date field can prevent the trigger from working as intended.", "A member with no date value has no personal date for the scheduler to match.", "Both event and campaign must be active; creating an event name does not award points."],
      scenarios: [{ title: "The custom field is missing", when: "The desired member date is not available in the selector.", steps: ["Create a Date field under Member fields.", "Save and activate the field, then reload Event definitions."], expected: "The field appears in Member date field choices.", help: "Text/number fields and inactive fields are not valid date triggers." }],
      imageAlt: "Annual member-date event showing the personal date field, timezone, and leap-day option.",
    }),

  // screenshot target: /event-definitions, one active date mode (annual recurring OR one-time).
  article("how-event-fixed-date", 1150, "automation",
    {
      title: "Tạo event ngày cố định", section: "Event definitions", route: "/event-definitions",
      purpose: "Cấu hình một ngày công ty lặp lại hàng năm hoặc một ngày sự kiện chỉ xảy ra một lần.",
      prerequisites: "Cần event.manage. Chuẩn bị ngày và timezone chính xác; các dịp cấp điểm bất thường sẽ cần campaign Approval required riêng.",
      steps: ["Tạo event definition với key duy nhất, tên hiển thị và mô tả dịp.", "Chọn Fixed annual date để nhập ngày/tháng lặp mỗi năm hoặc One-time date để chọn ngày đầy đủ.", "Chọn timezone; với ngày 29/2, chọn chỉ năm nhuận, chạy 28/2 hoặc chạy 1/3.", "Đọc Schedule preview để xác nhận ngày chạy.", "Save event; kiểm tra event nằm ở tab Inactive events, rồi Activate khi sẵn sàng.", "Tạo campaign chọn event này; chọn điểm, audience, delivery mode và lịch campaign phù hợp."],
      result: "Scheduler kiểm tra ngày cố định theo timezone; campaign active gắn event mới quyết định việc cấp điểm/claim.",
      notes: ["Ngày one-time đã qua không phải lịch chạy trong tương lai.", "Activate event không thay thế việc tạo/activate campaign.", "Nếu dịp cần approval, cần gửi campaign approval riêng."],
      scenarios: [{ title: "Ngày preview bị lệch", when: "Schedule preview không trùng ngày doanh nghiệp mong muốn.", steps: ["Kiểm tra chọn annual hay one-time.", "Kiểm tra ngày, timezone và chính sách February 29.", "Sửa preview trước khi Activate."], expected: "Preview ghi đúng ngày và timezone dự kiến.", help: "Không sửa event đang dùng cho campaign mà chưa đánh giá tác động các lịch sắp tới." }],
      imageAlt: "Event ngày cố định với một lựa chọn ngày (hàng năm hoặc một lần), timezone và Schedule preview.",
    },
    {
      title: "Create a fixed-date event", section: "Event definitions", route: "/event-definitions",
      purpose: "Configure a company date that recurs annually or a one-time event date.",
      prerequisites: "You need event.manage. Prepare the exact date and timezone; unusual point awards require a separate Approval required campaign.",
      steps: ["Create an event definition with a unique key, display name, and occasion description.", "Choose Fixed annual date and enter the month/day for yearly recurrence, or One-time date and select the full date.", "Set the timezone; for February 29 choose leap years only, February 28, or March 1.", "Read Schedule preview and verify its date.", "Save the event, find it under Inactive events, and Activate when ready.", "Create a campaign using this event and configure its award, audience, delivery mode, and campaign schedule."],
      result: "The scheduler checks a fixed date in its timezone; an active linked campaign determines whether points or claims are created.",
      notes: ["A past one-time date is not a future schedule.", "Activating an event does not create or activate a campaign.", "An exceptional award still needs campaign approval."],
      scenarios: [{ title: "The preview date is wrong", when: "Schedule preview differs from the intended company date.", steps: ["Check annual versus one-time mode.", "Verify the date, timezone, and February 29 policy.", "Correct the preview before activation."], expected: "The preview matches the intended date and timezone.", help: "Assess upcoming campaigns before changing an event already in use." }],
      imageAlt: "Fixed-date event with one date mode (annual or one-time), timezone, and schedule preview.",
    }),

  // screenshot target: /event-definitions Manual event form; do not imply manual preview is an issuance test.
  article("how-event-manual", 1155, "automation",
    {
      title: "Tạo event Manual cho campaign ngoại lệ", section: "Event definitions và Campaigns", route: "/event-definitions",
      purpose: "Tạo event placeholder để gắn vào một campaign ngoại lệ; đây không phải event tự chạy theo lịch hoặc nút check-in của member.",
      prerequisites: "Cần event.manage và campaign.manage. Workflow CAMPAIGN_ISSUANCE_PROPOSAL phải active để campaign ngoại lệ được duyệt.",
      steps: ["Tạo Event definition với key duy nhất, tên dịp và mô tả.", "Chọn Manual event và đọc preview để xác nhận đây là trigger manual.", "Save event rồi Activate khi key/mô tả đã kiểm tra.", "Tạo campaign mới, chọn Approval required và event Manual vừa tạo.", "Cấu hình audience, point type, số điểm, auto/claim và schedule; nhập justification cụ thể.", "Submit for approval. Với Run automatically after approval, campaign chạy sau khi được duyệt; nếu chọn Specific date, campaign chờ ngày đã chọn.", "Trước khi dùng Run campaign now, kiểm tra approval status, schedule, audience và award; thao tác này tạo grant/claim thật. Sau đó xem issuance status."],
      result: "Event definition chỉ cung cấp trigger cho campaign. Campaign được approve mới chạy theo lịch đã chọn; việc đặt tên event không tự cấp điểm.",
      notes: ["Không gắn Manual event vào campaign Standing nếu policy không cho phép.", "Run campaign now không phải preview: nó thực thi award/claim theo audience và có thể phát điểm thật.", "Không tạo event trùng key cho cùng một dịp. Approval campaign và approval event definition là hai thứ khác nhau."],
      scenarios: [{ title: "Campaign được duyệt nhưng chưa chạy", when: "Manual event campaign chưa phát grant/claim.", steps: ["Kiểm tra event active và campaign đang approved/active.", "Ở Review xem schedule là Run automatically after approval hay Specific date.", "Nếu chọn ngày cụ thể, kiểm tra ngày bắt đầu đã tới; sau đó xem issuance status."], expected: "Campaign chạy sau approval theo schedule cấu hình.", help: "Không gửi Run campaign now lặp đi lặp lại khi scheduler có thể chạy sau đó." }],
      imageAlt: "Manual event definition với preview giải thích campaign-driven trigger.",
    },
    {
      title: "Create a Manual event for an exceptional campaign", section: "Event definitions and Campaigns", route: "/event-definitions",
      purpose: "Create a placeholder event to attach to an exceptional campaign; it is not a scheduled event or a member check-in button.",
      prerequisites: "You need event.manage and campaign.manage. CAMPAIGN_ISSUANCE_PROPOSAL must be active so the exceptional campaign can be reviewed.",
      steps: ["Create an Event definition with a unique key, occasion name, and description.", "Choose Manual event and read the preview to confirm the trigger type.", "Save and activate the event after checking its key/name.", "Create a campaign, choose Approval required, and select the Manual event.", "Configure audience, point type, award, automatic/claim delivery, and schedule; provide a specific justification.", "Submit for approval. With Run automatically after approval, the campaign runs after approval; Specific date waits until its configured date.", "Before choosing Run campaign now, check approval status, schedule, audience, and award; this action creates real grants/claims. Then inspect issuance status."],
      result: "The definition provides a trigger for the campaign. The approved campaign runs according to its schedule; naming an event does not award points.",
      notes: ["Do not attach a Manual event to a Standing campaign when policy does not allow it.", "Run campaign now is not a preview; it executes the award/claim for its audience and can issue real points.", "Do not create duplicate event keys for the same occasion. Campaign approval is separate from event-definition activation."],
      scenarios: [{ title: "The approved campaign has not run", when: "The Manual-event campaign has no grant/claim yet.", steps: ["Confirm the event is active and the campaign is approved/active.", "On Review, check Run automatically after approval versus Specific date.", "If a specific date is selected, check that it has arrived; then inspect issuance status."], expected: "The campaign runs after approval according to its configured schedule.", help: "Avoid repeatedly using Run campaign now if the scheduler may still run it." }],
      imageAlt: "Manual event definition with preview explaining its campaign-driven trigger.",
    }),

  // screenshot target: /event-definitions, Member check-in form and active check-in event row.
  article("how-event-checkin", 1160, "automation",
    {
      title: "Tạo campaign điểm danh/check-in", section: "Event definitions và Campaigns", route: "/event-definitions",
      purpose: "Bật lịch điểm danh cho member và cấp điểm theo campaign; lịch hoạt động chỉ có ý nghĩa khi campaign check-in đang bật.",
      prerequisites: "Cần quyền event và campaign manage. Tạo event kiểu Member check-in, point type active, campaign đã cấu hình điểm và approval nếu policy yêu cầu.",
      steps: ["Tạo event definition, chọn Member check-in, nhập key và tên rồi đọc preview về giới hạn mỗi ngày.", "Save và activate event.", "Tạo campaign chọn event check-in, audience phù hợp, point type/amount và chọn auto issue hoặc claim.", "Duyệt/activate campaign theo policy.", "Mở customer home bằng tài khoản phù hợp để xác nhận thẻ Check in và calendar xuất hiện.", "Member check in một lần trong ngày địa phương; kiểm tra lịch hoạt động và issuance/ledger để đối chiếu."],
      result: "Member có thể check-in tối đa một lần mỗi ngày địa phương; calendar đánh dấu ngày có hoạt động khi campaign và event đang hoạt động.",
      notes: ["Pause/deactivate campaign check-in sẽ ẩn phần check-in/calendar phía customer theo trạng thái feature.", "Không dùng Run campaign now để giả lập một lần check-in thường nhật.", "Timezone quyết định ngày nào được tính là hôm nay."],
      scenarios: [{ title: "Customer không thấy calendar", when: "Trang customer không hiển thị phần check-in.", steps: ["Kiểm tra event và campaign đều active.", "Xác nhận campaign thực sự dùng event kiểu Member check-in.", "Kiểm tra role/status của member và tải lại Home."], expected: "Khi feature đã được bật, thẻ check-in/calendar xuất hiện cho member đủ điều kiện.", help: "Inactive/paused campaign chủ ý ẩn feature; đổi lại trạng thái chỉ khi được phép." }],
      imageAlt: "Member check-in event đang active và campaign gắn với event đó.",
    },
    {
      title: "Set up a member check-in campaign", section: "Event definitions and campaigns", route: "/event-definitions",
      purpose: "Enable member check-ins and award points through a campaign; the activity calendar is available only while check-in is enabled.",
      prerequisites: "You need event and campaign management. Create a Member check-in event, active point type, configured campaign, and approval workflow if required by policy.",
      steps: ["Create an event definition, select Member check-in, enter its key/name, and read the once-per-local-day preview.", "Save and activate the event.", "Create a campaign for that event, configure its audience, point type/amount, and automatic or claim delivery.", "Approve and activate the campaign according to its policy.", "Open Customer Home with an eligible account and verify that Check in and the calendar appear.", "Have the member check in once on the local day, then reconcile the activity calendar, issuance status, and Ledger."],
      result: "Members can check in at most once per local day. The calendar marks activity when the event and campaign are active.",
      notes: ["Pausing/deactivating the check-in campaign hides the check-in feature and calendar on the customer side.", "Do not use Run campaign now to simulate an ordinary daily check-in.", "Timezone determines which local date a check-in belongs to."],
      scenarios: [{ title: "The calendar is not visible", when: "Customer Home has no check-in section.", steps: ["Confirm that the event and campaign are active.", "Confirm the campaign uses the Member check-in event.", "Check member status/eligibility and reload Home."], expected: "Eligible members see the check-in card and calendar when the feature is enabled.", help: "An inactive or paused campaign intentionally hides the feature; only reactivate it through the approved process." }],
      imageAlt: "Active member check-in event and its linked campaign.",
    }),

  // screenshot target: /event-definitions, External event type and key preview (no API setup or credentials).
  article("how-event-external", 1170, "automation",
    {
      title: "Event external: tạo event để tích hợp gửi vào", section: "Event definitions", route: "/event-definitions",
      purpose: "Giải thích giới hạn của loại External event. Khai báo key không làm event tự phát sinh trong LoyaltyOS.",
      prerequisites: "Cần event.manage để xem định nghĩa. Event chỉ chạy nếu đã có một integration được triển khai để gửi key; trang này không cấu hình integration đó.",
      steps: ["Trong Event definitions, xem External event và ghi nhận event key chính xác.", "Hiểu rằng tạo hoặc activate definition chỉ đăng ký loại event, không tạo lần phát sinh.", "Nếu chương trình đã có integration nội bộ được phê duyệt, người phụ trách integration phải gửi đúng key; việc triển khai sender không nằm trong hướng dẫn này.", "Chỉ gắn event vào campaign khi đã xác nhận có sender phù hợp và campaign policy/approval đúng.", "Sau khi sender phát event, kiểm tra campaign issuance status để đối chiếu kết quả."],
      result: "External event chỉ có thể kích hoạt campaign khi một integration thực sự gửi event key đã đăng ký.",
      notes: ["Tên event hoặc campaign một mình không trigger issuance.", "Hướng dẫn này không có bước tạo API key, cấu hình sender hay tích hợp purchase/checkout.", "Nếu chưa có integration được phê duyệt, không dùng External event làm cách phát điểm nội bộ; cân nhắc event nội bộ phù hợp."],
      scenarios: [{ title: "Tạo event xong nhưng không có điểm", when: "Definition active nhưng issuance vẫn trống.", steps: ["Xác nhận có integration thực sự gửi event key tương ứng; chỉ tạo definition là chưa đủ.", "Kiểm tra campaign liên kết đã approved/active, audience đúng và event không bị inactive.", "Nếu không có sender nội bộ, dừng kiểm tra tại đây và chọn một trigger event được app xử lý sẵn."], expected: "Chỉ event do sender đã triển khai báo vào mới được xử lý theo campaign.", help: "Không thể trigger External event chỉ bằng cách tạo tên hoặc bấm Run campaign now." }],
      imageAlt: "External event definition hiển thị event key; không có API/sender được cấu hình ở đây.",
    },
    {
      title: "External events: define an event for an integration", section: "Event definitions", route: "/event-definitions",
      purpose: "Explain the limits of External events. Registering a key does not make LoyaltyOS emit the event.",
      prerequisites: "You need event.manage to view the definition. The event works only if an integration has been deployed to report its key; this page does not configure that integration.",
      steps: ["In Event definitions, inspect External event and note its exact event key.", "Understand that creating or activating the definition registers an event type; it does not emit an occurrence.", "If an approved internal integration already exists, its owner must report the exact key; implementing the sender is outside this guide.", "Attach the event to a campaign only after confirming a sender exists and the campaign policy/approval is correct.", "After the sender reports an event, inspect campaign issuance status to reconcile its result."],
      result: "An External event can trigger a campaign only when an integration actually reports the registered key.",
      notes: ["Naming an event or campaign alone does not trigger issuance.", "This guide does not create API keys, configure a sender, or cover purchase/checkout integrations.", "Without an approved integration, do not use External events for internal point issuance; choose an app-supported internal trigger instead."],
      scenarios: [{ title: "The event exists but no points were issued", when: "The definition is active but issuance is empty.", steps: ["Confirm an integration actually reported the event key; creating the definition is not enough.", "Check that the linked campaign is approved/active, the audience matches, and the event is active.", "If no internal sender exists, stop here and select a trigger the app supports directly."], expected: "Only events reported by a deployed sender are processed by the campaign.", help: "An External event cannot be triggered by naming it or selecting Run campaign now." }],
      imageAlt: "External event definition shows its event key; no API sender is configured here.",
    }),

  // screenshot target: /projects with New project plan form, requested budgets, and submit buttons.
  article("how-project-plan-approval", 1180, "project",
    {
      title: "Tạo project plan và xin duyệt ngân sách", section: "Group projects", route: "/projects",
      purpose: "Lập đề xuất project và xin duyệt ngân sách theo từng point type trước khi mời member hoặc giao task.",
      prerequisites: "Cần quyền tạo project. Nếu dùng field tùy chỉnh, Owner/role quản lý project tạo field dùng chung trước. Workflow PROJECT_PLAN_APPROVAL cần active approver.",
      steps: ["Trong Projects chọn New project; nhập tên và mô tả đủ để reviewer hiểu mục tiêu.", "Điền các shared project fields bắt buộc; nếu thiếu field cần thiết, dùng Manage project fields để tạo trước.", "Nhập budget theo từng point type; xem Bank available để tránh xin vượt quỹ.", "Chọn Save draft nếu chưa gửi, hoặc Save and submit for approval để mở request.", "Theo dõi status và rejection feedback ở project workspace/Approval inbox.", "Nếu bị từ chối, sửa plan và gửi lại; sau khi approved, project xuất hiện ở trạng thái sẵn sàng Activate."],
      result: "Ngân sách chỉ được reserve vào escrow sau khi plan được duyệt; trước đó member chưa thể được mời và điểm chưa được giải ngân.",
      notes: ["Không xin budget bằng point type inactive hoặc vượt bank hiện có.", "Các field Required phải có giá trị trước khi submit.", "Draft không tạo approval request."],
      scenarios: [{ title: "Submit bị lỗi thiếu workflow", when: "Form không tạo được approval request.", steps: ["Yêu cầu owner kiểm tra workflow action PROJECT_PLAN_APPROVAL đã active chưa.", "Kiểm tra workflow có assignee hợp lệ rồi thử submit lại."], expected: "Project chuyển sang trạng thái chờ duyệt; escrow chưa reserve đến khi được approve.", help: "Không tạo project trùng để xử lý lỗi; mở project hiện tại và gửi lại sau khi cấu hình workflow." }],
      imageAlt: "Project plan với custom fields, ngân sách theo point type và Save draft/submit buttons.",
    },
    {
      title: "Create a project plan and request budget approval", section: "Group projects", route: "/projects",
      purpose: "Propose a project and request a budget by point type before inviting members or assigning tasks.",
      prerequisites: "You need project-creation access. If custom fields are needed, an Owner/project administrator must create shared fields first. PROJECT_PLAN_APPROVAL must have an active approver.",
      steps: ["In Projects, select New project and enter a clear name and description.", "Complete required shared project fields; use Manage project fields to add a missing field first.", "Enter a requested budget for each point type and check Bank available.", "Choose Save draft to continue later, or Save and submit for approval to create a request.", "Track status and reviewer feedback in the project workspace or Approval inbox.", "If rejected, revise and resubmit. After approval, the project is ready to Activate."],
      result: "Budget is reserved in project escrow only after plan approval. Members cannot be invited and points are not distributed before then.",
      notes: ["Do not request budget from an inactive point type or beyond available bank value.", "Required custom fields must be completed before submission.", "A draft does not create an approval request."],
      scenarios: [{ title: "Submission has no workflow", when: "The form cannot create an approval request.", steps: ["Ask an Owner to verify that PROJECT_PLAN_APPROVAL is active.", "Verify the workflow has a valid assignee, then submit again."], expected: "The project becomes pending review; escrow is not reserved until approval.", help: "Do not create a duplicate project to work around the missing workflow." }],
      imageAlt: "Project plan with custom fields, budget by point type, and draft/submit buttons.",
    }),

  // screenshot target: /projects ACTIVE project Members tab with invitation controls, after activation.
  article("how-project-invite-members", 1190, "project",
    {
      title: "Activate project và mời member", section: "Group projects", route: "/projects",
      purpose: "Sau khi budget plan được duyệt, kích hoạt project và gửi invitation cho các member tham gia.",
      prerequisites: "Project ở trạng thái APPROVED; người thao tác có quyền quản lý. Member cần active để xuất hiện trong danh sách mời.",
      steps: ["Mở project APPROVED và chọn Activate project.", "Chuyển sang tab Members và search theo tên, email hoặc department.", "Chọn member cần mời; có thể chọn từng người hoặc Select visible members cho kết quả đang hiển thị.", "Kiểm tra số người selected và chọn Send invitations.", "Xem invitation status trong danh sách participants; member cần vào trang Customer Projects và Accept nếu lời mời đang pending.", "Chỉ member ACCEPTED đủ điều kiện được gán task/nhận project point distribution."],
      result: "Project chuyển ACTIVE; participants có trạng thái invitation riêng và chỉ người đã accept là member tham gia chính thức.",
      notes: ["Không gửi invitation trước khi project activate.", "Search/select all áp dụng cho member hiển thị trong kết quả, không mặc định toàn bộ database.", "Member đã mời/đã tham gia không được gửi trùng."],
      scenarios: [{ title: "Member không xuất hiện", when: "Người muốn mời không có trong danh sách search.", steps: ["Thử email/tên đầy đủ hoặc xóa filter.", "Kiểm tra member ACTIVE.", "Xác nhận người đó chưa được mời/đã tham gia project."], expected: "Member active chưa được mời xuất hiện để chọn.", help: "Inactive member hoặc participant hiện tại không thể được mời lại qua cùng danh sách." }],
      imageAlt: "Project ACTIVE ở tab Members với ô tìm kiếm và thao tác mời member.",
    },
    {
      title: "Activate a project and invite members", section: "Group projects", route: "/projects",
      purpose: "After budget approval, activate a project and send invitations to participating members.",
      prerequisites: "The project is APPROVED and you have management access. Members must be active to appear in the invite list.",
      steps: ["Open the APPROVED project and select Activate project.", "Open Members and search by name, email, or department.", "Select people individually or Select visible members for the current results.", "Verify the selected count and select Send invitations.", "Review invitation status in participants; members must open Customer Projects and Accept a pending invitation.", "Only ACCEPTED members can be assigned tasks or receive project point distributions."],
      result: "The project becomes ACTIVE. Each participant has an invitation status; accepted members are enrolled.",
      notes: ["Do not send invitations before project activation.", "Search/select all applies to displayed results, not automatically to the whole database.", "Already invited/enrolled participants cannot be invited again."],
      scenarios: [{ title: "A member is missing", when: "The intended participant does not appear in search.", steps: ["Try the full email/name or remove filters.", "Confirm the member is ACTIVE.", "Check that the person is not already invited or enrolled."], expected: "An active member without an existing invitation can be selected.", help: "Inactive and existing participants are not eligible for another invite through this list." }],
      imageAlt: "ACTIVE project Members tab with search and invitation controls.",
    }),

  // screenshot target: /projects Tasks tab with an assigned task moving from To do to Done.
  article("how-project-tasks", 1195, "project",
    {
      title: "Tạo và theo dõi task trong project", section: "Group projects", route: "/projects",
      purpose: "Chia project thành công việc có người phụ trách và trạng thái rõ ràng.",
      prerequisites: "Project phải ACTIVE; member cần accept invitation trước khi được chọn làm assignee. Người thao tác cần project.manage.",
      steps: ["Mở workspace project và chọn tab Tasks.", "Chọn Add task; nhập Task title, description, accepted Assignee và Due date nếu cần.", "Chọn Add task để lưu; kiểm tra task hiển thị ở trạng thái To do.", "Cập nhật trạng thái qua To do, In progress, Done theo tiến độ; dùng Edit để sửa mô tả/người phụ trách/ngày hạn.", "Dùng Remove chỉ khi task không còn cần thiết và xác nhận thao tác.", "Trước khi PM chọn Confirm project complete, đảm bảo mọi task ở trạng thái Done."],
      result: "Task xuất hiện trong project và tăng tiến độ; bất kỳ task nào chưa Done sẽ khóa thao tác confirm complete.",
      notes: ["Không assign cho member chưa Accept invitation.", "Sau khi project completed, task updates bị khóa nhưng task vẫn được giữ để xem lại.", "Xóa task làm mất nó khỏi danh sách công việc đang quản lý; chỉ xóa khi chắc chắn."],
      scenarios: [{ title: "Confirm project complete đang disabled", when: "Button xác nhận hoàn thành không bấm được.", steps: ["Mở Tasks và lọc từng task chưa DONE.", "Cập nhật hoặc gỡ task không còn dùng.", "Quay lại Overview sau khi open task count bằng 0."], expected: "Confirm project complete khả dụng khi tất cả task đã hoàn thành.", help: "Không đánh dấu Done cho công việc chưa hoàn tất chỉ để mở bước phân bổ điểm." }],
      imageAlt: "Project Tasks tab với task assignee, due date và trạng thái To do/In progress/Done.",
    },
    {
      title: "Create and track project tasks", section: "Group projects", route: "/projects",
      purpose: "Break project work into tasks with an owner and a clear status.",
      prerequisites: "The project must be ACTIVE. An assignee must have accepted their invitation. You need project.manage.",
      steps: ["Open a project workspace and select Tasks.", "Choose Add task; enter a title, description, accepted assignee, and optional due date.", "Select Add task and verify it appears as To do.", "Move it through To do, In progress, and Done as work progresses; use Edit to update its description/assignee/due date.", "Use Remove only when a task is no longer required and confirm the action.", "Before the PM confirms project completion, ensure every task is Done."],
      result: "Tasks appear in the project and contribute to progress. Any task not Done disables project completion.",
      notes: ["Do not assign a member who has not accepted the project invitation.", "After completion, task updates are locked but tasks remain visible for review.", "Removing a task removes it from the managed work list; do so only when certain."],
      scenarios: [{ title: "Confirm project complete is disabled", when: "The completion button cannot be selected.", steps: ["Review Tasks and find each item not marked DONE.", "Complete or remove tasks that are no longer needed.", "Return to Overview after the open task count reaches zero."], expected: "Confirm project complete is available when all tasks are done.", help: "Do not mark incomplete work Done just to reach point distribution." }],
      imageAlt: "Project Tasks tab with assignee, due date, and To do/In progress/Done status.",
    }),

  // screenshot target: /projects Budget & distribution tab after all tasks are done, with synthetic allocations.
  article("how-project-complete-distribute", 1200, "project",
    {
      title: "Hoàn thành project và gửi phân bổ điểm", section: "Group projects", route: "/projects",
      purpose: "Xác nhận công việc kết thúc, đề xuất phân bổ từ ngân sách escrow và xử lý phần quỹ còn lại.",
      prerequisites: "Project ACTIVE, toàn bộ task DONE, member đã accept; PM xem tài chính project của mình. Xem tài chính project do PM khác quản lý cần project.finance.view. Workflow PROJECT_POINT_ISSUANCE phải active.",
      steps: ["Kiểm tra tab Tasks để chắc không còn task mở; xác nhận project complete.", "Mở Budget & distribution và xem Approved, Remaining, Issued cho từng point type.", "Với từng accepted member và point type, nhập Points hoặc Percent; xem tổng allocation so với Remaining.", "Sửa lỗi số âm, phần trăm vượt 100%, số lẻ không hợp lệ hoặc tổng vượt quỹ.", "Chọn Submit point distribution for approval và theo dõi request trong Approval inbox.", "Sau khi approve, kiểm tra Distribution batches và ledger; sau khi giải ngân, Close project để trả phần escrow chưa dùng về bank."],
      result: "Approved distribution phát điểm từ escrow, không trừ bank lần thứ hai. Đóng project trả ngân sách chưa phân bổ theo quy trình hệ thống.",
      notes: ["Chỉ accepted members xuất hiện là người nhận hợp lệ.", "Tài chính của project PM khác cần project.finance.view; thiếu quyền không đồng nghĩa dữ liệu project bị mất.", "Rejection yêu cầu sửa allocation rồi resubmit; Close project không thể undo."],
      scenarios: [{ title: "Nút submit bị khóa", when: "Không thể gửi distribution approval.", steps: ["Kiểm tra project đã complete chưa.", "Kiểm tra có accepted members, allocation hợp lệ và tổng không vượt remaining.", "Xác nhận workflow PROJECT_POINT_ISSUANCE active."], expected: "Valid distribution được gửi và xuất hiện trong inbox.", help: "Nếu issue bị rejected, sửa batch hiện tại thay vì tạo bản phân bổ trùng." }],
      imageAlt: "Budget & distribution với approved/remaining balances, allocation mode và approval action.",
    },
    {
      title: "Complete a project and submit point distribution", section: "Group projects", route: "/projects",
      purpose: "Confirm delivery, propose awards from project escrow, and return unused budget when closing the project.",
      prerequisites: "The project is ACTIVE, all tasks are DONE, and participants accepted. A PM can see their own project's finances; viewing another PM's project finance requires project.finance.view. PROJECT_POINT_ISSUANCE must have an active workflow.",
      steps: ["Review Tasks to confirm none are open, then confirm project completion.", "Open Budget & distribution and review Approved, Remaining, and Issued for each point type.", "For each accepted member and point type, enter Points or Percent and compare allocation totals with Remaining.", "Fix negative amounts, percentages over 100%, invalid fractions, or totals beyond the remaining budget.", "Select Submit point distribution for approval and track it in Approval inbox.", "After approval, review Distribution batches and Ledger; close the project to return unspent escrow to the bank."],
      result: "An approved distribution issues points from escrow without debiting the bank a second time. Closing returns the unallocated budget according to system rules.",
      notes: ["Only accepted members are eligible recipients.", "Viewing another PM's project finances requires project.finance.view; missing access does not mean the project data is lost.", "After rejection, read the feedback and revise/resubmit; closing is irreversible."],
      scenarios: [{ title: "Submit is disabled", when: "The distribution cannot be submitted for approval.", steps: ["Confirm the project is complete.", "Check accepted recipients, valid values, and totals within the remaining budget.", "Verify PROJECT_POINT_ISSUANCE has an active workflow."], expected: "A valid distribution is submitted and appears in the inbox.", help: "Revise a rejected batch rather than creating a duplicate distribution." }],
      imageAlt: "Budget & distribution showing approved/remaining balances, allocation mode, and approval action.",
    }),

  // screenshot target: /point-types/new, identity/visibility/operation fields before saving.
  article("how-point-type-create", 1210, "wallet",
    {
      title: "Tạo point type và cấu hình cách sử dụng", section: "Credits & point types", route: "/point-types/new",
      purpose: "Tạo loại điểm trước khi sử dụng trong bank, campaign, ví, reward hoặc transfer.",
      prerequisites: "Cần point_type.manage. Quy ước code phải ổn định, duy nhất và thống nhất với file import/API downstream.",
      steps: ["Mở Point type registry → Create point type.", "Nhập name, code, unit label và màu/icon; chọn active và hiển thị cho customer khi cần.", "Cấu hình các phép dùng: cấp điểm, đổi reward, transfer/give hoặc exchange theo nhu cầu chính sách.", "Chọn expiry mode riêng ở bài hướng dẫn expiry; không bật operation chưa có quy trình quản trị.", "Nếu cho phép Give, đặt source/allowance policy và matrix đích ở phần Give transfer matrix.", "Save rồi kiểm tra type xuất hiện trong campaign, wallet và các màn hình liên quan."],
      result: "Point type active xuất hiện ở những tính năng được phép; code được dùng trong cột import và ledger.",
      notes: ["Không đổi code sau khi đã có dữ liệu/import; tạo code trùng khiến campaign/import không phân biệt được type.", "Tắt một operation không xóa lịch sử giao dịch đã có.", "Kiểm tra customer visibility và quyền operation riêng biệt."],
      scenarios: [{ title: "Campaign không nhận point type", when: "Type không thấy trong danh sách award point type.", steps: ["Kiểm tra type active và chưa archive.", "Xác nhận role có quyền xem point type và campaign.", "Tải lại campaign builder sau khi cấu hình."], expected: "Type active có thể được chọn trong campaign.", help: "Loại inactive/archived bị ẩn có chủ ý để ngăn giao dịch mới." }],
      imageAlt: "Form tạo point type với code, đơn vị, hiển thị và các operation.",
    },
    {
      title: "Create a point type and configure its operations", section: "Credits & point types", route: "/point-types/new",
      purpose: "Create a points currency before using it in banks, campaigns, wallets, rewards, or transfers.",
      prerequisites: "You need point_type.manage. Keep the code stable and unique, including for imports and downstream integrations.",
      steps: ["Open Point type registry → Create point type.", "Enter its name, code, unit label, and color/icon; set active status and customer visibility.", "Enable only the intended operations: issuance, reward redemption, transfers/give, or exchange.", "Configure expiry separately; do not enable an operation without an owner and process.", "If Give is enabled, configure its source/allowance policy and destination matrix.", "Save and verify the type appears in campaigns, wallets, and relevant screens."],
      result: "An active point type becomes selectable only in the operations that are enabled. Its code is used in imports and ledger records.",
      notes: ["Do not change a code after it has been used in imports or transactions.", "Disabling an operation does not erase existing transaction history.", "Customer visibility and operation permissions are separate settings."],
      scenarios: [{ title: "The point type is missing in Campaigns", when: "The new type is not selectable as an award type.", steps: ["Confirm the type is active and not archived.", "Confirm your role can view point types and manage campaigns.", "Reload Campaign builder after saving the type."], expected: "An active type is available for a new campaign.", help: "Inactive/archived types are hidden intentionally to prevent new transactions." }],
      imageAlt: "Point-type creation form with code, unit, visibility, and operation settings.",
    }),

  // screenshot target: /point-types edit form with expiry policy and the confirmation dialog for expiry operation.
  article("how-point-expiry", 1220, "wallet",
    {
      title: "Cấu hình và quản lý hạn dùng point type", section: "Credits & point types", route: "/point-types",
      purpose: "Chọn mốc hết hạn và vận hành expiry cho grant của một point type.",
      prerequisites: "Cần point_type.manage. Đọc tác động policy trước khi đổi cho point type đã phát sinh số dư; thao tác Run/Reset expiry cần xác nhận.",
      steps: ["Mở Point type registry và Edit type cần cấu hình.", "Chọn Never, After days, Fixed date hoặc Per grant theo chính sách; nhập số ngày/ngày cố định tương ứng.", "Với After days, hiểu đây là ngày hết hạn tính từ lúc tạo point type; số ngày còn lại giảm mỗi ngày và không reset theo lần nhận grant.", "Cấu hình warning days nếu cần thông báo sắp hết hạn; Save.", "Với type có expiry, dùng Run expiry khi cần xử lý ngay sau khi kiểm tra trước; xác nhận dialog.", "Nếu vừa chạy nhầm và hệ thống cho phép, dùng Reset expiry cho lần chạy gần nhất sau khi xác nhận; đối chiếu member balances/Ledger."],
      result: "Point grants theo policy có expiry; dashboard/customer có thể hiển thị số ngày còn lại, còn run expiry tạo các thay đổi hết hạn theo policy.",
      notes: ["Run expiry là thao tác ảnh hưởng số dư; không bấm như refresh.", "Reset expiry chỉ áp dụng lần chạy gần nhất theo chức năng hiển thị, không phải hoàn tác mọi expiry lịch sử.", "Ngày cố định đã qua có thể khiến grant mới không hợp lệ."],
      scenarios: [{ title: "Expiry action không xuất hiện", when: "Không thấy Run expiry hoặc Reset expiry.", steps: ["Kiểm tra type active và expiry mode khác Never.", "Kiểm tra quyền point_type.manage.", "Mở đúng type registry row và trạng thái của expiry run gần nhất."], expected: "Action hiển thị chỉ với type đủ điều kiện; Reset chỉ khả dụng nếu có lần run gần đây để đảo." , help: "Không tự tạo run thử trên production để làm xuất hiện nút reset." }],
      imageAlt: "Cấu hình expiry policy và action expiry có dialog xác nhận.",
    },
    {
      title: "Configure and operate point-type expiry", section: "Credits & point types", route: "/point-types",
      purpose: "Choose an expiry policy and manage expiry processing for a point type.",
      prerequisites: "You need point_type.manage. Review policy impact before changing a type with existing balances. Run/Reset expiry requires confirmation.",
      steps: ["Open Point type registry and edit the desired type.", "Choose Never, After days, Fixed date, or Per grant and enter the corresponding value.", "For After days, the expiry date is measured from point-type creation; remaining days decrease daily and do not restart on each grant.", "Optionally configure warning days, then save.", "For an expiring type, select Run expiry only after reviewing impact and confirm the dialog.", "If a run was made in error and the option is available, use Reset expiry for the latest run; reconcile balances and Ledger."],
      result: "Grants follow the configured expiry policy. Home can show days remaining, while Run expiry applies expiry transactions according to the policy.",
      notes: ["Run expiry changes balances; it is not a refresh action.", "Reset expiry applies to the most recent run offered by the UI, not every historical expiry.", "A fixed date in the past may make new grants invalid."],
      scenarios: [{ title: "Expiry controls are unavailable", when: "Run expiry or Reset expiry is not shown.", steps: ["Confirm the type is active and its expiry mode is not Never.", "Check point_type.manage access.", "Review the selected type and the latest expiry-run state."], expected: "Run appears only for eligible types; Reset requires a reversible recent run.", help: "Do not create a live production expiry run merely to reveal Reset." }],
      imageAlt: "Expiry policy configuration and the confirmation dialog for an expiry action.",
    }),

  // screenshot target: /credits/wallets, adjustment form populated with synthetic member and reason.
  article("how-wallet-adjustment", 1230, "wallet",
    {
      title: "Cộng hoặc trừ điểm bằng Wallet adjustment", section: "Credits & point types", route: "/credits/wallets",
      purpose: "Sửa một giao dịch/số dư thành viên bằng thao tác có lý do và audit trail.",
      prerequisites: "Cần wallet.manage. Xác minh chính xác memberId, point type, hướng cộng/trừ và số bank còn khả dụng trước khi xác nhận.",
      steps: ["Mở Wallet adjustments; tìm member bằng email/tên/ID và chọn đúng hồ sơ.", "Chọn point type và Add points hoặc Remove points.", "Nhập số nguyên dương cùng reason mô tả nghiệp vụ; kiểm tra summary trước khi xác nhận.", "Add tiêu thụ bank khả dụng nếu point type bị bank-governed; Remove trả điểm về admin bank theo rule.", "Xác nhận một lần; sau thông báo thành công, mở Ledger và lọc member để kiểm tra amount, reason, actor và balance after."],
      result: "Ví member thay đổi một lần và phát sinh giao dịch ledger có actor/lý do.",
      notes: ["Không nhập số âm để biểu diễn trừ điểm; chọn đúng Remove.", "Adjustment không tạo campaign, audience hoặc claim.", "Nếu member chọn nhầm, không bấm lại trước khi xem Ledger; việc sửa cần adjustment bù có lý do."],
      scenarios: [{ title: "Add thất bại do bank không đủ", when: "Hệ thống báo không đủ ngân sách/quỹ.", steps: ["Mở bank của đúng point type và kiểm tra balance/cycle.", "Điều chỉnh số điểm hoặc nạp quỹ theo quy trình phê duyệt.", "Gửi adjustment lại sau khi xác nhận số dư."], expected: "Add chỉ được ghi khi đủ bank khả dụng.", help: "Không đổi sang point type khác để né kiểm soát ngân sách." }],
      imageAlt: "Wallet adjustment form với member, point type, Add/Remove, amount và reason.",
    },
    {
      title: "Add or remove points with Wallet adjustment", section: "Credits & point types", route: "/credits/wallets",
      purpose: "Correct a member balance or transaction through a reasoned, auditable adjustment.",
      prerequisites: "You need wallet.manage. Verify memberId, point type, direction, amount, and available bank value before confirming.",
      steps: ["Open Wallet adjustments; find the member by email/name/ID and verify the profile.", "Choose a point type and Add points or Remove points.", "Enter a positive whole-point amount and a business reason; review the summary.", "Add consumes available bank value for bank-governed types; Remove returns points to the admin bank under current rules.", "Confirm once. After success, open Ledger filtered by member to verify amount, reason, actor, and resulting balance."],
      result: "The member wallet changes once and a ledger transaction records the actor and reason.",
      notes: ["Do not enter a negative number to mean removal; choose Remove.", "An adjustment does not create a campaign, audience, or claim.", "If the wrong member/type was selected, inspect Ledger before doing anything else; corrections require a compensating adjustment."],
      scenarios: [{ title: "Add fails because the bank is low", when: "The system reports insufficient bank value.", steps: ["Open the bank for the selected point type and inspect balance/cycle.", "Adjust the amount or fund the bank through the approved process.", "Retry only after confirming available value."], expected: "Add is recorded only when the bank has sufficient value.", help: "Do not switch point types to bypass a budget control." }],
      imageAlt: "Wallet adjustment form with member, type, Add/Remove, amount, and reason.",
    }),

  // screenshot target: /credits/banks funding form and its funding-history row.
  article("how-bank-funding", 1240, "bank",
    {
      title: "Nạp bank và kiểm tra lịch sử funding", section: "Banks & cycles", route: "/credits/banks",
      purpose: "Nạp quỹ điểm admin để các thao tác cấp điểm có nguồn ngân sách và lý do truy vết.",
      prerequisites: "Cần bank.manage. Chọn đúng point type và dùng số lượng/lý do đã được phê duyệt nội bộ.",
      steps: ["Mở Banks & cycles và chọn đúng point type.", "Kiểm tra current bank balance và cycle đang mở nếu có.", "Mở thao tác fund/add bank; nhập lượng điểm và reason cụ thể.", "Xem lại point type/amount/reason rồi xác nhận funding.", "Chuyển sang Ledger và bật loại lọc Bank funding để tìm dòng mới.", "Đối chiếu actor, thời điểm, reason và balance; member email có thể trống vì đây là giao dịch quỹ trung tâm."],
      result: "Bank balance tăng và funding history/ledger lưu actor cùng lý do; không tạo giao dịch ví cho member.",
      notes: ["Không nhập số nạp như một Wallet adjustment.", "Reason nên nêu ticket/nghiệp vụ, không để một ký tự khó truy vết.", "Đối chiếu funding riêng với allocated; nạp quỹ không có nghĩa điểm đã phát cho member."],
      scenarios: [{ title: "Không thấy member email ở bank funding", when: "Dòng funding hiển thị dấu gạch ở cột member.", steps: ["Kiểm tra action/source là Bank funding.", "Đối chiếu point type, actor, reason và balance sau nạp."], expected: "Giao dịch bank trung tâm không cần target member.", help: "Chỉ các giao dịch ví có đối tượng member mới nên có member email." }],
      imageAlt: "Form fund bank và dòng lịch sử Bank funding với actor/reason.",
    },
    {
      title: "Fund a bank and review funding history", section: "Banks & cycles", route: "/credits/banks",
      purpose: "Add points to the administrative bank so issuance has a traceable funding source and reason.",
      prerequisites: "You need bank.manage. Select the correct point type and use an internally approved amount and reason.",
      steps: ["Open Banks & cycles and select the point type.", "Review the current bank balance and any open cycle.", "Open the fund/add-bank action and enter a point amount and specific reason.", "Review type, amount, and reason, then confirm funding.", "Open Ledger and select the Bank funding filter to find the new row.", "Verify actor, timestamp, reason, and balance; member email may be blank because this is a central-bank transaction."],
      result: "The bank balance increases and funding history records actor/reason; no member wallet transaction is created.",
      notes: ["Do not record a funding operation as a Wallet adjustment.", "Use a traceable reason instead of an unexplained one-character note.", "Funding and allocation are different; adding to the bank does not mean points were issued to members."],
      scenarios: [{ title: "Bank funding has no member email", when: "The member column shows a dash.", steps: ["Confirm the action/source is Bank funding.", "Reconcile point type, actor, reason, and resulting bank balance."], expected: "A central bank transaction does not require a member target.", help: "Member email is expected for wallet transactions with a member recipient." }],
      imageAlt: "Bank funding form and a funding-history row with actor and reason.",
    }),

  // screenshot target: /credits/banks with an open and a closed cycle detail view, showing net allocation.
  article("how-bank-cycles", 1250, "bank",
    {
      title: "Mở, theo dõi và đóng bank cycle", section: "Banks & cycles", route: "/credits/banks",
      purpose: "Theo dõi một cửa sổ phân bổ điểm, nguyên nhân mở/đóng và các giao dịch làm thay đổi ngân sách.",
      prerequisites: "Cần bank.manage. Chọn đúng point type; cycle chỉ dùng để theo dõi allocation, không phải một lần nạp bank.",
      steps: ["Trong Banks & cycles, chọn point type và nhập ngày bắt đầu/kết thúc cùng note khi mở cycle.", "Xác nhận opening balance; cycle ghi người mở/Created by.", "Chọn cycle để xem funding, project reservation, grants, removals/returns và các giao dịch trong kỳ; dùng phân trang nếu cần.", "Đối chiếu allocated là tổng ròng sau các khoản trả về đủ điều kiện, không phải tổng gross issuance.", "Khi kết thúc, chọn Close cycle; nhập lý do đóng và xác nhận.", "Mở chi tiết đã đóng để kiểm tra closing balance, closed by, thời gian, lý do và transactions."],
      result: "Cycle chuyển CLEARED/đóng theo trạng thái hiển thị; phần bank chưa sử dụng vẫn còn. Lịch sử mở/đóng và giao dịch trong kỳ được giữ lại.",
      notes: ["Không đóng cycle chỉ để reset số liệu; đóng là hành động audit.", "Hoàn điểm có thể giảm allocated ròng; kiểm tra action/refund tương ứng trước khi kết luận cycle sai.", "Funding thêm vào bank không tự được tính là allocated."],
      scenarios: [{ title: "Allocated khác tổng grants", when: "Số allocated thấp hơn gross points issued.", steps: ["Tìm các REMOVE/refund/return đủ điều kiện trong transactions.", "Đọc allocated theo giá trị net sau hoàn.", "Kiểm tra period và point type của cycle."], expected: "Allocated khớp tổng cấp ra trừ các khoản hoàn được cycle tính vào.", help: "Đối chiếu dòng giao dịch thay vì lấy tổng grants làm số net." }],
      imageAlt: "Chi tiết bank cycle mở/đóng với lý do, người thao tác, số dư và giao dịch.",
    },
    {
      title: "Open, track, and close a bank cycle", section: "Banks & cycles", route: "/credits/banks",
      purpose: "Track an allocation window, its opening/closing reason, and transactions that change available budget.",
      prerequisites: "You need bank.manage. Select the correct point type. A cycle tracks allocation; it is not a bank funding action.",
      steps: ["In Banks & cycles, select a point type and enter the cycle dates and opening note.", "Confirm the opening balance; the record identifies who opened it.", "Select the cycle to review funding, project reservations, grants, removals/returns, and paginated transactions.", "Treat allocated as net of qualifying returns, not gross issuance.", "At the end of the period, select Close cycle, enter a closing reason, and confirm.", "Reopen the closed detail to review closing balance, closer, timestamp, reason, and transactions."],
      result: "The cycle moves to its cleared/closed state. Unused bank value remains, and opening/closing and transaction history are retained.",
      notes: ["Do not close a cycle as a way to reset its numbers; closure is an audit action.", "Refunds can reduce net allocated; inspect the matching return transaction before diagnosing a discrepancy.", "Funding the bank does not itself count as allocated."],
      scenarios: [{ title: "Allocated differs from gross grants", when: "Net allocated is lower than points issued gross.", steps: ["Find eligible REMOVE/refund/return transactions in cycle details.", "Read allocated as net after qualifying returns.", "Verify the cycle period and point type."], expected: "Allocated equals counted issuance less returns included in the cycle.", help: "Reconcile the transactions rather than comparing only with gross grants." }],
      imageAlt: "Open/closed cycle detail with reason, responsible admins, balances, and transactions.",
    }),

  // screenshot target: /credits/ledger with filters and one readable transaction expanded.
  article("how-ledger-find-transaction", 1260, "table",
    {
      title: "Tìm và đọc giao dịch trong Ledger", section: "Ledger và Logs", route: "/credits/ledger",
      purpose: "Xác định giao dịch điểm thuộc member nào, ai thực hiện, nguồn, lý do và số dư sau giao dịch.",
      prerequisites: "Cần wallet.view; để xem đầy đủ member email hoặc các dataset liên quan, role phải có quyền tương ứng.",
      steps: ["Mở Ledger; lọc loại giao dịch trước, ví dụ grant, redemption, adjustment hoặc Bank funding.", "Thu hẹp theo khoảng thời gian, point type, member/email, actor hoặc action type.", "Đọc Actor/Action type/Target member, Source, Reason, Amount, Balance after và timestamp.", "Mở chi tiết dòng để xem metadata và tên campaign/reward thay vì chỉ dựa trên ID.", "Dùng Bank funding filter cho quỹ trung tâm; dùng Logs để tìm action/audit không phải biến động điểm.", "Nếu cần báo cáo, chuyển Data export và chọn Ledger fields theo mục đích."],
      result: "Có thể truy vết phát sinh từ member đến nguồn và số dư sau; bank funding được phân biệt khỏi ví member.",
      notes: ["Email có thể trùng; xác nhận bằng memberId khi có nhiều member gần giống.", "Bank funding không có member target là bình thường.", "Ledger ghi thay đổi điểm; Logs ghi hành động ứng dụng; Approval history ghi quyết định duyệt."],
      scenarios: [{ title: "Không tìm thấy dòng giao dịch", when: "Ledger trả về rỗng sau khi thao tác thành công.", steps: ["Bỏ bớt filter một trường mỗi lần và mở rộng khoảng ngày.", "Kiểm tra đúng point type và loại source.", "Nếu giao dịch thuộc campaign/reward, tra theo member và thời điểm."], expected: "Filter đúng sẽ hiển thị dòng giao dịch tương ứng.", help: "Nếu vẫn không có dòng, dùng Logs/Approval history để xác định thao tác đã commit hay chỉ được gửi/chờ duyệt." }],
      imageAlt: "Ledger có bộ lọc actor/action/member và dòng giao dịch mở rộng với nguồn, lý do, số dư sau.",
    },
    {
      title: "Find and read a Ledger transaction", section: "Ledger and Logs", route: "/credits/ledger",
      purpose: "Identify the member, actor, source, reason, and resulting balance for a point movement.",
      prerequisites: "You need wallet.view. Your role may need additional capabilities to see member email or related datasets.",
      steps: ["Open Ledger and filter by transaction type, such as grant, redemption, adjustment, or Bank funding.", "Narrow by date range, point type, member/email, actor, or action type.", "Read actor, action type, target member, source, reason, amount, resulting balance, and timestamp.", "Open a row for metadata and a campaign/reward name rather than relying on an ID alone.", "Use Bank funding for central-fund movements; use Logs for application actions that are not point changes.", "For a report, open Data export and select the Ledger fields you need."],
      result: "You can trace a point movement from member to source and resulting balance; bank funding is separate from member wallets.",
      notes: ["Email may not be unique; verify memberId when records are similar.", "Bank funding does not require a member target.", "Ledger records point movement, Logs record application actions, and Approval history records decisions."],
      scenarios: [{ title: "The transaction is not found", when: "Ledger is empty after an operation appeared successful.", steps: ["Remove filters one at a time and widen the date range.", "Check the point type and transaction source.", "For campaign/reward activity, search by member and time."], expected: "Correct filters show the corresponding transaction.", help: "If still absent, check Logs or Approval history to learn whether the action committed or is only pending." }],
      imageAlt: "Ledger filters and an expanded transaction showing source, reason, and resulting balance.",
    }),

  // screenshot target: /segments/new Rule Builder with conditions, AND/OR, and estimated member count.
  article("how-segment-dynamic", 1270, "table",
    {
      title: "Tạo dynamic segment bằng điều kiện", section: "Segments", route: "/segments/new",
      purpose: "Tự động gom member theo hồ sơ, số dư hoặc hoạt động được Rule Builder hỗ trợ.",
      prerequisites: "Cần segment.manage. Tạo custom member field trước nếu rule cần dữ liệu chưa có; đảm bảo field có đúng data type và đã được điền.",
      steps: ["Chọn New segment và loại Dynamic; đặt tên/description để người dùng biết nhóm này phục vụ gì.", "Thêm điều kiện: chọn field, operator và giá trị; với ngày, dùng date picker và kiểm tra inclusive/exclusive rule.", "Chọn AND nếu phải thỏa tất cả điều kiện, OR nếu chỉ cần thỏa một điều kiện.", "Dùng Estimate Count để xem tổng số member khớp; builder không hiển thị từng member.", "Save segment rồi quay về danh sách Segments, chọn View members tại segment cần kiểm tra.", "Sau khi dữ liệu member đổi, mở lại segment vì dynamic membership được tính theo dữ liệu hiện tại."],
      result: "Segment cập nhật membership theo rule; campaign tham chiếu segment sẽ dùng member khớp tại thời điểm đánh giá.",
      notes: ["Date field để kiểu TEXT có thể không hiện date picker/so sánh đúng.", "AND giữa điều kiện sinh nhật và department có thể tạo audience rất nhỏ; kiểm tra preview.", "Rule event activity chỉ đo event được app ghi nhận, không suy ra event bên ngoài chưa được gửi."],
      scenarios: [{ title: "Số member preview bằng 0", when: "Rule không tìm thấy người nào.", steps: ["Tạm bỏ từng condition để tìm điều kiện đang loại hết member.", "Kiểm tra AND/OR và kiểu dữ liệu/format ngày.", "Xác nhận custom field đã có giá trị trên member."], expected: "Preview phản ánh tập member dự kiến trước khi segment được gắn vào campaign.", help: "Không dùng segment rỗng cho chiến dịch cấp điểm nếu chưa xác nhận đó là chủ đích." }],
      imageAlt: "Dynamic segment Rule Builder với field/operator/value, AND/OR và Estimate Count.",
    },
    {
      title: "Build a dynamic segment with rules", section: "Segments", route: "/segments/new",
      purpose: "Automatically group members by profile, balance, or activity conditions supported by Rule Builder.",
      prerequisites: "You need segment.manage. Create any required custom member field first, use the correct data type, and populate it.",
      steps: ["Choose New segment and Dynamic; give it a purpose-specific name and description.", "Add conditions by selecting field, operator, and value. For dates, use the date picker and check inclusive/exclusive semantics.", "Choose AND when all rules must match, or OR when any rule is enough.", "Use Estimate Count to see how many members match; the builder does not show individual records.", "Save the segment, return to the Segments list, and select View members on the segment to inspect records.", "Reopen the segment when member data changes; dynamic membership is based on current data."],
      result: "Membership is recalculated from the rules; campaigns use the members matching when evaluated.",
      notes: ["A TEXT date field may not support a date picker or correct date comparisons.", "Combining birthday and department with AND can create a small audience; review the preview.", "Event activity reflects events recorded by the app, not external events that were never sent."],
      scenarios: [{ title: "The preview count is zero", when: "No members match the current rules.", steps: ["Temporarily remove one condition at a time to find the blocking rule.", "Check AND/OR logic and date formats/data types.", "Confirm the custom field is populated on member profiles."], expected: "Preview reflects the intended audience before the segment is attached to a campaign.", help: "Do not use an empty segment for issuance until you confirm that is intentional." }],
      imageAlt: "Dynamic Rule Builder with field/operator/value, AND/OR logic, and Estimate Count.",
    }),

  // screenshot target: /segments/new static flow showing search/filters and Select all search results.
  article("how-segment-static", 1280, "table",
    {
      title: "Tạo static segment bằng cách chọn member", section: "Segments", route: "/segments/new",
      purpose: "Lưu một danh sách thành viên được admin chọn thủ công, không tự đổi theo rule member.",
      prerequisites: "Cần segment.manage và member.view. Xác định nhóm member, tránh chọn toàn bộ chỉ vì đang xem trang kết quả đầu tiên.",
      steps: ["Chọn New segment → Static và nhập tên dễ nhận biết.", "Tìm bằng tên/email/member ID; áp dụng status/department filter nếu có.", "Chọn từng member hoặc Select all search results để chọn mọi kết quả khớp với search/filter hiện tại, kể cả ở trang khác; checkbox chỉ chọn dòng đang thấy.", "Xem số selected và rà danh sách người đã chọn trước khi lưu.", "Save; mở lại segment để xác nhận thành viên được giữ lại.", "Khi cần đổi membership, edit segment, bỏ chọn/add member rồi Save."],
      result: "Static segment giữ lại đúng IDs đã chọn; thay đổi hồ sơ member không tự thêm/bớt họ khỏi segment.",
      notes: ["Select all search results áp dụng search/status/department filters hiện tại và chọn kết quả qua tất cả trang; checkbox chỉ chọn dòng đang hiển thị.", "Đừng dùng email đơn lẻ làm định danh nếu có thể đối chiếu member ID.", "Member bị deactivate/delete có thể không còn hành động được trong các campaign mới."],
      scenarios: [{ title: "Tôi muốn chọn cả danh sách lọc", when: "Cần chọn một nhóm có điều kiện qua nhiều trang.", steps: ["Đặt search/status/department filters trước.", "Kiểm tra số kết quả rồi chọn Select all search results.", "Xem số selected và rà danh sách trước khi lưu."], expected: "Chỉ member khớp search và filters hiện tại được thêm vào segment.", help: "Bỏ filter sẽ mở rộng tập kết quả; kiểm tra count trước khi chọn tất cả." }],
      imageAlt: "Static segment picker với ô search/filter, Select all search results và bộ đếm selected.",
    },
    {
      title: "Create a static segment by selecting members", section: "Segments", route: "/segments/new",
      purpose: "Save a manually selected member list that does not change automatically with rule evaluation.",
      prerequisites: "You need segment.manage and member.view. Define the target group first; do not assume the first result page is the entire list.",
      steps: ["Choose New segment → Static and enter a recognizable name.", "Search by name/email/member ID and apply status/department filters if available.", "Select members individually or use Select all search results for every match across pages; the row checkbox only selects visible rows.", "Review the selected count and list before saving.", "Save and reopen the segment to verify its membership.", "To change membership, edit the segment, add/remove members, and save."],
      result: "A static segment retains the selected IDs; profile changes do not automatically add or remove members.",
      notes: ["Select all search results respects current search/status/department filters and includes matches across pages; the row checkbox is limited to visible rows.", "Use member IDs to disambiguate duplicate emails.", "Deactivated/deleted members may not be eligible for new campaign actions."],
      scenarios: [{ title: "I want all filtered matches", when: "You need a filtered group selected across pages.", steps: ["Set search/status/department filters first.", "Check the result count, then select Select all search results.", "Review the selected count and list before saving."], expected: "Only members matching the current search and filters are added to the segment.", help: "Clearing a filter broadens the result set; verify the count before selecting all." }],
      imageAlt: "Static segment picker showing search/filters, Select all search results, and selected count.",
    }),

  // screenshot target: /tiers with a tier editing two point-type thresholds and AND/OR choice.
  article("how-tiers-configure", 1290, "table",
    {
      title: "Cấu hình tier theo nhiều loại điểm", section: "Tiers and badges", route: "/tiers",
      purpose: "Tạo cấp bậc member theo một hoặc nhiều ngưỡng point type và chọn cách kết hợp điều kiện.",
      prerequisites: "Cần tier.manage; tạo và activate point type trước. Xác định điểm nào tham gia xét hạng và điểm nào chỉ để chi tiêu.",
      steps: ["Mở Tiers và tạo tier hoặc Edit tier hiện có.", "Nhập tên/màu/thứ tự hiển thị.", "Thêm requirement cho từng point type và đặt minimum points.", "Chọn AND để member phải đạt mọi ngưỡng hoặc OR để chỉ cần đạt một ngưỡng.", "Save; kiểm tra thứ tự giữa các tier để member được so sánh với đúng cấp.", "Mở customer profile/Home và xác nhận loại điểm nào còn thiếu để lên tier."],
      result: "Tier và progress được tính theo các point type/ngưỡng cùng AND/OR đã chọn.",
      notes: ["Không suy ra điều kiện chỉ từ thanh progress; kiểm tra tất cả requirements.", "Hai threshold cùng AND khiến member chưa đạt tier nếu thiếu một trong hai loại điểm.", "Đổi logic/tier order có thể làm hạng member thay đổi."],
      scenarios: [{ title: "Customer chỉ thấy progress một loại điểm", when: "Tier có nhiều point type nhưng UI không hiện đủ.", steps: ["Mở tier config và xác nhận mỗi requirement đã lưu.", "Kiểm tra AND/OR và customer đang xem đúng tier.", "Tải lại member view sau khi lưu."], expected: "Tier calculation follows the configured requirements; progress UI should expose each applicable threshold.", help: "Nếu cấu hình đủ nhưng UI vẫn thiếu một ngưỡng, ghi lại tier ID và báo lỗi giao diện." }],
      imageAlt: "Tier editor với nhiều point-type requirement và lựa chọn AND/OR.",
    },
    {
      title: "Configure a tier with multiple point types", section: "Tiers and badges", route: "/tiers",
      purpose: "Set a member tier using one or more point-type thresholds and choose how the requirements combine.",
      prerequisites: "You need tier.manage; create and activate point types first. Decide which balances determine status versus only being spendable.",
      steps: ["Open Tiers and create a tier or edit an existing one.", "Enter its name, color, and display order.", "Add a requirement for each point type and enter the minimum points.", "Choose AND if the member must meet every threshold, or OR if any one threshold is enough.", "Save and check tier order so members are compared with the intended level.", "Open a customer profile/Home view and confirm which point type is still needed for the next tier."],
      result: "Tier and progress follow all configured point-type thresholds and the selected AND/OR rule.",
      notes: ["Do not infer eligibility from a single progress bar; check all requirements.", "Two requirements joined with AND mean the member must reach both thresholds.", "Changing the logic or ordering may change member tiers."],
      scenarios: [{ title: "Customer shows only one progress value", when: "The tier has multiple point types but the UI shows one.", steps: ["Confirm every requirement is saved in tier configuration.", "Check AND/OR and the tier shown to this customer.", "Reload the member view after saving."], expected: "Tier calculation follows all configured requirements; progress should expose each applicable threshold.", help: "If configuration is correct but the UI omits a threshold, capture the tier ID and report a display issue." }],
      imageAlt: "Tier editor with multiple point-type requirements and AND/OR logic.",
    }),

  // screenshot target: /badges/new showing uploaded image and condition builder.
  article("how-badges-configure", 1300, "table",
    {
      title: "Tạo badge và điều kiện đạt", section: "Tiers and badges", route: "/badges/new",
      purpose: "Tạo huy hiệu member có thể đạt từ điều kiện điểm, hồ sơ, tier, activity hoặc gán thủ công.",
      prerequisites: "Cần badge.manage. Chuẩn bị ảnh hợp lệ để upload và xác định AND/OR cho các điều kiện.",
      steps: ["Mở Badges → New badge; nhập name, mô tả và tải ảnh lên.", "Thêm condition theo loại được hỗ trợ như points, member field, tier/tag hoặc event activity.", "Chọn AND nếu tất cả condition phải đúng; chọn OR nếu một điều kiện là đủ.", "Kiểm tra condition đang có giá trị/point type/event hợp lệ; không bật Advanced rules nếu không dùng.", "Lưu badge và xác nhận trạng thái; member đủ điều kiện sẽ hiện badge theo rule hoặc qua thao tác award nếu badge đặt manual.", "Kiểm tra customer profile với một member dự kiến đạt và một member chưa đạt."],
      result: "Badge được hiển thị/cấp khi member thỏa rule hoặc admin cấp theo chế độ manual; badge tự nó không cấp điểm/reward.",
      notes: ["Không có condition thường tương ứng badge cấp manual; xác minh trước khi publish.", "Tên event phải là event thực sự được app ghi nhận.", "Ảnh URL cũ không thay thế cho ảnh cần upload nếu form yêu cầu tệp."],
      scenarios: [{ title: "Badge không được cấp tự động", when: "Member có vẻ đạt nhưng badge chưa hiện.", steps: ["Mở badge và rà điều kiện, AND/OR, point type và event.", "Đối chiếu dữ liệu member và activity thực tế.", "Kiểm tra badge đang active và không phải manual-award."], expected: "Chỉ badge active với rule khớp mới được cấp tự động.", help: "Nếu manual, admin cần dùng luồng cấp phù hợp; rule trống không tự sinh award." }],
      imageAlt: "Badge editor với ảnh đã tải lên, condition builder và logic AND/OR.",
    },
    {
      title: "Create a badge and define its conditions", section: "Tiers and badges", route: "/badges/new",
      purpose: "Create a member achievement based on points, profile fields, tier, activity, or a manual award.",
      prerequisites: "You need badge.manage. Prepare a valid image upload and decide whether conditions combine with AND or OR.",
      steps: ["Open Badges → New badge; enter its name/description and upload an image.", "Add supported conditions such as points, member fields, tier/tag, or event activity.", "Choose AND when every condition must match, or OR when any one condition is enough.", "Check that every condition has a valid value, point type, or event; leave Advanced rules unused unless needed.", "Save and review status. Eligible members receive the badge automatically according to its rule, or through a manual award flow if configured that way.", "Check one qualifying and one non-qualifying customer profile."],
      result: "The badge is shown/awarded when its rule matches or an admin manually awards it; a badge alone does not grant points or a reward.",
      notes: ["An empty condition set may indicate manual award; confirm before publishing.", "An event condition requires an event that the app actually records.", "An old URL value does not replace a required file upload."],
      scenarios: [{ title: "The badge is not awarded automatically", when: "A member appears eligible but has no badge.", steps: ["Review conditions, AND/OR, point type, and event.", "Compare the member data and recorded activity with each condition.", "Confirm the badge is active and is not manual-award only."], expected: "Only active badges with matching automatic rules are awarded automatically.", help: "Manual badges require the applicable admin award action; empty rules do not create an award." }],
      imageAlt: "Badge editor with uploaded image, condition builder, and AND/OR logic.",
    }),

  // screenshot target: /members/:id showing profile in view and edit modes with PII blurred.
  article("how-member-profile-admin", 1310, "members",
    {
      title: "Tìm, xem và sửa hồ sơ member", section: "Members", route: "/members",
      purpose: "Quản lý thông tin member, trường tùy chỉnh, ảnh và xem số dư/lịch sử mà không nhầm bản ghi.",
      prerequisites: "Cần member.view; sửa field cần member.manage. Xác định member bằng member ID khi email trùng hoặc có nhiều tài khoản tương tự.",
      steps: ["Trong Members, tìm theo name, email, external ID hoặc member ID; lọc ACTIVE/INACTIVE và department.", "Mở đúng member profile; kiểm tra email/ID trước khi thay đổi.", "Chọn Edit, sửa các trường cơ bản/custom fields; nhập Photo URL vào trường photo nếu cần thay ảnh.", "Save và xác nhận trường như birthdate/Work anniversary hiển thị ở chế độ view, không chỉ trong editor.", "Xem Balance và Transaction history; nguồn campaign/reward cần đọc theo tên hiển thị thay vì raw ID.", "Nếu chỉ muốn dừng tài khoản, cân nhắc Deactivate; Delete xóa member khỏi danh sách active và clear balances nhưng giữ lịch sử giao dịch."],
      result: "Profile giữ các giá trị đã lưu; ví/lịch sử vẫn tra được theo member. Delete là thao tác admin nhạy cảm cần xác nhận.",
      notes: ["Deactivate không tự khôi phục số dư đã clear khi re-activate.", "Xóa member không đồng nghĩa xóa transaction history.", "Không chụp/đính kèm ảnh hướng dẫn có email, ảnh cá nhân hoặc thông tin xác thực chưa được làm mờ."],
      scenarios: [{ title: "Không thấy trường custom/date", when: "Member không hiển thị birthdate, department hoặc anniversary.", steps: ["Mở Member fields và kiểm tra field active/type.", "Vào profile edit để xác nhận field có value.", "Lưu lại rồi chuyển về chế độ view."], expected: "Field đã lưu hiển thị ở profile view nếu được bật/đưa vào hồ sơ.", help: "Field trống không có giá trị để render; kiểm tra dữ liệu import/member record." }],
      imageAlt: "Member profile view/edit với custom fields; mọi thông tin nhận dạng đã được làm mờ.",
    },
    {
      title: "Find, review, and edit a member profile", section: "Members", route: "/members",
      purpose: "Manage member details, custom fields, and photo while verifying balances/history against the correct profile.",
      prerequisites: "You need member.view; edits require member.manage. Use member ID when emails are duplicated or accounts look similar.",
      steps: ["In Members, search by name, email, external ID, or member ID; filter ACTIVE/INACTIVE and department.", "Open the correct profile and verify its email/ID before changing data.", "Select Edit, update standard/custom fields, and enter a Photo URL in the photo field if the image should change.", "Save and confirm fields such as birthdate/work anniversary are visible in read-only view, not only in the editor.", "Review Balance and Transaction history; read campaign/reward source labels rather than relying on raw IDs.", "For access removal, consider Deactivate. Delete removes the member from active lists and clears balances while retaining transaction history."],
      result: "Saved values remain on the profile and wallet/history can still be traced by member. Delete is a sensitive admin action requiring confirmation.",
      notes: ["Reactivation does not restore balances cleared by deactivation.", "Deleting a member does not erase transaction history.", "Do not capture unredacted member emails, personal photos, or credentials in guide screenshots."],
      scenarios: [{ title: "A custom/date field is missing", when: "Birthdate, department, or anniversary is not displayed.", steps: ["Check that the Member field is active and has the correct type.", "Edit the profile and verify the field has a value.", "Save and return to read-only view."], expected: "A populated enabled field is shown in profile view when configured for the profile.", help: "An empty field has no value to render; check the import/member record." }],
      imageAlt: "Member profile view/edit with custom fields; identifying data is blurred.",
    }),

  // screenshot target: /credits/import selected fields and completed import result with synthetic member data.
  article("how-member-import-profile", 1320, "table",
    {
      title: "Import member mới hoặc cập nhật hồ sơ", section: "Members và import", route: "/credits/import",
      purpose: "Tạo member mới hoặc cập nhật các field hồ sơ được chọn từ tệp import.",
      prerequisites: "Cần member.manage. Tải file mẫu mới nhất; chuẩn bị header và khóa định danh đúng. Màn hình có bản xem trước nội dung có thể chỉnh sửa, nhưng đây không phải dry-run/validation; Import members ghi dữ liệu ngay.",
      steps: ["Mở Member import và tải template hiện tại nếu cần.", "Chọn file được hỗ trợ; kiểm tra header và các cột đã được nhận diện.", "Chọn field import; các mandatory fields được tích sẵn và không thể bỏ.", "Đối chiếu cột file với email/memberId/externalId và custom fields; bỏ chọn field không muốn ghi đè.", "Rà nội dung trong Editable import preview và field selection; đây không phải kiểm tra trước khi ghi. Chỉ chọn Import members khi sẵn sàng thực thi.", "Xem kết quả succeeded/failed theo từng dòng trước khi quyết định có cần sửa và chạy lại dòng lỗi."],
      result: "Member mới được tạo hoặc các field được chọn cập nhật; field không chọn không bị lấy từ file.",
      notes: ["Khi file có header, dòng header phải được nhận dạng và bỏ qua.", "Email bắt buộc khi tạo member mới theo luồng import; cập nhật cần khóa xác định member hợp lệ.", "Import thành công một phần vẫn cần rà lỗi còn lại, không tự chạy lại toàn file nếu đã có member được tạo."],
      scenarios: [{ title: "Lỗi BULK_EMAIL_OR_EXTERNAL_ID_REQUIRED", when: "Các dòng dữ liệu báo thiếu email hoặc external ID.", steps: ["Kiểm tra cột email/externalId có được tích chọn và header đúng chính tả không.", "Đối chiếu các giá trị ở dòng lỗi để chắc chắn không lệch cột hoặc bị trống; khi tạo mới cần email, còn cập nhật phải có khóa định danh hợp lệ.", "Sửa các dòng lỗi rồi chỉ import lại phần thất bại; các dòng đã thành công được ghi ngay."], expected: "Các dòng được map đúng field định danh mà không tạo member trùng do chạy lại toàn bộ file.", help: "Parser nhận diện header. Import có thể thành công một phần, nên đọc kết quả theo dòng trước khi retry." }],
      imageAlt: "Member import field selector and completed result with synthetic data.",
    },
    {
      title: "Import new members or update profiles", section: "Members and import", route: "/credits/import",
      purpose: "Create members or update selected profile fields from an import file.",
      prerequisites: "You need member.manage. Download the latest template and prepare the correct identity header. The editable content preview is not a dry run or validation; Import members writes data immediately.",
      steps: ["Open Member import and download the current template if needed.", "Choose a supported file and inspect the detected headers/columns.", "Select fields to import; mandatory fields are preselected and cannot be deselected.", "Map file columns to email/memberId/externalId and custom fields; deselect fields you do not want overwritten.", "Review the Editable import preview and field selection; it does not validate the import before writing. Select Import members only when ready to execute.", "Inspect succeeded/failed results by row before deciding whether to correct and rerun failed rows."],
      result: "New members are created or selected profile fields are updated. Unselected fields are not written from the file.",
      notes: ["When a header exists, it should be detected and skipped as a data row.", "Email is required when creating a member through import; updates require a valid record identity.", "A partial success still requires reviewing failed rows; do not blindly re-import a file that already created members."],
      scenarios: [{ title: "BULK_EMAIL_OR_EXTERNAL_ID_REQUIRED", when: "Rows report that email or external ID is required.", steps: ["Confirm the email/externalId column is selected and the header is spelled correctly.", "Inspect failed rows for blank or shifted values; creation requires email, while updates need a valid identity key.", "Correct the failed rows and import only those rows; successful rows have already been written."], expected: "Rows map to the correct identity field without creating duplicates by rerunning the full file.", help: "The parser detects headers. Imports can partially succeed, so inspect row results before retrying." }],
      imageAlt: "Member import field selector and completed result with synthetic data.",
    }),

  // screenshot target: /credits/import field selection and completed result for a synthetic point import.
  article("how-member-import-points", 1330, "table",
    {
      title: "Import số dư hoặc điều chỉnh điểm hàng loạt", section: "Members và import", route: "/credits/import",
      purpose: "Cập nhật số dư hoặc tạo phát sinh điểm cho member bằng file, tuân theo settings của point type.",
      prerequisites: "Cần quyền import/wallet phù hợp; point type phải tồn tại và active. Export member list trước để giữ memberId và sao lưu file nguồn.",
      steps: ["Export đúng members và point columns cần cập nhật; giữ nguyên memberId.", "Trong Member import, chọn các trường balance_CODE để đặt số dư đích hoặc point_CODE để tạo giao dịch cộng/trừ.", "Với point type Per grant, bổ sung expiry_CODE theo cấu hình; không nhập tên display thay cho code header.", "Chọn field cần import và rà header, point type, amount trước khi thực thi.", "Rà Editable import preview; đây là nội dung file có thể chỉnh, không phải dry-run. Chỉ chọn Import members khi đã xác nhận point type và amounts.", "Đọc kết quả từng dòng, sau đó đối chiếu sample member balance và Ledger trước khi chạy lại các dòng thất bại."],
      result: "balance_CODE áp dụng chênh lệch tới số dư đích; point_CODE tạo transaction. Quy tắc point type, bank và expiry vẫn được áp dụng.",
      notes: ["Không dùng balance_CODE nếu mục tiêu là tạo ledger transaction riêng biệt.", "Point type phải trùng code, ví dụ dấu gạch/ngạch dưới phải chính xác.", "Bank-governed positive increase cần bank khả dụng; lỗi point type unknown không được sửa bằng cách đổi tên cột tùy tiện."],
      scenarios: [{ title: "Point type does not exist", when: "Import báo Point type CODE does not exist.", steps: ["Mở Point type registry và copy code chính xác.", "Đặt header balance_<CODE> hoặc point_<CODE> theo ý định.", "Xác nhận point type active; sửa file và chỉ import lại các dòng chưa thành công."], expected: "Header ghép với point type đúng; kết quả được rà theo từng dòng sau khi chạy.", help: "Tên hiển thị không thay thế point type code; không đoán từ tên reward/campaign." }],
      imageAlt: "Completed import result for balance_CODE/point_CODE and expiry fields using synthetic data.",
    },
    {
      title: "Bulk import balances or point adjustments", section: "Members and import", route: "/credits/import",
      purpose: "Set target balances or create point transactions from a file while enforcing point-type settings.",
      prerequisites: "You need the applicable import/wallet permission and an active point type. Export selected members with memberId and preserve the source file.",
      steps: ["Export the intended members and point columns; retain memberId.", "In Member import, use balance_CODE to set a target balance or point_CODE to create a credit/debit transaction.", "For Per grant types, include expiry_CODE as configured; use the exact code in headers, not the display name.", "Select fields and review headers, point type, and amounts before execution.", "Review the Editable import preview: it shows editable file contents but is not a dry-run. Select Import members only after confirming point types and amounts.", "Inspect results by row, then verify sample member balances and Ledger before rerunning failed rows."],
      result: "balance_CODE applies the difference to a target balance; point_CODE creates transactions. Point-type, bank, and expiry rules still apply.",
      notes: ["Do not use balance_CODE when you specifically need separate ledger transaction entries.", "The point-type code must match exactly, including hyphens/underscores.", "Positive increases for bank-governed types require available bank value; do not fix an unknown type by guessing a header."],
      scenarios: [{ title: "Point type does not exist", when: "Import reports Point type CODE does not exist.", steps: ["Open Point type registry and copy the exact code.", "Use balance_CODE or point_CODE according to the intended operation.", "Confirm the type is active, correct the file, and rerun only failed rows."], expected: "The header maps to the correct point type; results are reviewed row by row after execution.", help: "Display names are not codes; do not guess from a campaign or reward name." }],
      imageAlt: "Completed import result for balance_CODE/point_CODE and expiry fields using synthetic data.",
    }),

  // screenshot target: /permissions showing grouped capability accordion and administrator-account role/status fields.
  article("how-admin-accounts-roles", 1340, "roles",
    {
      title: "Tạo role và quản lý tài khoản Admin", section: "Roles & permissions", route: "/permissions",
      purpose: "Tạo quyền tối thiểu theo nhiệm vụ và gán role cho tài khoản back-office; phê duyệt tài khoản Microsoft là bước riêng.",
      prerequisites: "Cần Owner/permission.manage. Giữ ít nhất một Owner đang hoạt động; member account không phải admin account.",
      steps: ["Trong Roles & permissions, tạo role mới với tên mô tả công việc.", "Chọn role, mở từng nhóm tính năng và bật view/manage tối thiểu; Save role.", "Ở Administrator accounts, tạo admin với email, tên và role phù hợp.", "Nếu user đăng nhập Microsoft 365 và account được tạo dạng inactive/pending, mở đúng tài khoản và bật Active sau khi xác minh danh tính.", "Lưu role/status; user đăng nhập lại hoặc tải lại phiên để quyền có hiệu lực.", "Thử với account có quyền thấp: xác nhận menu/actions bị giới hạn như thiết kế."],
      result: "Admin account nhận capability từ role; account Microsoft mới chưa được activate không thể dùng quyền admin.",
      notes: ["Owner có full capabilities và không thể khóa quyền truy cập của chính hệ thống.", "Role được workflow tham chiếu có thể không xóa được cho đến khi gỡ liên kết.", "Không gửi mật khẩu/session/token trong tài liệu hoặc ảnh hướng dẫn."],
      scenarios: [{ title: "Menu hoặc nút không xuất hiện", when: "Admin đăng nhập nhưng không thấy một chức năng.", steps: ["Kiểm tra role đã được gán đúng account.", "Mở nhóm permission liên quan và bật capability view/manage phù hợp.", "Kiểm tra account active rồi tạo phiên mới/tải lại."], expected: "Menu và actions xuất hiện theo capabilities đã lưu.", help: "Nếu capability đúng nhưng vẫn bị chặn, kiểm tra permission của action cụ thể và role context." }],
      imageAlt: "Roles & permissions theo nhóm và bảng Administrator accounts đã làm mờ dữ liệu cá nhân.",
    },
    {
      title: "Create roles and manage Admin accounts", section: "Roles & permissions", route: "/permissions",
      purpose: "Grant least-privilege capabilities by job and assign them to back-office users; Microsoft-account approval is a separate step.",
      prerequisites: "You need Owner/permission.manage. Keep at least one active Owner. Member accounts are not Admin accounts.",
      steps: ["In Roles & permissions, create a role with a clear job-based name.", "Select the role, open feature groups, enable only required view/manage capabilities, and save.", "Under Administrator accounts, create an admin with name, email, and the intended role.", "If Microsoft 365 sign-in created an inactive/pending account, verify the person and activate the correct account.", "Save role/status; ask the administrator to sign in again or refresh their session.", "Verify with a least-privileged account that menus/actions match the intended access."],
      result: "An Admin receives capabilities from its assigned role. A new unapproved Microsoft account cannot use Admin privileges until activated.",
      notes: ["Owner retains all capabilities and cannot lock the system owner out.", "A role referenced by a workflow may not be deletable until its references are removed.", "Never share passwords, sessions, or tokens in guides or screenshots."],
      scenarios: [{ title: "A menu or action is missing", when: "An administrator signs in but cannot see a feature.", steps: ["Confirm the correct role is assigned to the account.", "Enable the necessary view/manage capability in the relevant group.", "Confirm the account is active and start a fresh session."], expected: "Menus and actions appear according to saved capabilities.", help: "If the capability is present but access is still denied, check the specific action permission and account context." }],
      imageAlt: "Grouped role capabilities and the Administrator accounts table with personal data redacted.",
    }),

  // screenshot target: /workflows create form with action key group, one approval layer and assignee selection.
  article("how-workflow-configure", 1350, "automation",
    {
      title: "Tạo và activate workflow phê duyệt", section: "Automation & governance", route: "/workflows",
      purpose: "Định tuyến đúng loại yêu cầu tới approver theo từng layer; workflow không áp dụng cho mọi thao tác CRUD.",
      prerequisites: "Cần workflow.manage. Xác định action key thực sự có handler và chuẩn bị account/role approver active.",
      steps: ["Mở Workflows → Create workflow; nhập tên dễ hiểu.", "Chọn action key theo nhóm, ví dụ CAMPAIGN_ISSUANCE_PROPOSAL, PROJECT_PLAN_APPROVAL, PROJECT_POINT_ISSUANCE, POINT_EXCHANGE hoặc REWARD_REDEMPTION.", "Nếu action có scope, chọn point type/reward/giới hạn phù hợp; để trống scope chỉ khi muốn match toàn bộ theo trợ giúp trên form.", "Thêm approval layer; gán active user/role và chọn điều kiện approval count/ALL như UI yêu cầu.", "Sắp xếp layer từ bước đầu đến bước cuối; kiểm tra mỗi layer có người xử lý.", "Save inactive để rà soát; activate khi hoàn tất. Tạo request thử trong luồng nghiệp vụ tương ứng và kiểm tra inbox."],
      result: "Workflow active được dùng cho request mới của action key tương ứng; request đang chờ giữ snapshot assignee/workflow ban đầu.",
      notes: ["Chọn sai action key khiến request không đi vào workflow mong muốn.", "Không có active assignee hoặc role rỗng khiến request không thể được xử lý.", "Sửa workflow không tự chuyển người duyệt của request đã submit."],
      scenarios: [{ title: "Request báo workflow chưa cấu hình", when: "Một tính năng submit nhưng không tạo request pending.", steps: ["Đối chiếu action key của tính năng với workflow key.", "Kiểm tra workflow Active và có assignee hiện hành.", "Gửi lại từ bản ghi chưa submit thành công."], expected: "Request mới xuất hiện ở Approval inbox theo workflow đã kích hoạt.", help: "History không tạo request bị thiếu; trước khi retry hãy xác nhận lần submit trước chưa commit." }],
      imageAlt: "Workflow builder với action key, scope, layer và assignee đã cấu hình.",
    },
    {
      title: "Create and activate an approval workflow", section: "Automation & governance", route: "/workflows",
      purpose: "Route supported request types to approvers by layer; workflows do not apply to every CRUD operation.",
      prerequisites: "You need workflow.manage. Choose an action key handled by the application and have active users/roles ready to approve.",
      steps: ["Open Workflows → Create workflow and enter a clear name.", "Choose an action key, for example CAMPAIGN_ISSUANCE_PROPOSAL, PROJECT_PLAN_APPROVAL, PROJECT_POINT_ISSUANCE, POINT_EXCHANGE, or REWARD_REDEMPTION.", "For scoped actions, select relevant point types/rewards/limits; leave scope blank only when the form help confirms that means all.", "Add approval layers, assign active users/roles, and set the required approval count or ALL rule.", "Order the layers and verify each has a valid assignee.", "Save inactive for review, then activate. Submit a request in the corresponding business flow and verify it appears in the inbox."],
      result: "New requests matching the active action key use this workflow. Existing pending requests retain their original workflow/assignee snapshot.",
      notes: ["A mismatched action key will not route the request as intended.", "Missing active assignees can leave a request without an actionable approver.", "Editing a workflow does not reassign already-submitted requests."],
      scenarios: [{ title: "A request says no workflow is configured", when: "A feature submission does not create a pending request.", steps: ["Compare the feature's action key with the workflow key.", "Confirm the workflow is Active and has a current assignee.", "Retry from a business record that was not successfully submitted."], expected: "A new request appears in Approval inbox under the active workflow.", help: "Before retrying, verify the prior submit did not commit; a missing request is not visible in history." }],
      imageAlt: "Workflow builder with action key, scope, approval layer, and assignee.",
    }),

  // screenshot target: /approvals inbox and request detail with decision controls and history.
  article("how-approval-inbox-decide", 1360, "automation",
    {
      title: "Xử lý request trong Approval inbox", section: "Approvals", route: "/approvals",
      purpose: "Đọc request được giao ở layer hiện tại, quyết định approve/reject và truy lại lịch sử duyệt.",
      prerequisites: "Cần approval.inbox và phải là approver hiện tại theo assigned snapshot. Requester không tự duyệt request của chính mình.",
      steps: ["Mở Approval inbox, chọn tab Inbox và chọn request pending.", "Đọc workflow/action key/subject/requester/justification và dữ liệu subject; xác nhận đúng object trước khi quyết định.", "Kiểm tra các layer, người được assign, quyết định cũ và trạng thái hiện tại.", "Approve để chuyển tiếp hoặc hoàn tất; Reject cần comment giải thích.", "Sau thông báo thành công, mở History và xác nhận approver/comment/timestamp đã được ghi.", "Quay lại business screen để xác nhận trạng thái campaign/project/exchange/reward đổi như dự kiến."],
      result: "Quyết định được ghi vào approval history; request có thể sang layer kế tiếp hoặc kết thúc APPROVED/REJECTED theo workflow.",
      notes: ["Mở notification chỉ đánh dấu đã đọc, không quyết định request.", "Không xử lý request nếu thông tin đối tượng đã stale; tải lại trước.", "Rejection comment bắt buộc cho audit trail."],
      scenarios: [{ title: "Không có nút Approve/Reject", when: "Request mở được nhưng không có controls quyết định.", steps: ["Kiểm tra request còn PENDING không.", "Kiểm tra bạn có phải assignee ở layer hiện tại và role có approval.inbox.", "Tải lại request để nhận trạng thái mới nhất."], expected: "Chỉ current approver mới có controls quyết định.", help: "Nếu request đã quyết định hoặc assigned cho người khác, liên hệ workflow owner thay vì dùng tài khoản khác để tự duyệt." }],
      imageAlt: "Approval inbox với request pending, decision controls và approval history.",
    },
    {
      title: "Process a request in Approval inbox", section: "Approvals", route: "/approvals",
      purpose: "Review a request assigned to the current approval layer, decide, and trace its decision history.",
      prerequisites: "You need approval.inbox and must be an approver in the current assignment snapshot. A requester cannot approve their own request.",
      steps: ["Open Approval inbox, select Inbox, then select a pending request.", "Review workflow/action key/subject/requester/justification and the subject data; verify the correct record.", "Check approval layers, assigned people, prior decisions, and current status.", "Approve to continue/complete, or Reject with an explanatory comment.", "After success, open History and verify approver, comment, and timestamp.", "Return to the business screen and confirm the campaign/project/exchange/reward status changed as expected."],
      result: "The decision is recorded; the request advances to another layer or ends APPROVED/REJECTED according to the workflow.",
      notes: ["Opening a notification marks it read; it does not decide the request.", "Reload if the subject data may have changed since the request was opened.", "A rejection comment is required for the audit trail."],
      scenarios: [{ title: "Approve/Reject controls are missing", when: "The request opens but no decision controls appear.", steps: ["Check that the request is still PENDING.", "Confirm you are assigned to its current layer and have approval.inbox.", "Reload the request to get the latest state."], expected: "Only the current approver can decide the request.", help: "If the request is already decided or assigned elsewhere, contact the workflow owner rather than switching accounts to self-approve." }],
      imageAlt: "Approval inbox showing a pending request, decision controls, and approval history.",
    }),

  // screenshot target: /rewards/new populated catalog editor, image, prices, stock, and eligibility.
  article("how-reward-catalog", 1370, "reward",
    {
      title: "Tạo reward trong catalog", section: "Campaigns & rewards", route: "/rewards/new",
      purpose: "Đăng phần thưởng mà member có thể đổi bằng điểm trong điều kiện áp dụng.",
      prerequisites: "Cần reward.manage; point type phải active. Chuẩn bị ảnh, giá theo từng type và chính sách tồn kho/thời gian.",
      steps: ["Mở Rewards → Create reward; nhập tên, mô tả và tải ảnh.", "Chọn category/status và thời gian áp dụng nếu có.", "Nhập giá theo các point type được nhận; kiểm tra đúng đơn vị.", "Nhập stock nếu giới hạn; để trống nếu muốn unlimited theo form.", "Cấu hình tier eligibility nếu cần và kiểm tra member nào được phép redeem.", "Save; mở customer catalog/preview và xác nhận tên, giá, ảnh, trạng thái và điều kiện."],
      result: "Reward active được hiển thị cho member đủ tier/điểm và còn stock trong thời hạn.",
      notes: ["Stock 0 không đồng nghĩa unlimited; không nhập 0 nếu form dùng blank để unlimited.", "Redemption sẽ trừ điểm và có thể cần xử lý fulfillment riêng.", "Reward hết hạn/inactive không nên xuất hiện để đổi mới."],
      scenarios: [{ title: "Member không thấy reward", when: "Reward đã lưu nhưng không hiển thị cho member.", steps: ["Kiểm tra active status và date window.", "Kiểm tra tier restriction, stock và point price.", "Xác nhận member đủ điểm của đúng point type."], expected: "Chỉ reward còn hiệu lực và đủ điều kiện hiển thị/đổi được.", help: "Kiểm tra customer account đúng chương trình/environment trước khi sửa catalog." }],
      imageAlt: "Reward editor với ảnh, point prices, stock và eligibility.",
    },
    {
      title: "Create a reward in the catalog", section: "Campaigns & rewards", route: "/rewards/new",
      purpose: "Publish a reward that members can redeem with points under the configured conditions.",
      prerequisites: "You need reward.manage and active point types. Prepare the image, prices by type, and stock/date policy.",
      steps: ["Open Rewards → Create reward; enter name/description and upload an image.", "Choose category/status and applicable dates if available.", "Set prices for accepted point types and verify units.", "Enter stock if limited; leave it blank for unlimited if that is the form's behavior.", "Configure tier eligibility if needed and review who can redeem.", "Save, then check the customer catalog/preview for name, price, image, status, and eligibility."],
      result: "An active reward is visible to members who meet tier/point requirements while it is in stock and in date range.",
      notes: ["Stock 0 is not necessarily unlimited; leave blank when the form defines blank as unlimited.", "Redemption deducts points and may require separate fulfillment handling.", "Expired/inactive rewards should not be available for new redemption."],
      scenarios: [{ title: "A member cannot see the reward", when: "A saved reward is missing from a member's catalog.", steps: ["Check active status and dates.", "Check tier restriction, stock, and point price.", "Confirm the member has enough of the required point type."], expected: "Only current and eligible rewards are shown/redeemable.", help: "Verify the customer is on the correct program/environment before changing catalog data." }],
      imageAlt: "Reward editor with uploaded image, point prices, stock, and eligibility.",
    }),

  // screenshot target: /rewards/:id/redemptions with member identity columns and fulfillment status.
  article("how-reward-fulfillment", 1380, "reward",
    {
      title: "Xử lý redemption và fulfillment reward", section: "Campaigns & rewards", route: "/rewards",
      purpose: "Tìm giao dịch đổi reward, nhận biết member bằng tên/email và cập nhật trạng thái xử lý giao phần thưởng.",
      prerequisites: "Cần reward.view và quyền cập nhật fulfillment tương ứng. Xác nhận nghiệp vụ giao hàng/dịch vụ đã hoàn tất trước khi đánh dấu.",
      steps: ["Mở reward và vào Redemption history.", "Tìm member theo tên/email; đối chiếu reward, ngày và số điểm đã khấu trừ.", "Đọc fulfillment status: Pending, Fulfilled hoặc Cancelled theo màn hình.", "Sau khi thực sự giao reward, chọn Fulfill và nhập lý do/reference nếu form yêu cầu.", "Sau thao tác, kiểm tra status, member name/email, ledger và notification nếu có.", "Nếu redemption bị hủy, dùng luồng Cancel chỉ khi chính sách cho phép và kiểm tra việc hoàn điểm."],
      result: "Fulfillment status phản ánh công việc nội bộ; nó không tự xác nhận một giao hàng ngoài hệ thống nếu chưa có thao tác thật.",
      notes: ["Không mark Fulfilled trước khi hàng/dịch vụ đã được giao.", "Fulfillment khác với redemption: member có thể đã bị trừ điểm khi redeem nhưng fulfillment vẫn Pending.", "Dùng memberId khi trùng tên/email."],
      scenarios: [{ title: "Không tìm thấy redemption", when: "Member báo đã đổi reward nhưng row không thấy.", steps: ["Chọn đúng reward và mở redemption history.", "Tìm theo email/tên và mở rộng khoảng ngày.", "Đối chiếu Transaction history/Ledger của member."], expected: "Redemption row xác nhận loại reward, người đổi và trạng thái fulfillment.", help: "Nếu chỉ có điểm bị trừ nhưng không có redemption record, escalates theo quy trình support; không tạo fulfillment giả." }],
      imageAlt: "Redemption history với tên/email member, reward và fulfillment status.",
    },
    {
      title: "Process reward redemption and fulfillment", section: "Campaigns & rewards", route: "/rewards",
      purpose: "Locate a redemption, identify the member by name/email, and update reward-delivery status.",
      prerequisites: "You need reward.view and the applicable fulfillment capability. Confirm the physical/service fulfillment is complete before marking it.",
      steps: ["Open the reward and select Redemption history.", "Find the member by name/email and verify the reward, date, and deducted points.", "Read the fulfillment state: Pending, Fulfilled, or Cancelled as shown.", "After delivery is actually complete, select Fulfill and provide a reason/reference if requested.", "Verify status, member name/email, Ledger, and any notification.", "Use Cancel only when policy permits and verify whether points are refunded."],
      result: "Fulfillment status records internal handling; it does not attest to an external delivery unless that delivery actually occurred.",
      notes: ["Do not mark Fulfilled before the reward/service is delivered.", "Redemption and fulfillment are separate; points can already be deducted while fulfillment is Pending.", "Use memberId to disambiguate duplicate names/emails."],
      scenarios: [{ title: "A redemption is not found", when: "A member says they redeemed but no row appears.", steps: ["Open the correct reward's redemption history.", "Search name/email and widen the date range.", "Compare the member's Transaction history/Ledger."], expected: "The redemption row identifies the reward, member, and fulfillment state.", help: "If points were deducted but no redemption exists, escalate through support; do not create a false fulfillment." }],
      imageAlt: "Redemption history with member name/email, reward, and fulfillment status.",
    }),

  // screenshot target: /coupons with a sanitized batch detail and coupon state/date columns.
  article("how-coupons-create-batch", 1390, "reward",
    {
      title: "Tạo và quản lý coupon batch nội bộ", section: "Campaigns & rewards", route: "/coupons",
      purpose: "Sinh và theo dõi coupon code bên trong LoyaltyOS; luồng checkout hoặc áp dụng coupon ở hệ thống ngoài không thuộc hướng dẫn này.",
      prerequisites: "Cần coupon.manage. Chuẩn bị trước benefit, số lượng code, giới hạn sử dụng và ngày hiệu lực vì nút Generate tạo batch ngay.",
      steps: ["Mở Coupons và tìm khu vực Generate Coupons.", "Nhập các giá trị batch mà form hỗ trợ, như prefix/tên, benefit hoặc discount, số lượng và giới hạn dùng.", "Nhập ngày bắt đầu/hết hạn nếu có; kiểm tra kỹ múi giờ và giá trị.", "Rà lại dữ liệu ngay trên form. Đây chưa phải preview và không có bước hủy trước khi tạo.", "Chọn Generate Coupons một lần để sinh mã; chờ kết quả rồi kiểm tra batch trong danh sách.", "Chỉ chia sẻ mã sau khi kiểm tra trạng thái và điều kiện; không đưa coupon thật vào ảnh hướng dẫn."],
      result: "LoyaltyOS tạo coupon codes theo giá trị đã nhập. Việc tạo mã không chứng minh mã được áp dụng ở checkout bên ngoài.",
      notes: ["Generate Coupons ghi dữ liệu ngay; không có màn hình preview/cancel trước khi tạo.", "Không tạo batch test trên production chỉ để chụp ảnh.", "Không chia sẻ mã thật trong tài liệu; việc sử dụng tại checkout ngoài app nằm ngoài phạm vi."],
      scenarios: [{ title: "Đã Generate nhầm số lượng hoặc benefit", when: "Batch đã được tạo nhưng giá trị nhập không đúng yêu cầu.", steps: ["Không bấm Generate lần nữa để bù hoặc sửa.", "Ghi lại thông tin batch và dừng phân phối các mã đó.", "Kiểm tra các thao tác quản lý đang hiển thị để vô hiệu hóa nếu có; nếu không có, nhờ Owner xử lý trước khi phát mã."], expected: "Không tạo batch trùng và mã sai không tiếp tục được phân phối.", help: "UI không có preview/cancel trước Generate; hãy rà kỹ form trước thao tác tạo." }],
      imageAlt: "Trang Coupons sau khi tạo batch, với coupon code đã được che.",
    },
    {
      title: "Create and manage an internal coupon batch", section: "Campaigns & rewards", route: "/coupons",
      purpose: "Generate and track coupon codes inside LoyaltyOS. External checkout or applying a coupon in another system is outside this guide.",
      prerequisites: "You need coupon.manage. Prepare the benefit, code quantity, usage limits, and validity dates because Generate creates the batch immediately.",
      steps: ["Open Coupons and locate Generate Coupons.", "Enter the batch values supported by the form, such as prefix/name, benefit or discount, quantity, and usage limits.", "Enter start/expiry dates if available; check the timezone and values carefully.", "Review the values on the form. This is not a preview, and there is no cancel-before-create step.", "Select Generate Coupons once and wait for the codes/batch to appear in the list.", "Check status and terms before sharing a code; do not put real codes in guide screenshots."],
      result: "LoyaltyOS creates coupon codes from the entered values. Creating a code does not prove that it can be used at an external checkout.",
      notes: ["Generate Coupons writes the batch immediately; there is no preview/cancel screen before creation.", "Do not create production test batches just to capture screenshots.", "Never expose real codes in guides; external checkout use is not covered here."],
      scenarios: [{ title: "A batch was generated with the wrong quantity or benefit", when: "The batch exists but one or more entered values were incorrect.", steps: ["Do not select Generate again to compensate or edit it.", "Record the batch details and stop distributing its codes.", "Review the management actions actually available to deactivate it; if none are offered, ask an Owner to resolve the batch before distribution."], expected: "No duplicate batch is created and incorrect codes are held back from distribution.", help: "The UI has no preview/cancel before Generate; check the form before creating." }],
      imageAlt: "Coupons list after a batch was generated, with coupon codes redacted.",
    }),

  // screenshot target: /credits/exchange rate configuration with a versioned active rate, no member PII.
  article("how-exchange-rate", 1400, "wallet",
    {
      title: "Cấu hình tỷ lệ Exchange mới", section: "Approvals & exchange", route: "/credits/exchange",
      purpose: "Tạo version tỷ lệ exchange mới; request cũ vẫn giữ snapshot rate đã áp dụng khi được tạo.",
      prerequisites: "Cần exchange.manage. Chuẩn bị point type, currency, payout mechanism, rate và min/max phù hợp policy; workflow exchange approval phải được cấu hình nếu request cần duyệt.",
      steps: ["Mở Exchange vouchers và chọn form tạo/activate rate.", "Chọn point type, currency, payout mechanism và value per point.", "Đặt min/max point và period limit nếu policy cần; để optional limit trống nếu thật sự unlimited.", "Review preview/currency units, thời điểm hiệu lực và các giới hạn.", "Activate rate mới; xác nhận version mới hiển thị trong rate history.", "Tạo request kiểm tra chỉ trong môi trường/test account được phép; xem request lưu rate version nào."],
      result: "Request mới dùng active rate version tại thời điểm submit; request cũ không bị tính lại theo rate mới.",
      notes: ["Không chỉnh trực tiếp rate cũ để sửa giao dịch đã gửi; tạo version mới.", "Giá trị currency minor units dễ nhầm đơn vị; đối chiếu ví dụ theo form.", "App ghi nhận accounting workflow nội bộ, không tự thực hiện chuyển tiền bên ngoài."],
      scenarios: [{ title: "Rate mới chưa áp dụng", when: "Request mới vẫn hiển thị tỷ lệ cũ.", steps: ["Kiểm tra version mới đã active chưa.", "Kiểm tra effective date/time và point type được request chọn.", "Tạo request mới; request cũ giữ snapshot cũ."], expected: "Chỉ request tạo sau khi rate version active dùng rate đó.", help: "Không dùng request cũ để kiểm tra rate version vừa thay đổi." }],
      imageAlt: "Exchange rate editor với point type, currency, limit và version active.",
    },
    {
      title: "Configure a new exchange rate", section: "Approvals & exchange", route: "/credits/exchange",
      purpose: "Create a new exchange-rate version; existing requests retain the rate snapshot captured when submitted.",
      prerequisites: "You need exchange.manage. Prepare the point type, currency, payout mechanism, rate, and policy limits. Configure the exchange approval workflow if requests require approval.",
      steps: ["Open Exchange vouchers and select the rate creation/activation form.", "Choose point type, currency, payout mechanism, and value per point.", "Set minimum/maximum points and period limit as policy requires; leave optional limits blank only when unlimited is intended.", "Review currency units, effective timing, and limits.", "Activate the new rate and verify its version in rate history.", "Create a request only in an approved test environment/account; inspect which rate version the request snapshots."],
      result: "New requests use the active rate version at submission time; existing requests are not repriced.",
      notes: ["Create a new version rather than editing a rate to rewrite submitted transactions.", "Currency minor units can be confusing; reconcile against the form's example.", "The app records an internal accounting workflow and does not transfer money externally."],
      scenarios: [{ title: "The new rate is not being used", when: "A new request still shows the previous rate.", steps: ["Confirm the new version is active.", "Check effective date/time and the point type selected by the request.", "Create a new request; old requests keep their prior snapshot."], expected: "Only requests created after activation use the new version.", help: "Do not use an older request to verify the latest rate." }],
      imageAlt: "Exchange rate form with point type, currency, limits, and active version.",
    }),

  // screenshot target: /credits/exchange request queue with status filter and an expanded request history.
  article("how-exchange-requests", 1410, "wallet",
    {
      title: "Xử lý Exchange voucher request", section: "Approvals & exchange", route: "/credits/exchange",
      purpose: "Tra cứu request exchange theo vòng đời và quyết định theo workflow; Complete chỉ ghi nhận hoàn tất nghiệp vụ đã xác minh.",
      prerequisites: "Cần exchange.view và action-specific permission; request pending có thể cần APPROVAL workflow active. Biết reference nghiệp vụ nếu muốn Complete.",
      steps: ["Mở Exchange vouchers và lọc theo Pending/Approved/Completed/Rejected/Cancelled.", "Mở request; kiểm tra member, point amount, currency/value, rate snapshot/version và ngày.", "Nếu pending, chọn Approve hoặc Reject theo workflow; rejection cần comment nếu form yêu cầu.", "Chỉ sau khi nghiệp vụ ngoài app thực sự hoàn tất, chọn Complete và nhập completion reference.", "Nếu hủy/từ chối, kiểm tra trạng thái refund; đối chiếu member Ledger.", "Xác nhận notification/approval history và trạng thái cuối."],
      result: "Request giữ snapshot tỷ lệ ban đầu và trạng thái kết thúc; hoàn điểm chỉ xảy ra theo luồng refund tương ứng.",
      notes: ["Approved không đồng nghĩa Completed.", "Không nhập reference giả và không Complete chỉ để ẩn pending.", "Exchange record là thông tin nội bộ, không chứng minh tiền đã chuyển."],
      scenarios: [{ title: "Member chưa được hoàn điểm sau Reject/Cancel", when: "Request status đổi nhưng balance chưa rõ.", steps: ["Mở request detail và xác nhận final status.", "Tìm giao dịch refund trong member Ledger theo thời điểm/point type.", "Kiểm tra request có đi qua handler refund hay không."], expected: "Nếu luồng có hoàn tiền, balance và Ledger thể hiện giao dịch bù tương ứng.", help: "Không tạo adjustment refund trùng trước khi đối chiếu ledger và request ID." }],
      imageAlt: "Exchange request queue có filter trạng thái, rate snapshot và history.",
    },
    {
      title: "Process an exchange voucher request", section: "Approvals & exchange", route: "/credits/exchange",
      purpose: "Track an exchange request through its workflow; Complete records a verified fulfillment, not a preview.",
      prerequisites: "You need exchange.view and the action-specific permission. Pending requests may require an active approval workflow. Have the business completion reference before marking complete.",
      steps: ["Open Exchange vouchers and filter Pending/Approved/Completed/Rejected/Cancelled.", "Open a request and inspect member, points, currency/value, rate snapshot/version, and date.", "For pending requests, Approve or Reject according to workflow; provide a rejection comment when required.", "Only after the external business process is actually complete, choose Complete and enter its reference.", "For rejected/cancelled requests, verify refund state and reconcile the member Ledger.", "Confirm notification/approval history and final status."],
      result: "The request retains its original rate snapshot and final status; points are refunded only through the configured refund flow.",
      notes: ["Approved is not the same as Completed.", "Do not invent a reference or complete a request merely to clear a pending row.", "The exchange record is internal and does not prove money was transferred."],
      scenarios: [{ title: "Points do not appear refunded after rejection/cancellation", when: "The request changed state but the balance is unclear.", steps: ["Open request detail and confirm its final state.", "Search the member Ledger by time and point type for a refund.", "Check whether the request used the refund handler."], expected: "If the flow refunds, balance and Ledger show the corresponding compensating transaction.", help: "Do not create a duplicate adjustment before reconciling the request ID and Ledger." }],
      imageAlt: "Exchange request queue with status filter, rate snapshot, and history.",
    }),

  // screenshot target: /logs showing filters and a sanitized expanded audit record.
  article("how-logs-filter-audit", 1420, "table",
    {
      title: "Lọc Logs và đọc audit record", section: "Logs và Data export", route: "/logs",
      purpose: "Tìm ai đã làm gì, ở tính năng nào, thời điểm nào và record/audit payload liên quan.",
      prerequisites: "Cần audit.view. Khi chia sẻ log, redact email, token, IDs nhạy cảm và payload không liên quan.",
      steps: ["Mở Logs; đặt date range trước để giới hạn dữ liệu.", "Lọc theo actor, actor type, action type, feature và text search; có thể kết hợp nhiều điều kiện.", "Mở record để đọc target type/ID và payload changes; dùng ID để quay lại member/campaign/project tương ứng.", "Đối chiếu audit action với Ledger nếu cần biết số điểm thay đổi.", "Đối chiếu Approval history nếu cần biết ai approve/reject.", "Reset filters nếu kết quả rỗng rồi thử từng filter riêng."],
      result: "Log xác định hành động ứng dụng được audit; không phải mọi request thất bại đều tạo record.",
      notes: ["Không dùng Logs thay Ledger để đối soát balance.", "Payload có thể chứa dữ liệu cá nhân/nghiệp vụ; chỉ export/share trong phạm vi quyền.", "Nếu action chưa commit, kiểm tra request status/API server logs theo quy trình vận hành."],
      scenarios: [{ title: "Log không hiện cho thao tác vừa làm", when: "Tìm actor/action nhưng không có row.", steps: ["Mở rộng khoảng ngày và kiểm tra timezone.", "Bỏ dần action/feature filters để tìm điều kiện quá hẹp.", "Xác định thao tác có thực sự thành công hay chỉ trả lỗi."], expected: "Successful audited actions xuất hiện khi filter bao đúng thời điểm/actor.", help: "Failed request không nhất thiết có audit row; kiểm tra request response và server logs nếu cần." }],
      imageAlt: "Logs filter và audit payload đã redact thông tin nhạy cảm.",
    },
    {
      title: "Filter Logs and read an audit record", section: "Logs and Data export", route: "/logs",
      purpose: "Find who did what, in which feature, when, and which target/audit payload was recorded.",
      prerequisites: "You need audit.view. Redact emails, tokens, sensitive IDs, and unrelated payload before sharing a log.",
      steps: ["Open Logs and set a date range to narrow results.", "Filter by actor, actor type, action type, feature, and text; combine filters when useful.", "Open a record to inspect target type/ID and payload changes; use the ID to locate the related member/campaign/project.", "Compare with Ledger when you need point balance changes.", "Compare with Approval history when you need approver/rejector details.", "Reset filters if no results appear, then try each filter separately."],
      result: "Logs identify audited application actions; not every failed request creates an audit record.",
      notes: ["Do not use Logs instead of Ledger for balance reconciliation.", "Payloads may contain personal/business data; export/share only within your authorization.", "If an action did not commit, use request status/API server logs through the operations process."],
      scenarios: [{ title: "The latest action is not in Logs", when: "No row appears for the actor/action just performed.", steps: ["Widen the date range and check timezone.", "Remove action/feature filters one at a time.", "Confirm whether the operation succeeded or returned an error."], expected: "Successful audited actions appear when filters include their actor/time.", help: "A failed request may not create an audit row; inspect the response/server logs if necessary." }],
      imageAlt: "Logs filters and a sanitized audit payload.",
    }),

  // screenshot target: /exports with dataset selector and chosen human-readable columns before download (no row filters).
  article("how-data-export-fields", 1430, "export",
    {
      title: "Chọn dataset và trường khi Data export", section: "Logs và Data export", route: "/exports",
      purpose: "Xuất CSV dễ đọc, chỉ gồm loại dữ liệu và cột cần dùng.",
      prerequisites: "Cần exports.view cùng capability dataset tương ứng. Xác định người nhận file và chỉ chọn trường cần thiết.",
      steps: ["Mở Data export và chọn dataset như Members, Ledger, bank cycles, Campaigns, Events hoặc Approvals.", "Đọc mô tả từng cột; tích các field cần xuất và bỏ các field không liên quan.", "Rà lại dataset và các cột đã chọn; trang này không có bộ lọc bản ghi hay preview số dòng.", "Chọn Export CSV và mở file được tải xuống.", "Kiểm tra header, encoding tiếng Việt, nhãn cột và một vài dòng dữ liệu.", "Nếu dùng file để update member, giữ memberId và header định danh; lưu/chia sẻ file theo chính sách dữ liệu."],
      result: "CSV chỉ chứa dataset/field được chọn trong phạm vi quyền truy cập.",
      notes: ["Export có thể chứa email, balance, approval comments hoặc audit payload nhạy cảm.", "Danh sách bản ghi tuân theo dataset/quyền hiện tại; UI chưa có bộ lọc tùy chỉnh.", "Không export JSON nội bộ để đưa trực tiếp cho người dùng nếu có dataset CSV thân thiện."],
      scenarios: [{ title: "Không thấy dataset hoặc field", when: "Danh sách export thiếu dataset/cột mong muốn.", steps: ["Kiểm tra exports.view và capability xem dataset tương ứng.", "Chọn lại dataset vì field list phụ thuộc loại dữ liệu.", "Hỏi owner nếu dataset không nằm trong catalog."], expected: "Chỉ dataset được phép xuất hiện; không có quyền thì không thể export qua UI.", help: "Không tự lấy dữ liệu qua API thay cho quyền bị thiếu." }],
      imageAlt: "Data export với dataset và các cột đã chọn trước khi tải CSV.",
    },
    {
      title: "Choose a dataset and fields in Data export", section: "Logs and Data export", route: "/exports",
      purpose: "Download a readable CSV containing only the data and columns needed.",
      prerequisites: "You need exports.view and the capability for the selected dataset. Know who will receive the file and minimize selected fields.",
      steps: ["Open Data export and choose a dataset such as Members, Ledger, bank cycles, Campaigns, Events, or Approvals.", "Read field descriptions, select the columns you need, and deselect unrelated data.", "Review the dataset and selected columns; this page has no custom row filters or row-count preview.", "Select Export CSV and open the downloaded file.", "Check the header, Vietnamese encoding, column labels, and a few rows.", "For member updates, preserve memberId and identity headers; store and share the file according to data policy."],
      result: "The CSV contains only selected fields and records permitted by your role.",
      notes: ["Exports may contain sensitive email, balances, approval comments, or audit payloads.", "The dataset and your current permissions define which records are included; the UI has no custom row filters.", "Prefer a human-readable CSV catalog over internal JSON dumps."],
      scenarios: [{ title: "A dataset or field is missing", when: "The export catalog does not show the desired dataset/column.", steps: ["Check exports.view and the capability for that dataset.", "Select the correct dataset because field lists depend on it.", "Ask an Owner whether the dataset is in the supported catalog."], expected: "Only authorized datasets are listed and exportable through the UI.", help: "Do not bypass missing permissions by calling the API directly." }],
      imageAlt: "Data export dataset and selected columns before downloading a CSV.",
    }),

  // screenshot target: /notification-templates with all locale columns and supported variable catalog visible.
  article("how-notification-templates", 1440, "automation",
    {
      title: "Sửa notification template nhiều ngôn ngữ", section: "Automation & governance", route: "/notification-templates",
      purpose: "Cấu hình nội dung cho từng notification type/channel và cập nhật nhiều locale trên cùng màn hình.",
      prerequisites: "Cần notification.manage. Xác định trigger, channel và các locale được app hỗ trợ; chỉ dùng biến từ catalog hiển thị.",
      steps: ["Mở Notification templates và chọn notification type/trigger.", "Kiểm tra channel và các cột ngôn ngữ đang hiển thị; không đổi locale nếu muốn chỉnh nhiều ngôn ngữ cùng lúc.", "Mở variable catalog, copy đúng key như member.firstName/campaign.name/points vào subject/body.", "Soạn bản dịch riêng cho từng locale, đảm bảo link/CTA và nội dung trạng thái tương đương.", "Xem preview nếu có, kiểm tra biến không render rỗng và lưu.", "Tạo/nhận notification hợp lệ trong môi trường phù hợp rồi kiểm tra customer language tương ứng."],
      result: "Notification trigger dùng template đã lưu cho channel và locale tương ứng.",
      notes: ["Biến không nằm trong catalog có thể để nguyên hoặc render rỗng.", "Không chèn password, API secret, token hoặc dữ liệu nhạy cảm.", "Thiếu bản dịch có thể dùng fallback; kiểm tra cả ngôn ngữ mặc định và tiếng Việt."],
      scenarios: [{ title: "Biến hiển thị trống", when: "Preview/notification không thay biến thành nội dung.", steps: ["Đối chiếu chính tả và dấu chấm với variable catalog.", "Kiểm tra record trigger có dữ liệu member/campaign tương ứng.", "Kiểm tra locale/channel template đã được lưu."], expected: "Biến hợp lệ render từ dữ liệu có trong trigger context.", help: "Nếu context không có field, chọn biến khác được hỗ trợ thay vì tự đặt tên biến mới." }],
      imageAlt: "Notification template editor với nhiều locale và danh sách biến được hỗ trợ.",
    },
    {
      title: "Edit notification templates in multiple languages", section: "Automation & governance", route: "/notification-templates",
      purpose: "Configure content per notification type/channel and edit supported locales side by side.",
      prerequisites: "You need notification.manage. Identify trigger, channel, supported locales, and use only variables listed in the catalog.",
      steps: ["Open Notification templates and select the notification type/trigger.", "Review the channel and locale columns; keep the multi-language editor open if editing several languages.", "Open the variable catalog and copy exact keys such as member.firstName/campaign.name/points into subject/body.", "Write equivalent text for each locale, preserving links/CTAs and state meaning.", "Preview if available, check that variables resolve, and save.", "Generate/receive a valid notification in an appropriate environment and verify the selected customer language."],
      result: "The trigger uses the saved template for the matching channel and locale.",
      notes: ["Unsupported variables may remain literal or render blank.", "Never insert passwords, API secrets, tokens, or sensitive data.", "A missing translation may fall back; test both the default locale and Vietnamese."],
      scenarios: [{ title: "A variable renders blank", when: "Preview/notification does not replace a variable.", steps: ["Check spelling and dots against the variable catalog.", "Confirm the triggering record contains the related member/campaign value.", "Confirm the locale/channel template was saved."], expected: "Supported variables render from available trigger context.", help: "If context lacks the field, use a supported variable rather than inventing a new key." }],
      imageAlt: "Notification template editor showing multiple locales and the supported-variable catalog.",
    }),

  // screenshot target: /dashboard with inline Metric/title builder and saved widgets (no personal data).
  article("how-dashboard-widgets", 1450, "dashboard",
    {
      title: "Tùy chỉnh dashboard bằng widget có sẵn", section: "Dashboard", route: "/",
      purpose: "Chọn metric hoặc biểu đồ dựng sẵn cho dashboard cá nhân; không tạo truy vấn hay cấu hình phân tích tùy ý.",
      prerequisites: "Cần dashboard.view và quyền xem dữ liệu liên quan. Layout được lưu theo tài khoản Admin và dùng được trên các thiết bị.",
      steps: ["Mở Dashboard rồi chọn Customize dashboard.", "Trong khung cấu hình ngay trên trang, chọn Metric và nhập Title nếu muốn.", "Chọn Add widget; widget được thêm và layout tự lưu vào tài khoản.", "Để bỏ widget, chọn biểu tượng xóa trên thẻ; thay đổi cũng được tự lưu. Không có thao tác kéo/thả sắp xếp.", "Đối chiếu metric với trang nguồn tương ứng.", "Trên thiết bị khác, đăng nhập cùng tài khoản Admin để thấy layout đã lưu."],
      result: "Dashboard hiển thị widget đã chọn; cùng một tài khoản Admin thấy layout đó trên các thiết bị.",
      notes: ["Bạn có thể thêm/bỏ widget nhưng không tự chọn grouping, point type, bộ lọc hoặc công thức.", "Dashboard cá nhân không thay thế report dùng chung hoặc Ledger.", "Đối soát giao dịch cần mở Ledger hoặc trang nguồn."],
      scenarios: [{ title: "Dashboard trống hoặc widget lỗi", when: "Widget không tải hoặc không có số.", steps: ["Kiểm tra role có dashboard.view và quyền dữ liệu cần thiết.", "Chọn khoảng thời gian có giao dịch.", "Xóa widget bị lỗi rồi thêm lại nếu cấu hình không còn hợp lệ."], expected: "Các widget hợp lệ hiển thị dữ liệu thuộc phạm vi quyền.", help: "Đối chiếu trang nguồn trước khi kết luận số liệu hệ thống sai." }],
      imageAlt: "Dashboard Customize panel với danh sách widget dựng sẵn.",
    },
    {
      title: "Customize a dashboard with built-in widgets", section: "Dashboard", route: "/",
      purpose: "Choose a few basic metrics/charts for routine monitoring without replacing the Ledger or exports.",
      prerequisites: "You need dashboard.view and access to the relevant data. The layout is saved to your Admin account and follows it across devices.",
      steps: ["Open Dashboard and select Customize dashboard.", "In the inline builder, choose a Metric and optionally enter a Title.", "Select Add widget; it appears on the dashboard and saves automatically to your account.", "To remove a widget, select its remove icon; that change also saves automatically. Widgets cannot be dragged or rearranged.", "Compare values with the corresponding source page.", "On another device, sign in to the same Admin account to see the saved layout."],
      result: "The dashboard shows your selected widgets, and the same Admin account sees them across devices.",
      notes: ["You can add/remove built-in widgets but cannot define arbitrary grouping, point-type filters, row filters, or formulas.", "A personal dashboard is not a shared report or a Ledger.", "Open Ledger or the source page to reconcile transactions."],
      scenarios: [{ title: "My layout differs on another device", when: "Widgets saved on one device are missing on another.", steps: ["Confirm both sessions use the same Admin account.", "Refresh Dashboard and check whether the change finished saving.", "If it is still missing, ask an Owner to check dashboard preference access."], expected: "A saved layout is shared across devices for the same Admin account.", help: "Different Admin accounts have separate personal dashboards." }],
      imageAlt: "Dashboard customization with the available built-in widgets.",
    }),
];

// Additional real-world edge cases for the focused procedures above. Kept
// separate so the original guide copy stays intact while every procedure has
// bilingual troubleshooting coverage.
const secondAdminScenarios: Record<string, { vi: GuideScenario; en: GuideScenario }> = {
  "how-event-registration-onboarding": {
    vi: { title: "Member thấy claim pending thay vì số dư", when: "Campaign onboarding dùng chế độ Member claim.", steps: ["Mở campaign và kiểm tra Issuance mode.", "Nếu là Member claim, đăng nhập bằng member và mở mục claim đang chờ.", "Xác nhận claim rồi xem lại Credits/transactions."], expected: "Điểm chỉ vào ví sau khi member claim; claim pending không đồng nghĩa với lỗi event.", help: "Nếu campaign chọn Automatic issue, kiểm tra issuance status thay vì chờ nút claim." },
    en: { title: "The member sees a pending claim instead of a balance", when: "The onboarding campaign uses Member claim mode.", steps: ["Open the campaign and check its Issuance mode.", "If it is Member claim, sign in as the member and open pending claims.", "Claim the award and then recheck Credits/transactions."], expected: "Points enter the wallet after the member claims; a pending claim does not mean the event failed.", help: "For Automatic issue, inspect issuance status instead of waiting for a claim button." },
  },
  "how-event-member-date": {
    vi: { title: "Event có field ngày nhưng không khớp member", when: "Field Date đã chọn được nhưng thành viên vẫn không được nhận.", steps: ["Mở hồ sơ member và kiểm tra chính field ngày mà event đang tham chiếu.", "Điền giá trị ngày hợp lệ rồi lưu hồ sơ.", "Kiểm tra event/campaign còn Active và đợi lần xử lý theo lịch tiếp theo."], expected: "Member chỉ khớp khi field ngày trên chính hồ sơ có giá trị phù hợp.", help: "Field tồn tại trong registry không tự điền dữ liệu cho mọi member." },
    en: { title: "The event has a date field but does not match a member", when: "The Date field is selectable but a member still does not qualify.", steps: ["Open the member profile and inspect the exact date field referenced by the event.", "Enter a valid date and save the profile.", "Confirm the event/campaign is still active and allow the next scheduled evaluation."], expected: "A member matches only when that member's field contains a qualifying date.", help: "Creating a field in the registry does not populate it on existing members." },
  },
  "how-event-fixed-date": {
    vi: { title: "Fixed-date event đã lưu nhưng đang inactive", when: "Event không kích hoạt dù ngày đã được cấu hình.", steps: ["Mở Event definitions và kiểm tra tab Active events/Inactive events.", "Nếu event nằm ở Inactive events, chọn Activate.", "Quay lại campaign và xác nhận campaign cũng đang Active, còn trong khoảng ngày chạy."], expected: "Chỉ event Active cùng campaign đủ điều kiện mới được xử lý.", help: "Ngày preview đúng không tự bật trạng thái event." },
    en: { title: "The fixed-date event is saved but inactive", when: "The event does not trigger even though its date is configured.", steps: ["Open Event definitions and check the Active events/Inactive events tabs.", "If the event is under Inactive events, select Activate.", "Return to the campaign and confirm it is active and within its run dates."], expected: "Only an active event and an eligible active campaign are processed.", help: "A correct preview date does not activate an event." },
  },
  "how-event-manual": {
    vi: { title: "Đang kỳ vọng manual event lặp lại", when: "Một manual event đã chạy nhưng lần sau không tự chạy lại.", steps: ["Mở event và xác nhận loại là Manual.", "Kiểm tra trạng thái campaign và issuance record của lần chạy.", "Dùng Manual cho lần chạy một lần sau phê duyệt; không xem nó như lịch lặp tự động."], expected: "Manual event được thiết kế cho một lần chạy khi campaign được duyệt, không phải trigger định kỳ.", help: "Không tạo event trùng chỉ để thử lại khi lần chạy đầu đã phát sinh." },
    en: { title: "A manual event was expected to repeat", when: "A manual event ran once but did not run again later.", steps: ["Open the event and confirm its type is Manual.", "Check the campaign status and the issuance record for that run.", "Use Manual for a one-time run after approval; do not treat it as a recurring schedule."], expected: "A Manual event is intended to run once when its campaign is approved, not as a recurring trigger.", help: "Do not create a duplicate event just to retry a run that already issued." },
  },
  "how-event-checkin": {
    vi: { title: "Member điểm danh lần hai trong cùng ngày", when: "Member thử check-in thêm nhưng không tạo lần ghi nhận mới.", steps: ["Mở calendar và xác định ô ngày hiện tại theo ngày local của ứng dụng.", "Kiểm tra hoạt động check-in đã được ghi cho member trong ngày chưa.", "Nếu đã có, thử lại vào ngày local tiếp theo; không tạo request lặp trong cùng ngày."], expected: "Mỗi member chỉ check-in một lần trong một ngày local.", help: "Calendar tô màu ngày đã ghi nhận; campaign bị pause sẽ ẩn cả check-in và calendar." },
    en: { title: "A member tries to check in twice on the same day", when: "A second attempt does not create another check-in record.", steps: ["Open the calendar and identify today's date in the app's local day.", "Check whether this member already has a check-in recorded today.", "If so, try again on the next local day instead of submitting a duplicate."], expected: "Each member can check in once per local day.", help: "The calendar marks recorded days; pausing the campaign hides both check-in and the calendar." },
  },
  "how-event-external": {
    vi: { title: "External event không dùng được với Standing campaign", when: "Event external có trong danh sách nhưng policy Standing không cho chọn.", steps: ["Mở campaign builder và kiểm tra policy đang chọn.", "Chọn Approval required cho event external.", "Đảm bảo workflow approval cho action campaign issuance đã cấu hình trước khi submit."], expected: "Event external cần campaign theo luồng approval; chỉ tên event không tự phát trigger.", help: "Integration phải gửi đúng event key thì hệ thống mới nhận được event." },
    en: { title: "An external event cannot be used with a Standing campaign", when: "The external event exists but the Standing policy does not allow it.", steps: ["Open the campaign builder and check the selected policy.", "Choose Approval required for an external event.", "Ensure the campaign-issuance approval workflow is configured before submission."], expected: "External events use the approval campaign flow; naming an event alone does not emit a trigger.", help: "An integration must report the exact event key for the application to receive it." },
  },
  "how-project-plan-approval": {
    vi: { title: "Project plan thiếu trường tùy chỉnh bắt buộc", when: "Form không cho lưu hoặc gửi kế hoạch.", steps: ["Đọc thông báo validation trong form project planning.", "Điền các trường bắt buộc được cấu hình trong Member/Project fields.", "Kiểm tra lại loại điểm và budget rồi lưu nháp hoặc gửi approval."], expected: "Kế hoạch chỉ được gửi khi các dữ liệu bắt buộc hợp lệ.", help: "Lưu draft không thay thế phê duyệt budget; project chỉ mở cho quản lý sau khi được duyệt và activate." },
    en: { title: "A project plan is missing a required custom field", when: "The form will not save or submit the plan.", steps: ["Read the validation message in project planning.", "Fill the required fields configured for project planning.", "Recheck point types and budget, then save a draft or submit for approval."], expected: "The plan can be submitted only when required values are valid.", help: "Saving a draft does not approve the budget; project management opens only after approval and activation." },
  },
  "how-project-invite-members": {
    vi: { title: "Project được duyệt nhưng chưa thể mời member", when: "Nút hoặc danh sách invite chưa khả dụng sau khi plan được duyệt.", steps: ["Kiểm tra project status trong trang Projects.", "Nếu status mới là APPROVED, chọn Activate project.", "Mở danh sách member và tìm người cần mời sau khi project chuyển ACTIVE."], expected: "Chỉ project ACTIVE mới đi vào bước mời/enroll member.", help: "Được duyệt kế hoạch không đồng nghĩa project đã được activate." },
    en: { title: "The project is approved but members cannot be invited yet", when: "Invite actions or the member list are unavailable after plan approval.", steps: ["Check the project status on Projects.", "If it is only APPROVED, select Activate project.", "Open the member list and search for invitees after the project becomes ACTIVE."], expected: "Member enrollment is available once the project is ACTIVE.", help: "Plan approval does not itself activate the project." },
  },
  "how-project-tasks": {
    vi: { title: "Người được giao task chưa nhận lời mời project", when: "Không tìm thấy member trong danh sách người nhận task.", steps: ["Mở Participants và kiểm tra trạng thái lời mời của member.", "Yêu cầu member accept invitation ở Customer portal.", "Tải lại task editor rồi chọn member đã tham gia."], expected: "Task có thể giao cho participant đã accept project.", help: "Không dùng trạng thái invited/pending như thể member đã enroll." },
    en: { title: "The intended task assignee has not accepted the project invitation", when: "The member is missing from the task assignee selector.", steps: ["Open Participants and check the member's invitation state.", "Have the member accept the invitation in the Customer portal.", "Reload the task editor and select the enrolled participant."], expected: "Tasks can be assigned to a participant who has accepted the project.", help: "An invited/pending member is not yet an enrolled participant." },
  },
  "how-project-complete-distribute": {
    vi: { title: "Chưa có participant để phân bổ điểm", when: "Bảng phân bổ không có member nhận điểm.", steps: ["Mở Participants và kiểm tra member nào đã accept invitation.", "Mời thêm member nếu cần và chờ họ accept.", "Quay lại distribution, nhập số điểm hoặc phần trăm cho participant đã tham gia."], expected: "Chỉ participant của project mới được chọn làm người nhận phân bổ.", help: "Không cộng tổng phân bổ vào member đang ở trạng thái invitation pending." },
    en: { title: "There are no project participants to receive an allocation", when: "The distribution table has no eligible members.", steps: ["Open Participants and check who has accepted an invitation.", "Invite additional members if needed and wait for their acceptance.", "Return to distribution and enter points or percentages for enrolled participants."], expected: "Only project participants can receive a project allocation.", help: "Do not allocate to members whose invitations are still pending." },
  },
  "how-point-type-create": {
    vi: { title: "Không chọn được cash payout cho point type", when: "Rate payout type không có lựa chọn cash.", steps: ["Mở Point type registry và sửa point type liên quan.", "Bật Exchangeable nếu chính sách cho phép exchange.", "Chỉ bật Cash eligible khi loại điểm được phép đổi ra cash; lưu rồi quay lại rate."], expected: "Cash payout chỉ khả dụng với loại điểm được bật exchange và cho phép cash.", help: "Không bật exchange chỉ để làm xuất hiện một lựa chọn nếu chính sách không cho phép." },
    en: { title: "Cash payout is unavailable for a point type", when: "The rate payout selector does not offer cash.", steps: ["Open Point type registry and edit the relevant type.", "Enable Exchangeable if policy permits exchange.", "Enable Cash eligible only when this point type may be exchanged for cash; save and return to rates."], expected: "Cash payout is available only for an exchangeable type that permits cash.", help: "Do not enable exchange solely to reveal an option if policy does not allow it." },
  },
  "how-point-expiry": {
    vi: { title: "Khoản nhận mới không có lại đủ số ngày expiry", when: "Member nhận điểm sau ngày tạo point type và kỳ vọng hạn được tính lại từ lần nhận.", steps: ["Mở point type và đọc expiry policy đang cấu hình.", "Kiểm tra policy là mốc tính từ lúc tạo point type hay số ngày sau mỗi lần nhận.", "Đối chiếu expiry date của grant trong member wallet/ledger."], expected: "Với policy expiry cố định từ ngày tạo point type, grant sau này dùng cùng mốc, không tự cộng lại đủ số ngày.", help: "Chỉ thay policy sau khi đánh giá ảnh hưởng tới điểm hiện có và giao dịch mới." },
    en: { title: "A later grant does not receive a fresh full expiry period", when: "A member receives points after point-type creation and expects expiry to restart from receipt.", steps: ["Open the point type and read its expiry policy.", "Check whether the policy is anchored to point-type creation or counts days after each grant.", "Compare the grant expiry shown in the member wallet/ledger."], expected: "With expiry anchored to point-type creation, later grants use the same date rather than restarting the full period.", help: "Change a policy only after considering its effect on existing value and future grants." },
  },
  "how-wallet-adjustment": {
    vi: { title: "Remove điểm nhưng kỳ vọng là trừ khỏi admin bank", when: "Bạn muốn thu hồi điểm khỏi ví member.", steps: ["Tìm đúng memberId và point type.", "Chọn Remove points and return to bank, không chọn Add.", "Nhập số dương, lý do nghiệp vụ rồi xác nhận; đối chiếu member balance và admin bank."], expected: "Remove giảm ví member và hoàn giá trị về admin bank; lý do được lưu cùng giao dịch.", help: "Point type phải còn active để xuất hiện trong form adjustment." },
    en: { title: "Remove points but expect them to leave the admin bank", when: "You need to reclaim points from a member wallet.", steps: ["Find the exact memberId and point type.", "Choose Remove points and return to bank, not Add.", "Enter a positive amount and a business reason, confirm, then reconcile member balance and admin bank."], expected: "Remove reduces the member wallet and returns value to the admin bank; the reason is retained with the transaction.", help: "The point type must be active to appear in the adjustment form." },
  },
  "how-bank-funding": {
    vi: { title: "Không thể tạo funding vì thiếu reason", when: "Nút Funding bị khóa hoặc request bị từ chối do form chưa đủ dữ liệu.", steps: ["Chọn bank/point type cần nạp.", "Nhập số điểm dương và Funding reason mô tả nguồn hoặc mục đích.", "Tạo funding rồi kiểm tra bank balance và bank transaction history."], expected: "Funding có số tiền và reason được lưu vào bank mà không gắn với member cụ thể.", help: "Bank funding không phải giao dịch ví member nên không có member email là bình thường." },
    en: { title: "Funding cannot be created because the reason is missing", when: "The Funding button is disabled or the incomplete form is rejected.", steps: ["Choose the bank/point type to fund.", "Enter a positive amount and a Funding reason describing the source or purpose.", "Create the funding entry and check the bank balance and bank transaction history."], expected: "Funding with an amount and reason is recorded in the bank without a specific member target.", help: "Bank funding is not a member-wallet transaction, so no member email is expected." },
  },
  "how-bank-cycles": {
    vi: { title: "Không đóng được bank cycle vì thiếu lý do", when: "Xác nhận đóng cycle bị hủy dù cycle đang mở.", steps: ["Mở đúng cycle và chọn đóng/clear.", "Nhập closing reason vào prompt xác nhận.", "Xác nhận rồi mở chi tiết cycle để xem người đóng, lý do và giao dịch trong kỳ."], expected: "Cycle chuyển CLEARED và lưu lý do đóng; số allocated phản ánh phân bổ ròng sau hoàn điểm.", help: "Đóng cycle giữ lại phần bank chưa dùng, không xóa lịch sử giao dịch." },
    en: { title: "A bank cycle cannot be closed without a reason", when: "The close confirmation is cancelled even though the cycle is open.", steps: ["Open the correct cycle and choose close/clear.", "Enter a closing reason in the confirmation prompt.", "Confirm, then open cycle details to review who closed it, the reason, and in-cycle transactions."], expected: "The cycle becomes CLEARED and records the reason; allocated reflects net allocations after returns.", help: "Closing retains unused bank value and does not erase transaction history." },
  },
  "how-ledger-find-transaction": {
    vi: { title: "Kết hợp nhiều filter làm mất kết quả", when: "Biết transaction tồn tại nhưng Ledger hiển thị rỗng.", steps: ["Xóa các filter tùy chọn, giữ lại khoảng ngày rộng.", "Tìm bằng member email hoặc transaction type trước.", "Thêm từng filter actor/action/point type/cycle và kiểm tra kết quả sau mỗi lần."], expected: "Có thể xác định filter nào loại transaction khỏi kết quả.", help: "Bank funding nằm ở lịch sử bank và không có member target; chọn đúng loại giao dịch khi tìm." },
    en: { title: "Combining filters hides the transaction", when: "You know a transaction exists but Ledger returns no rows.", steps: ["Clear optional filters and use a broad date range.", "Search by member email or transaction type first.", "Add actor/action/point type/cycle filters one at a time and check results after each."], expected: "You can identify which filter excludes the transaction.", help: "Bank funding is in bank history and has no member target; use the appropriate transaction view." },
  },
  "how-segment-dynamic": {
    vi: { title: "AND/OR làm segment rộng hoặc hẹp hơn dự kiến", when: "Preview member count khác với ý định của rule.", steps: ["Đọc logic AND/OR hiển thị giữa các điều kiện.", "Tạm bỏ từng điều kiện và xem preview thay đổi thế nào.", "Chọn AND nếu cần thỏa tất cả điều kiện, OR nếu chỉ cần thỏa một điều kiện rồi lưu."], expected: "Preview thể hiện đúng tập member theo logic đã chọn.", help: "Kiểm tra kiểu dữ liệu/date range của từng rule trước khi đưa segment vào campaign." },
    en: { title: "AND/OR makes the segment broader or narrower than expected", when: "The preview count differs from the intended rule.", steps: ["Read the AND/OR logic shown between conditions.", "Temporarily remove one condition at a time and watch the preview.", "Use AND to require all conditions or OR to match any condition, then save."], expected: "The preview reflects the member set implied by the selected logic.", help: "Check each rule's data type/date range before attaching the segment to a campaign." },
  },
  "how-segment-static": {
    vi: { title: "Chọn tất cả kết quả lọc", when: "Cần chọn một nhóm theo search/filter qua nhiều trang.", steps: ["Đặt search/status/department filters trước.", "Chọn Select all search results để lấy mọi member khớp trên các trang.", "Nếu dùng checkbox hàng đầu bảng thì nó chỉ chọn các dòng đang thấy."], expected: "Segment chứa đúng kết quả lọc đã chọn.", help: "Kiểm tra filter và tổng kết quả trước khi chọn tất cả." },
    en: { title: "Select all filtered results", when: "You need a searched/filtered group across multiple pages.", steps: ["Set search/status/department filters first.", "Select Select all search results to include every match across pages.", "The table header checkbox only selects rows currently visible."], expected: "The segment contains the intended filtered selection.", help: "Check the filters and total result count before selecting all." },
  },
  "how-tiers-configure": {
    vi: { title: "Member đạt một ngưỡng nhưng chưa lên tier", when: "Member đáp ứng một loại điểm nhưng tier vẫn chưa đạt.", steps: ["Mở tier và kiểm tra các point type cùng ngưỡng cấu hình.", "Kiểm tra rule logic đang là AND hay OR.", "Đối chiếu số dư/member progress cho từng loại điểm rồi lưu logic phù hợp."], expected: "AND yêu cầu đủ mọi ngưỡng; OR chỉ yêu cầu một ngưỡng khớp.", help: "Tiến độ tổng hợp không thay thế việc kiểm tra từng loại điểm trong điều kiện tier." },
    en: { title: "A member meets one threshold but has not reached the tier", when: "The member qualifies for one point type but the tier remains unmet.", steps: ["Open the tier and inspect its point types and thresholds.", "Check whether the rule logic is AND or OR.", "Compare the member's progress for every point type and save the intended logic."], expected: "AND requires every threshold; OR requires only one matching threshold.", help: "A combined progress display does not replace checking each point type condition." },
  },
  "how-badges-configure": {
    vi: { title: "Badge không có condition nên không tự cấp", when: "Badge đã lưu nhưng member không nhận khi đạt các hoạt động khác.", steps: ["Mở badge và kiểm tra Condition builder có ít nhất một điều kiện.", "Nếu để trống condition, đọc trạng thái/ghi chú Manual của badge.", "Không kỳ vọng badge conditionless được tự cấp; kiểm tra luồng cấp thủ công được hỗ trợ trước khi công bố."], expected: "Badge tự động chỉ được xét theo các condition đã cấu hình; badge manual không được coi là rule tự động.", help: "Trang editor không nên được hiểu là có nút cấp thủ công nếu nút đó không hiển thị." },
    en: { title: "A badge without conditions is not awarded automatically", when: "A saved badge is not granted when members complete unrelated activities.", steps: ["Open the badge and check that the Condition builder has at least one rule.", "If conditions are empty, read the badge's Manual status/help text.", "Do not expect a conditionless badge to be awarded automatically; verify the supported manual-award workflow before announcing it."], expected: "Automatic badges are evaluated from configured conditions; a manual badge is not an automatic rule.", help: "Do not assume the editor provides a manual-award button when none is shown." },
  },
  "how-member-profile-admin": {
    vi: { title: "Thay đổi hồ sơ nhưng chưa lưu", when: "Rời trang rồi thấy tên/field/photo vẫn là giá trị cũ.", steps: ["Mở lại hồ sơ và chọn Edit.", "Nhập lại các trường cần đổi; nếu đổi ảnh, nhập Photo URL vào trường photo.", "Chọn Save, chờ thông báo thành công rồi tải lại hồ sơ để xác nhận."], expected: "Chỉ các thay đổi đã Save mới xuất hiện ở chế độ xem hồ sơ.", help: "Admin profile dùng Photo URL, không có upload ảnh trực tiếp tại form này." },
    en: { title: "Profile changes were not saved", when: "After leaving the page, the old name/field/photo still appears.", steps: ["Reopen the profile and select Edit.", "Enter the new values; to change the image, enter a Photo URL in the photo field.", "Select Save, wait for success feedback, and reload the profile to confirm."], expected: "Only changes saved successfully appear in profile view.", help: "The Admin profile form uses a Photo URL; it does not upload an image file here." },
  },
  "how-member-import-profile": {
    vi: { title: "File có cột nhưng field đó chưa được chọn import", when: "Import hoàn tất nhưng một số giá trị hồ sơ không đổi.", steps: ["Mở lại member import và kiểm tra Selected fields.", "Giữ các trường mandatory đã khóa; tích chọn các field tùy chọn muốn cập nhật.", "Xác nhận header khớp field được chọn rồi chạy import lại với file đã sửa."], expected: "Field bị bỏ chọn không được ghi từ file; field đã chọn mới tham gia import.", help: "Kiểm tra một member mẫu sau import trước khi chạy cả batch lớn." },
    en: { title: "A file column is present but its field was not selected for import", when: "The import finishes but some profile values do not change.", steps: ["Reopen Member import and check Selected fields.", "Keep locked mandatory fields selected; select optional fields that should be updated.", "Confirm headers match the selected fields, then rerun with the corrected file."], expected: "Unselected fields are not written from the file; selected fields are included in the import.", help: "Verify one sample member after import before running a large batch." },
  },
  "how-member-import-points": {
    vi: { title: "Nhầm balance import với giao dịch điểm", when: "Số dư sau import không như mong đợi.", steps: ["Kiểm tra header của point type trong file.", "Dùng balance_CODE khi muốn đặt số dư đích; dùng point_CODE khi muốn ghi giao dịch cộng/trừ.", "Đối chiếu kết quả với member wallet và Ledger sau khi import."], expected: "Mỗi dạng cột thực hiện đúng ý nghĩa riêng; không thay balance bằng grant hoặc ngược lại.", help: "Dùng code point type chính xác như template, kể cả dấu gạch nối nếu có." },
    en: { title: "Balance import was confused with a point transaction", when: "The member's balance after import is unexpected.", steps: ["Check the point-type column header in the file.", "Use balance_CODE to set a target balance; use point_CODE to record a credit/debit transaction.", "Reconcile the member wallet and Ledger after import."], expected: "Each column form performs its distinct operation; a balance is not the same as a grant.", help: "Use the exact point-type code from the template, including hyphens when present." },
  },
  "how-admin-accounts-roles": {
    vi: { title: "Tài khoản Microsoft mới đang chờ duyệt", when: "Admin đăng nhập Microsoft nhưng chưa vào được trang quản trị.", steps: ["Owner mở Roles & permissions → Administrator accounts.", "Tìm tài khoản mới với trạng thái inactive/pending.", "Kiểm tra danh tính, gán role phù hợp và Activate để duyệt quyền truy cập."], expected: "Tài khoản admin Microsoft chỉ hoạt động sau khi Owner/role có quyền kích hoạt duyệt.", help: "Không cấp quyền admin cho account chưa xác minh; member accounts không nhận admin capability." },
    en: { title: "A new Microsoft administrator account is pending approval", when: "An admin signs in with Microsoft but cannot enter the back office.", steps: ["An Owner opens Roles & permissions → Administrator accounts.", "Find the new account in inactive/pending state.", "Verify identity, assign the appropriate role, and Activate to approve access."], expected: "A Microsoft admin account becomes usable only after an authorized Owner activates it.", help: "Do not grant admin access to an unverified account; member accounts do not receive admin capabilities." },
  },
  "how-workflow-configure": {
    vi: { title: "Request cũ vẫn theo workflow trước khi chỉnh sửa", when: "Bạn đổi approver/step nhưng request đang pending chưa đổi người xử lý.", steps: ["Mở request trong Approval inbox/History và xem snapshot của workflow/steps.", "Kiểm tra ngày tạo request so với thời điểm workflow được cập nhật.", "Dùng cấu hình mới cho request mới; xử lý request đang chờ theo các approver đã gắn vào request đó."], expected: "Workflow mới áp dụng cho yêu cầu mới, không viết lại approval history của request đã tạo.", help: "Không xóa workflow/role đang được request hoặc cấu hình khác sử dụng." },
    en: { title: "An existing request still follows the earlier workflow", when: "You change an approver/step but a pending request does not move to the new assignee.", steps: ["Open the request in Approval inbox/History and inspect its workflow/step snapshot.", "Compare the request creation time with when the workflow was updated.", "Use the new configuration for new requests; process this pending request with the approvers already attached to it."], expected: "The new workflow applies to new requests and does not rewrite an existing request's approval history.", help: "Do not remove a workflow/role that is still referenced by requests or other configuration." },
  },
  "how-approval-inbox-decide": {
    vi: { title: "Không thể Reject khi chưa có comment", when: "Nút Reject bị khóa hoặc validation yêu cầu lý do.", steps: ["Mở chi tiết request và đọc justification/dữ liệu liên quan.", "Nhập comment nêu lý do từ chối.", "Chọn Reject và kiểm tra status cùng approval history."], expected: "Request được từ chối và comment được lưu làm audit context.", help: "Chỉ approver của layer hiện tại mới có thể quyết định; mở notification không tự approve/reject." },
    en: { title: "A request cannot be rejected without a comment", when: "Reject is disabled or validation asks for a reason.", steps: ["Open the request details and review its justification and subject data.", "Enter a comment explaining the rejection.", "Select Reject and verify the status and approval history."], expected: "The request is rejected and the comment is retained as audit context.", help: "Only the current-layer approver can decide; opening a notification does not approve or reject it." },
  },
  "how-reward-catalog": {
    vi: { title: "Stock bằng 0 khác với stock để trống", when: "Reward không thể đổi dù bạn nghĩ stock chưa giới hạn.", steps: ["Mở reward và kiểm tra trường stock.", "Để trống nếu muốn unlimited; số 0 là không còn hàng để đổi.", "Kiểm tra Active và ngày hiệu lực rồi lưu."], expected: "Reward chỉ có thể được đổi khi đang active, đúng thời gian và còn stock hoặc stock unlimited.", help: "Kiểm tra point price/tier requirement riêng với tình trạng stock." },
    en: { title: "Zero stock is different from blank stock", when: "A reward cannot be redeemed although you expected unlimited stock.", steps: ["Open the reward and inspect its stock field.", "Leave it blank for unlimited stock; zero means none is available to redeem.", "Check Active and the validity dates, then save."], expected: "A reward can be redeemed only when active, in its validity window, and stocked or unlimited.", help: "Check point price/tier requirements separately from stock." },
  },
  "how-reward-fulfillment": {
    vi: { title: "Redemption đã Fulfilled không còn nút xử lý", when: "Bạn mở một dòng lịch sử nhưng không thấy action Fulfill.", steps: ["Kiểm tra status của redemption.", "Nếu đã Fulfilled hoặc Cancelled, xem thông tin lịch sử thay vì gửi Fulfill lần nữa.", "Chỉ xử lý dòng Pending sau khi giao reward thật sự hoàn tất."], expected: "Fulfill là thao tác cho redemption còn Pending; status cuối giúp tránh giao/ghi nhận trùng.", help: "Nếu status không đúng nghiệp vụ, kiểm tra request/reference trước khi chỉnh qua luồng khác." },
    en: { title: "A fulfilled redemption has no further action button", when: "You open a history row and do not see Fulfill.", steps: ["Check the redemption status.", "If it is already Fulfilled or Cancelled, review its history rather than submitting Fulfill again.", "Fulfill only a Pending row after the reward has actually been delivered."], expected: "Fulfill is for pending redemptions; terminal status helps prevent duplicate fulfillment.", help: "If the status conflicts with the real outcome, review the request/reference before using another workflow." },
  },
  "how-coupons-create-batch": {
    vi: { title: "Coupon đã tạo nhưng hiện không khả dụng", when: "Người dùng không thể dùng code đã được sinh.", steps: ["Tìm batch và kiểm tra trạng thái coupon.", "Đối chiếu ngày hiệu lực, loại/value giảm, minimum purchase và max uses với cấu hình.", "Chỉ chia sẻ code còn hiệu lực; không đưa cùng code vượt giới hạn sử dụng."], expected: "Code dùng được khi status và điều kiện sử dụng của nó còn hợp lệ.", help: "Không giả định việc sinh code tự làm code có hiệu lực vô thời hạn." },
    en: { title: "A generated coupon is not currently usable", when: "A user cannot redeem a code from the generated batch.", steps: ["Find the batch and inspect the coupon status.", "Compare its validity dates, discount type/value, minimum purchase, and maximum uses with the configured terms.", "Share only a code that is still valid and do not exceed its usage limit."], expected: "A code is usable only while its status and redemption conditions remain valid.", help: "Generating a code does not make it valid forever." },
  },
  "how-exchange-rate": {
    vi: { title: "Không thấy lựa chọn cash trong rate", when: "Chọn payout type nhưng chỉ có non-cash.", steps: ["Mở point type registry và chọn point type dùng cho rate.", "Kiểm tra Exchangeable và Cash eligible theo chính sách.", "Lưu point type, quay lại tạo version rate và chọn payout type phù hợp."], expected: "Cash chỉ hiện khi point type được đánh dấu cho phép cash exchange.", help: "Tỷ lệ mới được lưu thành version; không sửa snapshot của request cũ." },
    en: { title: "Cash is missing from the rate payout options", when: "The payout selector offers only non-cash.", steps: ["Open Point type registry and select the type used by the rate.", "Check Exchangeable and Cash eligible against policy.", "Save the point type, return to rates, and create a version with the allowed payout type."], expected: "Cash appears only when the point type permits cash exchange.", help: "A new rate is saved as a version; it does not alter snapshots on existing requests." },
  },
  "how-exchange-requests": {
    vi: { title: "Request Approved nhưng chưa Completed", when: "Bạn đã approve nhưng vẫn thấy request chưa kết thúc.", steps: ["Mở request và xác nhận status là Approved.", "Chỉ khi quy trình nghiệp vụ thực sự hoàn tất, chọn Complete và nhập completion reference.", "Kiểm tra status Completed cùng approval history/ledger liên quan."], expected: "Approved là qua bước duyệt; Completed ghi nhận bước hoàn tất riêng.", help: "Không Complete chỉ để bỏ request khỏi inbox khi nghiệp vụ chưa xong." },
    en: { title: "A request is Approved but not Completed", when: "You approved a request but it still appears unfinished.", steps: ["Open the request and confirm its status is Approved.", "Only after the business process is actually complete, choose Complete and enter a completion reference.", "Verify Completed status and related approval history/Ledger records."], expected: "Approved means it passed review; Completed is a separate finalization step.", help: "Do not mark Complete merely to remove a request from view while work is unfinished." },
  },
  "how-logs-filter-audit": {
    vi: { title: "Nhầm người thực hiện với member bị tác động", when: "Tìm theo email người dùng nhưng không thấy action mong muốn.", steps: ["Xác định câu hỏi là ai thao tác hay member nào bị tác động.", "Lọc Actor cho người thực hiện; dùng target/member filter cho đối tượng bị ảnh hưởng.", "Mở log row để xem action, dữ liệu liên quan và thời điểm."], expected: "Actor và target được phân biệt để audit đúng người thao tác và người nhận tác động.", help: "Giao dịch điểm thuộc Ledger; Logs tập trung vào hành động quản trị/audit." },
    en: { title: "The actor was confused with the member affected", when: "Searching a user's email does not find the expected action.", steps: ["Decide whether you are asking who performed the action or which member was affected.", "Filter Actor for the administrator who acted; use the target/member filter for the affected person.", "Open the log row to inspect action, related data, and time."], expected: "Actor and target distinguish the person performing an action from its subject.", help: "Point transactions belong in Ledger; Logs focus on administrative/audit actions." },
  },
  "how-data-export-fields": {
    vi: { title: "Export bị từ chối do role thiếu quyền", when: "Không tạo được file dù đã chọn dataset và field.", steps: ["Mở Roles & permissions và kiểm tra capability export tương ứng của role.", "Nhờ Owner cấp đúng quyền tối thiểu nếu công việc yêu cầu.", "Mở lại Data export, chọn dataset/field và tạo file."], expected: "Export chỉ thực hiện được khi tài khoản có quyền cho dữ liệu đó.", help: "Không mượn tài khoản Owner để vượt qua phạm vi truy cập; chỉ export trường thật sự cần." },
    en: { title: "Export is denied because the role lacks permission", when: "A file cannot be created even after choosing a dataset and fields.", steps: ["Open Roles & permissions and check the role's relevant export capability.", "Ask an Owner to grant the minimum required permission if the task needs it.", "Return to Data export, choose the dataset/fields, and create the file."], expected: "An export runs only when the account has access to that data.", help: "Do not use an Owner account to bypass scope; export only fields that are needed." },
  },
  "how-notification-templates": {
    vi: { title: "Đã tạo trigger template nhưng không có notification", when: "Template lưu thành công nhưng không có notification mới phát ra.", steps: ["Kiểm tra trigger key trong template có khớp với loại notification dự kiến không.", "Xác nhận tính năng tạo notification thực sự phát trigger đó; đặt tên trigger không tự gọi nó.", "Kiểm tra recipient, locale/channel và log/request của nghiệp vụ phát sinh."], expected: "Template chỉ định dạng nội dung khi ứng dụng phát đúng trigger; tự tạo key không tự gửi thông báo.", help: "Custom trigger chỉ hoạt động khi feature hoặc integration gửi trigger tương ứng." },
    en: { title: "A trigger template was created but no notification appeared", when: "The template saved successfully but no new notification was emitted.", steps: ["Check that the template trigger key matches the expected notification type.", "Confirm the feature actually emits that trigger; naming a trigger does not invoke it.", "Check recipient, locale/channel, and the originating workflow/request."], expected: "A template formats content only when the application emits the matching trigger; creating a key does not send a notification.", help: "A custom trigger works only when a feature or integration reports it." },
  },
  "how-dashboard-widgets": {
    vi: { title: "Dashboard khác giữa các thiết bị", when: "Widget đã lưu trên một thiết bị chưa xuất hiện ở thiết bị khác.", steps: ["Đăng nhập cùng tài khoản Admin trên cả hai thiết bị.", "Tải lại Dashboard và kiểm tra thay đổi đã lưu hoàn tất chưa.", "Nếu vẫn thiếu, nhờ Owner kiểm tra quyền lưu dashboard preference."], expected: "Cùng tài khoản Admin sẽ thấy layout đã lưu trên các thiết bị.", help: "Mỗi tài khoản Admin có dashboard cá nhân riêng." },
    en: { title: "The dashboard differs across devices", when: "Widgets saved on one device are missing on another.", steps: ["Sign in to the same Admin account on both devices.", "Refresh Dashboard and confirm the change finished saving.", "If it is still missing, ask an Owner to check dashboard preference access."], expected: "The same Admin account sees its saved layout across devices.", help: "Each Admin account has a separate personal dashboard." },
  },
};

for (const guide of expandedAdminGuideArticles) {
  const second = secondAdminScenarios[guide.slug];
  if (second) {
    guide.content.vi.scenarios.push(second.vi);
    guide.content.en.scenarios.push(second.en);
  }
}

expandedAdminGuideArticles.push(
  // screenshot target: /member-fields showing the create form and configured fields with active/type labels.
  article("how-member-fields", 1460, "members",
    {
      title: "Tạo và quản lý custom member fields", section: "Members and data", route: "/member-fields",
      purpose: "Khai báo dữ liệu mở rộng như ngày sinh, phòng ban hoặc thuộc tính phục vụ segment/event.",
      prerequisites: "Cần member.manage. Chọn key ổn định, nhãn dễ hiểu và kiểu dữ liệu phù hợp trước khi đưa field vào import/rule.",
      steps: ["Mở Member fields và nhập Key, Label.", "Chọn Text, Number, Yes/No, Date hoặc Select; với Select nhập các lựa chọn cách nhau bằng dấu phẩy.", "Đánh dấu Required nếu hồ sơ/import phải cung cấp field này.", "Chọn Create field rồi kiểm tra field trong danh sách, gồm trạng thái và Created by.", "Điền giá trị trong hồ sơ member hoặc file import; dùng field Date khi cần rule ngày/event.", "Dùng Activate/Deactivate để kiểm soát việc sử dụng mới; Archive để ngừng dùng field."],
      result: "Field active xuất hiện trong các form/rule tương thích; giá trị từng member được quản lý riêng trong hồ sơ/import.",
      notes: ["Key là định danh ổn định dùng trong các quy tắc; tránh đổi key tùy tiện sau khi đã gắn vào segment/event.", "Select options được nhập dạng danh sách phân tách bằng dấu phẩy.", "Tắt hoặc archive field có thể làm field không còn chọn được trong các luồng mới; kiểm tra rule đang dùng trước."],
      scenarios: [
        { title: "Select không có option để chọn", when: "Field loại Select đã tạo nhưng danh sách trống.", steps: ["Kiểm tra field type là Select.", "Nếu mới tạo sai type, tạo field mới đúng type và nhập options phân tách bằng dấu phẩy.", "Điền giá trị member bằng một option hợp lệ."], expected: "Select field hiển thị các lựa chọn đã cấu hình." },
        { title: "Date field biến mất khỏi lựa chọn event", when: "Event date selector không còn hiển thị custom field.", steps: ["Mở danh sách member fields và kiểm tra field type là Date.", "Nếu field inactive, chọn Activate.", "Quay lại Event definitions và tải lại danh sách."], expected: "Field Date đang active xuất hiện trong các selector event tương thích." },
      ],
      imageAlt: "Member fields form with types, required option, and configured-field list.",
    },
    {
      title: "Create and manage custom member fields", section: "Members and data", route: "/member-fields",
      purpose: "Define extra member data such as birth date, department, or attributes used by segments/events.",
      prerequisites: "You need member.manage. Choose a stable key, clear label, and suitable data type before using the field in imports/rules.",
      steps: ["Open Member fields and enter a Key and Label.", "Choose Text, Number, Yes/No, Date, or Select; for Select, enter comma-separated choices.", "Mark Required if profiles/imports must provide this value.", "Select Create field and verify it in the list, including status and Created by.", "Populate values in member profiles or imports; use Date for date rules/events.", "Use Activate/Deactivate to control new use, or Archive when retiring a field."],
      result: "Active fields appear in compatible forms/rules; each member's value is maintained separately in their profile/import.",
      notes: ["The key is the stable identifier used by rules; avoid changing it after linking it to segments/events.", "Select options are entered as a comma-separated list.", "Deactivating or archiving can remove the field from new flows; review existing rules first."],
      scenarios: [
        { title: "A Select field has no choices", when: "The field was created but its option list is empty.", steps: ["Check that the field type is Select.", "If it was created with the wrong type, create a correctly typed field with comma-separated options.", "Populate member values with one of the configured choices."], expected: "A Select field displays its configured choices." },
        { title: "A Date field disappeared from an event selector", when: "An event date selector no longer lists a custom field.", steps: ["Open Member fields and verify the field type is Date.", "If the field is inactive, select Activate.", "Return to Event definitions and reload the options."], expected: "An active Date field appears in compatible event selectors." },
      ],
      imageAlt: "Member fields form with data types, required option, and configured field list.",
    }),
  // screenshot target: /credits/categories showing category name/description, active state, and archive action.
  article("how-recognition-categories", 1470, "members",
    {
      title: "Quản lý recognition categories", section: "Automation & governance", route: "/credits/categories",
      purpose: "Tạo danh mục ngắn gọn để member phân loại lý do Give Recognition và giúp báo cáo dễ đọc.",
      prerequisites: "Cần quyền quản lý credits/categories. Categories chỉ phân loại recognition, không tự cấp điểm hay thay đổi point type.",
      steps: ["Mở Credits → Recognition categories.", "Nhập Category name; thêm description giải thích khi nào nên chọn.", "Chọn Create category và xác nhận category xuất hiện trong danh sách.", "Dùng Deactivate nếu tạm không muốn category được chọn cho recognition mới; Activate để bật lại.", "Kiểm tra Give Recognition trong customer portal để xác nhận nhãn đang active được hiển thị.", "Dùng Delete/archive chỉ khi cần ngừng category; category đã được dùng sẽ được archive để giữ lịch sử."],
      result: "Member có thể chọn các category đang active; báo cáo/lịch sử giữ ngữ cảnh của những category đã dùng.",
      notes: ["Dùng tên rõ nghĩa và description ngắn để member chọn đúng lý do.", "Tắt category không xóa các recognition lịch sử.", "Không dùng category làm thay thế approval workflow hoặc policy cấp điểm."],
      scenarios: [
        { title: "Category không hiện trong Give Recognition", when: "Admin đã tạo category nhưng member không thấy để chọn.", steps: ["Kiểm tra category có trạng thái Active không.", "Nếu inactive, chọn Activate.", "Tải lại customer portal và kiểm tra đúng form Give Recognition."], expected: "Category active xuất hiện cho recognition mới." },
        { title: "Delete không xóa category đã dùng", when: "Category đã có trong giao dịch recognition cũ.", steps: ["Chọn Delete/archive trên category cần ngừng.", "Kiểm tra nó được giữ ở trạng thái archived/inactive.", "Mở history/report cũ để xác nhận ngữ cảnh lịch sử còn nguyên."], expected: "Category ngừng dùng cho giao dịch mới nhưng lịch sử cũ được bảo toàn." },
      ],
      imageAlt: "Recognition categories list with name, description, status, and archive action.",
    },
    {
      title: "Manage recognition categories", section: "Automation & governance", route: "/credits/categories",
      purpose: "Create concise categories so members can classify Give Recognition reasons and reports are easier to read.",
      prerequisites: "You need the relevant credits/category management permission. Categories classify recognition; they do not issue points or change a point type.",
      steps: ["Open Credits → Recognition categories.", "Enter a Category name and optionally describe when it should be chosen.", "Select Create category and confirm it appears in the list.", "Deactivate a category to stop offering it for new recognition; Activate it to offer it again.", "Check Give Recognition in the Customer portal to confirm active labels appear.", "Use Delete/archive only when retiring a category; categories already used are archived to preserve history."],
      result: "Members can choose active categories; reports/history retain context for categories already used.",
      notes: ["Use a clear name and brief description so members can choose the right reason.", "Deactivating a category does not remove historical recognition.", "Do not use a category as a substitute for an approval workflow or point-issuance policy."],
      scenarios: [
        { title: "A category is missing from Give Recognition", when: "An admin created it but a member cannot choose it.", steps: ["Check whether the category is Active.", "If inactive, select Activate.", "Reload the Customer portal and inspect the Give Recognition form."], expected: "An active category is offered for new recognition." },
        { title: "Deleting a used category does not erase it", when: "The category already appears on past recognition activity.", steps: ["Choose Delete/archive for the category being retired.", "Confirm it remains archived/inactive in the list.", "Open an old history/report row and verify its context remains."], expected: "The category is retired from new use while historical records are preserved." },
      ],
      imageAlt: "Recognition categories list with name, description, status, and archive action.",
    }),
  // screenshot target: /settings with redirect URIs, Microsoft configuration fields, and the Test connection action; hide secret values.
  article("how-settings-microsoft-login", 1480, "settings",
    {
      title: "Cấu hình đăng nhập Microsoft 365", section: "Settings", route: "/settings",
      purpose: "Kết nối Microsoft sign-in cho Customer/Admin bằng tenant và ứng dụng đã đăng ký; tài khoản admin mới vẫn cần được duyệt.",
      prerequisites: "Cần settings.manage và thông tin do IT/Microsoft Entra admin cấp: tenant ID, client ID, client secret và quyền OpenID cần thiết.",
      steps: ["Mở Settings và copy Customer redirect URI cùng Admin redirect URI đang hiển thị.", "Trong Microsoft Entra app registration, khai báo các redirect URI chính xác theo từng ứng dụng/hostname.", "Nhập tenant ID, client ID và client secret; chọn scopes openid/profile/email theo cấu hình được cấp.", "Bật Microsoft sign-in; chỉ bật auto-provision member nếu chính sách cho phép tạo member tự động.", "Chọn Save, sau đó dùng Test connection khi nút đã khả dụng.", "Nếu lần sign-in tạo admin account mới, Owner mở Roles & permissions, xác minh account, gán role và Activate để duyệt."],
      result: "Microsoft sign-in dùng cấu hình đã lưu; member provisioning theo tùy chọn, còn admin account mới ở trạng thái pending/inactive cho tới khi được duyệt.",
      notes: ["Không chụp hoặc chia sẻ client secret; khi sửa cấu hình khác, để trống secret nếu không muốn thay secret đã lưu.", "Redirect URI phải khớp chính xác scheme/hostname/path đã đăng ký.", "Cấu hình identity provider không tự cấp quyền quản trị cho account mới."],
      scenarios: [
        { title: "Test connection chưa khả dụng", when: "Nút Test bị khóa hoặc hệ thống báo chưa configured.", steps: ["Kiểm tra tenant ID, client ID và client secret đã nhập đúng.", "Xác nhận redirect URI phù hợp với app registration.", "Save cấu hình rồi tải lại trạng thái; chạy Test khi configured."], expected: "Test chỉ khả dụng sau khi cấu hình Microsoft được lưu đủ để backend xác nhận." },
        { title: "Admin sign-in thành công nhưng account chưa vào được", when: "Microsoft xác thực được người dùng nhưng account admin vẫn bị chặn.", steps: ["Owner mở Roles & permissions → Administrator accounts.", "Xác minh account pending/inactive mới tạo.", "Gán role tối thiểu cần thiết và Activate account."], expected: "Admin account chỉ truy cập back office sau khi được admin có quyền duyệt." },
      ],
      imageAlt: "Microsoft sign-in settings with redirect URIs and test control; secret field obscured.",
    },
    {
      title: "Configure Microsoft 365 sign-in", section: "Settings", route: "/settings",
      purpose: "Connect Microsoft sign-in for Customer/Admin with a registered tenant and application; newly created admin accounts still require approval.",
      prerequisites: "You need settings.manage and values from IT/Microsoft Entra: tenant ID, client ID, client secret, and the required OpenID scopes.",
      steps: ["Open Settings and copy the displayed Customer redirect URI and Admin redirect URI.", "In the Microsoft Entra app registration, add the exact redirect URIs for each application/hostname.", "Enter tenant ID, client ID, and client secret; select the supplied openid/profile/email scopes.", "Enable Microsoft sign-in; enable automatic member provisioning only if policy allows it.", "Select Save, then use Test connection when the button becomes available.", "If sign-in creates a new admin account, have an Owner verify it, assign a role, and Activate it under Roles & permissions."],
      result: "Microsoft sign-in uses saved settings; member provisioning follows its toggle, while a new admin account remains pending/inactive until approved.",
      notes: ["Never capture/share the client secret; leave it blank when editing other settings if you do not intend to rotate it.", "The redirect URI must exactly match the scheme/host/path registered with Microsoft.", "Configuring identity does not grant a new account administrative access."],
      scenarios: [
        { title: "Test connection is unavailable", when: "Test is disabled or the page says the configuration is incomplete.", steps: ["Verify tenant ID, client ID, and client secret.", "Confirm the redirect URI matches the app registration.", "Save the settings and refresh their status; run Test once configured."], expected: "Test is available after the backend recognizes a complete saved Microsoft configuration." },
        { title: "Admin sign-in succeeds but the account cannot enter", when: "Microsoft authenticates the identity but the back-office account is blocked.", steps: ["An Owner opens Roles & permissions → Administrator accounts.", "Verify the newly created pending/inactive account.", "Assign the minimum required role and Activate the account."], expected: "An admin account can access the back office only after an authorized admin approves it." },
      ],
      imageAlt: "Microsoft sign-in settings with redirect URIs and test control; secret field obscured.",
    }),
  // screenshot target: Admin header bell dropdown with unread count, one request marked read/unread, and Mark all as read.
  article("how-admin-approval-notifications", 1490, "automation",
    {
      title: "Dùng chuông thông báo approval của Admin", section: "Approvals", route: "/approvals",
      purpose: "Theo dõi notification của các yêu cầu approval được giao cho admin, mở đúng request và quản lý trạng thái đã đọc.",
      prerequisites: "Đăng nhập bằng admin có quyền xem inbox. Chuông tổng hợp approval requests; nó không phải danh sách mọi notification hệ thống.",
      steps: ["Mở chuông ở góc phải header và xem số notification chưa đọc.", "Chọn một notification để đánh dấu đã đọc và mở đúng request trong Approval inbox.", "Xem workflow, action key, subject và thời điểm; quyết định approve/reject riêng trong request.", "Dùng Mark as read/unread trên từng item để quản lý trạng thái; dùng Mark all as read khi đã rà các mục.", "Kiểm tra badge giảm/tăng theo số request chưa đọc."],
      result: "Badge đếm các approval notification chưa đọc; mở notification điều hướng tới request tương ứng nhưng không tự quyết định request.",
      notes: ["Mark as read chỉ đổi trạng thái notification, không approve/reject nghiệp vụ.", "Mark as unread có thể làm tăng badge trở lại.", "Request không được giao cho admin hoặc không còn pending có thể không nằm trong inbox của họ."],
      scenarios: [
        { title: "Đã đọc một notification nhưng badge vẫn còn", when: "Có nhiều request chưa đọc và bạn chỉ mở một mục.", steps: ["Mở chuông và kiểm tra các item vẫn có trạng thái unread.", "Đánh dấu từng item đã rà là read hoặc dùng Mark all as read.", "Nếu thao tác lưu lỗi, đợi inbox tải lại và kiểm tra trạng thái server."], expected: "Badge giảm theo số item thực sự được đánh dấu read, không nhất thiết về 0 sau khi mở một item." },
        { title: "Mở notification nhưng request vẫn pending", when: "Badge đã giảm nhưng workflow chưa có quyết định.", steps: ["Mở request được điều hướng tới trong Approval inbox.", "Đọc nội dung rồi dùng Approve hoặc Reject nếu bạn là approver của layer hiện tại.", "Xác nhận status/history sau quyết định."], expected: "Đọc notification và quyết định approval là hai thao tác độc lập." },
      ],
      imageAlt: "Admin approval bell dropdown showing unread count, request link, read toggle, and mark-all action.",
    },
    {
      title: "Use Admin approval notifications", section: "Approvals", route: "/approvals",
      purpose: "Track approval notifications assigned to an administrator, open the correct request, and manage read status.",
      prerequisites: "Sign in as an admin allowed to view the inbox. The bell summarizes approval requests; it is not every system notification.",
      steps: ["Open the bell in the top-right header and check the unread count.", "Select a notification to mark it read and open that request in Approval inbox.", "Review its workflow, action key, subject, and time; decide separately inside the request.", "Use Mark as read/unread on individual items, or Mark all as read after reviewing them.", "Confirm the badge changes with the number of unread requests."],
      result: "The badge counts unread approval notifications; opening one routes to its request but does not decide it.",
      notes: ["Mark as read changes notification state only; it does not approve/reject business activity.", "Mark as unread can increase the badge again.", "Requests not assigned to this admin or no longer pending may not appear in their inbox."],
      scenarios: [
        { title: "One notification was read but the badge remains", when: "Several requests are unread and only one item was opened.", steps: ["Open the bell and identify items still marked unread.", "Mark each reviewed item read or choose Mark all as read.", "If saving failed, wait for the inbox to reload and check server state."], expected: "The badge decreases by items actually marked read; opening one item does not necessarily clear it." },
        { title: "A request is still pending after opening its notification", when: "The unread count fell but the workflow has no decision.", steps: ["Open the linked request in Approval inbox.", "Review it and select Approve or Reject if you are the current-layer approver.", "Confirm the status/history after deciding."], expected: "Reading a notification and deciding an approval are separate actions." },
      ],
      imageAlt: "Admin approval bell dropdown showing unread count, request link, read toggle, and mark-all action.",
    }),
);
