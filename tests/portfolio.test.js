const { test } = require("node:test");
const assert = require("node:assert/strict");
const { exposure } = require("../portfolio");
test("direct and ETF exposure are combined without assigning unreported holdings", () => {
  const result = exposure({ cashTwd: 100, positions: [{ symbol: "2330", kind: "stock", marketValueTwd: 100 }, { symbol: "00850", kind: "etf", marketValueTwd: 200 }], constituents: [{ etf: "00850", company: "2330", weight: 50 }] });
  assert.equal(result.total, 400);
  assert.equal(result.unknown, 100);
  assert.deepEqual(result.companies, [{ symbol: "2330", value: 200, percent: 50 }]);
});
test("missing data does not become a zero-risk portfolio", () => {
  assert.equal(exposure({ positions: [{ symbol: "2330", marketValueTwd: "" }] }).missing, 1);
  assert.throws(() => exposure({ positions: [{ symbol: "ETF", kind: "etf", marketValueTwd: 100 }], constituents: [{ etf: "ETF", company: "X", weight: 101 }] }));
});
