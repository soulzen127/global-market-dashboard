const categories = {
  tw: "台股",
  us: "美股",
  bond: "債券",
  commodity: "大宗物資",
  metal: "貴金屬",
};

const STORAGE_KEYS = {
  alerts: "global-market-radar-alerts-v1",
  audit: "global-market-radar-audit-v1",
  auditInitialized: "global-market-radar-audit-initialized-v1",
  groups: "global-market-radar-groups-v1",
  groupsInitialized: "global-market-radar-groups-initialized-v1",
  annotations: "global-market-radar-annotations-v1",
  layout: "global-market-radar-layout-v1",
};
let ALERT_STORAGE_KEY = STORAGE_KEYS.alerts;
let AUDIT_STORAGE_KEY = STORAGE_KEYS.audit;
let AUDIT_INITIALIZED_KEY = STORAGE_KEYS.auditInitialized;
let GROUP_STORAGE_KEY = STORAGE_KEYS.groups;
let GROUP_INITIALIZED_KEY = STORAGE_KEYS.groupsInitialized;
let ANNOTATION_STORAGE_KEY = STORAGE_KEYS.annotations;
let CURRENT_USER = "unknown";
let AUTH_USER = null;
let workspaceReady = false;
let workspaceVersions = {};
let workspaceSaveQueue = Promise.resolve();
let workspaceSaveFailed = false;
let featurePermissions = {};
const CHART_COLORS = ["#5cc8ff", "#27c083", "#f4b740", "#ff5f6d", "#a78bfa", "#fb923c", "#2dd4bf", "#f472b6"];

const assets = [
  { symbol: "2330.TW", name: "台積電", market: "TWSE", category: "tw", price: 925, currency: "TWD", volatility: 2.8 },
  { symbol: "2317.TW", name: "鴻海", market: "TWSE", category: "tw", price: 182.5, currency: "TWD", volatility: 3.4 },
  { symbol: "2454.TW", name: "聯發科", market: "TWSE", category: "tw", price: 1285, currency: "TWD", volatility: 3.8 },
  { symbol: "AAPL", name: "Apple", market: "NASDAQ", category: "us", price: 203.45, currency: "USD", volatility: 2.1 },
  { symbol: "NVDA", name: "NVIDIA", market: "NASDAQ", category: "us", price: 116.82, currency: "USD", volatility: 4.9 },
  { symbol: "SPY", name: "S&P 500 ETF", market: "NYSE Arca", category: "us", price: 590.18, currency: "USD", volatility: 1.5 },
  { symbol: "US10Y", name: "美國 10 年債殖利率", market: "Treasury", category: "bond", price: 4.42, currency: "%", volatility: 1.8 },
  { symbol: "TLT", name: "20+ 年美債 ETF", market: "NASDAQ", category: "bond", price: 91.6, currency: "USD", volatility: 2.6 },
  { symbol: "WTI", name: "西德州原油", market: "NYMEX", category: "commodity", price: 77.24, currency: "USD", volatility: 4.1 },
  { symbol: "BRENT", name: "布蘭特原油", market: "ICE", category: "commodity", price: 81.12, currency: "USD", volatility: 3.7 },
  { symbol: "CORN", name: "玉米期貨", market: "CBOT", category: "commodity", price: 462.75, currency: "USD", volatility: 3.2 },
  { symbol: "XAU", name: "黃金現貨", market: "LBMA", category: "metal", price: 2348.5, currency: "USD", volatility: 2.4 },
  { symbol: "XAG", name: "白銀現貨", market: "LBMA", category: "metal", price: 30.18, currency: "USD", volatility: 5.2 },
  { symbol: "PLAT", name: "鉑金現貨", market: "NYMEX", category: "metal", price: 1032.1, currency: "USD", volatility: 4.4 },
].map((asset, index) => ({
  ...asset,
  id: index + 1,
  basePrice: asset.price / (1 + seededChange(index) / 100),
  change: seededChange(index),
  history: createHistory(asset.price, asset.volatility, index),
}));

let selectedAsset = assets[0];
window.getInstrumentCatalog = () => [
  ...assets.map(({ symbol, name, market, category, currency }) => ({ symbol, name, market, currency, categoryLabel: categories[category], kind: ["SPY", "TLT"].includes(symbol) ? "etf" : "stock" })),
  { symbol: "2308.TW", name: "台達電", market: "TWSE", categoryLabel: "台股", currency: "TWD", kind: "stock" },
  { symbol: "00850.TW", name: "元大臺灣ESG永續", market: "TWSE", categoryLabel: "台股", currency: "TWD", kind: "etf" }
];
let activeCategory = "all";
let alerts = loadStoredJson(ALERT_STORAGE_KEY, [
  { name: "NVDA 波動監測", symbol: "NVDA", rule: "change", levels: [{ name: "Level-01", value: 3.5, severity: "watch" }] },
  { name: "黃金突破監測", symbol: "XAU", rule: "above", levels: [{ name: "Level-01", value: 2400, severity: "warning" }] },
]);
let auditLogs = loadStoredJson(AUDIT_STORAGE_KEY, []);
let investmentGroups = loadStoredJson(GROUP_STORAGE_KEY, []);
let annotations = loadStoredJson(ANNOTATION_STORAGE_KEY, []);
if (!Array.isArray(alerts)) alerts = [];
if (!Array.isArray(auditLogs)) auditLogs = [];
if (!Array.isArray(investmentGroups)) investmentGroups = [];
if (!Array.isArray(annotations)) annotations = [];
let auditVisibleLimit = 100;
let activeGroupId = investmentGroups[0]?.id || null;
let researchAsset = assets[0];
let researchRange = 180;
let researchZoom = 1;
let selectedResearchIndex = null;
let researchChartPoints = [];

const els = {
  rows: document.querySelector("#assetRows"),
  search: document.querySelector("#searchInput"),
  lastUpdate: document.querySelector("#lastUpdate"),
  assetCount: document.querySelector("#assetCount"),
  gainRatio: document.querySelector("#gainRatio"),
  riskCount: document.querySelector("#riskCount"),
  bullishCount: document.querySelector("#bullishCount"),
  selectedCategory: document.querySelector("#selectedCategory"),
  selectedName: document.querySelector("#selectedName"),
  selectedSymbol: document.querySelector("#selectedSymbol"),
  selectedPrice: document.querySelector("#selectedPrice"),
  selectedChange: document.querySelector("#selectedChange"),
  selectedForecast: document.querySelector("#selectedForecast"),
  canvas: document.querySelector("#trendCanvas"),
  reportList: document.querySelector("#reportList"),
  horizonInput: document.querySelector("#horizonInput"),
  horizonValue: document.querySelector("#horizonValue"),
  riskInput: document.querySelector("#riskInput"),
  riskValue: document.querySelector("#riskValue"),
  modelOutput: document.querySelector("#modelOutput"),
  alertAsset: document.querySelector("#alertAsset"),
  alertName: document.querySelector("#alertName"),
  alertRule: document.querySelector("#alertRule"),
  alertLevelName: document.querySelector("#alertLevelName"),
  alertValue: document.querySelector("#alertValue"),
  alertSeverity: document.querySelector("#alertSeverity"),
  alertList: document.querySelector("#alertList"),
  auditFilterForm: document.querySelector("#auditFilterForm"),
  auditKeyword: document.querySelector("#auditKeyword"),
  auditType: document.querySelector("#auditType"),
  auditStartDate: document.querySelector("#auditStartDate"),
  auditEndDate: document.querySelector("#auditEndDate"),
  auditRows: document.querySelector("#auditRows"),
  auditEmptyState: document.querySelector("#auditEmptyState"),
  auditResultCount: document.querySelector("#auditResultCount"),
  auditChangeCount: document.querySelector("#auditChangeCount"),
  auditAlertCount: document.querySelector("#auditAlertCount"),
  auditExportCount: document.querySelector("#auditExportCount"),
  auditRangeText: document.querySelector("#auditRangeText"),
  loadMoreAudit: document.querySelector("#loadMoreAudit"),
  groupCreateForm: document.querySelector("#groupCreateForm"),
  groupNameInput: document.querySelector("#groupNameInput"),
  groupList: document.querySelector("#groupList"),
  groupEmptyState: document.querySelector("#groupEmptyState"),
  groupContent: document.querySelector("#groupContent"),
  activeGroupName: document.querySelector("#activeGroupName"),
  groupAssetCount: document.querySelector("#groupAssetCount"),
  groupAverageChange: document.querySelector("#groupAverageChange"),
  groupAverageVolatility: document.querySelector("#groupAverageVolatility"),
  groupBullishCount: document.querySelector("#groupBullishCount"),
  groupAssetSearch: document.querySelector("#groupAssetSearch"),
  groupAssetPicker: document.querySelector("#groupAssetPicker"),
  groupAssetRows: document.querySelector("#groupAssetRows"),
  comparisonCanvas: document.querySelector("#comparisonCanvas"),
  comparisonLegend: document.querySelector("#comparisonLegend"),
  correlationMatrix: document.querySelector("#correlationMatrix"),
  researchAsset: document.querySelector("#researchAsset"),
  researchCanvas: document.querySelector("#researchCanvas"),
  chartTooltip: document.querySelector("#chartTooltip"),
  researchWindowLabel: document.querySelector("#researchWindowLabel"),
  pointDetail: document.querySelector("#pointDetail"),
  relatedNews: document.querySelector("#relatedNews"),
  annotationForm: document.querySelector("#annotationForm"),
  annotationTitle: document.querySelector("#annotationTitle"),
  annotationType: document.querySelector("#annotationType"),
  annotationNote: document.querySelector("#annotationNote"),
  annotationUrl: document.querySelector("#annotationUrl"),
  annotationSearch: document.querySelector("#annotationSearch"),
  annotationList: document.querySelector("#annotationList"),
  annotationCount: document.querySelector("#annotationCount"),
  currentUserInitial: document.querySelector("#currentUserInitial"),
  currentUserName: document.querySelector("#currentUserName"),
  currentRoleBadge: document.querySelector("#currentRoleBadge"),
  passwordWarning: document.querySelector("#passwordWarning"),
  changePasswordForm: document.querySelector("#changePasswordForm"),
  currentPassword: document.querySelector("#currentPassword"),
  newPassword: document.querySelector("#newPassword"),
  confirmPassword: document.querySelector("#confirmPassword"),
  passwordMessage: document.querySelector("#passwordMessage"),
  adminUserPanel: document.querySelector("#adminUserPanel"),
  createUserForm: document.querySelector("#createUserForm"),
  newUsername: document.querySelector("#newUsername"),
  newDisplayName: document.querySelector("#newDisplayName"),
  newUserRole: document.querySelector("#newUserRole"),
  newUserPassword: document.querySelector("#newUserPassword"),
  createUserMessage: document.querySelector("#createUserMessage"),
  systemUserList: document.querySelector("#systemUserList"),
  userCount: document.querySelector("#userCount"),
  applicationCount: document.querySelector("#applicationCount"),
  accountApplicationList: document.querySelector("#accountApplicationList"),
  refreshApplicationsButton: document.querySelector("#refreshApplicationsButton"),
  permissionForm: document.querySelector("#permissionForm"),
  permissionList: document.querySelector("#permissionList"),
  permissionMessage: document.querySelector("#permissionMessage"),
  appShell: document.querySelector(".app-shell"),
  hideLeftSidebar: document.querySelector("#hideLeftSidebar"),
  showLeftSidebar: document.querySelector("#showLeftSidebar"),
  hideRightSidebar: document.querySelector("#hideRightSidebar"),
  showRightSidebar: document.querySelector("#showRightSidebar"),
  newsRailCategory: document.querySelector("#newsRailCategory"),
  newsRailName: document.querySelector("#newsRailName"),
  newsRailSymbol: document.querySelector("#newsRailSymbol"),
  newsWeekChange: document.querySelector("#newsWeekChange"),
  newsWeekHigh: document.querySelector("#newsWeekHigh"),
  newsWeekLow: document.querySelector("#newsWeekLow"),
  newsMarketSignal: document.querySelector("#newsMarketSignal"),
  weeklyMarketTimeline: document.querySelector("#weeklyMarketTimeline"),
  weeklyNewsList: document.querySelector("#weeklyNewsList"),
  liveNewsSearch: document.querySelector("#liveNewsSearch"),
};
let lastHorizon = Number(els.horizonInput.value);
let lastRiskLimit = Number(els.riskInput.value);

function loadStoredJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.warn(`無法讀取 ${key}`, error);
    return fallback;
  }
}

function saveStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`無法儲存 ${key}`, error);
  }
  const section = Object.entries({ groups: GROUP_STORAGE_KEY, alerts: ALERT_STORAGE_KEY, annotations: ANNOTATION_STORAGE_KEY }).find(([, storageKey]) => storageKey === key)?.[0];
  if (workspaceReady && section) queueWorkspaceSave(section, value);
}

function queueWorkspaceSave(key, value) {
  if (AUTH_USER?.tenantRole === "viewer") return Promise.resolve();
  const snapshot = JSON.parse(JSON.stringify(value));
  workspaceSaveQueue = workspaceSaveQueue.then(async () => {
    if (workspaceSaveFailed) throw new Error("保存已暫停，請先備份本機資料後重新載入。");
    const saved = await apiRequest("/api/workspace", { method: "PUT", body: JSON.stringify({ key, value: snapshot, version: workspaceVersions[key] || 0 }) });
    workspaceVersions[key] = saved.version;
    document.querySelector("#syncStatus").textContent = "資料已保存";
  }).catch((error) => {
    workspaceSaveFailed = true;
    document.querySelector("#syncStatus").textContent = `尚未保存：${error.message}`;
  });
  document.querySelector("#syncStatus").textContent = "保存中...";
  return workspaceSaveQueue;
}

async function loadWorkspace() {
  const result = await apiRequest("/api/workspace");
  workspaceVersions = Object.fromEntries(Object.entries(result.data).map(([key, entry]) => [key, entry.version]));
  investmentGroups = result.data.groups?.value || [];
  alerts = result.data.alerts?.value || [];
  annotations = result.data.annotations?.value || [];
  activeGroupId = investmentGroups[0]?.id || null;
  saveStoredJson(GROUP_STORAGE_KEY, investmentGroups);
  saveStoredJson(ALERT_STORAGE_KEY, alerts);
  saveStoredJson(ANNOTATION_STORAGE_KEY, annotations);
  workspaceReady = true;
  document.querySelector("#syncStatus").textContent = "資料已載入";
  return result.data;
}

function loadLayoutState() {
  const state = loadStoredJson(STORAGE_KEYS.layout, { leftCollapsed: false, rightCollapsed: false });
  applyLayoutState(state);
}

function applyLayoutState(state) {
  els.appShell.classList.toggle("left-collapsed", Boolean(state.leftCollapsed));
  els.appShell.classList.toggle("right-collapsed", Boolean(state.rightCollapsed));
  els.showLeftSidebar.hidden = !state.leftCollapsed;
  els.showRightSidebar.hidden = !state.rightCollapsed;
}

function updateLayoutState(side, collapsed) {
  const state = loadStoredJson(STORAGE_KEYS.layout, { leftCollapsed: false, rightCollapsed: false });
  state[side === "left" ? "leftCollapsed" : "rightCollapsed"] = collapsed;
  saveStoredJson(STORAGE_KEYS.layout, state);
  applyLayoutState(state);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (response.status === 401) {
    window.location.replace("/login.html");
    throw new Error("登入狀態已失效。");
  }
  if (!response.ok) throw new Error(translateApiError(result.error) || "操作失敗。");
  return result;
}

function translateApiError(message) {
  return {
    "Read-only account.": "A3 為唯讀角色，無法修改帳戶內容。",
    "Invalid tenant role.": "請選擇 A1、A2 或 A3 權限。",
    "Cannot change this owner role.": "不可修改目前登入者或受保護管理者的權限。",
    "Cannot remove the last owner.": "帳戶必須保留至少一位啟用中的 A1 管理者。",
    "Authentication required.": "請先登入系統。",
    "Session expired.": "登入狀態已失效。",
    "Password policy not satisfied.": "密碼至少 10 碼，且需包含大小寫英文、數字及特殊符號。",
    "Current password is incorrect.": "目前密碼不正確。",
    "Administrator access required.": "需要管理員權限。",
    "Supervisor access required.": "需要 L1 Supervisor 最高權限。",
    "Invalid username format.": "帳號需為有效 Email，或 3-32 碼英數字、句點、底線或連字號。",
    "Username already exists.": "帳號已存在。",
    "Cannot disable the current account.": "不可停用目前登入的帳號。",
    "Cannot delete the current account.": "不可刪除目前登入的帳號。",
    "User not found.": "找不到帳號。",
    "Too many login attempts. Try again later.": "登入失敗次數過多，請稍後再試。",
    "Application not found.": "找不到待審申請。",
    "Application already pending.": "此帳號已有待審申請。",
    "Password change required.": "請先在帳號管理變更初始密碼。",
    "Workspace changed on another device. Reload before saving.": "其他裝置已修改資料，請先匯出備份，再重新整理。",
  }[message] || message;
}

function showFormMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.hidden = false;
}

function applyAuthenticatedUser(user) {
  AUTH_USER = user;
  CURRENT_USER = user.username;
  scopeStorageForUser(`${user.tenantId}:${user.username}`);
  els.currentUserName.textContent = user.displayName || user.username;
  els.currentUserInitial.textContent = (user.displayName || user.username).slice(0, 1).toUpperCase();
  els.currentRoleBadge.textContent = `${user.tenantName} · ${user.roleLabel}${user.platformAdmin ? " · 系統審核管理員" : ""}`;
  els.currentRoleBadge.className = `badge ${isSupervisor(user) ? "bullish" : ""}`;
  els.passwordWarning.hidden = !user.forcePasswordChange;
  els.adminUserPanel.hidden = !isSupervisor(user);
  document.querySelector('#tenantNameInput').value = user.tenantName || "";
  els.accountApplicationList.closest(".user-list-panel").hidden = !user.platformAdmin;
}

function isSupervisor(user = AUTH_USER) {
  return user?.role === "supervisor" || user?.role === "admin";
}

function applyReadOnlyControls() {
  if (AUTH_USER?.tenantRole !== "viewer") return;
  document.querySelectorAll('#strategy form, #groupCreateForm, #alertForm, #annotationForm').forEach((form) => {
    form.querySelectorAll('input, textarea, select, button').forEach((control) => { control.disabled = true; });
  });
  document.querySelectorAll('#renameGroupBtn, #deleteGroupBtn, .asset-picker input, .asset-picker button, [data-remove-alert], [data-remove-alert-level], [data-delete-annotation], [data-remove-position], [data-remove-constituent]').forEach((control) => { control.disabled = true; });
}
new MutationObserver(applyReadOnlyControls).observe(document.querySelector('main'), { childList: true, subtree: true });
els.systemUserList.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-member-role]");
  if (!select) return;
  select.disabled = true;
  try {
    await apiRequest("/api/users/role", { method: "POST", body: JSON.stringify({ username: select.dataset.memberRole, tenantRole: select.value }) });
    await loadSystemUsers();
  } catch (error) { window.alert(error.message); await loadSystemUsers(); }
});
document.querySelector('#tenantNameForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await apiRequest('/api/tenant', { method: 'PUT', body: JSON.stringify({ name: document.querySelector('#tenantNameInput').value }) });
    AUTH_USER.tenantName = result.tenant.name;
    els.currentRoleBadge.textContent = `${AUTH_USER.tenantName} · ${AUTH_USER.roleLabel}${AUTH_USER.platformAdmin ? " · 系統審核管理員" : ""}`;
    document.querySelector('#tenantNameMessage').textContent = '帳戶名稱已更新';
  } catch (error) { document.querySelector('#tenantNameMessage').textContent = error.message; }
  finally { button.disabled = false; }
});

function getRoleLabel(role) {
  return role === "supervisor" || role === "admin" ? "A1 帳戶管理者" : "帳戶成員";
}

function scopeStorageForUser(username) {
  const scopedKey = (key) => `${key}:${username}`;
  ALERT_STORAGE_KEY = scopedKey(STORAGE_KEYS.alerts);
  AUDIT_STORAGE_KEY = scopedKey(STORAGE_KEYS.audit);
  AUDIT_INITIALIZED_KEY = scopedKey(STORAGE_KEYS.auditInitialized);
  GROUP_STORAGE_KEY = scopedKey(STORAGE_KEYS.groups);
  GROUP_INITIALIZED_KEY = scopedKey(STORAGE_KEYS.groupsInitialized);
  ANNOTATION_STORAGE_KEY = scopedKey(STORAGE_KEYS.annotations);

  const legacyFallback = username === "admin";
  alerts = loadStoredJson(ALERT_STORAGE_KEY, legacyFallback ? loadStoredJson(STORAGE_KEYS.alerts, []) : []);
  auditLogs = loadStoredJson(AUDIT_STORAGE_KEY, legacyFallback ? loadStoredJson(STORAGE_KEYS.audit, []) : []);
  investmentGroups = loadStoredJson(GROUP_STORAGE_KEY, legacyFallback ? loadStoredJson(STORAGE_KEYS.groups, []) : []);
  annotations = loadStoredJson(ANNOTATION_STORAGE_KEY, legacyFallback ? loadStoredJson(STORAGE_KEYS.annotations, []) : []);
  if (!Array.isArray(alerts)) alerts = [];
  if (!Array.isArray(auditLogs)) auditLogs = [];
  if (!Array.isArray(investmentGroups)) investmentGroups = [];
  if (!Array.isArray(annotations)) annotations = [];
  activeGroupId = investmentGroups[0]?.id || null;
  saveStoredJson(ALERT_STORAGE_KEY, alerts);
  saveStoredJson(AUDIT_STORAGE_KEY, auditLogs);
  saveStoredJson(GROUP_STORAGE_KEY, investmentGroups);
  saveStoredJson(ANNOTATION_STORAGE_KEY, annotations);
}

async function initializeAuthentication() {
  const result = await apiRequest("/api/session");
  featurePermissions = result.permissions || {};
  applyAuthenticatedUser(result.user);
  for (const [feature, role] of Object.entries(featurePermissions)) {
    if (role === "supervisor" && !isSupervisor()) {
      document.getElementById(feature)?.setAttribute("hidden", "");
      document.querySelector(`a[href="#${feature}"]`)?.setAttribute("hidden", "");
    }
  }
  if (isSupervisor(result.user)) {
    const results = await Promise.allSettled([loadSystemUsers(), ...(result.user.platformAdmin ? [loadAccountApplications()] : []), loadPermissions()]);
    if (results.some((entry) => entry.status === "rejected")) {
      showFormMessage(els.createUserMessage, "部分管理資料暫時無法載入，請重新整理。", true);
    }
  }
}

