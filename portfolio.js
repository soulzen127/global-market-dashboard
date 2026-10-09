(function (root) {
  function exposure(portfolio) {
    const companies = {};
    let total = Number(portfolio.cashTwd || 0);
    let unknown = 0;
    let missing = 0;
    for (const p of portfolio.positions || []) {
      if (p.marketValueTwd === "" || p.marketValueTwd == null) { missing++; continue; }
      const value = Number(p.marketValueTwd);
      if (!Number.isFinite(value) || value < 0) { missing++; continue; }
      total += value;
      if (p.kind !== "etf") companies[p.symbol] = (companies[p.symbol] || 0) + value;
      else {
        const holdings = (portfolio.constituents || []).filter((h) => h.etf === p.symbol);
        const weight = holdings.reduce((sum, h) => sum + Number(h.weight), 0);
        if (weight > 100 || holdings.some((h) => !Number.isFinite(Number(h.weight)) || Number(h.weight) < 0)) throw new Error("ETF weights must be between 0 and 100% in total.");
        for (const h of holdings) companies[h.company] = (companies[h.company] || 0) + value * Number(h.weight) / 100;
        unknown += value * (1 - weight / 100);
      }
    }
    return { total, unknown, missing, companies: Object.entries(companies).map(([symbol, value]) => ({ symbol, value, percent: total ? value / total * 100 : 0 })).sort((a, b) => b.value - a.value) };
  }
  if (typeof module !== "undefined") module.exports = { exposure };
  else root.PortfolioMath = { exposure };
})(typeof window !== "undefined" ? window : globalThis);
