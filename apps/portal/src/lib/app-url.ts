const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appUrl(path = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE_PATH}${suffix}` || "/";
}
