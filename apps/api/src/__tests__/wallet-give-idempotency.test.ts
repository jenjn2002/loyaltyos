import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletService } from "../lib/wallets.js";

describe("WalletService give idempotency", () => {
  const findMany = vi.fn();
  const tx = { customPointTransaction: { findMany } };
  const db = { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
  const service = new WalletService(db as never);

  const transactions = [
    {
      id: "out-1",
      idempotencyKey: "give-key:0:out",
      memberId: "giver-1",
      counterpartyMemberId: "recipient-1",
      pointTypeId: "point-p",
      sourcePointTypeId: "point-p",
      destinationPointTypeId: "point-r",
      amount: -100,
      metadata: { fundingSource: "BALANCE", sourceAmount: 100, destinationAmount: 50 },
    },
    {
      id: "in-1",
      idempotencyKey: "give-key:0:in",
      memberId: "recipient-1",
      counterpartyMemberId: "giver-1",
      pointTypeId: "point-r",
      sourcePointTypeId: "point-p",
      destinationPointTypeId: "point-r",
      amount: 50,
      metadata: { fundingSource: "BALANCE", sourceAmount: 100, destinationAmount: 50 },
    },
  ];

  const input = {
    sourcePointTypeId: "point-p",
    destinationPointTypeId: "point-r",
    recipients: [{ memberId: "recipient-1", amount: 100 }],
    fundingSource: "BALANCE" as const,
    idempotencyKey: "give-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue(transactions);
  });

  it("returns an idempotent result for the original transfer", async () => {
    const result = await service.give("giver-1", "program-1", input);

    expect(result).toEqual({ transactions, idempotent: true });
  });

  it("rejects reusing the key for a different transfer", async () => {
    await expect(
      service.give("giver-1", "program-1", {
        ...input,
        recipients: [{ memberId: "recipient-1", amount: 200 }],
      }),
    ).rejects.toMatchObject({ code: "POINT_IDEMPOTENCY_CONFLICT", httpStatus: 409 });
  });

  it("rejects a prior transfer missing its matching incoming entry", async () => {
    findMany.mockResolvedValue([transactions[0]]);

    await expect(service.give("giver-1", "program-1", input)).rejects.toMatchObject({
      code: "POINT_IDEMPOTENCY_CONFLICT",
      httpStatus: 409,
    });
  });
});
