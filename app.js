const state = {
  domains: [],
  queue: [],
  phone: null,
  currentDomain: null,
  users: new Map(),
  globalCategories: new Map(),
  historyByUser: new Map(),
  isLoadingDomains: false,
  categorySet: new Set(),
  deviceMode: "mobile",
  previewPlaceholder: null,
  statsPlaceholder: null,
  isMobileLayout: null,
  savedFrameHeight: null,
  savedWindowWidth: null,
  userSelectedDeviceMode: false, // Track if user manually selected device mode
};

const API_ENDPOINT = "api.php";
const dom = {
  phoneRow: document.getElementById("phone-row"),
  passwordRow: document.getElementById("password-row"),
  phoneInput: document.getElementById("phone-input"),
  startButton: document.getElementById("start-session"),
  sessionIndicator: document.getElementById("session-indicator"),
  sessionPhone: document.getElementById("session-phone"),
  currentDomain: document.getElementById("current-domain"),
  totalReviewed: document.getElementById("total-reviewed"),
  remaining: document.getElementById("remaining-domains"),
  categoryButtons: document.getElementById("category-buttons"),
  addCategory: document.getElementById("add-category"),
  nextDomain: document.getElementById("next-domain"),
  historyList: document.getElementById("history-list"),
  frame: document.getElementById("site-frame"),
  frameOverlay: document.getElementById("frame-overlay"),
  deviceToggle: document.getElementById("device-toggle"),
  deviceFrame: document.getElementById("device-frame"),
  userJson: document.getElementById("download-user-json"),
  userTxt: document.getElementById("download-user-txt"),
  globalJson: document.getElementById("download-global-json"),
  globalTxt: document.getElementById("download-global-txt"),
  clearHistory: document.getElementById("clear-history"),
  cancelDialog: document.getElementById("cancel-dialog"),
  categoryDialog: document.getElementById("category-dialog"),
  controlPanel: document.querySelector(".control-panel"),
  errorText: document.getElementById("error-text"),
  newCategoryInput: document.getElementById("new-category-input"),
  previewPanel: document.querySelector(".preview-panel"),
  categoryCard: document.querySelector(".category-card"),
  statsCard: document.getElementById("stats-card"),
  authCard: document.getElementById("auth-card"),
  actionsCard: document.getElementById("actions-card"),
  historyCard: document.querySelector(".history-card"),
  logoutBtn: document.getElementById("logout-btn"),
};

init();

async function init() {
  attachListeners();
  loadDomains();
  updateStats();
  state.previewPlaceholder = document.createComment("preview-home");
  dom.previewPanel.parentElement.insertBefore(
    state.previewPlaceholder,
    dom.previewPanel
  );
  state.statsPlaceholder = document.createComment("stats-home");
  dom.statsCard.parentElement.insertBefore(
    state.statsPlaceholder,
    dom.statsCard
  );
  updateDeviceModeByScreenSize();
  updateMobileFrameDimensions();
  updateLayoutMode();
  // Use visualViewport for mobile to avoid scroll-related height changes
  let resizeTimeout;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      updateDeviceModeByScreenSize();
      updateMobileFrameDimensions();
      updateLayoutMode();
    }, 100);
  };

  window.addEventListener("resize", handleResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleResize);
  }
  dom.startButton.disabled = true;
  state.categorySet = new Set(
    [...dom.categoryButtons.querySelectorAll("button")].map(
      (btn) => btn.dataset.category
    )
  );
  await hydrateStateFromStorage();
  syncCategoryButtons();
}

