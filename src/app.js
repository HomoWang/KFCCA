import {
  broadLabel,
  calculatorCategories,
  categoryProducts,
  productCategoryKey,
  PRODUCT_CATALOG,
  productLabel
} from "./lib/productCatalog.js";
import { canonicalizeItems } from "./lib/productNormalizer.js";
import { couponMatchesItemFilters, makeFilterId } from "./lib/couponFilters.js";
import { enrichCoupon, isCouponCurrentlyAvailable } from "./lib/couponParser.js";
import { getCouponLifecycle, matchesStatus } from "./lib/couponLifecycle.js";
import { buildProductStatus, productStatusFor } from "./lib/productStatus.js";
import { matchCoupon, buildSuggestions } from "./lib/couponSearch.js";
import { findSimilarCoupons, formatItems, optimizeCoupons, requirementLabel } from "./lib/optimizer.js";

const state = {
  data: { lastUpdated: null, coupons: [] },
  coupons: [],
  people: [],
  selectedItemFilters: new Set(),
  // 預設只看進行中：資料含寬限期內的過期券，預設排序（期限近到遠）會把它們排最前。
  selectedStatus: "ongoing",
  history: null,
  productStatus: null,
  now: new Date(),
  alternativeVisibleCount: 5,
  lastResult: null,
  lastPeople: []
};

const els = {
  lastUpdated: document.querySelector("#last-updated"),
  search: document.querySelector("#search"),
  searchSuggestions: document.querySelector("#search-suggestions"),
  maxPrice: document.querySelector("#max-price"),
  sort: document.querySelector("#sort"),
  statusFilter: document.querySelector("#status-filter"),
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
  state.now = new Date();
  await loadCoupons();
  await loadHistory();
  state.productStatus = buildProductStatus(state.coupons, { now: state.now, history: state.history });
  renderStatusFilter();
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
  els.lastUpdated.textContent = `資料更新：${formatDateTime(state.data.lastUpdated)}`;
}

async function loadHistory() {
  try {
    const response = await fetch("./public/product-history.json", { cache: "no-store" });
    if (!response.ok) {
      state.history = null;
      return;
    }
    state.history = await response.json();
  } catch (error) {
    // 歷史檔在 pipeline 上線前不存在屬正常情況，新登場狀態與徽章會優雅降級。
    state.history = null;
  }
}

function bindEvents() {
  [els.search, els.maxPrice, els.sort].forEach((el) => el.addEventListener("input", renderCoupons));
  els.search.addEventListener("input", renderSuggestions);
  els.searchSuggestions.addEventListener("click", handleSuggestionClick);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) hideSuggestions();
  });
  els.statusFilter.addEventListener("click", handleStatusFilterClick);
  els.itemFilters.addEventListener("click", handleItemFiltersClick);
  els.clearItemFilters.addEventListener("click", clearItemFilters);
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.viewTab)));
  els.buildPeople.addEventListener("click", buildPeopleForms);
  els.calculate.addEventListener("click", calculateBestDeal);
  els.peopleForms.addEventListener("click", handlePeopleFormsClick);
  els.peopleForms.addEventListener("change", handlePeopleFormsChange);
}

function statusOptions() {
  const options = [
    { key: "all", label: "全部" },
    { key: "ongoing", label: "進行中" },
    { key: "ending_soon", label: "即將結束" }
  ];
  if (state.history?.baselineDate) options.push({ key: "new", label: "新登場" });
  return options;
}

function renderStatusFilter() {
  els.statusFilter.innerHTML = statusOptions()
    .map((option) => `
      <button class="status-chip ${option.key === state.selectedStatus ? "active" : ""}" type="button" data-status="${escapeHtml(option.key)}">
        ${escapeHtml(option.label)}
      </button>
    `)
    .join("");
}

function handleStatusFilterClick(event) {
  const button = event.target.closest("[data-status]");
  if (!button || !els.statusFilter.contains(button)) return;
  state.selectedStatus = button.dataset.status;
  renderStatusFilter();
  renderCoupons();
}

function renderItemFilters() {
  els.itemFilters.innerHTML = calculatorCategories().map(renderFilterGroup).join("");
}

