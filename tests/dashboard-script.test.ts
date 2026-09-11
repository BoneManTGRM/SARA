import assert from "node:assert/strict";
import {test} from "node:test";
import {Script} from "node:vm";
import {DASHBOARD_HTML} from "../src/dashboard.ts";

test("served dashboard scripts parse before owner event handlers are installed",()=>{
  const scripts=[...DASHBOARD_HTML.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
  assert.ok(scripts.length>0);
  for(const script of scripts)assert.doesNotThrow(()=>new Script(script[1]!,{filename:"served-dashboard.js"}));
  assert.match(DASHBOARD_HTML,/Replace active mandate with 20\/day internal learning/);
  assert.match(DASHBOARD_HTML,/current routine mandate will be replaced under exact owner reconciliation/);
});