function attachListeners() {
  dom.phoneInput.addEventListener("input", () => {
    dom.startButton.disabled = !isPhoneValid(dom.phoneInput.value);
  });
  dom.categoryButtons.addEventListener("click", handleCategoryClick);
  dom.nextDomain.addEventListener("click", () => {
    if (!state.phone) {
      showToast(" ابتدا وارد  سامانه شوید");
    } else if (dom.nextDomain.disabled) {
      return; // Prevent multiple clicks
    } else {
      cycleDomain();
    }
  });

  // Listen for iframe load to re-enable button
  dom.frame.addEventListener("load", () => {
    if (dom.nextDomain) {
      dom.nextDomain.disabled = false;
      const buttonText = dom.nextDomain.querySelector(".button-text");
      const buttonSpinner = dom.nextDomain.querySelector(".button-spinner");
      if (buttonText) buttonText.style.display = "";
      if (buttonSpinner) buttonSpinner.style.display = "none";
    }

    if (
      dom.frameOverlay &&
      dom.frame.src &&
      state.phone &&
      state.currentDomain
    ) {
      dom.frameOverlay.style.display = "none";
      dom.frameOverlay.textContent = "";
    }
  });
  dom.deviceToggle.addEventListener("click", handleDeviceToggle);

  const openTabBtn = document.getElementById("open-in-tab");

  if (openTabBtn) {
    openTabBtn.onclick = () => {
      if (!state.currentDomain) return;
      window.open(buildUrl(state.currentDomain), "_blank");
    };
  }

  dom.userJson.addEventListener("click", () => {
    if (state.users.size === 0) {
      showToast("هنوز کاربری دسته‌بندی انجام نداده است.");
      return;
    }

    downloadBlob(
      "users-classification.json",
      JSON.stringify(buildUserOutput(), null, 2)
    );
  });
  dom.userTxt.addEventListener("click", () => {
    if (state.users.size === 0) {
      showToast("هنوز کاربری دسته‌بندی انجام نداده است.");
      return;
    }

    downloadBlob(
      "users-classification.txt",
      buildUserTxt(),
      "text/plain;charset=utf-8"
    );
  });
  dom.globalJson.addEventListener("click", () => {
    if (state.globalCategories.size === 0) {
      showToast("هنوز دامنه‌ای طبقه‌بندی نشده است.");
      return;
    }
    downloadBlob(
      "categories-summary.json",
      JSON.stringify(buildGlobalOutput(), null, 2)
    );
  });
  dom.globalTxt.addEventListener("click", () => {
    if (state.globalCategories.size === 0) {
      showToast("هنوز دامنه‌ای طبقه‌بندی نشده است.");
    }
    downloadBlob(
      "categories-summary.txt",
      buildGlobalTxt(),
      "text/plain;charset=utf-8"
    );
  });
  dom.clearHistory.addEventListener("click", () => {
    if (!state.phone) return;
    state.historyByUser.set(state.phone, []);
    renderHistory();
    // persistState();
  });
  dom.addCategory.addEventListener("click", () => {
    dom.categoryDialog.showModal();
    dom.newCategoryInput.value = "";
    setTimeout(() => dom.newCategoryInput.focus(), 50);
  });
  // dom.categoryDialog.addEventListener("close", handleAddCategory);
  dom.logoutBtn.addEventListener("click", handleLogout);
}

async function loadDomains() {
  if (state.isLoadingDomains) return;
  state.isLoadingDomains = true;
  try {
    const response = await fetch("assets/domains.txt");
    if (!response.ok) throw new Error("domains.txt قابل خواندن نیست");
    const text = await response.text();
    state.domains = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    state.queue = shuffle([...state.domains]);
    // Initial value of the number of remaining sites
    dom.remaining.textContent = state.domains.length.toLocaleString("fa-IR");
  } catch (error) {
    console.error(error);
    showToast(
      "خطا در بارگذاری لیست دامنه. لطفاً فایل assets/domains.txt را بررسی کنید."
    );
  } finally {
    state.isLoadingDomains = false;
  }
}

function isPhoneValid(value) {
  return /^0\d{10}$/.test(value);
}

function handleStartSession() {
  const phone = dom.phoneInput.value.trim();
  if (!isPhoneValid(phone)) {
    showToast("لطفاً شماره معتبر 11 رقمی وارد کنید.");
    return;
  }
  state.phone = phone;
  const user = ensureUser(phone);
  dom.sessionPhone.textContent = `${phone}`;
  dom.sessionIndicator.appendChild(dom.logoutBtn);
  dom.logoutBtn.style.display = "inline-block";
  dom.frameOverlay.textContent = "در حال آماده‌سازی دامنه تصادفی...";
  dom.frameOverlay.style.display = "flex";
  dom.totalReviewed.textContent = user.total.toLocaleString("fa-IR");

  const reviewedCount = user.labeledDomains.size;
  dom.remaining.textContent = (
    state.domains.length - reviewedCount
  ).toLocaleString("fa-IR");

  rebuildQueueForUser();

  renderHistory();

  dom.phoneInput.disabled = true;
  dom.startButton.disabled = true;
  if (dom.authCard) dom.authCard.style.display = "none";

  if (!state.currentDomain) {
    cycleDomain();
  }
}

