import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../db.js";
import { LoyaltyError } from "../lib/errors.js";
import { systemBrandingResponse } from "../lib/system-branding.js";

export function publicBrandingRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/auth/branding", async (request, reply) => {
    const query = z.object({ programId: z.string().trim().min(1).max(120).optional() }).parse(request.query);
    const header = request.headers["x-program-id"];
    const programId = query.programId ?? (typeof header === "string"
      ? z.string().trim().min(1).max(120).parse(header) : undefined);
    const program = programId ? await prisma.program.findFirst({
      where: { id: programId, isActive: true },
      select: { systemName: true, logoUrl: true },
    }) : null;
    return reply.header("Cache-Control", "no-store").send({ data: systemBrandingResponse(program) });
  });
  done();
}

export function programBrandingRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get("/branding", async (request, reply) => {
    const program = await prisma.program.findUnique({
      where: { id: request.programId },
      select: { systemName: true, logoUrl: true },
    });
    if (!program) throw new LoyaltyError("PROGRAM_NOT_FOUND", 404);
    return reply.header("Cache-Control", "no-store").send({ data: systemBrandingResponse(program) });
  });
  done();
}