async function loadSystemUsers() {
  if (!isSupervisor()) return;
  const result = await apiRequest("/api/users");
  els.userCount.textContent = `${result.users.length} 個帳號`;
  els.systemUserList.innerHTML = result.users
    .map(
      (user) => `
        <div class="system-user-item">
          <div>
            <strong>${escapeHtml(user.displayName)} · ${escapeHtml(user.username)}</strong>
            <span>${escapeHtml(user.roleLabel)} · ${user.enabled ? "啟用中" : "已停用"}${user.forcePasswordChange ? " · 待修改密碼" : ""}</span>
          </div>
          <div class="user-item-actions">
            <select aria-label="${escapeHtml(user.username)} 的權限" data-member-role="${escapeHtml(user.username)}" ${user.username === CURRENT_USER || user.platformAdmin ? "disabled" : ""}>${[["owner", "A1 帳戶管理者"], ["editor", "A2 查看與操作"], ["viewer", "A3 僅可瀏覽"]].map(([value, label]) => `<option value="${value}" ${value === user.tenantRole ? "selected" : ""}>${label}</option>`).join("")}</select>
            <button class="text-button secondary-button" type="button" data-reset-user="${escapeHtml(user.username)}">重設密碼</button>
            <button class="text-button ${user.enabled ? "danger-button" : ""}" type="button" data-toggle-user="${escapeHtml(user.username)}" data-enabled="${user.enabled}">${user.enabled ? "停用" : "啟用"}</button>
            <button class="icon-button" type="button" data-delete-user="${escapeHtml(user.username)}" title="刪除帳號">×</button>
          </div>
        </div>
      `,
    )
    .join("");

  document.querySelectorAll("[data-toggle-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = button.dataset.toggleUser;
      const nextEnabled = button.dataset.enabled !== "true";
      if (!window.confirm(`確定要${nextEnabled ? "啟用" : "停用"}帳號 ${username} 嗎？`)) return;
      try {
        await apiRequest("/api/users/status", {
          method: "POST",
          body: JSON.stringify({ username, enabled: nextEnabled }),
        });
        recordAudit("change", nextEnabled ? "啟用使用者" : "停用使用者", username, `管理員${nextEnabled ? "啟用" : "停用"}系統帳號。`);
        await loadSystemUsers();
      } catch (error) {
        window.alert(error.message);
      }
    });
  });

  document.querySelectorAll("[data-reset-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = button.dataset.resetUser;
      const password = window.prompt(`輸入 ${username} 的新密碼：\n至少 10 碼，包含大小寫英文、數字及特殊符號。`);
      if (!password) return;
      try {
        await apiRequest("/api/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        recordAudit("change", "重設使用者密碼", username, "管理員重設帳號密碼並要求下次登入修改。");
        await loadSystemUsers();
      } catch (error) {
        window.alert(error.message);
      }
    });
  });

  document.querySelectorAll("[data-delete-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const username = button.dataset.deleteUser;
      if (!window.confirm(`確定永久刪除帳號 ${username} 嗎？`)) return;
      try {
        await apiRequest("/api/users/delete", {
          method: "POST",
          body: JSON.stringify({ username }),
        });
        recordAudit("change", "刪除系統使用者", username, "管理員永久刪除系統帳號。");
        await loadSystemUsers();
      } catch (error) {
        window.alert(error.message);
      }
    });
  });
}

const permissionLabels = {
  dashboard: "總覽",
  assets: "資產監控",
  watchlists: "自選群組",
  research: "標的研究",
  trend: "趨勢報表",
  alerts: "警示中心",
  audit: "系統報表",
  sources: "資料源",
  strategy: "投資策略與組合",
  account: "帳號設定",
  accountManagement: "帳戶權限管理",
  permissionSettings: "操作功能權限設定",
  accountApplications: "帳號申請審核",
};

async function loadPermissions() {
  if (!isSupervisor()) return;
  const result = await apiRequest("/api/permissions");
  els.permissionList.innerHTML = Object.entries(permissionLabels).filter(([key]) => !["accountManagement", "permissionSettings", "accountApplications"].includes(key))
    .map(
      ([feature, label]) => `
        <label class="permission-row">
          <span>${escapeHtml(label)}</span>
          <select data-permission-feature="${escapeHtml(feature)}">
            <option value="user" ${result.permissions[feature] === "user" ? "selected" : ""}>A1 / A2 / A3（依角色）</option>
            <option value="supervisor" ${result.permissions[feature] === "supervisor" ? "selected" : ""}>僅 A1</option>
          </select>
        </label>
      `,
    )
    .join("");
}

