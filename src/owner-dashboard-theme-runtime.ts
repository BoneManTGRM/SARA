import { ServerResponse } from "node:http";
import { applyOwnerDashboardTheme, KNIGHT_RIDER_THEME_MARKER } from "./owner-dashboard-theme.ts";

let installed = false;
let loggedFirstApplication = false;

export const OWNER_MOBILE_LAYOUT_FIX_MARKER = 'data-owner-mobile-layout-fix="2026-09-09"';

const OWNER_MOBILE_LAYOUT_FIX = String.raw`<style ${OWNER_MOBILE_LAYOUT_FIX_MARKER}>
/* Narrow-screen containment fix for the cockpit skin. Presentation only. */
@media (max-width: 720px) {
  html, body {
    max-width: 100% !important;
    overflow-x: hidden !important;
  }

  .shell {
    width: calc(100% - 14px) !important;
    max-width: 100% !important;
  }

  .topbar {
    width: 100% !important;
    max-width: 100% !important;
  }

  .hero {
    grid-template-columns: minmax(0, 1fr) !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    min-height: auto !important;
    overflow: hidden !important;
    padding: 34px 14px 30px !important;
  }

  .hero > div {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  .hero > div:first-child {
    padding-left: 10px !important;
  }

  .eyebrow {
    max-width: 100% !important;
    flex-wrap: wrap !important;
    font-size: .57rem !important;
    letter-spacing: .12em !important;
  }

  h1 {
    width: 100% !important;
    max-width: 100% !important;
    font-size: clamp(2.55rem, 12.8vw, 4.2rem) !important;
    line-height: .93 !important;
    letter-spacing: -.06em !important;
    overflow-wrap: normal !important;
    word-break: normal !important;
  }

  .hero-copy {
    width: 100% !important;
    max-width: 100% !important;
    overflow-wrap: anywhere !important;
  }

  .truth-row {
    width: 100% !important;
    max-width: 100% !important;
  }

  .truth-chip {
    min-width: 0 !important;
    max-width: 100% !important;
    flex: 0 1 auto !important;
  }

  .core-stage {
    width: min(100%, 360px) !important;
    max-width: 100% !important;
    justify-self: center !important;
    margin: 16px auto 0 !important;
    overflow: hidden !important;
  }

  .core-caption {
    right: 3% !important;
    bottom: 4% !important;
    width: min(160px, 48%) !important;
    max-width: 48% !important;
    padding: 9px 10px !important;
  }

  .core-caption strong {
    white-space: normal !important;
    overflow-wrap: anywhere !important;
    font-size: .62rem !important;
    line-height: 1.35 !important;
  }

  .chapter,
  .chapter-head,
  .bento,
  .card {
    min-width: 0 !important;
    max-width: 100% !important;
  }
}

@media (max-width: 390px) {
  .hero {
    padding-left: 12px !important;
    padding-right: 12px !important;
  }

  h1 {
    font-size: clamp(2.35rem, 12.3vw, 3.75rem) !important;
  }

  .core-stage {
    width: min(100%, 340px) !important;
  }

  .core-caption {
    width: min(150px, 50%) !important;
    max-width: 50% !important;
  }

  .brand-name {
    letter-spacing: .22em !important;
  }
}
</style>`;

export function applyOwnerMobileLayoutFix(html: string): string {
  if (
    html.includes(OWNER_MOBILE_LAYOUT_FIX_MARKER) ||
    !html.includes("<title>SARA // Owner Command Center</title>") ||
    !html.includes("</head>")
  ) {
    return html;
  }
  return html.replace("</head>", `${OWNER_MOBILE_LAYOUT_FIX}</head>`);
}

/**
 * Runtime presentation hook for the owner dashboard.
 *
 * The owner page is identified by its exact title rather than by response headers.
 * Node may have already committed writeHead() before end() runs, so header state is
 * deliberately not used to decide whether to apply the theme.
 */
export function installOwnerDashboardThemeRuntime(): void {
  if (installed) return;
  installed = true;

  type RawEnd = (...args: unknown[]) => unknown;
  const responsePrototype = ServerResponse.prototype as unknown as { end: RawEnd };
  const originalEnd = responsePrototype.end;

  responsePrototype.end = function (this: ServerResponse, ...args: unknown[]): unknown {
    if (args.length > 0 && typeof args[0] === "string" && args[0].includes("<title>SARA // Owner Command Center</title>")) {
      const themed = applyOwnerMobileLayoutFix(applyOwnerDashboardTheme(args[0]));
      if (themed !== args[0]) {
        args[0] = themed;
        if (!loggedFirstApplication && themed.includes(KNIGHT_RIDER_THEME_MARKER)) {
          loggedFirstApplication = true;
          console.log("SARA owner cockpit theme applied to live HTML response.");
        }
      }
    }
    return originalEnd.apply(this, args);
  };
}
