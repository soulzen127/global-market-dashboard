const form = document.querySelector("#loginForm");
const errorBox = document.querySelector("#loginError");
const loginButton = document.querySelector("#loginButton");
const initialAccount = document.querySelector("#initialAccount");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const requestForm = document.querySelector("#requestAccountForm");
const requestMessage = document.querySelector("#requestMessage");
const requestButton = document.querySelector("#requestButton");
const LOGIN_DESTINATION = "/";
const errorTranslations = {
  "Invalid credentials or disabled account.": "帳號或密碼錯誤，或帳號已停用。",
  "Too many login attempts. Try again later.": "登入失敗次數過多，請稍後再試。",
  "Invalid username format.": "請輸入有效 Email 或 3-32 碼一般帳號。",
  "Password policy not satisfied.": "密碼至少 10 碼，需包含大小寫英文、數字及特殊符號。",
  "Username already exists.": "帳號已存在。",
  "Application already pending.": "此帳號已有待審申請。",
};

async function clearStaleAppShell() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Cache cleanup is best-effort; login must continue even if the browser denies it.
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function verifyAuthenticatedSession() {
  const response = await fetch("/api/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) return false;
  const result = await readJsonResponse(response);
  return Boolean(result.user?.username);
}

clearStaleAppShell();

fetch("/api/bootstrap-status")
  .then((response) => response.json())
  .then((result) => {
    initialAccount.hidden = !result.initialPasswordActive || result.setupRequired === false;
  })
  .catch(() => {});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = "登入中...";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(errorTranslations[result.error] || result.error || "登入失敗。");
    const sessionReady = await verifyAuthenticatedSession();
    if (!sessionReady) {
      throw new Error("登入已驗證，但瀏覽器未保留登入狀態。請確認使用 http://127.0.0.1:8080/login.html 開啟，並允許 Cookie。");
    }
    window.location.assign(LOGIN_DESTINATION);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "登入";
  }
});

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  requestMessage.hidden = true;
  requestMessage.classList.remove("success");
  requestButton.disabled = true;
  requestButton.textContent = "送出中...";

  try {
    const response = await fetch("/api/account-applications", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: requestForm.requestUsername.value.trim(),
        displayName: requestForm.requestDisplayName.value.trim(),
        password: requestForm.requestPassword.value,
        note: requestForm.requestNote.value.trim(),
      }),
    });
    const result = await readJsonResponse(response);
    if (!response.ok) throw new Error(errorTranslations[result.error] || result.error || "申請送出失敗。");
    requestForm.reset();
    requestMessage.textContent = "帳號申請已送出，系統已通知 L1 Supervisor 審核。";
    requestMessage.classList.add("success");
    requestMessage.hidden = false;
  } catch (error) {
    requestMessage.textContent = error.message;
    requestMessage.hidden = false;
  } finally {
    requestButton.disabled = false;
    requestButton.textContent = "送出申請";
  }
});