async function loadAccountApplications() {
  if (!AUTH_USER?.platformAdmin) return;
  const result = await apiRequest("/api/account-applications");
  const pending = result.applications.filter((item) => item.status === "pending");
  els.applicationCount.textContent = `${pending.length} 筆待審 · ${result.mailConfigured ? "寄信服務已設定" : "寄信服務未設定"}`;
  els.accountApplicationList.innerHTML = result.applications.length
    ? result.applications
        .map(
          (application) => `
            <div class="system-user-item">
              <div>
                <strong>${escapeHtml(application.displayName)} · ${escapeHtml(application.username)}</strong>
                <small>獨立帳戶：${escapeHtml(application.accountName)}</small>
                <span>${application.status === "pending" ? "待審核" : application.status === "approved" ? "已同意" : "已拒絕"} · ${escapeHtml(formatDate(new Date(application.requestedAt)))}</span>
                ${application.note ? `<small>${escapeHtml(application.note)}</small>` : ""}
                <small>申請編號 ${escapeHtml(application.id)}</small>
                ${application.decidedAt ? `<small>審核：${escapeHtml(application.decidedBy)} · ${escapeHtml(formatDate(new Date(application.decidedAt)))} · ${escapeHtml(application.decisionReason || "未填理由")}</small>` : ""}
              </div>
              ${
                application.status === "pending"
                  ? `<div class="user-item-actions">
                      <button class="text-button" type="button" data-application-decision="approve" data-application-id="${escapeHtml(application.id)}">同意</button>
                      <button class="text-button danger-button" type="button" data-application-decision="reject" data-application-id="${escapeHtml(application.id)}">拒絕</button>
                    </div>`
                  : ""
              }
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">目前沒有帳號申請。</div>`;

  const mailLabels = { queued: "待寄", sending: "寄送中", accepted: "寄信服務已受理（不等於已送達）", failed: "寄送失敗" };
  els.accountApplicationList.insertAdjacentHTML("beforeend", `<h3>通知紀錄</h3>${(result.notifications || []).slice().reverse().map((m) => `<div class="system-user-item"><div><strong>${escapeHtml(m.to)}</strong><small>${escapeHtml(m.applicationId || "舊通知")} · ${escapeHtml(mailLabels[m.status] || m.status)} · 嘗試 ${Number(m.attempts || 0)} 次</small><small>${escapeHtml(m.createdAt)} ${escapeHtml(m.error || "")}</small></div>${m.status !== "accepted" ? `<button type="button" class="text-button" data-retry-mail="${escapeHtml(m.id)}" ${result.mailConfigured ? "" : "disabled"}>重試寄送</button>` : ""}</div>`).join("") || "<p>尚無通知</p>"}`);
  els.accountApplicationList.querySelectorAll("[data-retry-mail]").forEach((button) => button.onclick = async () => {
    button.disabled = true;
    try { await apiRequest("/api/notifications/retry", { method: "POST", body: JSON.stringify({ id: button.dataset.retryMail }) }); await loadAccountApplications(); }
    catch (error) { window.alert(error.message); button.disabled = false; }
  });
  document.querySelectorAll("[data-application-decision]").forEach((button) => {
    button.addEventListener("click", async () => {
      const decision = button.dataset.applicationDecision;
      const id = button.dataset.applicationId;
      const reason = window.prompt(decision === "reject" ? "請填寫拒絕理由（必填）" : "審核備註（可留空）");
      if (reason === null || (decision === "reject" && !reason.trim())) return;
      button.disabled = true;
      try {
        const result = await apiRequest("/api/account-applications/decision", {
          method: "POST",
          body: JSON.stringify({ id, decision, reason }),
        });
        recordAudit("change", decision === "approve" ? "同意帳號申請" : "拒絕帳號申請", result.application.username, `Supervisor ${decision === "approve" ? "同意" : "拒絕"}帳號申請。`);
        await loadAccountApplications();
        await loadSystemUsers();
      } catch (error) {
        window.alert(error.message);
      }
    });
  });
}

function createAuditId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function recordAudit(type, action, target, detail, options = {}) {
  auditLogs.unshift({
    id: createAuditId(),
    timestamp: new Date().toISOString(),
    user: CURRENT_USER,
    type,
    action,
    target,
    detail,
    before: options.before ?? null,
    after: options.after ?? null,
  });
  auditLogs = auditLogs.slice(0, 2000);
  saveStoredJson(AUDIT_STORAGE_KEY, auditLogs);
  renderAuditReport();
}

function seedAuditLogs() {
  try {
    if (localStorage.getItem(AUDIT_INITIALIZED_KEY)) return;
  } catch (error) {
    console.warn("無法存取操作記錄初始化狀態", error);
    return;
  }
  const now = Date.now();
  auditLogs = [
    {
      id: createAuditId(),
      timestamp: new Date(now - 1000 * 60 * 42).toISOString(),
      user: CURRENT_USER,
      type: "system",
      action: "系統啟動",
      target: "Global Market Radar",
      detail: "初始化市場監控儀表板與模擬行情服務。",
      before: null,
      after: "running",
    },
    {
      id: createAuditId(),
      timestamp: new Date(now - 1000 * 60 * 26).toISOString(),
      user: CURRENT_USER,
      type: "change",
      action: "修改風險門檻",
      target: "趨勢模型",
      detail: "風險門檻由 3% 調整為 4%。",
      before: "3%",
      after: "4%",
    },
    {
      id: createAuditId(),
      timestamp: new Date(now - 1000 * 60 * 8).toISOString(),
      user: CURRENT_USER,
      type: "alert",
      action: "建立警示",
      target: "NVDA",
      detail: "新增漲跌幅超過 3.5% 的監控條件。",
      before: null,
      after: "change > 3.5%",
    },
  ];
  saveStoredJson(AUDIT_STORAGE_KEY, auditLogs);
  try {
    localStorage.setItem(AUDIT_INITIALIZED_KEY, "true");
  } catch (error) {
    console.warn("無法儲存操作記錄初始化狀態", error);
  }
}

function seededChange(seed) {
  return Number((Math.sin(seed * 2.17) * 2.8 + Math.cos(seed * 0.71)).toFixed(2));
}

function createHistory(price, volatility, seed) {
  const points = [];
  let current = price * (1 - seededChange(seed) / 100);
  for (let i = 0; i < 364; i += 1) {
    const wave = Math.sin((i + seed) / 5) * volatility * 0.002;
    const drift = Math.cos((i + seed) / 13) * 0.001;
    current *= 1 + wave + drift;
    points.push(Number(current.toFixed(4)));
  }
  points.push(price);
  return points;
}

function formatPrice(asset) {
  if (asset.currency === "%") return `${asset.price.toFixed(2)}%`;
  return `${asset.currency} ${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function getForecast(asset) {
  const recent = asset.history.slice(-12);
  const shortAvg = average(recent.slice(-5));
  const longAvg = average(recent);
  const momentum = ((asset.price - recent[0]) / recent[0]) * 100;
  const score = momentum * 0.52 + ((shortAvg - longAvg) / longAvg) * 100 * 0.48;
  const direction = score > 0.35 ? "偏多" : score < -0.35 ? "偏空" : "震盪";
  const forecast = asset.price * (1 + score / 100);
  return { score, direction, forecast };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeExternalUrl(value) {
  const url = value.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function getFilteredAssets() {
  const matches = els.search.value.trim() ? new Set(PortfolioMath.search(assets.map((a) => ({ ...a, categoryLabel: categories[a.category] })), els.search.value).map((a) => a.symbol)) : null;
  return assets.filter((asset) => {
    const categoryMatch = activeCategory === "all" || asset.category === activeCategory;
    const termMatch = !matches || matches.has(asset.symbol);
    return categoryMatch && termMatch;
  });
}

function renderRows() {
  els.rows.innerHTML = "";
  document.querySelector("#searchResultStatus").textContent = `${getFilteredAssets().length} 筆監控標的${els.search.value.trim() ? ` · ${els.search.value.trim()}` : ""}`;
  if (!getFilteredAssets().length) els.rows.innerHTML = '<tr><td colspan="6">沒有符合的監控標的</td></tr>';
  getFilteredAssets().forEach((asset) => {
    const forecast = getForecast(asset);
    const row = document.createElement("tr");
    row.className = selectedAsset.symbol === asset.symbol ? "selected" : "";
    row.innerHTML = `
      <td><div class="asset-name"><strong>${asset.symbol}</strong><span>${asset.name}</span></div></td>
      <td>${categories[asset.category]} · ${asset.market}</td>
      <td>${formatPrice(asset)}</td>
      <td class="${asset.change >= 0 ? "up" : "down"}">${asset.change >= 0 ? "+" : ""}${asset.change.toFixed(2)}%</td>
      <td>${asset.volatility.toFixed(1)}%</td>
      <td><span class="badge ${forecast.direction === "偏多" ? "bullish" : forecast.direction === "偏空" ? "bearish" : "watch"}">${forecast.direction}</span></td>
    `;
    row.addEventListener("click", () => {
      selectedAsset = asset;
      recordAudit("view", "檢視標的", asset.symbol, `開啟 ${asset.name} 的即時價格與趨勢圖。`);
      renderRows();
      renderDetail();
    });
    els.rows.appendChild(row);
  });
}

function renderSummary() {
  const rising = assets.filter((asset) => asset.change > 0).length;
  const riskLimit = Number(els.riskInput.value);
  els.assetCount.textContent = assets.length;
  els.gainRatio.textContent = `${Math.round((rising / assets.length) * 100)}%`;
  els.riskCount.textContent = assets.filter((asset) => asset.volatility >= riskLimit).length;
  els.bullishCount.textContent = assets.filter((asset) => getForecast(asset).direction === "偏多").length;
}

function renderDetail() {
  const forecast = getForecast(selectedAsset);
  els.selectedCategory.textContent = categories[selectedAsset.category];
  els.selectedName.textContent = selectedAsset.name;
  els.selectedSymbol.textContent = selectedAsset.symbol;
  els.selectedPrice.textContent = formatPrice(selectedAsset);
  els.selectedChange.textContent = `${selectedAsset.change >= 0 ? "+" : ""}${selectedAsset.change.toFixed(2)}%`;
  els.selectedChange.className = selectedAsset.change >= 0 ? "up" : "down";
  els.selectedForecast.textContent = `${forecast.direction} · ${forecast.forecast.toFixed(2)}`;
  drawTrend(selectedAsset);
  renderWeeklyMarketContext(selectedAsset);
}

function getPastDate(daysAgo) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", weekday: "short" }).format(date);
}

function getDailyContext(asset, dayIndex, value, previousValue) {
  const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0;
  const categoryContexts = {
    tw: ["外資籌碼與台幣走勢影響大型權值股。", "電子成交比重與大盤風險偏好同步變化。", "供應鏈展望與法說預期成為市場焦點。"],
    us: ["美債殖利率與科技股評價牽動盤勢。", "企業財測與資金輪動影響大型成長股。", "美元與風險偏好帶動盤中波動。"],
    bond: ["通膨預期與政策利率路徑牽動殖利率。", "期限溢酬與避險需求影響債券價格。", "市場重新評估降息時點與幅度。"],
    commodity: ["供需、庫存與地緣風險影響商品報價。", "美元走勢與全球景氣預期帶動價格。", "期貨部位與現貨需求形成短期波動。"],
    metal: ["實質利率與美元走勢牽動貴金屬。", "避險需求與央行買盤影響市場情緒。", "資金流向與工業需求形成價格變化。"],
  };
  return {
    change,
    text: categoryContexts[asset.category][(asset.id + dayIndex) % 3],
  };
}

function getWeeklyNews(asset) {
  const templates = {
    tw: [
      ["法人關注供應鏈展望與外資持股變化", "籌碼動向"],
      ["台股權值族群隨匯率及科技需求波動", "市場焦點"],
      ["產業景氣與企業營收預期受到關注", "企業動態"],
    ],
    us: [
      ["美股評價受利率預期與企業財測影響", "華爾街焦點"],
      ["大型科技股資金輪動與市場風險偏好", "資金動向"],
      ["總體數據牽動美元及成長股表現", "總體市場"],
    ],
    bond: [
      ["債券市場重新評估政策利率路徑", "利率市場"],
      ["殖利率曲線反映通膨與景氣預期", "固定收益"],
      ["避險需求帶動長天期債券波動", "市場焦點"],
    ],
    commodity: [
      ["商品市場關注庫存與全球供需變化", "供需動態"],
      ["地緣風險與美元牽動原物料價格", "國際市場"],
      ["景氣預期影響能源與農產品需求", "商品市場"],
    ],
    metal: [
      ["貴金屬受實質利率與避險需求影響", "金屬市場"],
      ["美元走勢與央行需求成為價格焦點", "國際市場"],
      ["資金流向牽動黃金與白銀相對表現", "資金動向"],
    ],
  };
  return templates[asset.category].map(([title, source], index) => ({
    title: `${asset.symbol}：${title}`,
    source,
    date: getPastDate(index * 2),
  }));
}

function renderWeeklyMarketContext(asset) {
  const values = asset.history.slice(-8);
  const start = values[0];
  const end = values[values.length - 1];
  const weekChange = ((end - start) / start) * 100;
  const forecast = getForecast(asset);
  els.newsRailCategory.textContent = `${categories[asset.category]} · ${asset.market}`;
  els.newsRailName.textContent = asset.name;
  els.newsRailSymbol.textContent = asset.symbol;
  els.newsWeekChange.textContent = `${weekChange >= 0 ? "+" : ""}${weekChange.toFixed(2)}%`;
  els.newsWeekChange.className = weekChange >= 0 ? "up" : "down";
  els.newsWeekHigh.textContent = Math.max(...values).toFixed(2);
  els.newsWeekLow.textContent = Math.min(...values).toFixed(2);
  els.newsMarketSignal.textContent = forecast.direction;
  els.newsMarketSignal.className = forecast.direction === "偏多" ? "up" : forecast.direction === "偏空" ? "down" : "";

  els.weeklyMarketTimeline.innerHTML = values
    .slice(1)
    .map((value, index) => {
      const previous = values[index];
      const context = getDailyContext(asset, index, value, previous);
      const date = getPastDate(6 - index);
      return `
        <article class="market-event ${context.change >= 0 ? "up-event" : "down-event"}">
          <span class="market-event-meta">${escapeHtml(formatShortDate(date))} · ${value.toFixed(2)}</span>
          <strong class="${context.change >= 0 ? "up" : "down"}">${context.change >= 0 ? "+" : ""}${context.change.toFixed(2)}%</strong>
          <p>${escapeHtml(context.text)}</p>
        </article>
      `;
    })
    .reverse()
    .join("");

  els.weeklyNewsList.innerHTML = getWeeklyNews(asset)
    .map(
      (news) => `
        <article class="rail-news-item">
          <span>${escapeHtml(formatShortDate(news.date))} · ${escapeHtml(news.source)}</span>
          <strong>${escapeHtml(news.title)}</strong>
        </article>
      `,
    )
    .join("");
  els.liveNewsSearch.href = `https://www.google.com/search?q=${encodeURIComponent(`${asset.symbol} ${asset.name} 最新新聞`)}&tbm=nws`;
}

function drawTrend(asset) {
  const ctx = els.canvas.getContext("2d");
  const width = els.canvas.width;
  const height = els.canvas.height;
  const pad = 30;
  const points = asset.history;
  const min = Math.min(...points);
  const max = Math.max(...points);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#1f2b3a";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = pad + ((height - pad * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, "rgba(92, 200, 255, 0.35)");
  gradient.addColorStop(1, "rgba(92, 200, 255, 0)");

  const coords = points.map((point, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point - min) / (max - min || 1)) * (height - pad * 2);
    return { x, y };
  });

  ctx.beginPath();
  coords.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.lineTo(width - pad, height - pad);
  ctx.lineTo(pad, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  coords.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.strokeStyle = asset.change >= 0 ? "#27c083" : "#ff5f6d";
  ctx.lineWidth = 3;
  ctx.stroke();

  const last = coords[coords.length - 1];
  ctx.fillStyle = "#ecf2f8";
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function renderReports() {
  const riskLimit = Number(els.riskInput.value);
  const horizon = Number(els.horizonInput.value);
  const leaders = [...assets].sort((a, b) => getForecast(b).score - getForecast(a).score).slice(0, 3);
  const laggards = [...assets].sort((a, b) => getForecast(a).score - getForecast(b).score).slice(0, 3);
  const highRisk = assets.filter((asset) => asset.volatility >= riskLimit);
  const metalMomentum = average(assets.filter((asset) => asset.category === "metal").map((asset) => asset.change));

  const reports = [
    {
      title: `${horizon} 日動能領先標的`,
      body: leaders.map((asset) => `${asset.symbol} ${getForecast(asset).direction}`).join("、"),
      tone: "bullish",
    },
    {
      title: "短期壓力標的",
      body: laggards.map((asset) => `${asset.symbol} ${asset.change.toFixed(2)}%`).join("、"),
      tone: "bearish",
    },
    {
      title: "風險監控",
      body: highRisk.length ? `${highRisk.length} 檔高於 ${riskLimit}% 門檻，建議加強停損與部位限制。` : "目前波動未超過設定門檻。",
      tone: highRisk.length ? "watch" : "bullish",
    },
    {
      title: "商品與金屬輪動",
      body: metalMomentum > 0 ? "貴金屬平均動能偏強，可觀察避險需求與美元走勢。" : "貴金屬動能降溫，可對照實質利率與美元指數。",
      tone: metalMomentum > 0 ? "bullish" : "watch",
    },
  ];

  els.reportList.innerHTML = reports
    .map((report) => `<div class="report-item"><span class="badge ${report.tone}">${report.tone === "bullish" ? "機會" : report.tone === "bearish" ? "壓力" : "觀察"}</span><strong>${report.title}</strong><p>${report.body}</p></div>`)
    .join("");

  els.modelOutput.innerHTML = leaders
    .map((asset) => {
      const forecast = getForecast(asset);
      return `<div><strong>${asset.symbol} · ${asset.name}</strong><span>${horizon} 日模型預估 ${forecast.forecast.toFixed(2)}，訊號 ${forecast.direction}，分數 ${forecast.score.toFixed(2)}</span></div>`;
    })
    .join("");
}

function renderAlerts() {
  if (!els.alertAsset.options.length) {
    els.alertAsset.innerHTML = assets.map((asset) => `<option value="${asset.symbol}">${asset.symbol} ${asset.name}</option>`).join("");
  }
  els.alertList.innerHTML = alerts
    .map((alert, index) => {
      const asset = assets.find((item) => item.symbol === alert.symbol);
      const label = alert.rule === "above" ? "價格高於" : alert.rule === "below" ? "價格低於" : "漲跌幅超過";
      const levels = normalizeAlertLevels(alert);
      const levelRows = levels
        .map((level, levelIndex) => {
          const triggered = isAlertLevelTriggered(alert, level, asset);
          const severityClass = triggered ? (level.severity === "critical" ? "bearish" : "watch") : "";
          return `<div class="alert-level-row">
            <span>${escapeHtml(level.name)} · ${label} ${Number(level.value).toLocaleString()}</span>
            <span class="badge ${severityClass}">${triggered ? getSeverityLabel(level.severity) : "監控中"}</span>
            <button class="icon-button" data-remove-alert-level="${index}:${levelIndex}" title="刪除此階層">×</button>
          </div>`;
        })
        .join("");
      const triggeredCount = levels.filter((level) => isAlertLevelTriggered(alert, level, asset)).length;
      return `<div class="alert-item alert-stack">
        <div class="alert-summary">
          <span><strong>${escapeHtml(alert.name || alert.symbol)}</strong><br><small>${escapeHtml(alert.symbol)} · ${label} · ${levels.length} 個階層</small></span>
          <span class="badge ${triggeredCount ? "watch" : ""}">${triggeredCount ? `${triggeredCount} 層觸發` : "監控中"}</span>
          <button class="icon-button" data-remove-alert="${index}" title="刪除整組警示">×</button>
        </div>
        <div class="alert-levels">${levelRows}</div>
      </div>`;
    })
    .join("");

  document.querySelectorAll("[data-remove-alert]").forEach((button) => {
    button.addEventListener("click", () => {
      const removed = alerts.splice(Number(button.dataset.removeAlert), 1)[0];
      saveStoredJson(ALERT_STORAGE_KEY, alerts);
      recordAudit("alert", "刪除警示", removed.symbol, `刪除 ${getAlertDescription(removed)}。`, {
        before: removed,
        after: null,
      });
      renderAlerts();
    });
  });

  document.querySelectorAll("[data-remove-alert-level]").forEach((button) => {
    button.addEventListener("click", () => {
      const [alertIndex, levelIndex] = button.dataset.removeAlertLevel.split(":").map(Number);
      const alert = alerts[alertIndex];
      const levels = normalizeAlertLevels(alert);
      const removed = levels.splice(levelIndex, 1)[0];
      if (!levels.length) {
        alerts.splice(alertIndex, 1);
      } else {
        alert.levels = levels;
      }
      saveStoredJson(ALERT_STORAGE_KEY, alerts);
      recordAudit("alert", "刪除告警階層", alert?.symbol || "警示", `刪除 ${removed?.name || "Level"} 階層。`, { before: removed, after: alert || null });
      renderAlerts();
    });
  });
}

function getAlertDescription(alert) {
  const label = alert.rule === "above" ? "價格高於" : alert.rule === "below" ? "價格低於" : "漲跌幅超過";
  return normalizeAlertLevels(alert).map((level) => `${level.name} ${label} ${level.value}`).join("、");
}

function normalizeAlertLevels(alert) {
  if (Array.isArray(alert.levels) && alert.levels.length) return alert.levels;
  return [{ name: alert.levelName || "Level-01", value: Number(alert.value), severity: alert.severity || "watch" }];
}

function isAlertLevelTriggered(alert, level, asset) {
  if (!asset) return false;
  return (
    (alert.rule === "above" && asset.price > level.value) ||
    (alert.rule === "below" && asset.price < level.value) ||
    (alert.rule === "change" && Math.abs(asset.change) > level.value)
  );
}

function getSeverityLabel(severity) {
  return { watch: "觀察觸發", warning: "警戒觸發", critical: "重大觸發" }[severity] || "已觸發";
}

function createGroupId() {
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getActiveGroup() {
  return investmentGroups.find((group) => group.id === activeGroupId) || null;
}

function getGroupAssets(group = getActiveGroup()) {
  if (!group) return [];
  return group.symbols.map((symbol) => assets.find((asset) => asset.symbol === symbol)).filter(Boolean);
}

function saveGroups() {
  saveStoredJson(GROUP_STORAGE_KEY, investmentGroups);
}

function seedInvestmentGroups() {
  try {
    if (localStorage.getItem(GROUP_INITIALIZED_KEY)) return;
    const initialGroup = {
      id: createGroupId(),
      name: "跨市場觀察",
      symbols: ["2330.TW", "AAPL", "US10Y", "WTI", "XAU"],
      createdAt: new Date().toISOString(),
    };
    investmentGroups = [initialGroup];
    activeGroupId = initialGroup.id;
    saveGroups();
    localStorage.setItem(GROUP_INITIALIZED_KEY, "true");
  } catch (error) {
    console.warn("無法初始化投資群組", error);
  }
}

function renderGroups() {
  const activeGroup = getActiveGroup();
  els.groupList.innerHTML = investmentGroups.length
    ? investmentGroups
        .map(
          (group) =>
            `<button type="button" class="${group.id === activeGroupId ? "active" : ""}" data-group-id="${escapeHtml(group.id)}"><strong>${escapeHtml(group.name)}</strong><br><small>${group.symbols.length} 個標的</small></button>`,
        )
        .join("")
    : '<div class="empty-state">尚未建立群組</div>';

  document.querySelectorAll("[data-group-id]").forEach((button) => {
    button.addEventListener("click", () => {
      activeGroupId = button.dataset.groupId;
      renderGroups();
      recordAudit("view", "檢視投資群組", getActiveGroup()?.name || "", "開啟群組監控全覽與相關性分析。");
    });
  });

  els.groupEmptyState.hidden = Boolean(activeGroup);
  els.groupContent.hidden = !activeGroup;
  if (!activeGroup) return;

  renderGroupAssetPicker();
  renderActiveGroupAnalysis();
}

function renderActiveGroupAnalysis() {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;
  const groupAssets = getGroupAssets(activeGroup);
  els.activeGroupName.textContent = activeGroup.name;
  els.groupAssetCount.textContent = groupAssets.length;
  els.groupAverageChange.textContent = groupAssets.length ? `${average(groupAssets.map((asset) => asset.change)).toFixed(2)}%` : "0%";
  els.groupAverageVolatility.textContent = groupAssets.length ? `${average(groupAssets.map((asset) => asset.volatility)).toFixed(2)}%` : "0%";
  els.groupBullishCount.textContent = groupAssets.filter((asset) => getForecast(asset).direction === "偏多").length;
  renderGroupOverview(groupAssets);
  drawComparisonChart(groupAssets);
  renderCorrelationMatrix(groupAssets);
}

function renderGroupAssetPicker() {
  const group = getActiveGroup();
  if (!group) return;
  const term = els.groupAssetSearch.value.trim().toLowerCase();
  const filtered = assets.filter((asset) =>
    [asset.symbol, asset.name, asset.market, categories[asset.category]].join(" ").toLowerCase().includes(term),
  );
  els.groupAssetPicker.innerHTML = filtered
    .map(
      (asset) => `
        <label class="asset-choice">
          <input type="checkbox" data-group-symbol="${escapeHtml(asset.symbol)}" ${group.symbols.includes(asset.symbol) ? "checked" : ""} />
          <span><strong>${escapeHtml(asset.symbol)} · ${escapeHtml(asset.name)}</strong><small>${escapeHtml(categories[asset.category])} / ${escapeHtml(asset.market)}</small></span>
        </label>
      `,
    )
    .join("");

  document.querySelectorAll("[data-group-symbol]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const symbol = checkbox.dataset.groupSymbol;
      const before = [...group.symbols];
      if (checkbox.checked && !group.symbols.includes(symbol)) group.symbols.push(symbol);
      if (!checkbox.checked) group.symbols = group.symbols.filter((item) => item !== symbol);
      saveGroups();
      recordAudit("change", checkbox.checked ? "加入群組標的" : "移除群組標的", group.name, `${symbol} ${checkbox.checked ? "加入" : "移出"}群組。`, {
        before,
        after: group.symbols,
      });
      renderGroups();
    });
  });
}

