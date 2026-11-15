
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ALLOWED_EMAILS = [
  "mmdowhe@gmail.com",
  "hossein5khezri@gmail.com"
];

const OFFLINE_PRODUCTS_KEY = "inventory_offline_products";
const OFFLINE_USER_KEY = "inventory_offline_user";

let currentUser = null;
let products = [];
let sales = [];
let options = [];
let dirhamRate = 0;
let offlineMode = false;

const $ = id => document.getElementById(id);

// ---------------- ذخیره‌سازی آفلاین ----------------

function saveOfflineProducts(items) {
  try {
    localStorage.setItem(OFFLINE_PRODUCTS_KEY, JSON.stringify(items));
  } catch (error) {
    console.error("ذخیره محصولات ناموفق بود:", error);
  }
}

function getOfflineProducts() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_PRODUCTS_KEY) || "[]");
  } catch {
    return [];
  }
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 150000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return Array.from(new Uint8Array(bits))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function saveOfflineLogin(email, password, userId) {
  const salt = crypto.randomUUID();
  const passwordHash = await hashPassword(password, salt);

  localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify({
    email,
    userId,
    salt,
    passwordHash
  }));
}

async function verifyOfflineLogin(email, password) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(OFFLINE_USER_KEY) || "null"
    );

    if (!saved || saved.email !== email) return null;

    const hash = await hashPassword(password, saved.salt);

    if (hash !== saved.passwordHash) return null;

    return {
      id: saved.userId,
      email: saved.email
    };
  } catch (error) {
    console.error("خطای ورود آفلاین:", error);
    return null;
  }
}

// ---------------- ابزارهای عمومی ----------------

function setConnectionStatus(message) {
  if ($("onlineStatus")) {
    $("onlineStatus").textContent = message;
  }
}

function money(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

function digits(value) {
  return Number(String(value || "").replace(/[^\d.-]/g, "")) || 0;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function localDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function today() {
  return localDate(new Date());
}

function showMessage(id, message) {
  if ($(id)) $(id).textContent = message;
}

function showPage(pageId) {
  document.querySelectorAll(".content .page").forEach(page => {
    page.classList.toggle("hidden", page.id !== pageId);
  });

  document.querySelectorAll(".navbtn").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (pageId === "dashboardPage") renderDashboard();
  if (pageId === "salesPage") renderSales();
  if (pageId === "archivePage") renderArchive();
  if (pageId === "categoriesPage") renderCategoriesPage();
}

function costPrice(product) {
  const buy = Number(product.buy_price || 0);
  const freight = Number(product.freight || 0);

  if (product.purchase_type === "dirham") {
    return buy * dirhamRate + freight;
  }

  return buy + freight;
}

function sellingPrice(product) {
  const cost = costPrice(product);
  const profit = Number(product.profit_value || 0);

  if (product.profit_type === "percent") {
    return Math.round(cost * (1 + profit / 100));
  }

  return Math.round(cost + profit);
}

function activeProducts() {
  return products.filter(p => p.is_active !== false);
}

function showApp() {
  $("login").style.display = "none";
  $("app").classList.remove("hidden");
  showPage("productsPage");
}

function showLogin() {
  $("login").style.display = "flex";
  $("app").classList.add("hidden");
}

// ---------------- ورود و خروج ----------------

async function login() {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (!ALLOWED_EMAILS.includes(email)) {
    showMessage("message", "این ایمیل اجازه ورود ندارد.");
    return;
  }

  if (!password) {
    showMessage("message", "رمز عبور را وارد کن.");
    return;
  }

  $("loginBtn").disabled = true;
  showMessage("message", "در حال ورود...");

  if (!navigator.onLine) {
    const offlineUser = await verifyOfflineLogin(email, password);

    $("loginBtn").disabled = false;

    if (!offlineUser) {
      showMessage(
        "message",
        "اطلاعات ورود آفلاین پیدا نشد یا رمز اشتباه است. ابتدا با اینترنت وارد شو."
      );
      return;
    }

    currentUser = offlineUser;
    offlineMode = true;

    products = getOfflineProducts();

    if (!products.length) {
      showMessage("message", "محصولی قبلاً ذخیره نشده است. یک بار آنلاین وارد شو.");
      return;
    }

    renderProducts();
    renderArchive();
    renderDashboard();
    renderCategoriesPage();

    setConnectionStatus("● آفلاین");
    showApp();
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      $("loginBtn").disabled = false;
      showMessage("message", "خطا در ورود: " + error.message);
      return;
    }

    currentUser = data.user;
    offlineMode = false;

    await saveOfflineLogin(email, password, currentUser.id);

    await refreshAll();
    $("loginBtn").disabled = false;

    setConnectionStatus("● آنلاین");
    showApp();

  } catch (error) {
    $("loginBtn").disabled = false;
    showMessage("message", "اتصال برقرار نشد. اگر قبلاً آنلاین وارد شده‌ای، اینترنت را خاموش کن و دوباره تلاش کن.");
    console.error(error);
  }
}

async function logout() {
  if (navigator.onLine) {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error(error);
    }
  }

  currentUser = null;
  products = [];
  sales = [];
  options = [];
  offlineMode = false;

  showLogin();
}

