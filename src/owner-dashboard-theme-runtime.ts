import { ServerResponse } from "node:http";
import { applyOwnerDashboardTheme, KNIGHT_RIDER_THEME_MARKER } from "./owner-dashboard-theme.ts";

let installed = false;
let loggedFirstApplication = false;

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
      const themed = applyOwnerDashboardTheme(args[0]);
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