function handleLogout() {
  state.phone = null;
  dom.sessionPhone.textContent = "منتظر شروع";
  dom.logoutBtn.style.display = "none";
  dom.phoneInput.disabled = false;
  dom.phoneInput.value = "";
  dom.phoneRow.style.display = "flex";
  dom.passwordRow.style.display = "none";
  dom.actionsCard.style.display = "none";
  dom.startButton.disabled = true;
  dom.authCard.style.display = "";
  dom.currentDomain.textContent = "—";
  dom.totalReviewed.textContent = "0";
  dom.remaining.textContent = state.domains.length.toLocaleString("fa-IR");
  state.currentDomain = null;
  dom.frame.src = "about:blank";
  dom.frameOverlay.textContent =
    "لطفاً ابتدا وارد شوید و سپس دسته‌بندی را شروع کنید.";
  dom.frameOverlay.style.display = "flex";
  renderHistory();
  persistState();
}

function cycleDomain() {
  const user = ensureUser(state.phone);
  if (state.queue.length === 0) {
    state.queue = shuffle([...state.domains]);
  }
  state.currentDomain = state.queue.pop() ?? null;
  dom.currentDomain.textContent = state.currentDomain ?? "—";
  dom.remaining.textContent = (
    state.domains.length - user.labeledDomains.size
  ).toLocaleString("fa-IR");

  // Show loading state on button with spinner
  if (dom.nextDomain) {
    dom.nextDomain.disabled = true;
    const buttonText = dom.nextDomain.querySelector(".button-text");
    const buttonSpinner = dom.nextDomain.querySelector(".button-spinner");
    if (buttonText) buttonText.style.display = "none";
    if (buttonSpinner) buttonSpinner.style.display = "inline-flex";
  }

  loadInFrame(state.currentDomain);
}

function loadInFrame(domain) {
  if (!domain) {
    dom.frameOverlay.style.display = "flex";
    dom.frameOverlay.textContent = "دامنه‌ای برای نمایش موجود نیست.";
    dom.frame.src = "about:blank";
    // Re-enable button if no domain
    if (dom.nextDomain) {
      dom.nextDomain.disabled = false;
      const buttonText = dom.nextDomain.querySelector(".button-text");
      const buttonSpinner = dom.nextDomain.querySelector(".button-spinner");
      if (buttonText) buttonText.style.display = "";
      if (buttonSpinner) buttonSpinner.style.display = "none";
    }
    return;
  }

  // Show loading overlay
  dom.frameOverlay.style.display = "flex";
  dom.frameOverlay.textContent = "در حال بارگذاری...";

  // Load the domain
  dom.frame.src = buildUrl(domain);

  // Set a timeout as fallback in case iframe load event doesn't fire
  // This handles cases where iframe content doesn't trigger load event
  setTimeout(() => {
    // Only re-enable if still disabled (meaning load event hasn't fired yet)
    if (dom.nextDomain && dom.nextDomain.disabled) {
      dom.nextDomain.disabled = false;
      const buttonText = dom.nextDomain.querySelector(".button-text");
      const buttonSpinner = dom.nextDomain.querySelector(".button-spinner");
      if (buttonText) buttonText.style.display = "";
      if (buttonSpinner) buttonSpinner.style.display = "none";
      if (
        dom.frameOverlay &&
        dom.frame.src &&
        state.phone &&
        state.currentDomain
      ) {
        dom.frameOverlay.style.display = "none";
      }
    }
  }, 5000); // 5 second timeout fallback
}

