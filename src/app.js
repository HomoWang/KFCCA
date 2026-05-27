import { catalogOptions, expandItemAliases, PRODUCT_CATALOG } from "./lib/productNormalizer.js";
import { enrichCoupon, isCouponCurrentlyAvailable } from "./lib/couponParser.js";
import { allocateToPeople, findSimilarCoupons, formatItems, optimizeCoupons } from "./lib/optimizer.js";

const state = {
  data: { lastUpdated: null, coupons: [] },
  coupons: [],
  people: [],
  selectedItemFilters: new Set(),
  alternativeVisibleCount: 5
};

const els = {
  lastUpdated: document.querySelector("#last-updated"),
  search: document.querySelector("#search"),
  maxPrice: document.querySelector("#max-price"),
  sort: document.querySelector("#sort"),
  itemFilters: document.querySelector("#item-filters"),
  clearItemFilters: document.querySelector("#clear-item-filters"),
  couponCount: document.querySelector("#coupon-count"),
  couponList: document.querySelector("#coupon-list"),
  tabs: [...document.querySelectorAll("[data-view-tab]")],
  panels: [...document.querySelectorAll("[data-view-panel]")],
  personCount: document.querySelector("#person-count"),
  buildPeople: document.querySelector("#build-people"),
  peopleForms: document.querySelector("#people-forms"),
  calculate: document.querySelector("#calculate"),
  result: document.querySelector("#result")
};

async function init() {
  await loadCoupons();
  renderItemFilters();
  updateFilterChipStates();
  bindEvents();
  buildPeopleForms();
  renderCoupons();
}

async function loadCoupons() {
  try {
    const response = await fetch("./public/coupon.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`coupon.json HTTP ${response.status}`);
    state.data = await response.json();
  } catch (error) {
    console.error(error);
    state.data = { lastUpdated: null, coupons: [] };
  }

  state.coupons = (state.data.coupons ?? []).map(enrichCoupon);
  els.lastUpdated.textContent = `最後更新：${formatDateTime(state.data.lastUpdated)}`;
}

function bindEvents() {
  [els.search, els.maxPrice, els.sort].forEach((el) => el.addEventListener("input", renderCoupons));
  els.clearItemFilters.addEventListener("click", clearItemFilters);
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.viewTab));
  });
  els.buildPeople.addEventListener("click", buildPeopleForms);
  els.calculate.addEventListener("click", calculateBestDeal);
}

function renderItemFilters() {
  els.itemFilters.innerHTML = catalogOptions()
    .map((option) => {
      const count = countCouponsForItem(option.key);
      if (count === 0) return "";
      return `
        <button class="filter-chip" type="button" data-item-filter="${escapeHtml(option.key)}">
          ${escapeHtml(option.label)}
          <span>${count}</span>
        </button>
      `;
    })
    .join("");

  els.itemFilters.querySelectorAll("[data-item-filter]").forEach((button) => {
    button.addEventListener("click", () => toggleItemFilter(button.dataset.itemFilter));
  });
}

function toggleItemFilter(key) {
  if (state.selectedItemFilters.has(key)) {
    state.selectedItemFilters.delete(key);
  } else {
    state.selectedItemFilters.add(key);
  }
  updateFilterChipStates();
  renderCoupons();
}

function clearItemFilters() {
  state.selectedItemFilters.clear();
  updateFilterChipStates();
  renderCoupons();
}

function updateFilterChipStates() {
  els.itemFilters.querySelectorAll("[data-item-filter]").forEach((button) => {
    button.classList.toggle("active", state.selectedItemFilters.has(button.dataset.itemFilter));
  });
  els.clearItemFilters.hidden = state.selectedItemFilters.size === 0;
}

function renderCoupons() {
  const query = els.search.value.trim().toLowerCase();
  const maxPrice = Number(els.maxPrice.value);
  const selectedKeys = [...state.selectedItemFilters];

  const filtered = state.coupons
    .filter((coupon) => {
      const haystack = `${coupon.code} ${coupon.title} ${coupon.description} ${JSON.stringify(coupon.rawItems)}`.toLowerCase();
      const itemKeys = Object.keys(expandItemAliases(coupon.items ?? {}));
      return (
        (!query || haystack.includes(query)) &&
        (!selectedKeys.length || selectedKeys.some((key) => itemKeys.includes(key))) &&
        (!els.maxPrice.value || Number(coupon.price) <= maxPrice)
      );
    })
    .sort(sortCoupons);

  els.couponCount.textContent = `${filtered.length} 張`;
  els.couponList.innerHTML = filtered.length
    ? filtered.map(renderCouponCard).join("")
    : `<p class="muted empty-state">目前沒有符合條件的優惠券。</p>`;
}

