import { catalogOptions, PRODUCT_CATALOG, productLabel } from "./lib/productNormalizer.js";
import { enrichCoupon, isCouponCurrentlyAvailable } from "./lib/couponParser.js";
import { allocateToPeople, formatItems, optimizeCoupons } from "./lib/optimizer.js";

const state = {
  data: { lastUpdated: null, coupons: [] },
  coupons: [],
  people: []
};

const els = {
  lastUpdated: document.querySelector("#last-updated"),
  search: document.querySelector("#search"),
  category: document.querySelector("#category"),
  maxPrice: document.querySelector("#max-price"),
  sort: document.querySelector("#sort"),
  couponCount: document.querySelector("#coupon-count"),
  couponList: document.querySelector("#coupon-list"),
  personCount: document.querySelector("#person-count"),
  buildPeople: document.querySelector("#build-people"),
  peopleForms: document.querySelector("#people-forms"),
  calculate: document.querySelector("#calculate"),
  result: document.querySelector("#result")
};

async function init() {
  await loadCoupons();
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
  [els.search, els.category, els.maxPrice, els.sort].forEach((el) => el.addEventListener("input", renderCoupons));
  els.buildPeople.addEventListener("click", buildPeopleForms);
  els.calculate.addEventListener("click", calculateBestDeal);
}

function renderCoupons() {
  const query = els.search.value.trim().toLowerCase();
  const category = els.category.value;
  const maxPrice = Number(els.maxPrice.value);

  const filtered = state.coupons
    .filter((coupon) => {
      const haystack = `${coupon.code} ${coupon.title} ${coupon.description} ${JSON.stringify(coupon.rawItems)}`.toLowerCase();
      const categories = Object.keys(coupon.items ?? {}).map((key) => PRODUCT_CATALOG[key]?.category);
      return (
        (!query || haystack.includes(query)) &&
        (!category || categories.includes(category)) &&
        (!els.maxPrice.value || Number(coupon.price) <= maxPrice)
      );
    })
    .sort(sortCoupons);

  els.couponCount.textContent = `${filtered.length} 張`;
  els.couponList.innerHTML = filtered.length ? filtered.map(renderCouponCard).join("") : `<p class="muted">目前沒有符合條件的優惠券。</p>`;
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
  const result = optimizeCoupons(demand, state.coupons.filter((coupon) => !coupon.unknownItems?.length || Object.keys(coupon.items ?? {}).length));
  const allocation = allocateToPeople(people, result.providedItems);
  renderResult(result, allocation);
}

function renderResult(result, allocation) {
  const coupons = result.selectedCoupons.length
    ? `<ul class="mini-list">${result.selectedCoupons.map((coupon) => `<li>${escapeHtml(coupon.code)} x ${coupon.quantity}，$${coupon.price}/份 ${escapeHtml(coupon.title ?? "")}</li>`).join("")}</ul>`
    : `<p class="muted">目前沒有可推薦的優惠券組合。</p>`;

  els.result.innerHTML = `
    <div class="result-panel">
      <div>
        <h3>推薦組合</h3>
        <p class="price">$${result.totalPrice}</p>
        ${coupons}
      </div>
      <div class="result-grid">
        <div>
          <h3>可滿足品項</h3>
          <p>${formatItems(result.providedItems)}</p>
        </div>
        <div>
          <h3>多出品項</h3>
          <p>${formatItems(result.extraItems)}</p>
        </div>
        <div>
          <h3>無法滿足品項</h3>
          <p>${formatItems(result.missingItems)}</p>
        </div>
      </div>
      <div>
        <h3>個人分配</h3>
        <ul class="mini-list">
          ${allocation.people.map((person) => `<li>第 ${person.personIndex} 人：${formatItems(person.assigned)}${Object.keys(person.missing).length ? `；缺少 ${formatItems(person.missing)}` : ""}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function formatDateTime(value) {
  if (!value) return "尚未產生資料";
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

init();