function buildUrl(domain) {
  if (!domain) return "about:blank";
  if (/^https?:\/\//i.test(domain)) return domain;
  return `https://${domain}`;
}

function handleCategoryClick(event) {
  const target = event.target.closest("button");
  if (!target || !target.dataset.category) return;
  if (!state.phone) {
    showToast(" ابتدا وارد  سامانه شوید");
    return;
  }
  if (!state.currentDomain) {
    showToast(" دامنه‌ای برای دسته‌بندی وجود ندارد");
    return;
  }
  registerClassification(target.dataset.category);
}

function registerClassification(category) {
  const user = ensureUser(state.phone);
  if (!user.labeledDomains.has(state.currentDomain)) {
    user.total += 1;
    user.labeledDomains.add(state.currentDomain);
  }

  const timestamp = new Date().toISOString();
  const historyItem = { domain: state.currentDomain, category, timestamp };

  if (!user.categories.has(category)) {
    user.categories.set(category, []);
  }
  user.categories
    .get(category)
    .push({ domain: state.currentDomain, timestamp });

  if (!state.globalCategories.has(category)) {
    state.globalCategories.set(category, []);
  }
  state.globalCategories.get(category).push({
    domain: state.currentDomain,
    user: state.phone,
    timestamp,
  });

  if (!state.historyByUser.has(state.phone)) {
    state.historyByUser.set(state.phone, []);
  }
  const historyList = state.historyByUser.get(state.phone);
  historyList.unshift(historyItem);
  state.historyByUser.set(state.phone, historyList.slice(0, 30));

  dom.totalReviewed.textContent = user.total.toLocaleString("fa-IR");

  dom.remaining.textContent = (
    state.domains.length - user.labeledDomains.size
  ).toLocaleString("fa-IR");

  rebuildQueueForUser();
  renderHistory();
  cycleDomain();
  persistState();
}

function rebuildQueueForUser() {
  if (!state.phone) return;
  const user = ensureUser(state.phone);
  // Only domains that the user has not categorized
  state.queue = shuffle(
    state.domains.filter((domain) => !user.labeledDomains.has(domain))
  );
}

function ensureUser(phone) {
  if (!state.users.has(phone)) {
    state.users.set(phone, {
      phone,
      total: 0,
      categories: new Map(),
      labeledDomains: new Set(),
    });
  }
  return state.users.get(phone);
}

function renderHistory() {
  dom.historyList.innerHTML = "";
  const template = document.getElementById("history-item-template");
  const list = state.phone ? state.historyByUser.get(state.phone) ?? [] : [];
  list.forEach((item) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".history-domain").textContent = item.domain;
    node.querySelector(".history-category").textContent = item.category;
    node.querySelector(".history-time").textContent = formatTime(
      item.timestamp
    );
    dom.historyList.appendChild(node);
  });
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateDeviceModeByScreenSize() {
  // Don't auto-update if user has manually selected a device mode
  if (state.userSelectedDeviceMode) return;

  const isMobileLayout = window.matchMedia("(max-width: 1100px)").matches;
  const targetMode = isMobileLayout ? "mobile" : "desktop";

  // Only update if mode changed
  if (state.deviceMode === targetMode) return;

  state.deviceMode = targetMode;

  // Update button states
  [...dom.deviceToggle.children].forEach((child) => {
    if (child.dataset.mode === targetMode) {
      child.classList.add("active");
    } else {
      child.classList.remove("active");
    }
  });

  // Update device frame classes
  if (targetMode === "mobile") {
    dom.deviceFrame.classList.add("mobile");
    dom.deviceFrame.classList.remove("desktop");
  } else {
    dom.deviceFrame.classList.add("desktop");
    dom.deviceFrame.classList.remove("mobile");
  }

  updateMobileFrameDimensions();
}

function handleDeviceToggle(event) {
  const button = event.target.closest("button");
  if (!button) return;
  [...dom.deviceToggle.children].forEach((child) =>
    child.classList.remove("active")
  );
  button.classList.add("active");
  const mode = button.dataset.mode;
  state.deviceMode = mode;

  // Mark that user has manually selected device mode
  state.userSelectedDeviceMode = true;

  dom.deviceFrame.classList.toggle("mobile", mode === "mobile");
  dom.deviceFrame.classList.toggle("desktop", mode === "desktop");
  updateMobileFrameDimensions();
}