function renderGroupOverview(groupAssets) {
  els.groupAssetRows.innerHTML = groupAssets.length
    ? groupAssets
        .map((asset) => {
          const forecast = getForecast(asset);
          return `
            <tr>
              <td><div class="asset-name"><strong>${escapeHtml(asset.symbol)}</strong><span>${escapeHtml(asset.name)}</span></div></td>
              <td>${escapeHtml(categories[asset.category])}</td>
              <td>${escapeHtml(formatPrice(asset))}</td>
              <td class="${asset.change >= 0 ? "up" : "down"}">${asset.change >= 0 ? "+" : ""}${asset.change.toFixed(2)}%</td>
              <td>${asset.volatility.toFixed(1)}%</td>
              <td><span class="badge ${forecast.direction === "偏多" ? "bullish" : forecast.direction === "偏空" ? "bearish" : "watch"}">${forecast.direction}</span></td>
              <td><button class="text-button secondary-button" type="button" data-research-symbol="${escapeHtml(asset.symbol)}">研究</button></td>
            </tr>
          `;
        })
        .join("")
    : '<tr><td colspan="7">請從上方「新增或移除投資標的」加入標的。</td></tr>';

  document.querySelectorAll("[data-research-symbol]").forEach((button) => {
    button.addEventListener("click", () => openResearchAsset(button.dataset.researchSymbol));
  });
}

