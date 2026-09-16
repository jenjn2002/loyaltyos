import { hashPassword } from "@loyaltyos/core";
import { Prisma } from "@prisma/client";

import { prisma } from "../db.js";
import { getAdminBootstrapValues, validateProductionConfiguration } from "./runtime-config.js";

/**
 * Create only the minimum records required to log into a fresh installation.
 * This deliberately does not call prisma/seed.ts and never changes an
 * existing admin password, program, member, or demo record.
 */
export async function bootstrapInitialAdmin(): Promise<void> {
  const existingAdmin = await prisma.adminUser.findFirst({ select: { id: true } });

  validateProductionConfiguration(process.env, { requireAdminBootstrap: !existingAdmin });

  if (existingAdmin) {
    console.info("[Bootstrap] Existing admin found; initial admin bootstrap skipped.");
    return;
  }

  const values = getAdminBootstrapValues();
  const passwordHash = await hashPassword(values.password);

  try {
    await prisma.$transaction(
      async (tx) => {
        // Re-check inside the transaction so a second API replica cannot
        // overwrite or duplicate the first admin during a simultaneous boot.
        const admin = await tx.adminUser.findFirst({ select: { id: true } });
        if (admin) return;

        const program =
          (await tx.program.findFirst({ orderBy: { createdAt: "asc" } })) ??
          (await tx.program.create({
            data: {
              // Align fresh installs with the Admin, Portal, API tests and seed
              // convention. Existing programs are never renamed.
              id: "prog_dev",
              name: "LoyaltyOS",
              description: "Default loyalty program created during first installation",
              pointsUnit: "PTS",
            },
          }));

        const adminWithEmail = await tx.adminUser.findUnique({
          where: { email: values.email },
          select: { id: true },
        });
        if (adminWithEmail) return;

        await tx.adminUser.create({
          data: {
            email: values.email,
            name: values.name,
            passwordHash,
            role: "SUPER_ADMIN",
            programId: program.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    console.info(`[Bootstrap] Initial SUPER_ADMIN created for ${values.email}.`);
  } catch (error) {
    // A concurrent API replica may have won the unique-admin race. Confirm
    // that case and treat it as a successful idempotent bootstrap.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const admin = await prisma.adminUser.findFirst({ select: { id: true } });
      if (admin) {
        console.info("[Bootstrap] Another instance created the initial admin; continuing.");
        return;
      }
    }
    throw new Error(
      `Initial admin bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
