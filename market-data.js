const SOURCE = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
let cache;
let pending;
function parseRows(rows) {
  if (!Array.isArray(rows)) throw new Error("Invalid market data");
  return rows.filter((row) => /^\d{4,6}[A-Z]?$/.test(row.Code || "")).map((row) => {
    const date = String(row.Date || "");
    const quoteDate = /^\d{7}$/.test(date) ? `${Number(date.slice(0, 3)) + 1911}-${date.slice(3, 5)}-${date.slice(5, 7)}` : "";
    const raw = String(row.ClosingPrice || "").replaceAll(",", "");
    const price = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
    return { symbol: `${row.Code}.TW`, name: String(row.Name || row.Code), market: "TWSE", categoryLabel: "台股", currency: "TWD", kind: /^00\d/.test(row.Code) ? "etf" : "stock", unitPriceTwd: price > 0 && quoteDate ? price : null, quoteDate, quoteSource: SOURCE };
  });
}
async function instruments() {
  if (cache && Date.now() - cache.at < 600000) return cache.items;
  if (!pending) pending = (async () => {
    const response = await fetch(SOURCE, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Market provider unavailable");
    const items = parseRows(await response.json());
    if (!items.length) throw new Error("Empty market data");
    cache = { at: Date.now(), items };
    return items;
  })().finally(() => { pending = null; });
  return pending;
}
module.exports = { parseRows, instruments };