function drawComparisonChart(groupAssets) {
  const canvas = els.comparisonCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = 38;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, width, height);
  if (!groupAssets.length) {
    ctx.fillStyle = "#91a0b5";
    ctx.font = "16px Segoe UI";
    ctx.fillText("加入標的後顯示標準化績效比較", 30, height / 2);
    els.comparisonLegend.innerHTML = "";
    return;
  }

  const series = groupAssets.slice(0, 8).map((asset) => {
    const values = asset.history.slice(-90);
    const base = values[0] || 1;
    return { asset, values: values.map((value) => (value / base) * 100) };
  });
  const allValues = series.flatMap((item) => item.values);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  ctx.strokeStyle = "#1f2b3a";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = pad + ((height - pad * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  series.forEach((item, seriesIndex) => {
    ctx.beginPath();
    item.values.forEach((value, index) => {
      const x = pad + (index / Math.max(item.values.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2);
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = CHART_COLORS[seriesIndex % CHART_COLORS.length];
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  els.comparisonLegend.innerHTML = series
    .map(
      (item, index) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></span>${escapeHtml(item.asset.symbol)}</span>`,
    )
    .join("");
}

function getReturns(asset, count = 60) {
  const values = asset.history.slice(-(count + 1));
  return values.slice(1).map((value, index) => (value - values[index]) / values[index]);
}

function pearsonCorrelation(left, right) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  const a = left.slice(-length);
  const b = right.slice(-length);
  const meanA = average(a);
  const meanB = average(b);
  let numerator = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < length; i += 1) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    numerator += diffA * diffB;
    sumA += diffA ** 2;
    sumB += diffB ** 2;
  }
  return numerator / Math.sqrt(sumA * sumB || 1);
}

function correlationColor(value) {
  const strength = Math.min(Math.abs(value), 1);
  return value >= 0 ? `rgba(39, 192, 131, ${0.12 + strength * 0.5})` : `rgba(255, 95, 109, ${0.12 + strength * 0.5})`;
}

function renderCorrelationMatrix(groupAssets) {
  if (groupAssets.length < 2) {
    els.correlationMatrix.innerHTML = '<div class="empty-state">至少加入兩個標的才能計算關聯性。</div>';
    return;
  }
  const limited = groupAssets.slice(0, 12);
  els.correlationMatrix.innerHTML = `
    <table class="correlation-table">
      <thead><tr><th>標的</th>${limited.map((asset) => `<th>${escapeHtml(asset.symbol)}</th>`).join("")}</tr></thead>
      <tbody>
        ${limited
          .map(
            (rowAsset) => `
              <tr>
                <th>${escapeHtml(rowAsset.symbol)}</th>
                ${limited
                  .map((columnAsset) => {
                    const value = rowAsset.symbol === columnAsset.symbol ? 1 : pearsonCorrelation(getReturns(rowAsset), getReturns(columnAsset));
                    return `<td class="correlation-cell" style="background:${correlationColor(value)}" title="${escapeHtml(rowAsset.symbol)} 與 ${escapeHtml(columnAsset.symbol)}">${value.toFixed(2)}</td>`;
                  })
                  .join("")}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function historyDate(asset, absoluteIndex) {
  const date = new Date();
  date.setDate(date.getDate() - (asset.history.length - 1 - absoluteIndex));
  return date;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function getResearchWindow() {
  const requested = Math.max(12, Math.round(researchRange / researchZoom));
  const count = Math.min(requested, researchAsset.history.length);
  const startIndex = researchAsset.history.length - count;
  return {
    values: researchAsset.history.slice(startIndex),
    startIndex,
    count,
  };
}

function openResearchAsset(symbol) {
  const asset = assets.find((item) => item.symbol === symbol);
  if (!asset) return;
  selectedAsset = asset;
  researchAsset = asset;
  els.researchAsset.value = symbol;
  selectedResearchIndex = null;
  researchZoom = 1;
  renderResearch();
  renderRows();
  renderDetail();
  document.querySelector("#research").scrollIntoView({ behavior: "smooth", block: "start" });
  recordAudit("view", "研究投資標的", symbol, `開啟 ${asset.name} 的歷史趨勢、新聞與標註。`);
}

function renderResearch() {
  drawResearchChart();
  renderPointDetail();
  renderRelatedNews();
  renderAnnotations();
}

function drawResearchChart() {
  const canvas = els.researchCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 62, right: 24, top: 28, bottom: 42 };
  const windowData = getResearchWindow();
  const values = windowData.values;
  const min = Math.min(...values);
  const max = Math.max(...values);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, width, height);

  ctx.font = "13px Segoe UI";
  for (let i = 0; i < 5; i += 1) {
    const ratio = i / 4;
    const y = pad.top + ratio * (height - pad.top - pad.bottom);
    const label = max - ratio * (max - min);
    ctx.strokeStyle = "#1f2b3a";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = "#91a0b5";
    ctx.fillText(label.toFixed(2), 8, y + 4);
  }

  researchChartPoints = values.map((value, index) => ({
    x: pad.left + (index / Math.max(values.length - 1, 1)) * (width - pad.left - pad.right),
    y: height - pad.bottom - ((value - min) / (max - min || 1)) * (height - pad.top - pad.bottom),
    value,
    absoluteIndex: windowData.startIndex + index,
  }));

  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, "rgba(92, 200, 255, 0.3)");
  gradient.addColorStop(1, "rgba(92, 200, 255, 0)");
  ctx.beginPath();
  researchChartPoints.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.lineTo(width - pad.right, height - pad.bottom);
  ctx.lineTo(pad.left, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  researchChartPoints.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  ctx.strokeStyle = "#5cc8ff";
  ctx.lineWidth = 3;
  ctx.stroke();

  const assetAnnotations = annotations.filter((item) => item.symbol === researchAsset.symbol);
  assetAnnotations.forEach((annotation) => {
    const point = researchChartPoints.find((item) => item.absoluteIndex === annotation.historyIndex);
    if (!point) return;
    ctx.fillStyle = annotation.type === "risk" || annotation.type === "sell" ? "#ff5f6d" : annotation.type === "buy" ? "#27c083" : "#f4b740";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ecf2f8";
    ctx.stroke();
  });

  if (selectedResearchIndex !== null) {
    const selectedPoint = researchChartPoints.find((point) => point.absoluteIndex === selectedResearchIndex);
    if (selectedPoint) {
      ctx.strokeStyle = "#f4b740";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(selectedPoint.x, pad.top);
      ctx.lineTo(selectedPoint.x, height - pad.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f4b740";
      ctx.beginPath();
      ctx.arc(selectedPoint.x, selectedPoint.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const firstDate = historyDate(researchAsset, windowData.startIndex);
  const lastDate = historyDate(researchAsset, researchAsset.history.length - 1);
  ctx.fillStyle = "#91a0b5";
  ctx.fillText(formatDate(firstDate), pad.left, height - 12);
  ctx.textAlign = "right";
  ctx.fillText(formatDate(lastDate), width - pad.right, height - 12);
  ctx.textAlign = "left";
  els.researchWindowLabel.textContent = `${formatDate(firstDate)} 至 ${formatDate(lastDate)}，共 ${windowData.count} 個資料點`;
}

function getSelectedResearchPoint() {
  if (selectedResearchIndex === null) return null;
  const value = researchAsset.history[selectedResearchIndex];
  const previous = researchAsset.history[Math.max(0, selectedResearchIndex - 1)];
  return {
    historyIndex: selectedResearchIndex,
    value,
    date: historyDate(researchAsset, selectedResearchIndex),
    change: previous ? ((value - previous) / previous) * 100 : 0,
  };
}

function renderPointDetail() {
  const point = getSelectedResearchPoint();
  if (!point) {
    els.pointDetail.className = "point-detail empty-state";
    els.pointDetail.textContent = "尚未選擇資料點。";
    return;
  }
  const windowAround = researchAsset.history.slice(Math.max(0, point.historyIndex - 10), point.historyIndex + 1);
  const high = Math.max(...windowAround);
  const low = Math.min(...windowAround);
  els.pointDetail.className = "point-detail";
  els.pointDetail.innerHTML = `
    <div class="point-values">
      <div><span>日期</span><strong>${escapeHtml(formatDate(point.date))}</strong></div>
      <div><span>收盤/價格</span><strong>${escapeHtml(point.value.toFixed(2))}</strong></div>
      <div><span>單日變動</span><strong class="${point.change >= 0 ? "up" : "down"}">${point.change >= 0 ? "+" : ""}${point.change.toFixed(2)}%</strong></div>
      <div><span>近 10 點區間</span><strong>${low.toFixed(2)} - ${high.toFixed(2)}</strong></div>
    </div>
  `;
}

function getRelatedNews(asset, point) {
  if (!point) return [];
  const day = point.date.getDate();
  const templates = {
    tw: [
      ["產業供應鏈與法說預期受到市場關注", "市場事件"],
      ["外資籌碼與匯率變化影響大型權值股", "資金動向"],
    ],
    us: [
      ["美國科技股評價與企業財測成為焦點", "企業動態"],
      ["利率預期與風險偏好帶動盤勢變化", "總體市場"],
    ],
    bond: [
      ["公債殖利率隨通膨與政策預期波動", "利率市場"],
      ["市場重新評估降息路徑與期限溢酬", "央行政策"],
    ],
    commodity: [
      ["供需、庫存與地緣風險牽動商品價格", "供需事件"],
      ["美元與全球景氣預期影響商品走勢", "總體市場"],
    ],
    metal: [
      ["避險需求與實質利率影響貴金屬價格", "避險資產"],
      ["央行需求與美元走勢成為金屬市場焦點", "市場事件"],
    ],
  };
  if (day % 4 === 0) return [];
  return templates[asset.category].slice(0, day % 2 === 0 ? 2 : 1).map(([title, source], index) => ({
    id: `${asset.symbol}-${point.historyIndex}-${index}`,
    title: `${asset.symbol}：${title}`,
    source,
    date: formatDate(point.date),
  }));
}

function renderRelatedNews() {
  const point = getSelectedResearchPoint();
  const news = getRelatedNews(researchAsset, point);
  if (!point) {
    els.relatedNews.innerHTML = '<div class="empty-state">選擇資料點後顯示同日關聯事件。</div>';
    return;
  }
  els.relatedNews.innerHTML = news.length
    ? news.map((item) => `<div class="news-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.date)} · ${escapeHtml(item.source)}</span></div>`).join("")
    : '<div class="empty-state">此資料點沒有自動關聯新聞，可使用右側表單手動建立事件記錄。</div>';
}

function renderAnnotations() {
  const term = els.annotationSearch.value.trim().toLowerCase();
  const filtered = annotations
    .filter((item) => item.symbol === researchAsset.symbol)
    .filter((item) => !term || [item.title, item.note, item.type, item.date].join(" ").toLowerCase().includes(term))
    .sort((a, b) => b.historyIndex - a.historyIndex);
  els.annotationCount.textContent = `${filtered.length} 筆`;
  els.annotationList.innerHTML = filtered.length
    ? filtered
        .map(
          (item) => `
            <div class="annotation-item">
              <div>
                <div class="annotation-meta"><span class="badge ${item.type === "risk" || item.type === "sell" ? "bearish" : item.type === "buy" ? "bullish" : "watch"}">${escapeHtml(getAnnotationTypeLabel(item.type))}</span><span>${escapeHtml(item.date)} · ${escapeHtml(item.symbol)} · ${Number(item.price).toFixed(2)}</span></div>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.note)}</p>
                ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">開啟相關來源</a>` : ""}
              </div>
              <div class="annotation-actions">
                <button class="text-button secondary-button" type="button" data-jump-annotation="${escapeHtml(item.id)}">定位</button>
                <button class="icon-button" type="button" data-delete-annotation="${escapeHtml(item.id)}" title="刪除標註">×</button>
              </div>
            </div>
          `,
        )
        .join("")
    : '<div class="empty-state">目前沒有符合條件的標註。</div>';

  document.querySelectorAll("[data-jump-annotation]").forEach((button) => {
    button.addEventListener("click", () => {
      const annotation = annotations.find((item) => item.id === button.dataset.jumpAnnotation);
      if (!annotation) return;
      selectedResearchIndex = annotation.historyIndex;
      researchRange = Math.max(researchRange, researchAsset.history.length - annotation.historyIndex);
      researchZoom = 1;
      renderResearch();
    });
  });
  document.querySelectorAll("[data-delete-annotation]").forEach((button) => {
    button.addEventListener("click", () => {
      const annotation = annotations.find((item) => item.id === button.dataset.deleteAnnotation);
      annotations = annotations.filter((item) => item.id !== button.dataset.deleteAnnotation);
      saveStoredJson(ANNOTATION_STORAGE_KEY, annotations);
      recordAudit("change", "刪除標註", annotation?.symbol || "", `刪除標註「${annotation?.title || ""}」。`, { before: annotation, after: null });
      renderResearch();
    });
  });
}

function getAnnotationTypeLabel(type) {
  return {
    observation: "觀察",
    buy: "投資/買進",
    sell: "減碼/賣出",
    risk: "風險事件",
    news: "新聞記錄",
  }[type] || type;
}

function updatePrices() {
  assets.forEach((asset) => {
    const noise = (Math.random() - 0.48) * asset.volatility * 0.0019;
    const drift = Math.sin(Date.now() / 8000 + asset.id) * 0.0009;
    const next = asset.price * (1 + noise + drift);
    asset.price = Number(next.toFixed(asset.price > 100 ? 2 : 4));
    asset.history[asset.history.length - 1] = asset.price;
    asset.change = Number((((asset.price - asset.basePrice) / asset.basePrice) * 100).toFixed(2));
  });
  els.lastUpdate.textContent = new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  renderLiveData();
}

function renderLiveData() {
  renderRows();
  renderSummary();
  renderDetail();
  renderAlerts();
  renderActiveGroupAnalysis();
  if (selectedResearchIndex === researchAsset.history.length - 2 || selectedResearchIndex === null) {
    drawResearchChart();
  }
}

function renderAll() {
  renderLiveData();
  renderReports();
  renderAuditReport();
  renderGroups();
  renderResearch();
}

function getFilteredAuditLogs() {
  const keyword = els.auditKeyword.value.trim().toLowerCase();
  const type = els.auditType.value;
  const startTime = els.auditStartDate.value ? new Date(`${els.auditStartDate.value}T00:00:00`).getTime() : null;
  const endTime = els.auditEndDate.value ? new Date(`${els.auditEndDate.value}T23:59:59.999`).getTime() : null;

  return auditLogs.filter((log) => {
    const timestamp = new Date(log.timestamp).getTime();
    const keywordMatch =
      !keyword ||
      [log.user, log.type, log.action, log.target, log.detail, log.before, log.after]
        .map((value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "")))
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    return keywordMatch && (type === "all" || log.type === type) && (!startTime || timestamp >= startTime) && (!endTime || timestamp <= endTime);
  });
}

function getAuditTypeLabel(type) {
  return {
    view: "查詢/檢視",
    change: "設定修改",
    alert: "警示異動",
    export: "報表匯出",
    system: "系統事件",
  }[type] || type;
}

function getAuditBadgeClass(type) {
  if (type === "change" || type === "alert") return "watch";
  if (type === "export") return "bullish";
  return "";
}

function formatAuditTime(timestamp) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function renderAuditReport() {
  const filtered = getFilteredAuditLogs();
  const visible = filtered.slice(0, auditVisibleLimit);
  els.auditRows.innerHTML = visible
    .map(
      (log) => `
        <tr>
          <td>${escapeHtml(formatAuditTime(log.timestamp))}</td>
          <td>${escapeHtml(log.user)}</td>
          <td><span class="badge ${getAuditBadgeClass(log.type)}">${escapeHtml(getAuditTypeLabel(log.type))}</span></td>
          <td>${escapeHtml(log.action)}</td>
          <td>${escapeHtml(log.target)}</td>
          <td class="audit-detail" title="${escapeHtml(log.detail)}">${escapeHtml(log.detail)}</td>
          <td class="audit-detail">${escapeHtml(formatAuditChange(log))}</td>
        </tr>
      `,
    )
    .join("");

  els.auditResultCount.textContent = filtered.length;
  els.auditChangeCount.textContent = filtered.filter((log) => log.type === "change").length;
  els.auditAlertCount.textContent = filtered.filter((log) => log.type === "alert").length;
  els.auditExportCount.textContent = filtered.filter((log) => log.type === "export").length;
  els.auditEmptyState.hidden = filtered.length !== 0;
  els.auditRangeText.textContent = filtered.length
    ? `顯示 ${Math.min(visible.length, filtered.length)} / ${filtered.length} 筆記錄`
    : "沒有符合條件的記錄";
  els.loadMoreAudit.hidden = visible.length >= filtered.length;
}

function formatAuditChange(log) {
  if (log.before === null && log.after === null) return "—";
  const before = typeof log.before === "object" && log.before !== null ? JSON.stringify(log.before) : String(log.before ?? "無");
  const after = typeof log.after === "object" && log.after !== null ? JSON.stringify(log.after) : String(log.after ?? "無");
  return `${before} → ${after}`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  const normalized = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeCategory = button.dataset.category;
    recordAudit("view", "切換資產類別", categories[activeCategory] || "全部", `行情表切換為「${categories[activeCategory] || "全部"}」。`);
    renderRows();
  });
});

els.search.addEventListener("input", renderRows);
function submitMarketSearch() {
  activeCategory = "all";
  document.querySelectorAll(".segment").forEach((button) => button.classList.toggle("active", button.dataset.category === "all"));
  renderRows();
  document.querySelector("#assets").scrollIntoView({ block: "start" });
  recordAudit("view", "搜尋市場標的", "即時行情", `搜尋關鍵字「${els.search.value.trim()}」。`);
}
els.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submitMarketSearch(); }
});
document.querySelector("#searchSubmit").addEventListener("click", submitMarketSearch);
els.search.addEventListener("change", () => {
  if (els.search.value.trim()) {
    recordAudit("view", "搜尋市場標的", "即時行情", `搜尋關鍵字「${els.search.value.trim()}」。`);
  }
});
els.horizonInput.addEventListener("input", () => {
  els.horizonValue.textContent = `${els.horizonInput.value} 天`;
  renderReports();
});
els.horizonInput.addEventListener("change", (event) => {
  const nextHorizon = Number(event.target.value);
  recordAudit("change", "修改預測天期", "趨勢模型", `預測天期調整為 ${event.target.value} 天。`, {
    before: `${lastHorizon} 天`,
    after: `${nextHorizon} 天`,
  });
  lastHorizon = nextHorizon;
});
els.riskInput.addEventListener("input", () => {
  els.riskValue.textContent = `${els.riskInput.value}%`;
  renderSummary();
  renderReports();
});
els.riskInput.addEventListener("change", (event) => {
  const nextRiskLimit = Number(event.target.value);
  recordAudit("change", "修改風險門檻", "趨勢模型", `高波動門檻調整為 ${event.target.value}%。`, {
    before: `${lastRiskLimit}%`,
    after: `${nextRiskLimit}%`,
  });
  lastRiskLimit = nextRiskLimit;
});
document.querySelector("#refreshReport").addEventListener("click", () => {
  renderReports();
  recordAudit("view", "重新分析趨勢", "趨勢報表", `以 ${els.horizonInput.value} 天預測天期與 ${els.riskInput.value}% 風險門檻重新分析。`);
});
document.querySelector("#exportBtn").addEventListener("click", () => {
  const report = {
    exportedAt: new Date().toISOString(),
    selected: selectedAsset.symbol,
    assets: assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      price: asset.price,
      change: asset.change,
      forecast: getForecast(asset),
    })),
  };
  downloadFile("market-trend-report.json", JSON.stringify(report, null, 2), "application/json;charset=utf-8");
  recordAudit("export", "匯出市場報表", "market-trend-report.json", `匯出 ${assets.length} 項資產行情與預測資料。`);
});

document.querySelector("#alertForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const level = {
    name: els.alertLevelName.value.trim() || `Level-${String((alerts.length || 0) + 1).padStart(2, "0")}`,
    value: Number(els.alertValue.value),
    severity: els.alertSeverity.value,
  };
  const existing = alerts.find((alert) => alert.symbol === els.alertAsset.value && alert.rule === els.alertRule.value && (alert.name || "") === els.alertName.value.trim());
  const newAlert = {
    name: els.alertName.value.trim(),
    symbol: els.alertAsset.value,
    rule: els.alertRule.value,
    levels: [level],
    createdAt: new Date().toISOString(),
  };
  if (existing) {
    existing.levels = normalizeAlertLevels(existing);
    existing.levels.push(level);
  } else {
    alerts.push(newAlert);
  }
  saveStoredJson(ALERT_STORAGE_KEY, alerts);
  recordAudit("alert", existing ? "新增告警階層" : "建立多階層告警", newAlert.symbol, `新增 ${level.name}：${getAlertDescription({ ...newAlert, levels: [level] })}。`, {
    before: null,
    after: existing || newAlert,
  });
  els.alertLevelName.value = `Level-${String((existing ? normalizeAlertLevels(existing).length + 1 : 2)).padStart(2, "0")}`;
  els.alertValue.value = "";
  renderAlerts();
});

els.auditFilterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  auditVisibleLimit = 100;
  recordAudit("view", "查詢系統報表", "操作記錄", `套用類型、關鍵字與日期區間條件，共找到 ${getFilteredAuditLogs().length} 筆。`);
});

document.querySelector("#clearAuditFilters").addEventListener("click", () => {
  els.auditFilterForm.reset();
  auditVisibleLimit = 100;
  renderAuditReport();
});

els.loadMoreAudit.addEventListener("click", () => {
  auditVisibleLimit += 100;
  renderAuditReport();
});

document.querySelector("#exportAuditBtn").addEventListener("click", () => {
  const filtered = getFilteredAuditLogs();
  const header = ["時間", "使用者", "類型", "操作", "對象", "內容", "修改前", "修改後"];
  const rows = filtered.map((log) => [
    log.timestamp,
    log.user,
    getAuditTypeLabel(log.type),
    log.action,
    log.target,
    log.detail,
    log.before,
    log.after,
  ]);
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(`system-audit-report-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  recordAudit("export", "匯出系統報表", "操作記錄 CSV", `依目前查詢條件匯出 ${filtered.length} 筆記錄。`);
});

document.querySelector("#resetAuditBtn").addEventListener("click", () => {
  if (!window.confirm("確定要清除目前瀏覽器中的全部操作與修改記錄嗎？")) return;
  auditLogs = [];
  saveStoredJson(AUDIT_STORAGE_KEY, auditLogs);
  recordAudit("system", "清除操作記錄", "系統報表", "使用者清除全部歷史操作與修改記錄。");
});

els.groupCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.groupNameInput.value.trim();
  if (!name) return;
  const group = { id: createGroupId(), name, symbols: [], createdAt: new Date().toISOString() };
  investmentGroups.push(group);
  activeGroupId = group.id;
  saveGroups();
  els.groupNameInput.value = "";
  recordAudit("change", "建立投資群組", name, "建立新的自選投資標的群組。", { before: null, after: group });
  renderGroups();
});

document.querySelector("#renameGroupBtn").addEventListener("click", () => {
  const group = getActiveGroup();
  if (!group) return;
  const nextName = window.prompt("輸入新的群組名稱", group.name)?.trim();
  if (!nextName || nextName === group.name) return;
  const previousName = group.name;
  group.name = nextName;
  saveGroups();
  recordAudit("change", "重新命名投資群組", previousName, `群組名稱修改為「${nextName}」。`, { before: previousName, after: nextName });
  renderGroups();
});

document.querySelector("#deleteGroupBtn").addEventListener("click", () => {
  const group = getActiveGroup();
  if (!group || !window.confirm(`確定刪除群組「${group.name}」嗎？`)) return;
  investmentGroups = investmentGroups.filter((item) => item.id !== group.id);
  activeGroupId = investmentGroups[0]?.id || null;
  saveGroups();
  recordAudit("change", "刪除投資群組", group.name, `刪除包含 ${group.symbols.length} 個標的的群組。`, { before: group, after: null });
  renderGroups();
});

els.groupAssetSearch.addEventListener("input", renderGroupAssetPicker);

document.querySelector("#selectAllAssetsBtn").addEventListener("click", () => {
  const group = getActiveGroup();
  if (!group) return;
  const visibleSymbols = [...document.querySelectorAll("[data-group-symbol]")].map((checkbox) => checkbox.dataset.groupSymbol);
  const before = [...group.symbols];
  group.symbols = [...new Set([...group.symbols, ...visibleSymbols])];
  saveGroups();
  recordAudit("change", "批次加入群組標的", group.name, `將目前搜尋結果的 ${visibleSymbols.length} 個標的加入群組。`, {
    before,
    after: group.symbols,
  });
  renderGroups();
});

document.querySelector("#clearGroupAssetsBtn").addEventListener("click", () => {
  const group = getActiveGroup();
  if (!group || !group.symbols.length || !window.confirm(`確定清空群組「${group.name}」的全部標的嗎？`)) return;
  const before = [...group.symbols];
  group.symbols = [];
  saveGroups();
  recordAudit("change", "清空投資群組", group.name, `移除群組中的 ${before.length} 個標的。`, { before, after: [] });
  renderGroups();
});

els.researchAsset.innerHTML = assets.map((asset) => `<option value="${escapeHtml(asset.symbol)}">${escapeHtml(asset.symbol)} · ${escapeHtml(asset.name)}</option>`).join("");
els.researchAsset.value = researchAsset.symbol;
els.researchAsset.addEventListener("change", () => openResearchAsset(els.researchAsset.value));

document.querySelectorAll(".research-ranges [data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".research-ranges [data-range]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    researchRange = Number(button.dataset.range);
    researchZoom = 1;
    selectedResearchIndex = null;
    renderResearch();
    recordAudit("view", "切換歷史區間", researchAsset.symbol, `歷史研究區間切換為 ${button.textContent.trim()}。`);
  });
});

document.querySelector("#zoomInBtn").addEventListener("click", () => {
  researchZoom = Math.min(researchZoom * 1.5, 12);
  drawResearchChart();
});

document.querySelector("#zoomOutBtn").addEventListener("click", () => {
  researchZoom = Math.max(researchZoom / 1.5, 1);
  drawResearchChart();
});

document.querySelector("#resetZoomBtn").addEventListener("click", () => {
  researchZoom = 1;
  selectedResearchIndex = null;
  renderResearch();
});

function getCanvasPointFromEvent(event) {
  const rect = els.researchCanvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * els.researchCanvas.width;
  return researchChartPoints.reduce((nearest, point) =>
    !nearest || Math.abs(point.x - canvasX) < Math.abs(nearest.x - canvasX) ? point : nearest,
  null);
}

els.researchCanvas.addEventListener("mousemove", (event) => {
  const point = getCanvasPointFromEvent(event);
  if (!point) return;
  const rect = els.researchCanvas.getBoundingClientRect();
  els.chartTooltip.hidden = false;
  els.chartTooltip.style.left = `${Math.min(event.clientX - rect.left + 12, rect.width - 170)}px`;
  els.chartTooltip.style.top = `${Math.max(event.clientY - rect.top - 48, 8)}px`;
  els.chartTooltip.innerHTML = `<strong>${escapeHtml(formatDate(historyDate(researchAsset, point.absoluteIndex)))}</strong><br>${escapeHtml(researchAsset.symbol)} ${point.value.toFixed(2)}`;
});

els.researchCanvas.addEventListener("mouseleave", () => {
  els.chartTooltip.hidden = true;
});

els.researchCanvas.addEventListener("click", (event) => {
  const point = getCanvasPointFromEvent(event);
  if (!point) return;
  selectedResearchIndex = point.absoluteIndex;
  renderResearch();
  recordAudit("view", "查詢歷史資料點", researchAsset.symbol, `查詢 ${formatDate(historyDate(researchAsset, point.absoluteIndex))} 的價格與關聯事件。`);
});

els.annotationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const point = getSelectedResearchPoint();
  if (!point) {
    window.alert("請先在歷史圖表中選擇一個資料點。");
    return;
  }
  const rawUrl = els.annotationUrl.value.trim();
  const safeUrl = normalizeExternalUrl(rawUrl);
  if (rawUrl && !safeUrl) {
    window.alert("相關網址必須使用 http:// 或 https://。");
    return;
  }
  const annotation = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: researchAsset.symbol,
    historyIndex: point.historyIndex,
    date: formatDate(point.date),
    price: point.value,
    type: els.annotationType.value,
    title: els.annotationTitle.value.trim(),
    note: els.annotationNote.value.trim(),
    url: safeUrl,
    createdAt: new Date().toISOString(),
  };
  annotations.push(annotation);
  saveStoredJson(ANNOTATION_STORAGE_KEY, annotations);
  els.annotationForm.reset();
  recordAudit("change", "建立歷史標註", researchAsset.symbol, `於 ${annotation.date} 建立「${annotation.title}」標註。`, {
    before: null,
    after: annotation,
  });
  renderResearch();
});