function renderFilterGroup(category) {
  const broadId = makeFilterId("broad", category.key);
  const broadCount = countCouponsForItem({ id: broadId });
  if (broadCount === 0) return "";

  const entries = category.products
    .map((product) => ({
      product,
      status: productStatusFor(state.productStatus, product.key),
      count: countCouponsForItem({ id: makeFilterId("exact", product.key) })
    }))
    .filter((entry) => entry.count > 0);

  const active = entries.filter((entry) => !entry.status.stale);
  const stale = entries.filter((entry) => entry.status.stale);
  const expanded = active.length > 0;

  const staleSection = stale.length
    ? `
      <div class="stale-group">
        <button class="stale-toggle" type="button" data-stale-toggle="${escapeHtml(category.key)}" aria-expanded="false">已過季 (${stale.length})</button>
        <div class="stale-body" data-stale-body="${escapeHtml(category.key)}" hidden>
          ${stale.map(renderProductChip).join("")}
        </div>
      </div>
    `
    : "";

  return `
    <section class="filter-group" data-group="${escapeHtml(category.key)}">
      <div class="filter-group-head">
        <button class="filter-group-toggle" type="button" data-group-toggle="${escapeHtml(category.key)}" aria-expanded="${expanded}">${escapeHtml(category.label)}</button>
        <button class="filter-chip" type="button" data-item-filter="${escapeHtml(broadId)}">
          ${escapeHtml(category.broadOptionLabel)}
          <span>${broadCount}</span>
        </button>
      </div>
      <div class="filter-group-body" data-group-body="${escapeHtml(category.key)}" ${expanded ? "" : "hidden"}>
        ${active.map(renderProductChip).join("")}
        ${staleSection}
      </div>
    </section>
  `;
}

function renderProductChip({ product, status, count }) {
  const id = makeFilterId("exact", product.key);
  const newBadge = status.isNew ? `<span class="chip-new-badge">新</span>` : "";
  return `
    <button class="filter-chip" type="button" data-item-filter="${escapeHtml(id)}">
      ${escapeHtml(product.label)}${newBadge}
      <span>${count}</span>
    </button>
  `;
}

function handleItemFiltersClick(event) {
  const filterButton = event.target.closest("[data-item-filter]");
  if (filterButton && els.itemFilters.contains(filterButton)) {
    toggleItemFilter(filterButton.dataset.itemFilter);
    return;
  }

  const groupToggle = event.target.closest("[data-group-toggle]");
  if (groupToggle && els.itemFilters.contains(groupToggle)) {
    toggleCollapsible(groupToggle, els.itemFilters.querySelector(`[data-group-body="${cssEscape(groupToggle.dataset.groupToggle)}"]`));
    return;
  }

  const staleToggle = event.target.closest("[data-stale-toggle]");
  if (staleToggle && els.itemFilters.contains(staleToggle)) {
    toggleCollapsible(staleToggle, els.itemFilters.querySelector(`[data-stale-body="${cssEscape(staleToggle.dataset.staleToggle)}"]`));
  }
}