function buildUserOutput() {
  const result = {};
  const users = Array.from(state.users.entries());
  shuffle(users);

  users.forEach(([phone, user]) => {
    const categories = {};
    user.categories.forEach((list, key) => {
      const shuffledList = shuffle(Array.from(list));
      categories[key] = shuffledList.map((entry) => entry.domain);
    });
    result[phone] = {
      total: user.total,
      categories,
    };
  });
  return result;
}

function buildUserTxt() {
  const parts = [];
  const users = Array.from(state.users.entries());
  shuffle(users);

  users.forEach(([phone, user]) => {
    parts.push(`کاربر: ${phone}`);
    parts.push(`تعداد: ${user.total}`);
    user.categories.forEach((list, category) => {
      parts.push(`  دسته ${category}:`);
      const shuffledList = shuffle(Array.from(list));
      shuffledList.forEach((entry) => {
        parts.push(`    - ${entry.domain}`);
      });
    });
    parts.push("");
  });
  return parts.join("\n");
}

function buildGlobalOutput() {
  const result = {};
  state.globalCategories.forEach((list, category) => {
    const shuffledList = shuffle(Array.from(list));
    result[category] = shuffledList.map(({ domain, user }) => ({
      domain,
      user,
    }));
  });
  return result;
}

function buildGlobalTxt() {
  const parts = [];
  state.globalCategories.forEach((list, category) => {
    parts.push(`دسته ${category}:`);
    const shuffledList = shuffle(Array.from(list));
    shuffledList.forEach((entry) => {
      parts.push(`  - ${entry.domain} (${entry.user})`);
    });
    parts.push("");
  });
  return parts.join("\n");
}