function renderCouponCard(coupon) {
  const categories = [...new Set(Object.keys(coupon.items ?? {}).map((key) => PRODUCT_CATALOG[key]?.category).filter(Boolean))];
  const unknown = coupon.unknownItems?.length ? `<span class="badge warn">含未標準化品項</span>` : "";
  const parseStatus = coupon.parseStatus && coupon.parseStatus !== "ok"
    ? `<span class="badge warn">解析狀態：${escapeHtml(coupon.parseStatus)}</span>`
    : "";
  const parseIssues = coupon.parseIssues?.length
    ? `<p class="muted">解析訊息：${coupon.parseIssues.map(escapeHtml).join(", ")}</p>`
    : "";
  const canDeliver = coupon.deliveryAvailable !== false;
  const delivery = `<span class="badge ${canDeliver ? "" : "warn"}">${canDeliver ? "可外送" : "不可外送"}</span>`;
  return `
    <article class="coupon-card">
      <div class="coupon-top">
        <div>
          <div class="code">${escapeHtml(coupon.code)}</div>
          <h3>${escapeHtml(coupon.title ?? "未命名優惠")}</h3>
        </div>
        <div class="price">$${Number(coupon.price ?? 0)}</div>
      </div>
      <p class="muted">${escapeHtml(coupon.description ?? "")}</p>
      <div>${formatItems(coupon.items)}</div>
      <div class="badge-row">
        <span class="badge">${isCouponCurrentlyAvailable(coupon) ? "目前可用" : "非可用期間"}</span>
        ${delivery}
        ${categories.map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("")}
        ${unknown}
        ${parseStatus}
      </div>
      <p class="muted">期間：${escapeHtml(coupon.startDate ?? "未提供")} - ${escapeHtml(coupon.endDate ?? "未提供")}</p>
      ${parseIssues}
    </article>
  `;
}

function sortCoupons(a, b) {
  switch (els.sort.value) {
    case "endDateDesc":
      return String(b.endDate ?? "").localeCompare(String(a.endDate ?? ""));
    case "priceAsc":
      return Number(a.price ?? 0) - Number(b.price ?? 0);
    case "priceDesc":
      return Number(b.price ?? 0) - Number(a.price ?? 0);
    case "endDateAsc":
    default:
      return String(a.endDate ?? "9999-12-31").localeCompare(String(b.endDate ?? "9999-12-31"));
  }
}

function switchView(view) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.viewTab === view));
  els.panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.viewPanel !== view));
}

function buildPeopleForms() {
  const count = clamp(Number(els.personCount.value) || 1, 1, 10);
  state.people = Array.from({ length: count }, (_, index) => state.people[index] ?? { items: {} });
  els.peopleForms.innerHTML = state.people.map((_, index) => renderPersonForm(index)).join("");

  els.peopleForms.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => addRequirementRow(Number(button.dataset.add)));
  });
  els.peopleForms.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => button.closest(".requirement-row").remove());
  });
}

function renderPersonForm(index) {
  const rows = Object.entries(state.people[index].items);
  const safeRows = rows.length ? rows : [["zinger_burger", 1]];
  return `
    <article class="person-card" data-person="${index}">
      <h3>第 ${index + 1} 人</h3>
      <div class="rows">
        ${safeRows.map(([key, quantity]) => renderRequirementRow(key, quantity)).join("")}
      </div>
      <button class="secondary" type="button" data-add="${index}">新增品項</button>
    </article>
  `;
}

function renderRequirementRow(selectedKey = "zinger_burger", quantity = 1) {
  const options = catalogOptions()
    .map((option) => `<option value="${option.key}" ${option.key === selectedKey ? "selected" : ""}>${option.label}</option>`)
    .join("");
  return `
    <div class="requirement-row">
      <select data-product>${options}</select>
      <input data-quantity type="number" min="1" max="20" value="${Number(quantity) || 1}" />
      <button class="icon-button" type="button" data-remove aria-label="移除">×</button>
    </div>
  `;
}

function addRequirementRow(personIndex) {
  const person = els.peopleForms.querySelector(`[data-person="${personIndex}"] .rows`);
  person.insertAdjacentHTML("beforeend", renderRequirementRow());
  person.querySelectorAll("[data-remove]").forEach((button) => {
    button.onclick = () => button.closest(".requirement-row").remove();
  });
}

function readPeopleRequirements() {
  return [...els.peopleForms.querySelectorAll("[data-person]")].map((card) => {
    const items = {};
    card.querySelectorAll(".requirement-row").forEach((row) => {
      const key = row.querySelector("[data-product]").value;
      const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
      if (key && quantity > 0) items[key] = (items[key] ?? 0) + quantity;
    });
    return { items };
  });
}