els.annotationSearch.addEventListener("input", renderAnnotations);

document.querySelector("#userMenuButton").addEventListener("click", () => {
  document.querySelector("#account").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  try {
    await workspaceSaveQueue;
    recordAudit("system", "登出系統", "Global Market Radar", "使用者主動登出系統。");
    await apiRequest("/api/logout", { method: "POST" });
  } catch (error) {
    window.alert(`登出失敗：${error.message}`);
    return;
  }
    window.location.replace("/login.html");
});

els.changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const completingInitialPassword = Boolean(AUTH_USER.forcePasswordChange);
  els.passwordMessage.hidden = true;
  if (els.newPassword.value !== els.confirmPassword.value) {
    showFormMessage(els.passwordMessage, "兩次輸入的新密碼不一致。", true);
    return;
  }
  try {
    const result = await apiRequest("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: els.currentPassword.value,
        newPassword: els.newPassword.value,
      }),
    });
    applyAuthenticatedUser(result.user);
    if (completingInitialPassword) {
      location.replace("/");
      return;
    }
    els.changePasswordForm.reset();
    showFormMessage(els.passwordMessage, "密碼已成功更新。");
    recordAudit("change", "修改登入密碼", CURRENT_USER, "使用者更新自己的登入密碼。");
    if (isSupervisor()) {
      await loadSystemUsers();
      await loadAccountApplications();
      await loadPermissions();
    }
  } catch (error) {
    showFormMessage(els.passwordMessage, error.message, true);
  }
});