function downloadBlob(filename, data, type = "application/json;charset=utf-8") {
  if (!data) {
    showToast("داده‌ای برای خروجی وجود ندارد");
    return;
  }
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function updateStats() {
  dom.totalReviewed.textContent = "0";
  dom.remaining.textContent = state.queue.length.toLocaleString("fa-IR");
}

// function handleAddCategory() {
//   if (dom.categoryDialog.returnValue !== "confirm") return;
//   const title = dom.newCategoryInput.value.trim();
//   if (!title) return;
//   if (state.categorySet?.has(title)) {
//     showToast("این دسته از قبل وجود دارد.");

//     return;
//   }
//   state.categorySet = state.categorySet || new Set();
//   state.categorySet.add(title);
//   createCategoryButton(title);
//   persistState();
// }

function updateLayoutMode() {
  const isMobileLayout = window.matchMedia("(max-width: 1100px)").matches;
  if (state.isMobileLayout === isMobileLayout) return;
  state.isMobileLayout = isMobileLayout;
  if (isMobileLayout) {
    const authNext = dom.authCard?.nextSibling ?? null;
    if (dom.previewPanel) {
      if (authNext) {
        dom.controlPanel.insertBefore(dom.previewPanel, authNext);
      } else {
        dom.controlPanel.appendChild(dom.previewPanel);
      }
      dom.previewPanel.classList.add("mobile-inline");
    }

    if (dom.statsCard) {
      const statsReference = dom.actionsCard ?? dom.historyCard ?? null;
      if (statsReference) {
        dom.controlPanel.insertBefore(dom.statsCard, statsReference);
      } else {
        dom.controlPanel.appendChild(dom.statsCard);
      }
    }

    if (dom.categoryCard && dom.statsCard) {
      dom.controlPanel.insertBefore(dom.categoryCard, dom.statsCard);
    }
  } else {
    if (dom.previewPanel) {
      state.previewPlaceholder?.parentElement?.insertBefore(
        dom.previewPanel,
        state.previewPlaceholder.nextSibling
      );
      dom.previewPanel.classList.remove("mobile-inline");
    }

    if (dom.statsCard) {
      state.statsPlaceholder?.parentElement?.insertBefore(
        dom.statsCard,
        state.statsPlaceholder.nextSibling
      );
    }

    if (dom.categoryCard) {
      const categoryReference = dom.actionsCard ?? dom.historyCard ?? null;
      if (categoryReference) {
        dom.controlPanel.insertBefore(dom.categoryCard, categoryReference);
      }
    }
  }
}

function updateMobileFrameDimensions() {
  const isCompact = window.matchMedia("(max-width: 1100px)").matches;
  const padding = isCompact ? 32 : 0;
  const rawWidth = isCompact ? window.innerWidth - padding : 428;
  const width = Math.max(280, rawWidth);

  // Only update height if window width changed significantly (orientation change or real resize)
  // or if it's the first time
  const currentWidth = window.innerWidth;
  const shouldUpdateHeight =
    state.savedFrameHeight === null ||
    Math.abs((state.savedWindowWidth || 0) - currentWidth) > 50;

  const headerFootprint = isCompact ? 200 : 280;
  let height;

  if (isCompact && shouldUpdateHeight) {
    // Use visualViewport height for mobile to avoid scroll-related changes
    // Or use document.documentElement.clientHeight which is more stable
    let viewportHeight;
    if (window.visualViewport && window.visualViewport.height > 0) {
      // visualViewport stays stable during scroll
      viewportHeight = window.visualViewport.height;
    } else {
      // Fallback: use document.documentElement.clientHeight which is more stable than innerHeight
      viewportHeight =
        document.documentElement.clientHeight || window.innerHeight;
    }

    // Calculate height based on viewport and save it (increased height for better visibility)
    const rawHeight = viewportHeight - headerFootprint + 100; // Added 100px more height
    height = Math.max(600, rawHeight); // Increased minimum from 520 to 600
    state.savedFrameHeight = height;
    state.savedWindowWidth = currentWidth;
  } else if (isCompact && state.savedFrameHeight) {
    // Use saved height to prevent scroll-related changes
    height = state.savedFrameHeight;
  } else if (isCompact) {
    // Fallback calculation (shouldn't reach here normally)
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const rawHeight = viewportHeight - headerFootprint + 100; // Added 100px more height
    height = Math.max(600, rawHeight); // Increased minimum from 520 to 600
  } else {
    // Desktop: Calculate height based on viewport to prevent scrolling
    // More accurately calculate used space for both mobile and desktop preview modes
    const viewportHeight = window.innerHeight;

    // Measure actual elements if available, otherwise use estimates
    let usedSpace = 0;

    // Header height - try to measure or use estimate
    const header = document.querySelector("header");
    if (header) {
      const headerRect = header.getBoundingClientRect();
      const headerMarginBottom =
        parseInt(window.getComputedStyle(header).marginBottom) || 24;
      usedSpace += headerRect.height + headerMarginBottom;
    } else {
      usedSpace += 80 + 24; // Header (~80px) + margin-bottom (24px)
    }

    // App shell padding
    usedSpace += 32 + 48; // padding top (32px) + padding bottom (48px)

    // Device toolbar
    if (dom.deviceToggle && dom.deviceToggle.parentElement) {
      const toolbarRect =
        dom.deviceToggle.parentElement.getBoundingClientRect();
      usedSpace += toolbarRect.height + 12; // toolbar height + gap
    } else {
      usedSpace += 60 + 12; // ~60px toolbar + 12px gap
    }

    // Minimal safety margin for desktop to maximize space usage
    usedSpace += 10; // Reduced from 30 to 10 for more space

    const availableHeight = viewportHeight - usedSpace;

    // For desktop, maximize height usage while ensuring no scroll
    // Use almost all available space (99.5% to account for any rounding/margins)
    // Minimum 500px for better visibility, use maximum available height
    height = Math.max(500, Math.min(availableHeight * 0.995, availableHeight));
  }

  document.documentElement.style.setProperty(
    "--mobile-frame-width",
    `${width}px`
  );
  document.documentElement.style.setProperty(
    "--mobile-frame-height",
    `${height}px`
  );

  if (state.deviceMode === "mobile" && !isCompact) {
    dom.deviceFrame.style.marginInline = "auto";
  } else {
    dom.deviceFrame.style.marginInline = "";
  }
}

async function hydrateStateFromStorage() {
  try {
    const response = await fetch(API_ENDPOINT);
    if (!response.ok) {
      console.warn("Failed to load data from server, starting fresh");
      return;
    }
    const data = await response.json();

    state.users = new Map(
      Object.entries(data.users ?? {}).map(([phone, payload]) => {
        const categories = new Map();
        Object.entries(payload.categories ?? {}).forEach(([category, list]) => {
          categories.set(
            category,
            list.map((entry) => ({
              domain: entry.domain,
              timestamp: entry.timestamp ?? entry.time ?? null,
            }))
          );
        });
        return [
          phone,
          {
            phone,
            total: payload.total ?? 0,
            categories,
            labeledDomains: new Set(payload.labeledDomains ?? []),
          },
        ];
      })
    );

    state.globalCategories = new Map(
      Object.entries(data.globalCategories ?? {}).map(([category, list]) => [
        category,
        list.map((entry) => ({
          domain: entry.domain,
          user: entry.user,
          timestamp: entry.timestamp ?? null,
        })),
      ])
    );

    state.historyByUser = new Map(
      Object.entries(data.historyByUser ?? {}).map(([phone, list]) => [
        phone,
        list.map((entry) => ({
          domain: entry.domain,
          category: entry.category,
          timestamp: entry.timestamp ?? new Date().toISOString(),
        })),
      ])
    );

    (data.categorySet ?? []).forEach((category) =>
      state.categorySet.add(category)
    );
  } catch (error) {
    console.error("Failed to restore saved data", error);
  }
}

async function persistState() {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serializeState()),
    });
    if (!response.ok) {
      console.error("Failed to save data to server");
    }
  } catch (error) {
    console.error("Failed to persist data", error);
  }
}

