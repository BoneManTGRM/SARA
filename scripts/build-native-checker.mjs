import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Native checker release is qualified only for linux-x64");
execFileSync("npm", ["ci", "--prefix", "tools/native-checker", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["--import", "tsx", "scripts/check-native-ready.ts"], { cwd: root, stdio: "inherit" });
