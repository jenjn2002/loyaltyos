function configuredPublicUrl(): string {
  const portalUrl = process.env.PORTAL_URL?.trim();
  if (portalUrl) return portalUrl;
  const apiUrl = process.env.PUBLIC_API_URL?.trim();
  if (apiUrl) return apiUrl;
  return "http://localhost:5176";
}

function configuredAdminPublicUrl(): string {
  const adminUrl = process.env.ADMIN_URL?.trim();
  if (adminUrl) return adminUrl;
  return "http://localhost:5175";
}

export function resolvePortalUrl(): string {
  const configured = configuredPublicUrl();
  try {
    return new URL(configured).toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:5176";
  }
}

/**
 * The callback uses the stable configured origin, never request Host headers.
 * PORTAL_URL may include /customer; the API is exposed at the same origin's
 * /api path by the default reverse proxy.
 */
export function resolvePortalOrigin(): string {
  try {
    return new URL(configuredPublicUrl()).origin;
  } catch {
    return "http://localhost:5176";
  }
}

export function microsoftRedirectUri(): string {
  return `${resolvePortalOrigin()}/api/v1/auth/microsoft/callback`;
}

export function resolveAdminUrl(): string {
  const configured = configuredAdminPublicUrl();
  try {
    return new URL(configured).toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:5175";
  }
}

export function resolveAdminOrigin(): string {
  try {
    return new URL(configuredAdminPublicUrl()).origin;
  } catch {
    return "http://localhost:5175";
  }
}

export function adminMicrosoftRedirectUri(): string {
  return `${resolveAdminOrigin()}/api/v1/admin/auth/microsoft/callback`;
}

export function adminHomeUrl(): string {
  return `${resolveAdminUrl()}/`;
}

export function portalHomeUrl(): string {
  return `${resolvePortalUrl()}/`;
}
