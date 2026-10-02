const productionOrigin = "https://csd-repo-ai.vercel.app";

export function getPasswordResetRedirectTo(origin = productionOrigin) {
  try {
    return new URL("/login", origin || productionOrigin).toString();
  } catch {
    return `${productionOrigin}/login`;
  }
}
