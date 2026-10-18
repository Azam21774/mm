const assert = require("node:assert/strict");
const test = require("node:test");
const { generateRandomTag, renderTagTemplate } = require("../utils/tagTemplate");

test("double-brace tags render unescaped message HTML", () => {
  assert.equal(renderTagTemplate("Hello {{name}}: {{content}}", { name: "Sam", content: "<b>Paid</b>" }), "Hello Sam: <b>Paid</b>");
});

test("missing tags render as empty text", () => {
  assert.equal(renderTagTemplate("{{known}}/{{missing}}", { known: "ok" }), "ok/");
});

test("Random Tags use only selected character sets and exact length", () => {
  assert.match(generateRandomTag(64, { number: true }), /^\d{64}$/);
  assert.match(generateRandomTag(64, { alphabets: true }), /^[a-z]{64}$/);
  assert.match(generateRandomTag(64, { capital: true }), /^[A-Z]{64}$/);
});

test("Random Tags reject an empty character configuration", () => {
  assert.throws(() => generateRandomTag(8, {}), /at least one character set/);
});

test("Random Tags validate length", () => {
  assert.throws(() => generateRandomTag(0, { number: true }), /between 1 and 128/);
  assert.throws(() => generateRandomTag(129, { number: true }), /between 1 and 128/);
});
