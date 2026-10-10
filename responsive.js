(() => {
  const mobile = matchMedia("(max-width: 1180px)");
  const rails = [document.querySelector(".sidebar"), document.querySelector(".market-news-rail")];
  const triggers = [document.querySelector("#mobileNavigation"), document.querySelector("#mobileNews")];
  const backdrop = document.querySelector(".drawer-backdrop");
  const main = document.querySelector("main");
  const bar = document.querySelector(".mobile-bar");
  let active = -1;
  function close(restore = true) {
    const previous = active;
    active = -1;
    rails.forEach((rail, index) => {
      rail.classList.remove("drawer-visible");
      rail.inert = mobile.matches;
      rail.removeAttribute("role");
      rail.removeAttribute("aria-modal");
      triggers[index].setAttribute("aria-expanded", "false");
    });
    main.inert = false;
    bar.inert = false;
    backdrop.hidden = true;
    document.body.classList.remove("drawer-open");
    if (restore && previous >= 0 && mobile.matches) triggers[previous].focus();
  }
  function open(index) {
    close(false);
    active = index;
    const rail = rails[index];
    rail.inert = false;
    rail.classList.add("drawer-visible");
    rail.setAttribute("role", "dialog");
    rail.setAttribute("aria-modal", "true");
    triggers[index].setAttribute("aria-expanded", "true");
    main.inert = true;
    bar.inert = true;
    backdrop.hidden = false;
    document.body.classList.add("drawer-open");
    rail.querySelector("button").focus();
  }
  triggers.forEach((button, index) => button.addEventListener("click", () => open(index)));
  rails.forEach((rail) => {
    rail.querySelector(".sidebar-toggle").addEventListener("click", (event) => {
      if (!mobile.matches) return;
      event.stopImmediatePropagation();
      close();
    }, true);
    rail.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener("click", () => {
      close(false);
      const target = document.getElementById(link.hash.slice(1));
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }));
  });
  backdrop.addEventListener("click", () => close());
  document.addEventListener("keydown", (event) => {
    if (active < 0) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab" || active < 0) return;
    const items = [...rails[active].querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  mobile.addEventListener("change", () => close(false));
  close(false);
  function prepareTables() {
    document.querySelectorAll(".table-wrap, .strategy-table, .correlation-wrap").forEach((table) => {
      table.tabIndex = 0;
      table.setAttribute("role", "region");
      table.setAttribute("aria-label", `${table.closest("section")?.querySelector("h2")?.textContent || "資料"}表格`);
    });
  }
  prepareTables();
  // Strategy tables are rendered after the authenticated workspace is fetched.
  new MutationObserver(prepareTables).observe(document.querySelector("#strategy"), { childList: true });
})();
