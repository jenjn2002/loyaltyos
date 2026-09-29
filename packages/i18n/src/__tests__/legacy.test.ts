import { describe, expect, it } from "vitest";

import { translateLegacyText } from "../legacy.js";

describe("legacy Vietnamese translations", () => {
  it("preserves the LoyaltyOS brand name", () => {
    expect(translateLegacyText("LoyaltyOS", "vi-VN")).toBe("LoyaltyOS");
  });

  it("uses Vietnamese for the new-members dashboard label", () => {
    expect(translateLegacyText("New members · last 30 days", "vi-VN")).toBe(
      "Thành viên mới · 30 ngày qua",
    );
  });

  it("translates the point-type registry lifecycle summary", () => {
    expect(translateLegacyText("After a number of days from creation", "vi-VN")).toBe(
      "Sau một số ngày kể từ khi tạo",
    );
    expect(translateLegacyText("Owned balance", "vi-VN")).toBe("Số dư sở hữu");
    expect(translateLegacyText("Owned balance or give allowance", "vi-VN")).toBe(
      "Số dư sở hữu hoặc hạn mức tặng",
    );
    expect(translateLegacyText("Allowed destinations", "vi-VN")).toBe("Điểm đến được phép");
    expect(translateLegacyText("Portal", "vi-VN")).toBe("Cổng thông tin");
    expect(translateLegacyText("Visible", "vi-VN")).toBe("Hiển thị");
    expect(translateLegacyText("Hidden", "vi-VN")).toBe("Ẩn");
  });
});