async function checkSession() {
  if (!navigator.onLine) {
    showLogin();
    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    showLogin();
    return;
  }

  currentUser = data.session.user;

  if (!ALLOWED_EMAILS.includes(currentUser.email.toLowerCase())) {
    await logout();
    return;
  }

  offlineMode = false;
  await refreshAll();
  showApp();
}

// ---------------- دریافت اطلاعات ----------------

async function loadProducts() {
  if (!navigator.onLine || offlineMode) {
    products = getOfflineProducts();
    renderProducts();
    renderArchive();
    renderCategoriesPage();
    return;
  }

  const { data, error } = await supabase
    .from("inventory_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("خطای دریافت محصولات:", error);

    products = getOfflineProducts();
    renderProducts();
    renderArchive();
    renderCategoriesPage();

    return;
  }

  products = data || [];
  saveOfflineProducts(products);

  renderProducts();
  renderArchive();
  renderCategoriesPage();
}

async function loadSales() {
  if (!navigator.onLine || offlineMode) {
    sales = [];
    renderSales();
    return;
  }

  const { data, error } = await supabase
    .from("inventory_sale_events")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("خطای دریافت فروش‌ها:", error);
    return;
  }

  sales = data || [];
  renderSales();
}

async function loadRate() {
  if (!navigator.onLine || offlineMode) return;

  const { data, error } = await supabase
    .from("inventory_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("خطای دریافت نرخ:", error);
    return;
  }

  dirhamRate = Number(data?.dirham_rate || 0);

  if ($("rate")) {
    $("rate").value = dirhamRate || "";
  }
}

async function loadOptions() {
  if (!navigator.onLine || offlineMode) {
    renderOptionSelects();
    renderOptionLists();
    renderCategoriesPage();
    return;
  }

  const { data, error } = await supabase
    .from("inventory_options")
    .select("*")
    .order("option_name", { ascending: true });

  if (error) {
    console.error("خطای دریافت گزینه‌ها:", error);
    showMessage("optionsMessage", "خطا در دریافت گزینه‌ها: " + error.message);
    return;
  }

  options = data || [];
  renderOptionSelects();
  renderOptionLists();
  renderCategoriesPage();
}

async function refreshAll() {
  if (!navigator.onLine || offlineMode) {
    products = getOfflineProducts();
    renderProducts();
    renderArchive();
    renderDashboard();
    renderSales();
    renderCategoriesPage();
    setConnectionStatus("● آفلاین");
    return;
  }

  await Promise.all([
    loadProducts(),
    loadSales(),
    loadRate(),
    loadOptions()
  ]);

  renderProducts();
  renderDashboard();
  renderSales();
  renderArchive();
  renderCategoriesPage();
}

// ---------------- نمایش محصولات ----------------

