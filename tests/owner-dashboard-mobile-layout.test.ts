import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOwnerMobileLayoutFix,
  OWNER_MOBILE_LAYOUT_FIX_MARKER,
} from "../src/owner-dashboard-theme-runtime.ts";

describe("SARA owner dashboard mobile containment", () => {
  it("constrains the hero, headline and SEED panel to narrow viewports", () => {
    const source = "<!doctype html><html><head><title>SARA // Owner Command Center</title></head><body><main class=\"hero\"><h1>Intelligence with roots.</h1><div class=\"core-stage\"><div class=\"core-caption\"><strong>Constitution verified</strong></div></div></main></body></html>";
    const fixed = applyOwnerMobileLayoutFix(source);

    assert.notEqual(fixed, source);
    assert.ok(fixed.includes(OWNER_MOBILE_LAYOUT_FIX_MARKER));
    assert.ok(fixed.includes("@media (max-width: 720px)"));
    assert.ok(fixed.includes("grid-template-columns: minmax(0, 1fr) !important"));
    assert.ok(fixed.includes("font-size: clamp(2.55rem, 12.8vw, 4.2rem) !important"));
    assert.ok(fixed.includes("width: min(100%, 360px) !important"));
    assert.ok(fixed.includes("max-width: 48% !important"));
  });

  it("is idempotent and does not alter non-owner HTML", () => {
    const owner = "<html><head><title>SARA // Owner Command Center</title></head><body></body></html>";
    const fixed = applyOwnerMobileLayoutFix(owner);
    assert.equal(applyOwnerMobileLayoutFix(fixed), fixed);

    const publicPage = "<html><head><title>SARA public</title></head><body></body></html>";
    assert.equal(applyOwnerMobileLayoutFix(publicPage), publicPage);
  });
});
