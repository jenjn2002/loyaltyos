type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => Boolean(value && typeof value === "object" && !Array.isArray(value));

const defaults = {
  en: {
    oldPurpose: "Review key operational metrics and arrange a simple dashboard around the data you need to monitor.",
    purpose: "Review operational metrics and add built-in widgets to your personal dashboard; it does not support arbitrary queries or charts.",
    oldResult: "The layout is saved in the current browser. Widgets provide an overview; they do not replace the Ledger or detailed reports.",
    result: "The layout is saved to the Admin account and follows it across devices. Widgets do not replace the Ledger or detailed reports.",
    oldSteps: [
      "Open Dashboard and check the date range and scope for each metric.",
      "Select Add widget to add an available card or chart.",
      "Choose a supported metric, grouping, or point type, then give it a clear name.",
      "Arrange the layout, save it, and compare the chart with the relevant detail page.",
    ],
    steps: [
      "Open Dashboard and check the date range and scope for each metric.",
      "Select Customize dashboard; choose a Metric in the inline builder and enter an optional Title.",
      "Select Add widget to save it automatically; use the remove icon on a card to delete a widget.",
      "Compare each metric with its detail page; widgets cannot be dragged or rearranged.",
    ],
  },
  vi: {
    oldPurpose: "Xem nhanh chỉ số vận hành và tự sắp xếp một dashboard đơn giản theo dữ liệu cần theo dõi.",
    purpose: "Xem chỉ số vận hành và thêm widget dựng sẵn vào dashboard cá nhân; không tạo truy vấn hoặc biểu đồ tùy ý.",
    oldResult: "Bố cục tùy chỉnh được lưu trên trình duyệt hiện tại. Widget giúp quan sát nhanh, không thay thế Ledger hoặc báo cáo chi tiết.",
    result: "Layout được lưu vào tài khoản Admin và đồng bộ giữa các thiết bị; widget không thay thế Ledger hoặc báo cáo chi tiết.",
    oldSteps: [
      "Mở Dashboard và đọc thời gian/phạm vi của từng thẻ số liệu.",
      "Chọn Add widget để thêm loại thẻ hoặc biểu đồ có sẵn.",
      "Chọn chỉ số, phân nhóm hoặc loại điểm mà cấu hình cho phép; đặt tên dễ hiểu.",
      "Sắp xếp bố cục, lưu lại rồi đối chiếu biểu đồ với trang chi tiết liên quan.",
    ],
    steps: [
      "Mở Dashboard và đọc thời gian/phạm vi của từng thẻ số liệu.",
      "Chọn Customize dashboard; trong khung hiện trên trang, chọn Metric và nhập Title nếu muốn.",
      "Chọn Add widget để thêm và tự lưu widget; dùng biểu tượng xóa trên thẻ để gỡ widget không cần.",
      "Đối chiếu metric với trang chi tiết liên quan; dashboard không có thao tác kéo/thả sắp xếp.",
    ],
  },
} as const;

/** Refresh only exact known obsolete default fields, never authored copy. */
export function refreshKnownDashboardDefaults(input: unknown): { content: JsonRecord; changed: boolean } | null {
  if (!isRecord(input)) return null;
  const content = structuredClone(input);
  let changed = false;
  for (const [locale, copy] of Object.entries(defaults)) {
    const text = content[locale];
    if (!isRecord(text)) continue;
    if (text.purpose === copy.oldPurpose) { text.purpose = copy.purpose; changed = true; }
    if (text.result === copy.oldResult) { text.result = copy.result; changed = true; }
    if (JSON.stringify(text.steps) === JSON.stringify(copy.oldSteps)) { text.steps = [...copy.steps]; changed = true; }
    if (Array.isArray(text.scenarios)) {
      for (const scenario of text.scenarios) {
        if (!isRecord(scenario)) continue;
        if (scenario.expected === copy.oldResult) { scenario.expected = copy.result; changed = true; }
        if (JSON.stringify(scenario.steps) === JSON.stringify(copy.oldSteps)) { scenario.steps = [...copy.steps]; changed = true; }
      }
    }
  }
  return { content, changed };
}

const memberStepReplacements: Record<string, Record<string, string>> = {
  "how-member-profile-admin": {
    "Chọn Edit, sửa các trường cơ bản/custom fields; nhập Photo URL vào trường photo nếu cần thay ảnh.": "Chọn Edit để sửa các trường cơ bản/custom fields. Có thể tải ảnh từ thiết bị (tối đa 5 MB); ảnh được thu nhỏ và có bản xem trước. Photo URL chỉ là lựa chọn bổ sung.",
    "Select Edit, update standard/custom fields, and enter a Photo URL in the photo field if the image should change.": "Select Edit to update standard/custom fields. Upload a photo from your device (up to 5 MB); it is resized and previewed. Photo URL remains an optional alternative.",
  },
  "how-member-import-points": {
    "Export đúng members và point columns cần cập nhật; giữ nguyên memberId.": "Trong Members, tích chọn những member cần xuất, chọn Export selected rồi chọn trường hồ sơ/custom fields và số dư từng loại điểm. Email luôn được giữ; chọn thêm memberId để đối chiếu khi cập nhật.",
    "Export the intended members and point columns; retain memberId.": "In Members, select the members, choose Export selected, and pick profile/custom fields and point balances. Email is always included; keep memberId selected to identify records when updating.",
  },
};

/** Amend only known obsolete default steps; uploaded images and authored copy stay intact. */
export function refreshKnownDocumentationDefaults(slug: string, input: unknown): { content: JsonRecord; changed: boolean } | null {
  if (slug === "dashboard") return refreshKnownDashboardDefaults(input);
  if (!isRecord(input)) return null;
  const content = structuredClone(input);
  let changed = false;
  const replacements = memberStepReplacements[slug];
  if (!replacements) return { content, changed };
  for (const locale of ["en", "vi"]) {
    const copy = content[locale];
    if (!isRecord(copy)) continue;
    const replaceSteps = (record: JsonRecord) => {
      if (!Array.isArray(record.steps)) return;
      record.steps = record.steps.map(step => {
        if (typeof step !== "string" || !Object.prototype.hasOwnProperty.call(replacements, step)) return step;
        changed = true;
        return replacements[step];
      });
    };
    replaceSteps(copy);
    if (Array.isArray(copy.scenarios)) for (const scenario of copy.scenarios) if (isRecord(scenario)) replaceSteps(scenario);
  }
  return { content, changed };
}