function calculateBestDeal() {
  const people = readPeopleRequirements();
  const demand = people.reduce((sum, person) => {
    for (const [key, quantity] of Object.entries(person.items)) sum[key] = (sum[key] ?? 0) + quantity;
    return sum;
  }, {});
  const usableCoupons = state.coupons.filter((coupon) => !coupon.unknownItems?.length || Object.keys(coupon.items ?? {}).length);
  state.alternativeVisibleCount = 5;
  const result = optimizeCoupons(demand, usableCoupons, { alternativeLimit: 12 });
  const similarCoupons = result.similarCoupons ?? (Object.keys(result.missingItems ?? {}).length ? findSimilarCoupons(demand, usableCoupons) : []);
  renderResult(result, people, similarCoupons);
}

function renderResult(result, people, similarCoupons = []) {
  const bestPlan = result.bestPlan ?? result;
  const allocation = allocateToPeople(people, bestPlan.providedItems);
  const alternatives = result.alternativePlans ?? [];
  const visibleAlternatives = alternatives.slice(0, state.alternativeVisibleCount);
  const moreButton = alternatives.length > visibleAlternatives.length
    ? `<button class="secondary" type="button" data-show-more-plans>顯示更多方案</button>`
    : "";
  const similar = similarCoupons.length
    ? `
      <div>
        <h3>相似推薦</h3>
        <ul class="mini-list">
          ${similarCoupons.map((coupon) => `<li>${escapeHtml(coupon.code)}，$${coupon.price}，相似度 ${Math.round(coupon.similarity * 100)}%，符合 ${formatItems(coupon.matchedItems)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  els.result.innerHTML = `
    <div class="result-panel">
      ${renderPlan(bestPlan, people, { title: "最佳方案", rank: 1 })}
      <div class="result-grid">
        <div>
          <h3>可滿足品項</h3>
          <p>${formatItems(bestPlan.fulfilledItems ?? bestPlan.providedItems)}</p>
        </div>
        <div>
          <h3>多出品項</h3>
          <p>${formatItems(bestPlan.extraItems)}</p>
        </div>
        <div>
          <h3>無法滿足品項</h3>
          <p>${formatItems(bestPlan.missingItems)}</p>
        </div>
      </div>
      <div>
        <h3>個人分配</h3>
        <ul class="mini-list">
          ${allocation.people.map((person) => `<li>第 ${person.personIndex} 人：${formatItems(person.assigned)}${Object.keys(person.missing).length ? `，缺少 ${formatItems(person.missing)}` : ""}</li>`).join("")}
        </ul>
      </div>
      ${visibleAlternatives.length ? `
        <div class="alternative-plans">
          <h3>其他可行方案</h3>
          ${visibleAlternatives.map((plan, index) => renderPlan(plan, people, { title: `方案 ${index + 2}`, rank: index + 2, bestPrice: bestPlan.totalPrice })).join("")}
          ${moreButton}
        </div>
      ` : ""}
      ${similar}
    </div>
  `;

  els.result.querySelector("[data-show-more-plans]")?.addEventListener("click", () => {
    state.alternativeVisibleCount += 5;
    renderResult(result, people, similarCoupons);
  });
}

function renderPlan(plan, people, { title, rank, bestPrice = null } = {}) {
  const allocation = allocateToPeople(people, plan.providedItems);
  const delta = bestPrice === null ? "" : `<span class="muted">比最佳方案貴 $${Math.max(0, plan.totalPrice - bestPrice)}</span>`;
  const coupons = plan.selectedCoupons.length
    ? `<ul class="mini-list">${plan.selectedCoupons.map((coupon) => `<li>${escapeHtml(coupon.code)} x ${coupon.quantity}，$${coupon.price}/份 ${escapeHtml(coupon.title ?? "")}</li>`).join("")}</ul>`
    : `<p class="muted">目前沒有找到可滿足需求的組合。</p>`;

  return `
    <article class="plan-card">
      <div class="plan-heading">
        <div>
          <h3>${escapeHtml(title ?? `方案 ${rank ?? ""}`)}</h3>
          ${delta}
        </div>
        <p class="price">$${plan.totalPrice}</p>
      </div>
      ${coupons}
      <div class="result-grid compact">
        <div>
          <h3>滿足需求</h3>
          <p>${formatItems(plan.fulfilledItems ?? plan.providedItems)}</p>
        </div>
        <div>
          <h3>多買品項</h3>
          <p>${formatItems(plan.extraItems)}</p>
        </div>
      </div>
      <div>
        <h3>個人分配</h3>
        <ul class="mini-list">
          ${allocation.people.map((person) => `<li>第 ${person.personIndex} 人：${formatItems(person.assigned)}${Object.keys(person.missing).length ? `，缺少 ${formatItems(person.missing)}` : ""}</li>`).join("")}
        </ul>
      </div>
    </article>
  `;
}

function countCouponsForItem(key) {
  return state.coupons.filter((coupon) => Number(expandItemAliases(coupon.items ?? {})[key] ?? 0) > 0).length;
}

function formatDateTime(value) {
  if (!value) return "尚未取得資料";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

init();
