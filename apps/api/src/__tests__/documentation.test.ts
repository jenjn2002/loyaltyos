import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findProgram } = vi.hoisted(() => ({
  findMany: vi.fn(),
  findProgram: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    documentationArticle: { findMany },
    program: { findUnique: findProgram },
  },
}));

import { publicDocumentationRoutes } from "../routes/documentation.js";

describe("public documentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findProgram.mockResolvedValue({ documentationConfigured: true });
    findMany.mockResolvedValue([{ slug: "getting-started", audience: "CUSTOMER", status: "PUBLISHED" }]);
  });

  it("returns only published customer guides for the requested program", async () => {
    const app = Fastify();
    app.register(publicDocumentationRoutes, { prefix: "/api/v1" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/documentation?programId=program-a",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        articles: [{ slug: "getting-started", audience: "CUSTOMER", status: "PUBLISHED" }],
        configured: true,
      },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { programId: "program-a", audience: "CUSTOMER", status: "PUBLISHED" },
    }));
    await app.close();
  });
});