function createProductCard(p) {
  return `
    <article class="product">
      <div class="product-info">
        <h3>${esc(p.name)}</h3>

        <div class="meta">
          ${esc(p.brand || "بدون برند")}
          ·
          ${esc(p.category || "بدون دسته‌بندی")}
          <br>
          مدل: ${esc(p.tag || "ثبت نشده")}
        </div>

        <div class="price">
          ${money(sellingPrice(p))} تومان
        </div>

        <div class="stock">
          موجودی: ${money(p.quantity)}
        </div>

        <div class="product-actions">
          ${offlineMode ? `
            <span class="meta">نمایش آفلاین</span>
          ` : `
            <button class="btn small" data-sell="${esc(String(p.id))}">
              فروش
            </button>

            <button class="btn dark small" data-edit="${esc(String(p.id))}">
              ویرایش
            </button>

            <button class="btn red small" data-archive="${esc(String(p.id))}">
              بایگانی
            </button>
          `}
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const container = $("products");
  if (!container) return;

  const query = ($("search")?.value || "").trim().toLowerCase();

  const list = activeProducts().filter(p => {
    const text = [
      p.name,
      p.tag,
      p.brand,
      p.category
    ].join(" ").toLowerCase();

    return text.includes(query);
  });

  if (!list.length) {
    container.innerHTML = `
      <div class="empty">
        محصولی پیدا نشد.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(createProductCard).join("");
}

// ---------------- صفحه دسته‌بندی‌ها ----------------

function getCategoryNames() {
  const names = options
    .filter(o => o.option_type === "category")
    .map(o => String(o.option_name || "").trim())
    .filter(Boolean);

  activeProducts().forEach(product => {
    const category = String(product.category || "").trim();

    if (category && !names.some(
      name => name.toLowerCase() === category.toLowerCase()
    )) {
      names.push(category);
    }
  });

  return [...new Set(names)];
}

function renderCategoriesPage() {
  const cards = $("categoryCards");
  const container = $("categoryProducts");

  if (!cards || !container) return;

  const categoryNames = getCategoryNames();
  const filter = $("categoryFilter");

  const previousValue = filter?.value || "";

  if (filter) {
    filter.innerHTML = `
      <option value="">همه دسته‌بندی‌ها</option>
      ${categoryNames.map(name => `
        <option value="${esc(name)}">${esc(name)}</option>
      `).join("")}
    `;

    const exists = categoryNames.some(
      name => name === previousValue
    );

    filter.value = exists ? previousValue : "";
  }

  const selectedCategory = filter?.value || "";

  if (!categoryNames.length) {
    cards.innerHTML = `
      <div class="empty">
        هنوز دسته‌بندی‌ای ثبت نشده است.
        از قسمت مدیریت گزینه‌ها یک دسته‌بندی اضافه کن.
      </div>
    `;
  } else {
    cards.innerHTML = categoryNames.map(name => {
      const count = activeProducts().filter(product =>
        String(product.category || "").trim() === name
      ).length;

      const selected = selectedCategory === name;

      return `
        <button
          type="button"
          class="category-card ${selected ? "active" : ""}"
          data-category="${esc(name)}"
        >
          <strong>${esc(name)}</strong>
          <span>${money(count)} محصول</span>
        </button>
      `;
    }).join("");
  }

  const filteredProducts = selectedCategory
    ? activeProducts().filter(product =>
        String(product.category || "").trim() === selectedCategory
      )
    : activeProducts();

  if ($("selectedCategoryTitle")) {
    $("selectedCategoryTitle").textContent =
      selectedCategory || "همه محصولات";
  }

  if (!filteredProducts.length) {
    container.innerHTML = `
      <div class="empty">
        ${selectedCategory
          ? "در این دسته‌بندی محصولی ثبت نشده است."
          : "هنوز محصولی ثبت نشده است."}
      </div>
    `;
    return;
  }

  container.innerHTML = filteredProducts
    .map(createProductCard)
    .join("");
}

// ---------------- فرم محصول ----------------

function openProductForm(product = null) {
  if (offlineMode || !navigator.onLine) {
    alert("در حالت آفلاین امکان تغییر محصولات وجود ندارد.");
    return;
  }

  $("productForm").reset();
  $("pid").value = product?.id || "";
  $("formTitle").textContent = product ? "ویرایش محصول" : "افزودن محصول";

  $("name").value = product?.name || "";
  $("category").value = product?.category || "";
  $("brand").value = product?.brand || "";
  $("tag").value = product?.tag || "";
  $("purchaseType").value = product?.purchase_type || "toman";
  $("buyPrice").value = product?.buy_price ?? "";
  $("freight").value = product?.freight ?? 0;
  $("profitType").value = product?.profit_type || "fixed";
  $("profitValue").value = product?.profit_value ?? 0;
  $("quantity").value = product?.quantity ?? 1;
  $("description").value = product?.description || "";

  showMessage("formMessage", "");

  $("productModal").classList.add("show");
}