function toggleCollapsible(toggleButton, body) {
  if (!body) return;
  const willExpand = body.hidden;
  body.hidden = !willExpand;
  toggleButton.setAttribute("aria-expanded", String(willExpand));
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function renderSuggestions() {
  const query = els.search.value.trim();
  if (!query) {
    hideSuggestions();
    return;
  }
  const suggestions = buildSuggestions(query, state.coupons, { limit: 8 });
  if (!suggestions.length) {
    hideSuggestions();
    return;
  }
  els.searchSuggestions.innerHTML = suggestions
    .map((suggestion) => {
      const value = suggestion.type === "product" ? suggestion.filterId : suggestion.code;
      const tag = suggestion.type === "product" ? "品項" : "代碼";
      return `
        <button class="search-suggestion" type="button" data-suggestion-type="${suggestion.type}" data-suggestion-value="${escapeHtml(value)}">
          <span class="suggestion-tag">${tag}</span>${escapeHtml(suggestion.label)}
        </button>
      `;
    })
    .join("");
  els.searchSuggestions.hidden = false;
}

function hideSuggestions() {
  els.searchSuggestions.hidden = true;
}

function handleSuggestionClick(event) {
  const button = event.target.closest("[data-suggestion-type]");
  if (!button) return;

  if (button.dataset.suggestionType === "product") {
    state.selectedItemFilters.add(button.dataset.suggestionValue);
    els.search.value = "";
    updateFilterChipStates();
  } else {
    els.search.value = button.dataset.suggestionValue;
  }
  hideSuggestions();
  renderCoupons();
}

function toggleItemFilter(key) {
  if (state.selectedItemFilters.has(key)) state.selectedItemFilters.delete(key);
  else state.selectedItemFilters.add(key);
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
  const query = els.search.value.trim();
  const maxPrice = Number(els.maxPrice.value);
  const selectedKeys = [...state.selectedItemFilters];

  const filtered = state.coupons
    .filter((coupon) => {
      const lifecycle = getCouponLifecycle(coupon, { now: state.now, history: state.history });
      return (
        matchCoupon(coupon, query) &&
        matchesStatus(lifecycle, state.selectedStatus) &&
        couponMatchesItemFilters(coupon, selectedKeys) &&
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
    ? `<span class="badge warn">解析：${escapeHtml(coupon.parseStatus)}</span>`
    : "";
  const parseIssues = coupon.parseIssues?.length
    ? `<p class="muted">解析問題：${coupon.parseIssues.map(escapeHtml).join(", ")}</p>`
    : "";
  const canDeliver = coupon.deliveryAvailable !== false;
  const delivery = `<span class="badge ${canDeliver ? "" : "warn"}">${canDeliver ? "可外送" : "不可外送"}</span>`;
  const lifecycle = getCouponLifecycle(coupon, { now: state.now, history: state.history });
  const lifecycleBadges = [
    lifecycle.isNew ? `<span class="badge new">新登場</span>` : "",
    lifecycle.isEndingSoon ? `<span class="badge warn">即將結束</span>` : "",
    lifecycle.isExpired ? `<span class="badge stale">已過季</span>` : ""
  ].join("");

  return `
    <article class="coupon-card">
      <div class="coupon-top">
        <div>
          <div class="code">${escapeHtml(coupon.code)}</div>
          <h3>${escapeHtml(coupon.title ?? "未命名優惠券")}</h3>
        </div>
        <div class="price">$${Number(coupon.price ?? 0)}</div>
      </div>
      <p class="muted">${escapeHtml(coupon.description ?? "")}</p>
      <div>${renderItemDetails(coupon.displayItems ?? itemObjectToDetails(coupon.items))}</div>
      <div class="badge-row">
        <span class="badge">${isCouponCurrentlyAvailable(coupon) ? "目前可用" : "未在期限內"}</span>
        ${lifecycleBadges}
        ${delivery}
        ${categories.map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("")}
        ${unknown}
        ${parseStatus}
      </div>
      <p class="muted">期限：${escapeHtml(coupon.startDate ?? "未提供")} - ${escapeHtml(coupon.endDate ?? "未提供")}</p>
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
  const current = readPeopleRequirements({ silent: true });
  state.people = Array.from({ length: count }, (_, index) => current[index] ?? defaultPerson(index));
  els.peopleForms.innerHTML = state.people.map((person, index) => renderPersonForm(person, index)).join("");
}

function defaultPerson(index) {
  return {
    name: `第 ${index + 1} 人`,
    requirements: [{ type: "broad", category: "burger", quantity: 1 }]
  };
}

function renderPersonForm(person, index) {
  const rows = person.requirements?.length ? person.requirements : defaultPerson(index).requirements;
  return `
    <article class="person-card" data-person="${index}">
      <h3>第 ${index + 1} 人</h3>
      <div class="rows">
        ${rows.map((requirement) => renderRequirementRow(requirement)).join("")}
      </div>
      <button class="secondary" type="button" data-add="${index}">新增品項</button>
    </article>
  `;
}

// 只回傳「實際出現在現有優惠券」的分類/品項，讓需求下拉與卡片所見一致（WYSIWYG）。
function appearingCategories() {
  return calculatorCategories().filter((category) =>
    category.products.some((product) => productStatusFor(state.productStatus, product.key).couponCount > 0)
  );
}

function appearingProducts(categoryKey) {
  return categoryProducts(categoryKey).filter((product) => productStatusFor(state.productStatus, product.key).couponCount > 0);
}

function renderRequirementRow(requirement = { type: "broad", category: "burger", quantity: 1 }) {
  const type = requirement.type ?? "broad";
  const category = requirement.category ?? productCategoryKey(requirement.productKey) ?? "burger";
  const productKey = requirement.productKey ?? appearingProducts(category)[0]?.key ?? "";

  return `
    <div class="requirement-row" data-requirement-row>
      <select data-requirement-type aria-label="需求類型">
        <option value="broad" ${type === "broad" ? "selected" : ""}>廣泛分類</option>
        <option value="exact" ${type === "exact" ? "selected" : ""}>精準品項</option>
      </select>
      <select data-category aria-label="分類">
        ${appearingCategories().map((item) => `<option value="${item.key}" ${item.key === category ? "selected" : ""}>${item.label}</option>`).join("")}
      </select>
      <select data-product aria-label="品項">
        ${productOptionsHtml(type, category, productKey)}
      </select>
      <input data-quantity type="number" min="1" max="20" value="${Number(requirement.quantity) || 1}" aria-label="數量" />
      <button class="icon-button" type="button" data-remove aria-label="移除">x</button>
    </div>
  `;
}

function productOptionsHtml(type, category, selectedProductKey) {
  if (type === "broad") {
    return `<option value="${category}">${broadLabel(category)}</option>`;
  }
  return appearingProducts(category)
    .map((product) => `<option value="${product.key}" ${product.key === selectedProductKey ? "selected" : ""}>${product.label}</option>`)
    .join("");
}

function handlePeopleFormsClick(event) {
  const addButton = event.target.closest("[data-add]");
  if (addButton && els.peopleForms.contains(addButton)) {
    addRequirementRow(Number(addButton.dataset.add));
    return;
  }

  const removeButton = event.target.closest("[data-remove]");
  if (removeButton && els.peopleForms.contains(removeButton)) {
    removeButton.closest("[data-requirement-row]")?.remove();
  }
}

function handlePeopleFormsChange(event) {
  if (!event.target.matches("[data-requirement-type], [data-category]")) return;
  refreshRequirementRow(event.target.closest("[data-requirement-row]"));
}

function refreshRequirementRow(row) {
  const type = row.querySelector("[data-requirement-type]").value;
  const category = row.querySelector("[data-category]").value;
  const product = row.querySelector("[data-product]");
  product.innerHTML = productOptionsHtml(type, category, product.value);
}

function addRequirementRow(personIndex) {
  const person = els.peopleForms.querySelector(`[data-person="${personIndex}"] .rows`);
  person.insertAdjacentHTML("beforeend", renderRequirementRow());
}

function readPeopleRequirements({ silent = false } = {}) {
  const cards = [...els.peopleForms.querySelectorAll("[data-person]")];
  if (!cards.length && silent) return [];

  return cards.map((card, index) => ({
    name: `第 ${index + 1} 人`,
    requirements: [...card.querySelectorAll("[data-requirement-row]")].map((row) => {
      const type = row.querySelector("[data-requirement-type]").value;
      const category = row.querySelector("[data-category]").value;
      const quantity = Number(row.querySelector("[data-quantity]").value) || 0;
      return type === "broad"
        ? { type: "broad", category, quantity }
        : { type: "exact", category, productKey: row.querySelector("[data-product]").value, quantity };
    }).filter((requirement) => requirement.quantity > 0)
  }));
}

function calculateBestDeal() {
  const people = readPeopleRequirements();
  const usableCoupons = state.coupons.filter((coupon) => !coupon.unknownItems?.length || Object.keys(coupon.items ?? {}).length);
  state.alternativeVisibleCount = 5;
  const result = optimizeCoupons({ people }, usableCoupons, { alternativeLimit: 12, now: state.now });
  const similarCoupons = result.similarCoupons ?? (result.missingRequirements?.length ? findSimilarCoupons({ people }, usableCoupons, { now: state.now }) : []);
  state.lastResult = result;
  state.lastPeople = people;
  renderResult(result, people, similarCoupons);
}

function renderResult(result, people, similarCoupons = []) {
  const bestPlan = result.bestPlan ?? result;
  const alternatives = result.alternativePlans ?? [];
  const visibleAlternatives = alternatives.slice(0, state.alternativeVisibleCount);
  const moreButton = alternatives.length > visibleAlternatives.length
    ? `<button class="secondary" type="button" data-show-more-plans>顯示更多方案</button>`
    : "";
  const similar = similarCoupons.length
    ? `
      <section>
        <h3>相似推薦</h3>
        <ul class="mini-list">
          ${similarCoupons.map((coupon) => `<li>${escapeHtml(coupon.code)}，$${coupon.price}，相似度 ${Math.round(coupon.similarity * 100)}%，符合 ${formatItems(coupon.matchedItems)}</li>`).join("")}
        </ul>
      </section>
    `
    : "";

  els.result.innerHTML = `
    <div class="result-panel">
      ${renderPlan(bestPlan, people, { title: "最佳方案摘要", rank: 1, isBest: true })}
      ${visibleAlternatives.length ? `
        <section class="alternative-plans">
          <h3>其他可行方案</h3>
          ${visibleAlternatives.map((plan, index) => renderPlan(plan, people, { title: `方案 ${index + 2}`, rank: index + 2, bestPrice: bestPlan.totalPrice })).join("")}
          ${moreButton}
        </section>
      ` : ""}
      ${similar}
    </div>
  `;

  els.result.querySelector("[data-show-more-plans]")?.addEventListener("click", () => {
    state.alternativeVisibleCount += 5;
    renderResult(result, people, similarCoupons);
  });
}

function renderPlan(plan, people, { title, rank, bestPrice = null, isBest = false } = {}) {
  const delta = bestPrice === null ? "" : `<span class="muted">比最佳方案貴 $${Math.max(0, plan.totalPrice - bestPrice)}</span>`;
  const totalCouponCount = plan.selectedCoupons.reduce((sum, coupon) => sum + coupon.quantity, 0);
  const hasExtraItems = Object.keys(plan.extraItems ?? {}).length > 0;

  return `
    <article class="plan-card ${isBest ? "best-plan-card" : "alternative-plan-card"}">
      <div class="plan-heading">
        <div>
          ${isBest ? `<span class="plan-label">最佳方案</span>` : `<span class="plan-label muted-label">其他方案</span>`}
          <h3>${escapeHtml(title ?? `方案 ${rank ?? ""}`)}</h3>
          ${delta}
        </div>
        <p class="price plan-price"><span>總金額</span>$${plan.totalPrice}</p>
      </div>
      ${isBest ? `
        <section class="summary-strip">
          <span>使用優惠券 ${totalCouponCount} 張</span>
          <span>${hasExtraItems ? "有多買品項" : "沒有多買品項"}</span>
          <span>${plan.missingRequirements?.length ? "有無法滿足項目" : "需求皆可滿足"}</span>
        </section>
        ${hasExtraItems ? `<p class="best-extra-note">此方案雖然有多買品項，但總價最低，因此列為最佳方案。</p>` : ""}
      ` : ""}
      <section>
        <h3>推薦購買</h3>
        ${plan.selectedCoupons.length ? plan.selectedCoupons.map(renderSelectedCoupon).join("") : `<p class="muted">目前沒有找到可滿足需求的組合。</p>`}
      </section>
      <section>
        <h3>需求滿足明細</h3>
        ${renderAssignment(plan.assignment ?? [], people)}
      </section>
      <section class="result-grid compact">
        <div>
          <h3>多買品項</h3>
          <p>${formatItems(plan.extraItems)}</p>
        </div>
        <div>
          <h3>無法滿足品項</h3>
          <p>${renderMissingRequirements(plan.missingRequirements ?? [])}</p>
        </div>
      </section>
    </article>
  `;
}

function renderSelectedCoupon(coupon) {
  return `
    <article class="coupon-purchase">
      <h4>優惠券 ${escapeHtml(coupon.code)}｜${escapeHtml(coupon.title ?? "")}</h4>
      <div class="purchase-meta">
        <span>單價：$${coupon.unitPrice ?? coupon.price}</span>
        <span>數量：${coupon.quantity}</span>
        <span>小計：$${coupon.subtotal ?? (coupon.price * coupon.quantity)}</span>
        ${coupon.endDate ? `<span>期限：${escapeHtml(coupon.endDate)}</span>` : ""}
      </div>
      <div>
        <strong>優惠內容：</strong>
        ${renderItemDetails(coupon.displayItems)}
      </div>
    </article>
  `;
}

function renderAssignment(assignment, people) {
  if (!assignment.length) return `<p class="muted">無</p>`;
  return people.map((person, index) => {
    const entries = assignment.filter((entry) => entry.personIndex === index + 1);
    return `
      <div class="assignment-person">
        <h4>${escapeHtml(person.name ?? `第 ${index + 1} 人`)}</h4>
        <ul class="mini-list">
          ${entries.map((entry) => `
            <li>
              需求：${escapeHtml(requirementLabel(entry))} x ${entry.quantity}<br />
              實際分配：${entry.assignedItems.length ? entry.assignedItems.map((item) => `${escapeHtml(item.label)} x ${item.quantity}`).join("、") : "無"}<br />
              來源：${entry.assignedItems.length ? [...new Set(entry.assignedItems.map((item) => item.couponCode))].map(escapeHtml).join("、") : "無"}
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }).join("");
}

function renderMissingRequirements(requirements) {
  if (!requirements.length) return "無";
  return requirements.map((requirement) => `${requirementLabel(requirement)} x ${requirement.quantity}`).join("、");
}

function renderItemDetails(items = []) {
  const details = Array.isArray(items) ? items : itemObjectToDetails(items);
  if (!details.length) return "無";
  return `<ul class="mini-list">${details.map((item) => `<li>${escapeHtml(item.label ?? productLabel(item.productKey))} x ${item.quantity}</li>`).join("")}</ul>`;
}

function itemObjectToDetails(items = {}) {
  return Object.entries(canonicalizeItems(items)).map(([productKey, quantity]) => ({
    productKey,
    label: productLabel(productKey),
    quantity
  }));
}

function countCouponsForItem(filter) {
  return state.coupons.filter((coupon) => couponMatchesItemFilters(coupon, [filter.id])).length;
}

function formatDateTime(value) {
  if (!value) return "未提供資料時間";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

init();