els.createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.createUserMessage.hidden = true;
  try {
    const result = await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: els.newUsername.value.trim(),
        displayName: els.newDisplayName.value.trim(),
        tenantRole: els.newUserRole.value,
        password: els.newUserPassword.value,
      }),
    });
    els.createUserForm.reset();
    showFormMessage(els.createUserMessage, `帳號 ${result.user.username} 已建立。`);
    recordAudit("change", "建立系統使用者", result.user.username, `建立${getRoleLabel(result.user.role)}帳號。`);
    await loadSystemUsers();
  } catch (error) {
    showFormMessage(els.createUserMessage, error.message, true);
  }
});

document.querySelector("#refreshUsersButton").addEventListener("click", async () => {
  try {
    await loadSystemUsers();
  } catch (error) {
    window.alert(error.message);
  }
});

els.refreshApplicationsButton.addEventListener("click", async () => {
  try {
    await loadAccountApplications();
  } catch (error) {
    window.alert(error.message);
  }
});

els.permissionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.permissionMessage.hidden = true;
  const permissions = {};
  document.querySelectorAll("[data-permission-feature]").forEach((select) => {
    permissions[select.dataset.permissionFeature] = select.value;
  });
  try {
    await apiRequest("/api/permissions", {
      method: "POST",
      body: JSON.stringify({ permissions }),
    });
    showFormMessage(els.permissionMessage, "操作功能權限設定已更新。");
    recordAudit("change", "更新操作功能權限", "權限設定", "Supervisor 調整功能可用權限。", { after: permissions });
    await loadPermissions();
  } catch (error) {
    showFormMessage(els.permissionMessage, error.message, true);
  }
});

els.hideLeftSidebar.addEventListener("click", () => {
  updateLayoutState("left", true);
  recordAudit("change", "隱藏左側功能列", "介面配置", "收合主要導覽列以增加主畫面寬度。");
});

els.showLeftSidebar.addEventListener("click", () => {
  updateLayoutState("left", false);
  recordAudit("change", "顯示左側功能列", "介面配置", "展開主要導覽列。");
});

els.hideRightSidebar.addEventListener("click", () => {
  updateLayoutState("right", true);
  recordAudit("change", "隱藏右側資訊列", "介面配置", "收合七日市場資訊列以增加主畫面寬度。");
});

els.showRightSidebar.addEventListener("click", () => {
  updateLayoutState("right", false);
  recordAudit("change", "顯示右側資訊列", "介面配置", "展開七日市場資訊與新聞列。");
});

async function initializeApplication() {
  try {
    await initializeAuthentication();
    if (AUTH_USER.forcePasswordChange) {
      document.querySelectorAll("main > section").forEach((section) => { section.hidden = section.id !== "account"; });
      location.hash = "account";
      return;
    }
    const workspace = await loadWorkspace();
    loadLayoutState();
    if (AUTH_USER.tenantRole !== "viewer" && !workspace.groups && !investmentGroups.length) seedInvestmentGroups();
    if (!workspace.groups && investmentGroups.length) queueWorkspaceSave("groups", investmentGroups);
    if (!workspace.alerts && alerts.length) queueWorkspaceSave("alerts", alerts);
    if (!workspace.annotations && annotations.length) queueWorkspaceSave("annotations", annotations);
    const serverAudit = await apiRequest("/api/audit").catch(() => ({ records: [] }));
    auditLogs = [...serverAudit.records, ...auditLogs].filter((record, index, list) => list.findIndex((other) => other.id === record.id) === index);
    recordAudit("system", "開啟系統", "Global Market Radar", "使用者進入市場監控儀表板。");
    renderAll();
    if (window.initializeStrategy) window.initializeStrategy(workspace.strategy?.value);
    applyReadOnlyControls();
    setInterval(updatePrices, 2000);
  } catch (error) {
    console.error(error);
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "系統初始化失敗，請重新整理或回登入頁重試。";
    document.body.prepend(notice);
  }
}

initializeApplication();
