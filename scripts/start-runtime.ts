import { spawn } from "node:child_process";

if (process.env.SARA_RUN_CODING_SPEED_BENCHMARK === "true") {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/benchmark-reparodynamic-coding.ts",
      "--live",
      "--acknowledge-max-spend-usd=0.15",
    ],
    { stdio: "inherit", env: process.env },
  );
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Coding-speed benchmark exited via signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  process.exit(exitCode);
} else {
  await import("../src/main.ts");
}
