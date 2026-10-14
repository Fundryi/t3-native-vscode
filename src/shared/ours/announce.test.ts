import assert from "node:assert/strict";
import { test } from "node:test";
import { announcementText } from "./announce.js";

test("announce: names the card, then each Alt key in order, without trailing dots", () => {
  assert.equal(announcementText({ kind: "Approval needed", title: "Command approval,\n  pnpm run test", keys: ["Decline", "Allow this session", "Approve"] }),
    "Approval needed: Command approval, pnpm run test. Alt+1 Decline, Alt+2 Allow this session, Alt+3 Approve.");
  assert.equal(announcementText({ kind: "Secret requested", title: "API key", keys: ["Decline", "Enter secret..."] }),
    "Secret requested: API key. Alt+1 Decline, Alt+2 Enter secret.");
  assert.equal(announcementText({ kind: "Secret requested", title: "API key", keys: [] }), "Secret requested: API key.");
  assert.equal(announcementText({ kind: "Question", title: "Which layout?", keys: ["Compact"] }), "Question: Which layout? Alt+1 Compact.");
  assert.equal(announcementText({ kind: "Question", title: "q", keys: Array.from({ length: 12 }, (_, i) => `o${i}`) }).split("Alt+").length, 10);
});