function serializeState() {
  const users = {};
  state.users.forEach((user, phone) => {
    const categories = {};
    user.categories.forEach((list, category) => {
      categories[category] = list.map((entry) => ({
        domain: entry.domain,
        timestamp: entry.timestamp,
      }));
    });
    users[phone] = {
      total: user.total,
      categories,
      labeledDomains: [...user.labeledDomains],
    };
  });

  const globalCategories = {};
  state.globalCategories.forEach((list, category) => {
    globalCategories[category] = list.map((entry) => ({
      domain: entry.domain,
      user: entry.user,
      timestamp: entry.timestamp,
    }));
  });

  const historyByUser = {};
  state.historyByUser.forEach((list, phone) => {
    historyByUser[phone] = list.map((entry) => ({
      domain: entry.domain,
      category: entry.category,
      timestamp: entry.timestamp,
    }));
  });

  return {
    users,
    globalCategories,
    historyByUser,
    categorySet: [...state.categorySet],
  };
}

function syncCategoryButtons() {
  const existing = new Set(
    [...dom.categoryButtons.querySelectorAll("button")].map(
      (btn) => btn.dataset.category
    )
  );
  state.categorySet.forEach((category) => {
    if (!existing.has(category)) {
      createCategoryButton(category);
    }
  });
}

function createCategoryButton(title) {
  const button = document.createElement("button");
  button.textContent = title;
  button.dataset.category = title;
  button.className = "category";
  dom.categoryButtons.appendChild(button);
}

