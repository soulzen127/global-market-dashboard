(() => {
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(n);
  let data;
  let panel;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function bindInstrumentSearch(form, name, etfOnly, select) {
    const input = form.elements[name];
    input.setAttribute("aria-label", input.closest("label").firstChild.textContent);
    input.autocomplete = "off";
    input.setAttribute("enterkeyhint", "search");
    const results = document.createElement("div");
    results.className = "instrument-results";
    results.id = `${form.id}-${name}-results`;
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "⌕";
    button.title = "搜尋標的"; button.setAttribute("aria-label", `搜尋${input.closest("label").firstChild.textContent}`);
    input.after(button, status, results);
    input.setAttribute("aria-controls", results.id);
    let generation = 0;
    async function run() {
      const request = ++generation;
      const query = input.value;
      results.replaceChildren(); status.textContent = "搜尋中…";
      const known = window.getInstrumentCatalog();
      let unavailable = false;
      try {
        const remote = await apiRequest(`/api/instruments?q=${encodeURIComponent(query)}`);
        for (const item of remote.items) {
          const index = known.findIndex((a) => a.symbol === item.symbol);
          if (index >= 0) known[index] = item; else known.push(item);
        }
      } catch { unavailable = true; }
      if (request !== generation) return;
      for (const p of data.positions) if (!known.some((a) => a.symbol === p.symbol)) known.push({ symbol: p.symbol, name: p.name || p.symbol, kind: p.kind, market: "已存持倉" });
      const matches = PortfolioMath.search(known.filter((a) => !etfOnly || a.kind === "etf"), input.value);
      results.replaceChildren();
      status.textContent = (matches.length ? `${matches.length} 筆結果` : "查無資料，可手動填寫") + (unavailable ? " · 官方報價暫不可用，僅顯示本機清單" : "");
      for (const item of matches) {
        const option = document.createElement("button");
        option.type = "button"; option.textContent = `${item.symbol} · ${item.name} · ${item.market}`;
        option.onclick = () => { input.value = item.symbol; results.replaceChildren(); status.textContent = item.name; select(item); input.focus(); };
        results.append(option);
      }
    }
    button.onclick = run;
    input.onkeydown = (event) => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); run(); }
      if (event.key === "ArrowDown" && results.firstChild) { event.preventDefault(); results.firstChild.focus(); }
      if (event.key === "Escape") results.replaceChildren();
    };
    input.oninput = () => { generation++; results.replaceChildren(); status.textContent = ""; };
  }
  const defaults = () => ({
    objective: "資本保全、長期複利；核心持有搭配戰術配置。台股為主，以台幣衡量風險。",
    concentrationLimit: "", cashTwd: "", cashFloor: "", reviewDate: "",
    positions: [], constituents: [], decisions: [],
  });
  const save = async () => { await queueWorkspaceSave("strategy", data); if (workspaceSaveFailed) throw new Error("資料尚未保存，請查看頁首狀態並匯出備份。"); };
  const fields = (items) => items.map(([name, label, type = "text", value = ""]) => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${type === "number" ? 'min="0" step="any"' : ''} required></label>`).join("");
  function render() {
    const result = window.PortfolioMath.exposure(data);
    panel.innerHTML = `
      <div class="panel-header"><h2>我的投資策略與組合</h2><button type="button" id="exportStrategy">匯出組合 JSON</button></div>
      <p>長期核心投資 / TWD / 台灣為主。持倉採官方收盤價或手動估值，與模擬行情分開計算。</p>
      <form id="strategyRules" class="strategy-form">
        <label class="wide">投資原則<textarea name="objective" maxlength="2000">${escape(data.objective)}</textarea></label>
        <label>台幣現金<input name="cashTwd" type="number" min="0" step="any" value="${escape(data.cashTwd)}"></label>
        <label>單一公司曝險上限 %<input name="concentrationLimit" type="number" min="0" max="100" step="any" value="${escape(data.concentrationLimit)}"></label>
        <label>最低現金比例 %<input name="cashFloor" type="number" min="0" max="100" step="any" value="${escape(data.cashFloor)}"></label>
        <label>下次檢視日期<input name="reviewDate" type="date" value="${escape(data.reviewDate)}"></label>
        <button>保存策略</button>
      </form>
      <h3>新增持倉資料</h3>
      <p>既有規劃標的：2330 台積電、2308 台達電、2454 聯發科、00850；國泰與群益 ETF 代號待確認。${data.positions.length ? "持倉以你輸入的資料為準。" : "尚未填入任何實際持倉。"}</p>
      <form id="positionForm" class="strategy-form">
        ${fields([["symbol", "標的代號"], ["quantity", "股數 / 單位", "number"], ["costTwd", "總成本 TWD", "number"], ["marketValueTwd", "市值 TWD", "number"], ["asOf", "估值日期", "date", today()]])}
        <label>每單位估值 TWD<input name="unitPriceTwd" type="number" min="0" step="any"></label>
        <label>估值來源<input name="valuationSource" maxlength="300" placeholder="手動估值 / 報價來源"></label>
        <input type="hidden" name="quoteDate"><input type="hidden" name="name">
        <p class="wide" id="valuationStatus" role="status">台股可使用證交所最近收盤價；其他市場需手動填入台幣估值。</p>
        <label>類型<select name="kind"><option value="stock">個股 / 其他</option><option value="etf">ETF</option></select></label>
        <label>配置角色<select name="role"><option>核心</option><option>戰術</option><option>避險</option></select></label>
        <label class="wide">投資理由<textarea name="thesis" required maxlength="2000"></textarea></label><button>新增持倉</button>
      </form>
      <div class="strategy-table"><table><thead><tr><th>標的</th><th>角色</th><th>單位</th><th>成本 TWD</th><th>市值 TWD</th><th>日期</th><th>投資理由</th><th></th></tr></thead><tbody>${data.positions.map((p) => `<tr><td>${escape(p.symbol)}</td><td>${escape(p.role)}</td><td>${escape(p.quantity)}</td><td>${money(p.costTwd)}</td><td>${money(p.marketValueTwd)}</td><td>${escape(p.asOf)}</td><td>${escape(p.thesis)}</td><td><button type="button" data-remove-position="${escape(p.id)}" title="刪除此持倉" aria-label="刪除 ${escape(p.symbol)}">×</button></td></tr>`).join("") || '<tr><td colspan="8">尚無實際持倉資料</td></tr>'}</tbody></table></div>
      <h3>ETF 穿透曝險</h3>
      <form id="constituentForm" class="strategy-form">${fields([["etf", "ETF 代號"], ["company", "成分公司代號"], ["weight", "成分權重 %", "number"], ["asOf", "資料日期", "date", today()], ["source", "資料來源"]])}<button>新增成分</button><p class="wide" id="constituentStatus" role="status">成分權重與來源以公告或手動輸入為準。</p></form>
      <ul>${data.constituents.map((h, index) => `<li>${escape(h.etf)} → ${escape(h.company)}：${h.weight}% · ${escape(h.asOf)} · ${escape(h.source)} <button type="button" data-remove-constituent="${index}" aria-label="刪除成分">×</button></li>`).join("")}</ul>
      <p>已輸入資產 TWD ${money(result.total)} · ETF 未解析部分 TWD ${money(result.unknown)}${result.missing ? ` · ${result.missing} 筆缺少估值` : ""}</p>
      <p>${data.cashFloor !== "" && result.total && Number(data.cashTwd) / result.total * 100 < Number(data.cashFloor) ? "現金比例低於你設定的門檻。" : ""}${data.concentrationLimit === "" ? "尚未設定集中度門檻。" : ""}</p>
      <div class="strategy-table"><table><thead><tr><th>公司</th><th>直接＋ETF 曝險 TWD</th><th>佔組合</th><th>門檻狀態</th></tr></thead><tbody>${result.companies.map((c) => `<tr><td>${escape(c.symbol)}</td><td>${money(c.value)}</td><td>${c.percent.toFixed(2)}%</td><td>${data.concentrationLimit === "" ? "未設定" : c.percent > Number(data.concentrationLimit) ? "超過自訂門檻" : "門檻內"}</td></tr>`).join("")}</tbody></table></div>
      <p>曝險依已輸入資料計算；未解析 ETF 部分不能視為分散風險。不同日期的估值及成分權重可能影響比較。</p>
      <h3>決策與檢討紀錄</h3>
      <form id="decisionForm" class="strategy-form">${fields([["symbol", "標的"], ["action", "決策 / 檢討事項"], ["reviewDate", "檢討日期", "date"]])}<label class="wide">理由、風險及事後檢討<textarea name="note" maxlength="4000" required></textarea></label><button>記錄決策</button></form>
      <ul>${data.decisions.map((d) => `<li><strong>${escape(d.symbol)} · ${escape(d.action)}</strong> · 檢討 ${escape(d.reviewDate)}<p>${escape(d.note)}</p></li>`).join("") || "<li>尚無決策紀錄</li>"}</ul>
      <p id="strategyMessage" role="status"></p>`;
    const position = panel.querySelector("#positionForm");
    position.elements.symbol.addEventListener("input", () => {
      for (const key of ["name", "unitPriceTwd", "marketValueTwd", "quoteDate", "valuationSource"]) position.elements[key].value = "";
      panel.querySelector("#valuationStatus").textContent = "標的已變更，請重新搜尋選取或手動估值。";
    });
    position.elements.marketValueTwd.addEventListener("input", () => {
      position.elements.unitPriceTwd.value = "";
      position.elements.quoteDate.value = "";
      position.elements.valuationSource.value = "手動市值";
      panel.querySelector("#valuationStatus").textContent = "市值已手動調整，不再由股數自動計算。";
    });
    const recalculate = () => {
      const value = PortfolioMath.valuation(position.elements.quantity.value, position.elements.unitPriceTwd.value);
      if (value === "" && position.elements.unitPriceTwd.value !== "") position.elements.marketValueTwd.value = "";
      if (value !== "") { position.elements.marketValueTwd.value = value; panel.querySelector("#valuationStatus").textContent = `股數 × 台幣單位估值。${position.elements.quoteDate.value ? `TWSE 收盤資料日期 ${position.elements.quoteDate.value}` : "手動估值"}，非盤中即時報價。`; }
    };
    position.elements.quantity.addEventListener("input", recalculate);
    position.elements.unitPriceTwd.addEventListener("input", () => { position.elements.quoteDate.value = ""; position.elements.valuationSource.value = "手動估值"; recalculate(); });
    bindInstrumentSearch(position, "symbol", false, (item) => {
      position.elements.kind.value = item.kind;
      position.elements.asOf.value = today();
      position.elements.name.value = item.name;
      position.elements.unitPriceTwd.value = item.unitPriceTwd ?? "";
      position.elements.quoteDate.value = item.quoteDate || "";
      position.elements.marketValueTwd.value = "";
      position.elements.valuationSource.value = item.unitPriceTwd ? item.quoteSource : "";
      panel.querySelector("#valuationStatus").textContent = item.unitPriceTwd ? `${item.name} · TWSE ${item.quoteDate} 收盤價 ${item.unitPriceTwd} TWD；填入股數後計算市值。` : `${item.name} · ${item.currency || "幣別待確認"}；無可用報價，請填台幣單位估值或市值。`;
      recalculate();
    });
    const constituent = panel.querySelector("#constituentForm");
    const selectConstituent = () => {
      const existing = data.constituents.find((c) => c.etf === constituent.elements.etf.value && c.company === constituent.elements.company.value);
      constituent.elements.weight.value = existing?.weight ?? "";
      constituent.elements.source.value = existing?.source ?? "";
      constituent.elements.asOf.value = existing?.asOf || today();
      panel.querySelector("#constituentStatus").textContent = existing ? "已帶入既有成分紀錄；更新前請先移除舊紀錄。" : "尚無該成分紀錄，請填權重與資料來源。";
    };
    bindInstrumentSearch(constituent, "etf", true, selectConstituent);
    bindInstrumentSearch(constituent, "company", false, selectConstituent);
    panel.querySelector("#strategyRules").onsubmit = (e) => perform(e, async (form) => { Object.assign(data, Object.fromEntries(new FormData(form))); });
    panel.querySelector("#positionForm").onsubmit = (e) => perform(e, async (form) => {
      const p = Object.fromEntries(new FormData(form)); p.symbol = p.symbol.trim().toUpperCase();
      data.positions.push({ ...p, id: crypto.randomUUID() });
    });
    panel.querySelector("#constituentForm").onsubmit = (e) => perform(e, async (form) => {
      const h = Object.fromEntries(new FormData(form)); h.etf = h.etf.trim().toUpperCase(); h.company = h.company.trim().toUpperCase();
      if (data.constituents.some((c) => c.etf === h.etf && c.company === h.company)) throw new Error("此 ETF 已有該成分，請先移除舊資料。");
      const total = data.constituents.filter((c) => c.etf === h.etf).reduce((sum, c) => sum + Number(c.weight), Number(h.weight));
      if (total > 100) throw new Error("同一 ETF 成分權重總計不能超過 100%。");
      data.constituents.push(h);
    });
    panel.querySelector("#decisionForm").onsubmit = (e) => perform(e, async (form) => data.decisions.unshift({ ...Object.fromEntries(new FormData(form)), id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    panel.querySelectorAll("[data-remove-position]").forEach((button) => button.onclick = (e) => perform(e, async () => { if (!confirm("刪除此持倉？")) return; data.positions = data.positions.filter((p) => p.id !== button.dataset.removePosition); }));
    panel.querySelectorAll("[data-remove-constituent]").forEach((button) => button.onclick = (e) => perform(e, async () => data.constituents.splice(Number(button.dataset.removeConstituent), 1)));
    panel.querySelector("#exportStrategy").onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "investment-portfolio.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
  async function perform(event, action) {
    event.preventDefault();
    const trigger = event.submitter || event.currentTarget;
    const previous = structuredClone(data);
    trigger.disabled = true;
    try { await action(event.currentTarget); await save(); render(); }
    catch (error) { data = previous; panel.querySelector("#strategyMessage").textContent = error.message; }
    finally { trigger.disabled = false; }
  }
  window.initializeStrategy = (stored) => {
    data = { ...defaults(), ...(stored || {}) };
    panel = document.querySelector("#strategy");
    render();
  };
})();
