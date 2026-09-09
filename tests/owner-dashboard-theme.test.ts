import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOwnerDashboardTheme,
  KNIGHT_RIDER_THEME_CSS,
  KNIGHT_RIDER_THEME_MARKER,
} from "../src/owner-dashboard-theme.ts";

describe("SARA owner dashboard cyberpunk theme", () => {
  it("injects the presentation skin only into the owner command center", () => {
    const source = "<!doctype html><html><head><title>SARA // Owner Command Center</title></head><body>owner</body></html>";
    const themed = applyOwnerDashboardTheme(source);
    assert.notEqual(themed, source);
    assert.match(themed, new RegExp(KNIGHT_RIDER_THEME_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(themed, /--scanner-red: #ff174f/);
    assert.match(themed, /@keyframes kittSweep/);
    assert.match(themed, /\.scan-rail span/);
    assert.match(themed, /\.brand-mark::before/);
  });

  it("is idempotent and leaves non-owner HTML unchanged", () => {
    const source = "<!doctype html><html><head><title>SARA // Owner Command Center</title></head><body>owner</body></html>";
    const once = applyOwnerDashboardTheme(source);
    assert.equal(applyOwnerDashboardTheme(once), once);
    assert.equal(
      applyOwnerDashboardTheme("<html><head><title>Other</title></head><body>public</body></html>"),
      "<html><head><title>Other</title></head><body>public</body></html>",
    );
  });

  it("keeps reduced-motion coverage for scanner animations", () => {
    assert.match(KNIGHT_RIDER_THEME_CSS, /prefers-reduced-motion: reduce/);
    assert.match(KNIGHT_RIDER_THEME_CSS, /animation: none !important/);
  });
});
