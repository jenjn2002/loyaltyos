function configuredPublicUrl(): string {
  const portalUrl = process.env.PORTAL_URL?.trim();
  if (portalUrl) return portalUrl;
  const apiUrl = process.env.PUBLIC_API_URL?.trim();
  if (apiUrl) return apiUrl;
  return "http://localhost:5176";
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

export function portalHomeUrl(): string {
  return `${resolvePortalUrl()}/`;
}
