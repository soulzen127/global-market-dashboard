const { test } = require("node:test");
const assert = require("node:assert/strict");
const { search, valuation } = require("../portfolio");
const { parseRows } = require("../market-data");
const items = [
  { symbol: "2330.TW", name: "台積電", market: "TWSE", categoryLabel: "台股" },
  { symbol: "SPY", name: "S&P 500 ETF", market: "NYSE Arca", kind: "etf" }
];
test("search handles whitespace, full width, names, market and multiple terms", () => {
  assert.equal(search(items, " ２３３０ ")[0].symbol, "2330.TW");
  assert.equal(search(items, "台積 台股").length, 1);
  assert.equal(search(items, "nyse ETF")[0].symbol, "SPY");
  assert.equal(search(items, "nothing").length, 0);
  assert.equal(search(items, " ").length, 0);
});
test("TWD valuation requires both quantity and unit value", () => {
  assert.equal(valuation("100", "123.45"), 12345);
  assert.equal(valuation("", "123.45"), "");
  assert.equal(valuation("100", ""), "");
  assert.equal(valuation("-1", "123"), "");
  assert.equal(valuation("Infinity", "123"), "");
  assert.equal(valuation("0", "123"), 0);
});
test("official closing quotes retain their actual date and reject unavailable prices", () => {
  const rows = parseRows([
    { Code: "2330", Name: "台積電", Date: "1151008", ClosingPrice: "1,000.50" },
    { Code: "00850", Name: "ETF", Date: "1151008", ClosingPrice: "--" },
    { Code: "2308", Date: "", ClosingPrice: "100" }
  ]);
  assert.equal(rows[0].quoteDate, "2026-10-08");
  assert.equal(rows[0].unitPriceTwd, 1000.5);
  assert.equal(rows[1].kind, "etf");
  assert.equal(rows[1].unitPriceTwd, null);
  assert.equal(rows[2].unitPriceTwd, null);
});