document.addEventListener("DOMContentLoaded", () => {
  const ADMIN_PHONE = "#?#?#?#?#";
  const ADMIN_PASS_HASH = "#?#?#?#?#";

  const startSessionBtn = document.getElementById("start-session");
  const phoneRow = document.getElementById("phone-row");
  const passwordRow = document.getElementById("password-row");
  const passwordInput = document.getElementById("password-input");
  const loginBtn = document.getElementById("login-btn");
  const actionsCard = document.getElementById("actions-card");
  const phoneInput = document.getElementById("phone-input");

  function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString();
  }

  if (startSessionBtn) {
    startSessionBtn.addEventListener("click", () => {
      const phone = phoneInput.value.trim();
      const phoneHash = simpleHash(phone);
      if (phoneHash == ADMIN_PHONE) {
        // For admin, just show the password field.
        if (dom.nextDomain) dom.nextDomain.disabled = true;
        if (phoneRow) phoneRow.style.display = "none";
        if (passwordRow) passwordRow.style.display = "flex";
        if (passwordInput) passwordInput.focus();
      } else {
        // For normal users, start the session directly.
        handleStartSession();
      }
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      const enteredPassword = passwordInput.value;
      if (!enteredPassword) {
        showToast("لطفاً رمز عبور را وارد کنید.");
        return;
      }

      const enteredPassHash = simpleHash(enteredPassword);

      if (enteredPassHash === ADMIN_PASS_HASH) {
        showToast("خوش آمدید ادمین!");
        if (actionsCard) actionsCard.style.display = "block";

        // Start the session for the admin after successful login.
        handleStartSession();
      } else {
        showToast("رمز عبور اشتباه است.");
        passwordInput.value = "";
      }
    });
  }

  /*****************    ToolTio Icon    **********************/

  const tooltipIcon = document.querySelector(".tooltip-icon");

  if (tooltipIcon) {
    const tooltipText = tooltipIcon.nextElementSibling;

    const toggleTooltip = (event) => {
      event.stopPropagation(); // Prevent the main button click
      event.preventDefault(); // Prevent any default action

      const isVisible = tooltipText.classList.contains("show");

      // Hide any other open tooltips if you have more in the future
      document.querySelectorAll(".tooltip-text.show").forEach((tt) => {
        if (tt !== tooltipText) {
          tt.classList.remove("show");
        }
      });

      // Toggle the current tooltip
      tooltipText.classList.toggle("show");
    };

    tooltipIcon.addEventListener("click", toggleTooltip);

    // Hide tooltip when clicking outside of it
    window.addEventListener("click", (event) => {
      if (
        !tooltipIcon.contains(event.target) &&
        tooltipText.classList.contains("show")
      ) {
        tooltipText.classList.remove("show");
      }
    });
  }
});

// --- Guide Modal & Accordion Logic ---
const guideModal = document.getElementById("guide-modal");
const openGuideBtn = document.getElementById("category-guide-btn");
const closeGuideBtn = document.getElementById("close-guide-modal");
const accordionHeaders = document.querySelectorAll(".accordion-header");

if (guideModal && openGuideBtn && closeGuideBtn) {
  // Function to open modal
  openGuideBtn.addEventListener("click", () => {
    guideModal.style.display = "block";
  });

  // Function to close modal
  const closeModal = () => {
    guideModal.style.display = "none";
  };

  closeGuideBtn.addEventListener("click", closeModal);

  // Close modal if user clicks outside of the modal content
  window.addEventListener("click", (event) => {
    if (event.target === guideModal) {
      closeModal();
    }
  });

  // Accordion logic
  accordionHeaders.forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.parentElement;
      const content = button.nextElementSibling;
      const icon = button.querySelector(".accordion-icon");
      const wasActive = item.classList.contains("active");

      // First, close all other items
      document.querySelectorAll(".accordion-item").forEach((otherItem) => {
        if (otherItem !== item) {
          otherItem.classList.remove("active");
          otherItem.querySelector(".accordion-content").style.maxHeight = null;
          otherItem.querySelector(".accordion-icon").textContent = "+";
          otherItem.querySelector(".accordion-icon").style.transform =
            "rotate(0deg)";
        }
      });

      // Then, toggle the clicked item
      if (wasActive) {
        item.classList.remove("active");
        content.style.maxHeight = null;
        icon.textContent = "+";
        icon.style.transform = "rotate(0deg)";
      } else {
        item.classList.add("active");
        content.style.maxHeight = content.scrollHeight + "px";
        icon.textContent = "×"; // Using a cross symbol for active state
        icon.style.transform = "rotate(45deg)";
      }
    });
  });
}

const elements = {
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toast-text"),
};

let toastTimeout; // To store the timeout ID
// Displays a toast notification with a message.
function showToast(message) {
  // If a toast is already shown, clear its timeout
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  elements.toastText.textContent = message;
  elements.toast.classList.add("show");

  // Hide the toast after 3 seconds
  toastTimeout = setTimeout(() => {
    elements.toast.classList.remove("show");
    toastTimeout = null; // Reset the timeout ID
  }, 3000);
}
