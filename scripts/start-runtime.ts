if (process.env.SARA_RUN_CODING_SPEED_BENCHMARK === "true") {
  process.argv.push("--live", "--acknowledge-max-spend-usd=0.15");
  await import("./benchmark-reparodynamic-coding.ts");
} else {
  await import("../src/main.ts");
}
