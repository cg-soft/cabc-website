import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual Add date click handler with a minimal DOM, without
// exposing private application state in the shipped browser script.
function dateDialog(month, today) {
  const handlers = {};
  const dialog = {
    addEventListener() {},
    querySelector() { return { setAttribute() {} }; },
    showModal() { this.open = true; }
  };
  const sandbox = {
    document: {
      querySelector(selector) { return selector === "#dialog" ? dialog : {}; },
      addEventListener(name, handler) { handlers[name] = handler; }
    },
    window: { addEventListener() {} }
  };
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const end = "  route();\n})();";
  assert.ok(source.endsWith(`${end}\n`) || source.endsWith(end));
  vm.runInNewContext(source.replace(end, "  window.testState = state;\n})();"), sandbox);
  Object.assign(sandbox.window.testState, { month, config: { today } });
  return {
    async open() {
      await handlers.click({
        target: { closest(selector) {
          return selector === "[data-action]" ? { dataset: { action: "add-date" } } : null;
        } }
      });
      assert.equal(dialog.open, true);
      const date = dialog.innerHTML.match(/<input name="date"[^>]+>/)[0];
      return {
        value: date.match(/value="([^"]+)"/)[1],
        min: date.match(/min="([^"]+)"/)[1]
      };
    },
    setMonth(value) { sandbox.window.testState.month = value; }
  };
}

for (const [label, month, today, expected] of [
  ["future displayed month", "2026-11", "2026-10-24", "2026-11-01"],
  ["current month", "2026-10", "2026-10-24", "2026-10-24"],
  ["year boundary", "2027-01", "2026-12-31", "2027-01-01"],
  ["leap day", "2028-02", "2028-02-29", "2028-02-29"],
  ["first day", "2026-11", "2026-11-01", "2026-11-01"],
  ["no month loaded or empty calendar", null, "2026-10-24", "2026-10-24"],
  ["stale past month", "2026-09", "2026-10-24", "2026-10-24"]
]) {
  test(`Add date default: ${label}`, async () => {
    assert.deepEqual(await dateDialog(month, today).open(), { value: expected, min: today });
  });
}

test("Add date recalculates its default after month navigation", async () => {
  const form = dateDialog("2026-11", "2026-10-24");
  assert.equal((await form.open()).value, "2026-11-01");
  form.setMonth("2027-01");
  assert.equal((await form.open()).value, "2027-01-01");
  form.setMonth("2026-10");
  assert.equal((await form.open()).value, "2026-10-24");
});
