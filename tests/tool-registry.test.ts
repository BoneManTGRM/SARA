import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listSaraTools } from "../src/tool-registry.ts";

describe("SARA governed tool registry", () => {
  it("reports real tools, runtime readiness, and authority boundaries", () => {
    const tools = listSaraTools({ lunaConfigured: true, ownerAssistantConfigured: true, nicoConfigured: true });
    const ids = tools.map((tool) => tool.id);

    assert.ok(ids.includes("luna-worker"));
    assert.ok(ids.includes("public-github-evidence"));
    assert.ok(ids.includes("genome-lab-program-builder"));
    assert.ok(ids.includes("operational-skill-router"));
    assert.ok(ids.includes("nico-comprehensive-operator"));
    assert.equal(tools.find((tool) => tool.id === "luna-worker")?.status, "available");
    assert.equal(tools.find((tool) => tool.id === "bounded-owner-analyst")?.status, "available");
    assert.equal(tools.find((tool) => tool.id === "nico-comprehensive-operator")?.status, "available");
    assert.ok(tools.every((tool) => tool.prohibitedActions.includes("customer delivery")));
    assert.equal(JSON.stringify(tools).match(/api[_-]?key|owner[_-]?token|secret/gi), null);
  });

  it("does not pretend Luna is available without its runtime configuration", () => {
    const tools = listSaraTools({ lunaConfigured: false });
    assert.equal(tools.find((tool) => tool.id === "luna-worker")?.status, "configuration_required");
    assert.equal(tools.find((tool) => tool.id === "bounded-owner-analyst")?.status, "configuration_required");
    assert.equal(tools.find((tool) => tool.id === "nico-comprehensive-operator")?.status, "configuration_required");
  });
});
