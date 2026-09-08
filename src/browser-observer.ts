/** Read-only page and request boundary for the owner-started browser observer. */
export function browserRequestAllowed(address: string, method: string): boolean {
  if (method !== "GET") return false;
  try {
    const url = new URL(address);
    return url.origin === "https://saraseed.app" && !url.username && !url.password && !url.pathname.includes("%") &&
      (!url.pathname.startsWith("/api/") || url.pathname === "/api/public/signal" || url.pathname === "/api/owner/session");
  } catch { return false; }
}

export function browserObserverAuthorized(environment: NodeJS.ProcessEnv): boolean {
  return environment.GITHUB_ACTIONS === "true" && environment.GITHUB_REPOSITORY === "BoneManTGRM/SARA" &&
    environment.GITHUB_REF === "refs/heads/main" && (environment.GITHUB_EVENT_NAME === "workflow_dispatch" || environment.GITHUB_EVENT_NAME === "push") &&
    environment.GITHUB_RUN_ATTEMPT === "1" && environment.SARA_REPOSITORY_VISIBILITY === "public";
}