function closeProductForm() {
  $("productModal").classList.remove("show");
}

// ---------------- ذخیره محصول ----------------

async function saveProduct(event) {
  event.preventDefault();

  if (offlineMode || !navigator.onLine) {
    showMessage("formMessage", "برای ذخیره محصول باید اینترنت وصل باشد.");
    return;
  }

  const id = $("pid").value;
  const submitButton = $("productForm").querySelector('[type="submit"]');

  const payload = {
    name: $("name").value.trim(),
    category: $("category").value,
    brand: $("brand").value,
    tag: $("tag").value.trim(),
    purchase_type: $("purchaseType").value,
    buy_price: digits($("buyPrice").value),
    freight: digits($("freight").value),
    profit_type: $("profitType").value,
    profit_value: digits($("profitValue").value),
    quantity: digits($("quantity").value),
    description: $("description").value.trim(),
    updated_at: new Date().toISOString()
  };

  if (!payload.name) {
    showMessage("formMessage", "نام محصول را وارد کن.");
    return;
  }

  if (payload.purchase_type === "dirham" && !dirhamRate) {
    showMessage("formMessage", "ابتدا نرخ درهم را در داشبورد ثبت کن.");
    return;
  }

  if (submitButton) submitButton.disabled = true;

  try {
    showMessage("formMessage", "در حال ذخیره محصول...");

    let result;

    if (id) {
      result = await supabase
        .from("inventory_products")
        .update(payload)
        .eq("id", id);
    } else {
      payload.user_id = currentUser.id;
      payload.is_active = true;

      result = await supabase
        .from("inventory_products")
        .insert(payload);
    }

    if (result.error) {
      throw new Error(result.error.message);
    }

    showMessage("formMessage", "محصول با موفقیت ذخیره شد.");

    await loadProducts();
    renderDashboard();
    renderCategoriesPage();

    closeProductForm();

  } catch (error) {
    console.error("خطای ذخیره محصول:", error);
    showMessage("formMessage", "خطا: " + error.message);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

// ---------------- بایگانی محصولات ----------------

async function archiveProduct(id) {
  if (offlineMode || !navigator.onLine) {
    alert("برای بایگانی محصول باید اینترنت وصل باشد.");
    return;
  }

  if (!confirm("این کالا به بایگانی منتقل شود؟")) return;

  const { error } = await supabase
    .from("inventory_products")
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    alert("خطا در بایگانی: " + error.message);
    return;
  }

  await loadProducts();
  renderDashboard();
}

async function restoreProduct(id) {
  if (offlineMode || !navigator.onLine) {
    alert("برای بازگردانی محصول باید اینترنت وصل باشد.");
    return;
  }

  const { error } = await supabase
    .from("inventory_products")
    .update({
      is_active: true,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    alert("خطا در بازگردانی: " + error.message);
    return;
  }

  await loadProducts();
  renderArchive();
}

function renderArchive() {
  const container = $("archivedProducts");
  if (!container) return;

  const list = products.filter(p => p.is_active === false);

  if (!list.length) {
    container.innerHTML = '<div class="empty">بایگانی خالی است.</div>';
    return;
  }

  container.innerHTML = list.map(p => `
    <article class="product">
      <div class="product-info">
        <h3>${esc(p.name)}</h3>
        <div class="meta">
          ${esc(p.brand || "بدون برند")}
          ·
          ${esc(p.category || "بدون دسته‌بندی")}
          <br>
          مدل: ${esc(p.tag || "ثبت نشده")}
        </div>
        <div class="price">${money(sellingPrice(p))} تومان</div>
        <div class="stock">موجودی: ${money(p.quantity)}</div>

        ${offlineMode ? "" : `
          <div class="product-actions">
            <button class="btn small" data-restore="${esc(String(p.id))}">
              بازگردانی
            </button>
          </div>
        `}
      </div>
    </article>
  `).join("");
}

// ---------------- ثبت فروش ----------------

async function sellProduct(id) {
  if (offlineMode || !navigator.onLine) {
    alert("برای ثبت فروش باید اینترنت وصل باشد.");
    return;
  }

  const product = products.find(p => String(p.id) === String(id));

  if (!product) return;

  if (Number(product.quantity) < 1) {
    alert("موجودی این کالا تمام شده است.");
    return;
  }

  const price = sellingPrice(product);

  if (!confirm(
    `ثبت فروش یک عدد از ${product.name}؟\nقیمت فروش: ${money(price)} تومان`
  )) return;

  const eventId = crypto.randomUUID();

  const { error } = await supabase.rpc("apply_inventory_sale", {
    p_event_id: eventId,
    p_product_id: product.id
  });

  if (error) {
    alert("ثبت فروش ناموفق بود: " + error.message);
    return;
  }

  await refreshAll();
  alert("فروش با موفقیت ثبت شد.");
}

async function cancelSale(eventId) {
  if (offlineMode || !navigator.onLine) {
    alert("برای لغو فروش باید اینترنت وصل باشد.");
    return;
  }

  if (!confirm("این فروش لغو شود و یک عدد به موجودی برگردد؟")) return;

  const { error } = await supabase.rpc("cancel_inventory_sale", {
    p_event_id: eventId
  });

  if (error) {
    alert("لغو فروش ناموفق بود: " + error.message);
    return;
  }

  await refreshAll();
  alert("فروش لغو شد.");
}

// ---------------- گزارش فروش ----------------

function salesForDate(date) {
  return sales.filter(s =>
    localDate(new Date(s.created_at)) === date &&
    !s.voided_at
  );
}

function groupSales(list, elementId) {
  const container = $(elementId);
  if (!container) return;

  const grouped = {};

  list.forEach(s => {
    const name = s.product_name || "کالای نامشخص";

    if (!grouped[name]) {
      grouped[name] = {
        count: 0,
        total: 0
      };
    }

    grouped[name].count++;
    grouped[name].total += Number(s.sale_price || 0);
  });

  const entries = Object.entries(grouped)
    .sort((a, b) => b[1].count - a[1].count);

  if (!entries.length) {
    container.innerHTML = '<div class="empty">فروشی ثبت نشده است.</div>';
    return;
  }

  container.innerHTML = entries.map(([name, item]) => `
    <div class="option-row">
      <span>${esc(name)}</span>
      <span>${money(item.count)} عدد</span>
      <strong>${money(item.total)} تومان</strong>
    </div>
  `).join("");
}

function renderDaily() {
  const date = $("dailyDate")?.value || today();
  const list = salesForDate(date);

  if ($("dailyCount")) {
    $("dailyCount").textContent = money(list.length);
  }

  if ($("dailyTotal")) {
    $("dailyTotal").textContent =
      money(list.reduce((sum, s) =>
        sum + Number(s.sale_price || 0), 0
      )) + " تومان";
  }

  groupSales(list, "dailyGroups");
}

function renderSales() {
  const rows = $("salesRows");
  if (!rows) return;

  const from = $("salesFrom")?.value || "";
  const to = $("salesTo")?.value || "";

  const list = sales.filter(s => {
    if (!s.created_at) return false;

    const day = localDate(new Date(s.created_at));

    return (!from || day >= from) && (!to || day <= to);
  });

  const valid = list.filter(s => !s.voided_at);

  if ($("salesCount")) {
    $("salesCount").textContent = money(valid.length);
  }

  if ($("salesTotal")) {
    $("salesTotal").textContent =
      money(valid.reduce((sum, s) =>
        sum + Number(s.sale_price || 0), 0
      )) + " تومان";
  }

  if (!list.length) {
    rows.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:25px">
          در این بازه فروشی ثبت نشده است.
        </td>
      </tr>
    `;
  } else {
    rows.innerHTML = list.map(s => {
      const canceled = Boolean(s.voided_at);

      return `
        <tr>
          <td>${esc(s.product_name || "فروش قدیمی")}</td>

          <td>
            ${s.sale_price == null
              ? "ثبت نشده"
              : money(s.sale_price) + " تومان"}
          </td>

          <td>
            ${new Date(s.created_at).toLocaleString("fa-IR")}
          </td>

          <td>${canceled ? "لغوشده" : "ثبت‌شده"}</td>

          <td>
            ${canceled || offlineMode
              ? "—"
              : `<button class="btn red small"
                    data-cancel="${esc(String(s.event_id))}">
                    لغو فروش
                 </button>`}
          </td>
        </tr>
      `;
    }).join("");
  }

  groupSales(valid, "salesByProduct");

  const grouped = {};

  valid.forEach(s => {
    const name = s.product_name || "کالای نامشخص";

    if (!grouped[name]) {
      grouped[name] = { name, count: 0, total: 0 };
    }

    grouped[name].count++;
    grouped[name].total += Number(s.sale_price || 0);
  });

  const ranking = Object.values(grouped)
    .sort((a, b) => b.count - a.count || b.total - a.total);

  if ($("topSellerName")) {
    $("topSellerName").textContent =
      ranking.length ? ranking[0].name : "فروشی ثبت نشده";
  }

  if ($("topSellerCount")) {
    $("topSellerCount").textContent =
      ranking.length ? money(ranking[0].count) + " عدد فروش" : "۰";
  }

  if ($("topSellerTotal")) {
    $("topSellerTotal").textContent =
      ranking.length ? money(ranking[0].total) + " تومان" : "۰ تومان";
  }

  if ($("topSellerRanking")) {
    $("topSellerRanking").innerHTML = ranking.length
      ? ranking.map((p, i) => `
          <div class="option-row">
            <span>${i + 1}. ${esc(p.name)}</span>
            <span>${money(p.count)} عدد</span>
            <strong>${money(p.total)} تومان</strong>
          </div>
        `).join("")
      : '<div class="empty">در این بازه فروشی ثبت نشده است.</div>';
  }
}

// ---------------- داشبورد ----------------

function renderDashboard() {
  const active = activeProducts();

  if ($("statProducts")) {
    $("statProducts").textContent = money(active.length);
  }

  if ($("statStock")) {
    $("statStock").textContent = money(
      active.reduce((sum, p) => sum + Number(p.quantity || 0), 0)
    );
  }

  if ($("statValue")) {
    $("statValue").textContent =
      money(active.reduce((sum, p) =>
        sum + costPrice(p) * Number(p.quantity || 0), 0
      )) + " تومان";
  }

  const validSales = sales.filter(s => !s.voided_at);

  if ($("statSales")) {
    $("statSales").textContent = money(validSales.length);
  }

  const grouped = {};

  validSales.forEach(s => {
    const name = s.product_name || "کالای نامشخص";
    grouped[name] = (grouped[name] || 0) + 1;
  });

  const ranking = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if ($("dashboardTop")) {
    $("dashboardTop").innerHTML = ranking.length
      ? ranking.map(([name, count], i) => `
          <div class="option-row">
            <span>${i + 1}. ${esc(name)}</span>
            <strong>${money(count)} فروش</strong>
          </div>
        `).join("")
      : '<div class="empty">هنوز فروشی ثبت نشده است.</div>';
  }
}

async function saveRate() {
  if (offlineMode || !navigator.onLine) {
    alert("برای ذخیره نرخ باید اینترنت وصل باشد.");
    return;
  }

  const rate = digits($("rate").value);

  if (rate <= 0) {
    alert("نرخ معتبر وارد کن.");
    return;
  }

  const { data: existing, error: readError } = await supabase
    .from("inventory_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (readError) {
    alert("خطا در خواندن تنظیمات: " + readError.message);
    return;
  }

  let result;

  if (existing) {
    result = await supabase
      .from("inventory_settings")
      .update({ dirham_rate: rate })
      .eq("id", existing.id);
  } else {
    result = await supabase
      .from("inventory_settings")
      .insert({ dirham_rate: rate });
  }

  if (result.error) {
    alert("ثبت نرخ ناموفق بود: " + result.error.message);
    return;
  }

  dirhamRate = rate;
  renderProducts();
  renderDashboard();
  renderCategoriesPage();

  alert("نرخ درهم ذخیره شد.");
}

// ---------------- برندها و دسته‌بندی‌ها ----------------

function renderOptionSelects() {
  const brands = options.filter(o => o.option_type === "brand");
  const categories = options.filter(o => o.option_type === "category");

  const oldBrand = $("brand")?.value || "";
  const oldCategory = $("category")?.value || "";

  if ($("brand")) {
    $("brand").innerHTML =
      '<option value="">انتخاب برند</option>' +
      brands.map(o =>
        `<option value="${esc(o.option_name)}">${esc(o.option_name)}</option>`
      ).join("");

    $("brand").value = oldBrand;
  }

  if ($("category")) {
    $("category").innerHTML =
      '<option value="">انتخاب دسته‌بندی</option>' +
      categories.map(o =>
        `<option value="${esc(o.option_name)}">${esc(o.option_name)}</option>`
      ).join("");

    $("category").value = oldCategory;
  }
}

function renderOptionLists() {
  const brands = options.filter(o => o.option_type === "brand");
  const categories = options.filter(o => o.option_type === "category");

  if ($("brandOptions")) {
    $("brandOptions").innerHTML = brands.map(o => `
      <div class="option-row">
        <span>${esc(o.option_name)}</span>
        <button class="btn red small" data-delete-option="${esc(String(o.id))}">حذف</button>
      </div>
    `).join("");
  }

  if ($("categoryOptions")) {
    $("categoryOptions").innerHTML = categories.map(o => `
      <div class="option-row">
        <span>${esc(o.option_name)}</span>
        <button class="btn red small" data-delete-option="${esc(String(o.id))}">حذف</button>
      </div>
    `).join("");
  }
}

async function addOption(type) {
  if (offlineMode || !navigator.onLine) {
    alert("برای افزودن گزینه باید اینترنت وصل باشد.");
    return;
  }

  if (!currentUser) {
    showMessage("optionsMessage", "ابتدا وارد حساب کاربری شو.");
    return;
  }

  const input = type === "brand" ? $("newBrand") : $("newCategory");

  if (!input) {
    showMessage("optionsMessage", "فیلد ورود اطلاعات پیدا نشد.");
    return;
  }

  const name = input.value.trim();

  if (!name) {
    showMessage("optionsMessage", "نام را وارد کن.");
    return;
  }

  const duplicate = options.some(o =>
    o.option_type === type &&
    String(o.option_name || "").toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    showMessage("optionsMessage", "این مورد قبلاً ثبت شده است.");
    return;
  }

  showMessage("optionsMessage", "در حال ثبت...");

  const { error } = await supabase
    .from("inventory_options")
    .insert({
      user_id: currentUser.id,
      option_type: type,
      option_name: name
    });

  if (error) {
    showMessage("optionsMessage", "خطا: " + error.message);
    console.error("خطای افزودن گزینه:", error);
    return;
  }

  input.value = "";
  showMessage("optionsMessage", "با موفقیت ثبت شد.");

  await loadOptions();
}

async function deleteOption(id) {
  if (offlineMode || !navigator.onLine) {
    alert("برای حذف گزینه باید اینترنت وصل باشد.");
    return;
  }

  if (!confirm("این گزینه حذف شود؟")) return;

  const { error } = await supabase
    .from("inventory_options")
    .delete()
    .eq("id", id);

  if (error) {
    alert("خطا در حذف: " + error.message);
    return;
  }

  await loadOptions();
}

// ---------------- رویدادهای صفحه ----------------

$("loginBtn").addEventListener("click", login);

$("password").addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});

$("logout").addEventListener("click", logout);

$("search").addEventListener("input", renderProducts);

$("addProductBtn").addEventListener("click", () => openProductForm());

$("sync").addEventListener("click", refreshAll);

$("productForm").addEventListener("submit", saveProduct);

$("closeProductModal").addEventListener("click", closeProductForm);
$("cancelEdit").addEventListener("click", closeProductForm);

$("saveRate").addEventListener("click", saveRate);

if ($("dailyDate")) {
  $("dailyDate").value = today();
}

$("dailyFilter").addEventListener("click", renderDaily);

$("dailyTab").addEventListener("click", () => {
  $("dailyReport").classList.remove("hidden");
  $("ledger").classList.add("hidden");

  $("dailyTab").className = "btn";
  $("ledgerTab").className = "btn dark";

  renderDaily();
});

$("ledgerTab").addEventListener("click", () => {
  $("ledger").classList.remove("hidden");
  $("dailyReport").classList.add("hidden");

  $("ledgerTab").className = "btn";
  $("dailyTab").className = "btn dark";

  renderSales();
});

$("filterSales").addEventListener("click", event => {
  event.preventDefault();

  const from = $("salesFrom").value;
  const to = $("salesTo").value;

  if (from && to && from > to) {
    alert("تاریخ شروع نباید بعد از تاریخ پایان باشد.");
    return;
  }

  renderSales();
});

$("manageOptionsBtn").addEventListener("click", () => {
  if (offlineMode) {
    alert("مدیریت گزینه‌ها در حالت آفلاین در دسترس نیست.");
    return;
  }

  $("optionsModal").classList.add("show");
});

$("closeOptions").addEventListener("click", () => {
  $("optionsModal").classList.remove("show");
});

$("addBrand").addEventListener("click", () => addOption("brand"));

$("addCategory").addEventListener("click", () => addOption("category"));

if ($("categoryFilter")) {
  $("categoryFilter").addEventListener("change", renderCategoriesPage);
}

if ($("showAllCategories")) {
  $("showAllCategories").addEventListener("click", () => {
    if ($("categoryFilter")) {
      $("categoryFilter").value = "";
    }

    renderCategoriesPage();
  });
}

document.addEventListener("click", async event => {
  const target = event.target;

  const nav = target.closest(".navbtn");
  if (nav) {
    event.preventDefault();
    showPage(nav.dataset.page);
    return;
  }

  const categoryButton = target.closest("[data-category]");
  if (categoryButton) {
    const categoryName = categoryButton.dataset.category;

    if ($("categoryFilter")) {
      $("categoryFilter").value = categoryName;
    }

    renderCategoriesPage();
    return;
  }

  const edit = target.closest("[data-edit]");
  if (edit) {
    const product = products.find(p => String(p.id) === edit.dataset.edit);
    if (product) openProductForm(product);
    return;
  }

  const sell = target.closest("[data-sell]");
  if (sell) {
    await sellProduct(sell.dataset.sell);
    return;
  }

  const archive = target.closest("[data-archive]");
  if (archive) {
    await archiveProduct(archive.dataset.archive);
    return;
  }

  const restore = target.closest("[data-restore]");
  if (restore) {
    await restoreProduct(restore.dataset.restore);
    return;
  }

  const cancel = target.closest("[data-cancel]");
  if (cancel) {
    await cancelSale(cancel.dataset.cancel);
    return;
  }

  const deleteOptionButton = target.closest("[data-delete-option]");
  if (deleteOptionButton) {
    await deleteOption(deleteOptionButton.dataset.deleteOption);
  }
});

// ---------------- اتصال اینترنت ----------------

window.addEventListener("online", async () => {
  setConnectionStatus("● اینترنت وصل شد");

  if (currentUser && offlineMode) {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (!error && data.session) {
        currentUser = data.session.user;
        offlineMode = false;
        await refreshAll();
        setConnectionStatus("● آنلاین");
        renderProducts();
      }
    } catch (error) {
      console.error("اتصال مجدد ناموفق بود:", error);
    }
  }
});

window.addEventListener("offline", () => {
  setConnectionStatus("● آفلاین");
});

// ---------------- وضعیت ورود و شروع ----------------

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    showLogin();
  }
});

async function startApp() {
  setConnectionStatus(
    navigator.onLine ? "● در حال اتصال" : "● آفلاین"
  );

  try {
    if (navigator.onLine) {
      await checkSession();
      setConnectionStatus("● آنلاین");
    } else {
      showLogin();
      setConnectionStatus("● آفلاین");
    }
  } catch (error) {
    console.error("خطای شروع برنامه:", error);
    setConnectionStatus("● آفلاین");
    showLogin();
  }
}

startApp();
