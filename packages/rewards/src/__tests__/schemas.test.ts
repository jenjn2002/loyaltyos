import { describe, expect, it } from "vitest";

import { rewardCreateSchema, rewardListQuerySchema } from "../schemas.js";

describe("reward category schema", () => {
  it("accepts program-defined categories", () => {
    expect(
      rewardCreateSchema.parse({
        programId: "program-1",
        name: "Food voucher",
        pointsCost: 100,
        category: "food_drinks",
      }).category,
    ).toBe("food_drinks");
  });

  it("keeps category filtering open to program-defined labels", () => {
    expect(rewardListQuerySchema.parse({ category: "food_drinks" }).category).toBe("food_drinks");
  });
});
