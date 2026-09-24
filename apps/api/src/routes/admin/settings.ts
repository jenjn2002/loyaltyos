import { encrypt, getMasterKey } from "@loyaltyos/coalition";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { LoyaltyError } from "../../lib/errors.js";
import {
  discoverMicrosoft,
  isMicrosoftTenantId,
  normalizeMicrosoftScopes,
  normalizeMicrosoftTenantId,
  validateMicrosoftConfig,
} from "../../lib/microsoft-auth.js";
import { requireCapability } from "../../lib/permissions.js";
import { adminMicrosoftRedirectUri, microsoftRedirectUri } from "../../lib/public-urls.js";

const microsoftSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  tenantId: z.string().trim().max(120).optional().default(""),
  clientId: z.string().trim().max(120).optional().default(""),
  // Omitted means preserve the current secret. An empty string never clears it.
  clientSecret: z.string().max(4096).optional(),
  scopes: z.array(z.string()).optional(),
  autoProvisionMembers: z.boolean().optional(),
});

function settingsResponse(config: {
  enabled: boolean;
  tenantId: string | null;
  clientId: string | null;
  encryptedClientSecret: string | null;
  scopes: string[];
  autoProvisionMembers: boolean;
}) {
  const configured = Boolean(
    config.tenantId &&
    isMicrosoftTenantId(config.tenantId) &&
    config.clientId &&
    config.encryptedClientSecret &&
    config.scopes.includes("openid"),
  );
  return {
    enabled: config.enabled,
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecretConfigured: Boolean(config.encryptedClientSecret),
    clientSecretMasked: config.encryptedClientSecret ? "********" : null,
    scopes: config.scopes,
    autoProvisionMembers: config.autoProvisionMembers,
    configured,
    redirectUri: microsoftRedirectUri(),
    adminRedirectUri: adminMicrosoftRedirectUri(),
  };
}

export function adminSettingsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    "/admin/settings/microsoft",
    { preHandler: [requireCapability("settings.view")] },
    async (request, reply) => {
      const config = await prisma.microsoftAuthConfig.findUnique({
        where: { programId: request.programId },
      });
      return reply.send({
        data: config
          ? settingsResponse(config)
          : {
              enabled: false,
              tenantId: null,
              clientId: null,
              clientSecretConfigured: false,
              clientSecretMasked: null,
              scopes: ["openid", "profile", "email"],
              autoProvisionMembers: true,
              configured: false,
              redirectUri: microsoftRedirectUri(),
              adminRedirectUri: adminMicrosoftRedirectUri(),
            },
      });
    },
  );

  app.put(
    "/admin/settings/microsoft",
    { preHandler: [requireCapability("settings.manage")] },
    async (request, reply) => {
      const body = microsoftSettingsSchema.parse(request.body);
      const current = await prisma.microsoftAuthConfig.findUnique({
        where: { programId: request.programId },
      });
      const scopes = normalizeMicrosoftScopes(body.scopes ?? current?.scopes);
      const tenantId = body.tenantId
        ? isMicrosoftTenantId(body.tenantId)
          ? normalizeMicrosoftTenantId(body.tenantId)
          : body.tenantId
        : null;
      const clientId = body.clientId || null;
      const encryptedClientSecret =
        body.clientSecret && body.clientSecret.length > 0
          ? encrypt(body.clientSecret, getMasterKey())
          : (current?.encryptedClientSecret ?? null);

      if (body.enabled) {
        if (!tenantId || !isMicrosoftTenantId(tenantId))
          throw new LoyaltyError("MICROSOFT_TENANT_ID_INVALID", 400);
        if (!clientId || !encryptedClientSecret)
          throw new LoyaltyError("MICROSOFT_CONFIG_INCOMPLETE", 409);
      }

      const config = await prisma.microsoftAuthConfig.upsert({
        where: { programId: request.programId },
        create: {
          programId: request.programId,
          enabled: body.enabled,
          tenantId,
          clientId,
          encryptedClientSecret,
          scopes,
          autoProvisionMembers: body.autoProvisionMembers ?? true,
        },
        update: {
          enabled: body.enabled,
          tenantId,
          clientId,
          ...(body.clientSecret && body.clientSecret.length > 0 ? { encryptedClientSecret } : {}),
          scopes,
          autoProvisionMembers: body.autoProvisionMembers ?? current?.autoProvisionMembers ?? true,
        },
      });
      await audit(
        request.programId,
        request.actor,
        "CONFIG_CHANGE",
        "microsoft_auth_config",
        config.id,
        {
          enabled: config.enabled,
          tenantId: config.tenantId,
          clientId: config.clientId,
          scopes: config.scopes,
          autoProvisionMembers: config.autoProvisionMembers,
          clientSecretChanged: Boolean(body.clientSecret),
        },
      );
      return reply.send({ data: settingsResponse(config) });
    },
  );

  app.post(
    "/admin/settings/microsoft/test",
    { preHandler: [requireCapability("settings.manage")] },
    async (request, reply) => {
      const config = await prisma.microsoftAuthConfig.findUnique({
        where: { programId: request.programId },
      });
      validateMicrosoftConfig(config);
      const discovery = await discoverMicrosoft(config);
      return reply.send({
        data: {
          ok: true,
          issuer: discovery.issuer,
          redirectUri: microsoftRedirectUri(),
          adminRedirectUri: adminMicrosoftRedirectUri(),
        },
      });
    },
  );

  done();
}
