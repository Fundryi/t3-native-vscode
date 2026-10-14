import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutMode, panelRoute } from "./layoutRoute.js";

test("layout: sidebar is the default, only editor switches", () => {
  assert.equal(layoutMode(undefined), "sidebar");
  assert.equal(layoutMode("bogus"), "sidebar");
  assert.equal(layoutMode("editor"), "editor");
});

test("layout: createPanel routes", () => {
  assert.equal(panelRoute("sidebar", "sidebar", "sidebar", false), "sidebar");
  assert.equal(panelRoute("sidebar", "sidebar", "sidebar", true), "his-then-list");
  assert.equal(panelRoute("sidebar", "panel_1", "sidebar", false), "his");
  assert.equal(panelRoute("editor", "sidebar", "sidebar", false), "his");
});
