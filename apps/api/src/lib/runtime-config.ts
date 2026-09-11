const PLACEHOLDER_PATTERN =
  /^(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example[-_ ]|dev[-_ ]secret|todo|xxx)/i;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function parseCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.COOKIE_SECURE?.trim().toLowerCase();
  if (FALSE_VALUES.has(raw ?? "")) return false;
  if (TRUE_VALUES.has(raw ?? "")) return true;

  // Preserve secure cookies for existing HTTPS installations that predate
  // COOKIE_SECURE. Fresh HTTP installs explicitly set COOKIE_SECURE=false in
  // the supplied env template.
  const portalUrl = env.PORTAL_URL?.trim().toLowerCase();
  if (portalUrl) return portalUrl.startsWith("https://");
  return env.NODE_ENV === "production";
}

function isUnsafePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

function requireSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  issues: string[],
  minimumLength = 32,
): void {
  const value = env[name]?.trim();
  if (!value) {
    issues.push(`${name} is required`);
    return;
  }
  if (value.length < minimumLength) {
    issues.push(`${name} must be at least ${String(minimumLength)} characters`);
  }
  if (isUnsafePlaceholder(value)) {
    issues.push(`${name} still contains an instructional placeholder`);
  }
}

function requireAdminBootstrapValues(env: NodeJS.ProcessEnv, issues: string[]): void {
  const email = env.ADMIN_DEFAULT_EMAIL?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    issues.push("ADMIN_DEFAULT_EMAIL must be a valid email address");
  } else if (isUnsafePlaceholder(email)) {
    issues.push("ADMIN_DEFAULT_EMAIL still contains an instructional placeholder");
  }

  const name = env.ADMIN_DEFAULT_NAME?.trim();
  if (!name) issues.push("ADMIN_DEFAULT_NAME is required for the first admin");
  else if (isUnsafePlaceholder(name)) {
    issues.push("ADMIN_DEFAULT_NAME still contains an instructional placeholder");
  }

  const password = env.ADMIN_DEFAULT_PASSWORD ?? "";
  if (password.length < 12) {
    issues.push("ADMIN_DEFAULT_PASSWORD must be at least 12 characters");
  }
  if (isUnsafePlaceholder(password)) {
    issues.push("ADMIN_DEFAULT_PASSWORD still contains an instructional placeholder");
  }
  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (characterClasses < 3) {
    issues.push("ADMIN_DEFAULT_PASSWORD must use at least 3 character classes");
  }
}

/**
 * Validate values that are unsafe to guess in a production installation.
 * Admin bootstrap values are required only when the database has no admin yet,
 * so upgrades of an existing installation do not need to rotate credentials.
 */
export function validateProductionConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireAdminBootstrap?: boolean } = {},
): void {
  if (env.NODE_ENV !== "production") return;

  const issues: string[] = [];
  requireSecret(env, "JWT_SECRET", issues);
  requireSecret(env, "API_KEY_SALT", issues);
  requireSecret(env, "KMS_MASTER_KEY", issues, 16);
  requireSecret(env, "GIFTCARD_HMAC_SECRET", issues);
  requireSecret(env, "POSTGRES_PASSWORD", issues, 16);

  const cookieSecure = env.COOKIE_SECURE?.trim().toLowerCase();
  if (cookieSecure && !TRUE_VALUES.has(cookieSecure) && !FALSE_VALUES.has(cookieSecure)) {
    issues.push("COOKIE_SECURE must be true or false");
  }

  if (options.requireAdminBootstrap) requireAdminBootstrapValues(env, issues);

  if (issues.length > 0) {
    throw new Error(
      `Production configuration is invalid:\n- ${issues.join("\n- ")}\n` +
        "Generate secrets with: openssl rand -hex 32 (or 64 for JWT_SECRET), then update infra/docker/.env.production.",
    );
  }
}

export function getAdminBootstrapValues(env: NodeJS.ProcessEnv = process.env): {
  email: string;
  name: string;
  password: string;
} {
  return {
    email: env.ADMIN_DEFAULT_EMAIL?.trim().toLowerCase() ?? "",
    name: env.ADMIN_DEFAULT_NAME?.trim() ?? "",
    password: env.ADMIN_DEFAULT_PASSWORD ?? "",
  };
}
