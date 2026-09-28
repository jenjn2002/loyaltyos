// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { csvCell } from "../members-list";

describe("member CSV export escaping", () => {
  it.each(["=1+1", "+cmd", "-1+1", "@SUM(A1:A2)", "\t=1+1", "  =1+1"])(
    "neutralizes spreadsheet formulas beginning with %s",
    (value) => {
      expect(csvCell(value)).toBe(`'${value}`);
    },
  );

  it("still quotes CSV delimiters after escaping", () => {
    expect(csvCell("=1,2")).toBe("\"'=1,2\"");
  });
});
