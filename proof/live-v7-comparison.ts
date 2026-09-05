import { assertOfflineRecovery } from "./v7-failure-diagnostics.ts";

// The historical V7 grant is consumed. Preserve its original implementation in
// Git history, not as an executable paid launcher on current main.
assertOfflineRecovery(process.argv);
throw new Error("Historical V7 launcher retired. Use the current owner-authenticated benchmark route; this file never dispatches a provider request.");
