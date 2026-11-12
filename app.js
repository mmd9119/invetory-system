
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ALLOWED_EMAILS = [
  "mmdowhe@gmail.com",
  "hossein5khezri@gmail.com"
];

const CATEGORIES = [
  "جاروبرقی و نظافت","لوازم آشپزخانه","سرخ‌کن و پخت‌وپز",
  "صوتی و تصویری","اسپیکر و هدفون","سرمایشی و گرمایشی",
  "روشنایی و چراغ شارژی","لوازم شخصی و اصلاح",
  "گجت و لوازم جانبی","ماساژور و سلامت","سایر محصولات"
];

const BRANDS = [
  "Philips","Xiaomi","Samsung","Sony","JBL",
  "Kenwood","Tefal","Sheglam","متفرقه"
];

const $ = id => document.getElementById(id);

let products = [];
let sales = [];
let dirhamRate = 0;
let editingProduct = null;
let realtimeChannel = null;
let refreshPromise = null;
let refreshQueued = false;
let realtimeTimer = null;
let imageCache = new Map();
let saving = false;
const sellingProducts = new Set();

/* ابزارهای عددی */

function digitsToEnglish(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function numberValue(value) {
  const normalized = digitsToEnglish(value)
    .replace(/[,\s٬،]/g, "")
    .replace(/[٫]/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function grouped(value, decimals = 0) {
  return (Number(value) || 0).toLocaleString("en-US", {
    maximumFractionDigits: decimals
  });
}

function faNumber(value) {
  return Number(value || 0).toLocaleString("fa-IR");
}

function formatMoney(value) {
  return faNumber(Math.round(Number(value) || 0)) + " تومان";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  }[c]));
}

function setMessage(id, message, error = false) {
  $(id).textContent = message;
  $(id).style.color = error ? "#d84c5b" : "#15966a";
}

/* انتخاب‌ها و صفحات */

function fillSelect(id, values) {
  const el = $(id);
  el.innerHTML = "";
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    el.append(option);
  });
}

function showApp() {
  $("login").style.display = "none";
  $("app").style.display = "block";
}

function showLogin() {
  $("login").style.display = "block";
  $("app").style.display = "none";
}

function goPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  if (pageId === "salesPage") renderSales();
  if (pageId === "reportsPage") renderReports();
  if (pageId === "archivePage") renderArchived();
}

/* محاسبه قیمت */

function costPrice(product) {
  const buy = Number(product.buy_price) || 0;
  const freight = Number(product.freight) || 0;

  // کرایه همیشه تومان است.
  return (product.purchase_type === "dirham"
    ? buy * dirhamRate
    : buy) + freight;
}

function sellingPrice(product) {
  const cost = costPrice(product);
  const profit = Number(product.profit_value) || 0;

  return product.profit_type === "percent"
    ? cost * (1 + profit / 100)
    : cost + profit;
}

/* عکس محصولات */

async function imageUrl(path) {
  if (!path) return "";
  if (imageCache.has(path)) return imageCache.get(path);

  const { data, error } = await db.storage
    .from("inventory-photos")
    .createSignedUrl(path, 3600);

  if (error) {
    console.error("خطای عکس:", error);
    return "";
  }

  imageCache.set(path, data.signedUrl);
  return data.signedUrl;
}

/* دریافت اطلاعات */

async function refresh() {
  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }

  refreshPromise = (async () => {
    do {
      refreshQueued = false;
      $("sync").textContent = "در حال دریافت اطلاعات...";

      const [productResult, settingsResult, salesResult] = await Promise.all([
        db.from("inventory_products")
          .select("*")
          .order("created_at", { ascending: false }),

        db.from("inventory_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle(),

        db.from("inventory_sale_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5000)
      ]);

      if (productResult.error) throw productResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (salesResult.error) throw salesResult.error;

      products = productResult.data || [];
      sales = salesResult.data || [];
      dirhamRate = Number(settingsResult.data?.dirham_rate) || 0;

      $("rate").value = dirhamRate ? grouped(dirhamRate, 2) : "";

      await renderAll();
      $("sync").textContent = "اطلاعات به‌روز است";

    } while (refreshQueued);
  })();

  try {
    await refreshPromise;
  } catch (error) {
    console.error("Refresh error:", error);
    $("sync").textContent = "خطا در دریافت اطلاعات: " + error.message;
  } finally {
    refreshPromise = null;
  }
}

function activeProducts() {
  return products.filter(p => p.is_active !== false);
}

function archivedProducts() {
  return products.filter(p => p.is_active === false);
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function todayKey() {
  return dayKey(new Date());
}

function validSales(list) {
  return list.filter(s => !s.voided_at);
}

function saleName(sale) {
  if (sale.product_name) return sale.product_name;
  const product = products.find(p => p.id === sale.product_id);
  return product?.name || "کالای قدیمی / نامشخص";
}

function salePrice(sale) {
  return sale.sale_price == null ? null : Number(sale.sale_price);
}

/* رندر همه بخش‌ها */

async function renderAll() {
  await renderProducts();
  renderDashboard();

  if ($("salesPage").classList.contains("active")) renderSales();
  if ($("reportsPage").classList.contains("active")) renderReports();
  if ($("archivePage").classList.contains("active")) renderArchived();
}

function renderDashboard() {
  const list = activeProducts();
  const stock = list.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  const inventoryValue = list.reduce(
    (sum, p) => sum + costPrice(p) * (Number(p.quantity) || 0), 0
  );

  const today = validSales(sales).filter(
    s => dayKey(s.created_at) === todayKey()
  );

  const todayTotal = today.reduce(
    (sum, s) => sum + (salePrice(s) ?? 0), 0
  );

  $("statProducts").textContent = faNumber(list.length);
  $("statStock").textContent = faNumber(stock);
  $("statToday").textContent = formatMoney(todayTotal);
  $("statTodayCount").textContent = `${faNumber(today.length)} فروش امروز`;
  $("statValue").textContent = formatMoney(inventoryValue);

  const recent = sales.slice(0, 6);

  if (!recent.length) {
    $("recentSales").innerHTML = '<div class="empty">هنوز فروشی ثبت نشده است.</div>';
    return;
  }

  $("recentSales").innerHTML = `
    <div class="table-wrap">
    <table>
      <thead><tr><th>کالا</th><th>زمان</th><th>مبلغ</th><th>وضعیت</th></tr></thead>
      <tbody>
      ${recent.map(s => `
        <tr>
          <td>${escapeHtml(saleName(s))}</td>
          <td>${new Date(s.created_at).toLocaleString("fa-IR")}</td>
          <td>${salePrice(s) == null ? "قیمت ثبت نشده" : formatMoney(s.sale_price)}</td>
          <td>${s.voided_at
            ? '<span class="stock zero">لغوشده</span>'
            : '<span class="stock">ثبت‌شده</span>'}</td>
        </tr>
      `).join("")}
      </tbody>
    </table>
    </div>`;
}

/* کارت کالا */

async function buildProductCard(product, archived = false) {
  const card = document.createElement("article");
  card.className = "product";

  const image = document.createElement("div");
  image.className = "product-image";

  if (product.image_path) {
    const url = await imageUrl(product.image_path);

    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = product.name || "محصول";
      image.append(img);
    } else {
      image.innerHTML = '<span class="no-image">▣</span>';
    }
  } else {
    image.innerHTML = '<span class="no-image">▣</span>';
  }

  const info = document.createElement("div");
  info.className = "product-info";

  const qty = Number(product.quantity) || 0;

  info.innerHTML = `
    <h3 title="${escapeHtml(product.name)}">${escapeHtml(product.name || "بدون نام")}</h3>
    <div class="product-meta">
      ${escapeHtml(product.category || "")}
      ${product.brand ? " · " + escapeHtml(product.brand) : ""}
      <br>${product.tag ? "مدل: " + escapeHtml(product.tag) : "بدون مدل"}
    </div>
    <div class="product-price">${formatMoney(sellingPrice(product))}</div>
    <span class="stock ${qty <= 0 ? "zero" : qty <= 3 ? "low" : ""}">
      موجودی: ${faNumber(qty)}
    </span>`;

  const actions = document.createElement("div");
  actions.className = "product-actions";

  if (archived) {
    const restore = document.createElement("button");
    restore.className = "sell-btn";
    restore.textContent = "بازگرداندن کالا";
    restore.onclick = () => setArchive(product, false);
    actions.append(restore);
  } else {
    const sell = document.createElement("button");
    sell.className = "sell-btn";
    sell.textContent = sellingProducts.has(product.id) ? "در حال ثبت..." : "فروش رفت";
    sell.disabled = qty <= 0 || sellingProducts.has(product.id);
    sell.onclick = () => sellOne(product);

    const edit = document.createElement("button");
    edit.className = "edit-btn";
    edit.textContent = "ویرایش";
    edit.onclick = () => editProduct(product);

    const archive = document.createElement("button");
    archive.className = "archive-btn";
    archive.textContent = "انتقال به بایگانی";
    archive.onclick = () => setArchive(product, true);

    actions.append(sell, edit, archive);
  }

  info.append(actions);
  card.append(image, info);
  return card;
}

async function renderProducts() {
  const list = activeProducts();
  const query = $("search").value.trim().toLowerCase();
  const category = $("categoryFilter").value;

  const filtered = list.filter(p => {
    const haystack = [
      p.name, p.tag, p.brand, p.category, p.description
    ].join(" ").toLowerCase();

    return haystack.includes(query) &&
      (!category || p.category === category);
  });

  const container = $("products");
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = '<div class="empty" style="grid-column:1/-1">محصولی پیدا نشد.</div>';
    return;
  }

  const cards = await Promise.all(
    filtered.map(p => buildProductCard(p))
  );

  container.replaceChildren(...cards);
}

async function renderArchived() {
  const container = $("archivedProducts");
  container.innerHTML = "";

  const list = archivedProducts();

  if (!list.length) {
    container.innerHTML = '<div class="empty" style="grid-column:1/-1">کالای بایگانی‌شده‌ای وجود ندارد.</div>';
    return;
  }

  const cards = await Promise.all(
    list.map(p => buildProductCard(p, true))
  );

  container.replaceChildren(...cards);
}

/* دفتر فروش */

function dateFiltered(list, fromId, toId) {
  const from = $(fromId).value;
  const to = $(toId).value;

  return list.filter(sale => {
    const date = dayKey(sale.created_at);
    return (!from || date >= from) && (!to || date <= to);
  });
}

function renderSales() {
  const filtered = dateFiltered(sales, "salesFrom", "salesTo");
  const valid = validSales(filtered);
  const total = valid.reduce((sum, s) => sum + (salePrice(s) ?? 0), 0);

  $("salesCount").textContent = faNumber(valid.length);
  $("salesTotal").textContent = formatMoney(total);
  $("salesVoided").textContent = faNumber(filtered.filter(s => s.voided_at).length);

  const container = $("salesTable");

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">در این بازه فروشی ثبت نشده است.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>نام کالا</th><th>تاریخ و ساعت</th><th>قیمت فروش</th><th>ثبت‌کننده</th><th>وضعیت</th><th>عملیات</th></tr>
      </thead>
      <tbody>
      ${filtered.map(s => `
        <tr>
          <td><strong>${escapeHtml(saleName(s))}</strong></td>
          <td>${new Date(s.created_at).toLocaleString("fa-IR")}</td>
          <td>${salePrice(s) == null ? "قدیمی؛ قیمت ثبت نشده" : formatMoney(s.sale_price)}</td>
          <td>${escapeHtml(s.user_email || "—")}</td>
          <td>${s.voided_at
            ? '<span class="stock zero">لغوشده</span>'
            : '<span class="stock">فروش معتبر</span>'}</td>
          <td>${s.voided_at ? "—" : `<button class="table-action" data-cancel="${s.event_id}">لغو فروش</button>`}</td>
        </tr>
      `).join("")}
      </tbody>
    </table>`;

  container.querySelectorAll("[data-cancel]").forEach(button => {
    button.addEventListener("click", () => cancelSale(button.dataset.cancel));
  });
}

/* گزارش فروش */

function renderReports() {
  const filtered = validSales(dateFiltered(sales, "reportFrom", "reportTo"));
  const total = filtered.reduce((sum, s) => sum + (salePrice(s) ?? 0), 0);

  $("reportCount").textContent = faNumber(filtered.length);
  $("reportTotal").textContent = formatMoney(total);
  $("reportAverage").textContent = formatMoney(
    filtered.length ? total / filtered.length : 0
  );

  const groups = new Map();

  filtered.forEach(s => {
    const name = saleName(s);
    const group = groups.get(name) || { count: 0, total: 0 };
    group.count++;
    group.total += salePrice(s) ?? 0;
    groups.set(name, group);
  });

  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const max = Math.max(1, ...sorted.map(item => item[1].count));

  $("topProducts").innerHTML = sorted.length
    ? sorted.map(([name, data]) => `
      <div class="bar-row">
        <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${data.count / max * 100}%"></div></div>
        <strong>${faNumber(data.count)} عدد</strong>
      </div>
    `).join("")
    : '<div class="empty">برای این بازه فروشی وجود ندارد.</div>';
}

/* نرخ درهم */

async function saveRate() {
  const rate = numberValue($("rate").value);

  if (rate <= 0) {
    alert("نرخ درهم را درست وارد کن.");
    return;
  }

  $("saveRate").disabled = true;

  try {
    const { error } = await db
      .from("inventory_settings")
      .upsert({ id: 1, dirham_rate: rate });

    if (error) throw error;

    dirhamRate = rate;
    $("rate").value = grouped(rate, 2);
    await renderAll();
    alert("نرخ درهم ذخیره شد.");

  } catch (error) {
    alert("خطا در ثبت نرخ: " + error.message);
  } finally {
    $("saveRate").disabled = false;
  }
}

/* جداکننده سه‌رقمی فیلدها */

function formatInput(input, allowDecimal = false) {
  const raw = digitsToEnglish(input.value).replace(/[^0-9.]/g, "");
  const parts = raw.split(".");
  const clean = allowDecimal && parts.length > 1
    ? parts[0] + "." + parts.slice(1).join("")
    : parts[0];

  if (clean === "") {
    input.value = "";
    return;
  }

  const number = Number(clean);
  if (Number.isFinite(number)) {
    input.value = grouped(number, allowDecimal ? 4 : 0);
  }
}

function setupFormattedInput(id, decimal = false) {
  const input = $(id);
  input.addEventListener("input", () => formatInput(input, decimal));
  input.addEventListener("blur", () => {
    if (input.value) formatInput(input, decimal);
  });
}

function updateBuyUnit() {
  const isDirham = $("purchaseType").value === "dirham";
  $("buyUnit").textContent = isDirham ? "(درهم)" : "(تومان)";
  $("buyHint").textContent = isDirham
    ? "قیمت خرید درهمی وارد می‌شود؛ کرایه جداگانه به تومان است."
    : "قیمت خرید تومانی با جداکننده سه‌رقمی نمایش داده می‌شود.";
}

/* فرم محصول */

function openModal() {
  $("productModal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  $("productModal").classList.remove("open");
  document.body.style.overflow = "";
}

function resetForm() {
  $("productForm").reset();
  $("pid").value = "";
  $("quantity").value = 1;
  $("freight").value = "0";
  $("formTitle").textContent = "افزودن محصول جدید";
  $("saveProduct").textContent = "ذخیره محصول";
  editingProduct = null;
  setMessage("formMessage", "");
  updateBuyUnit();
}

function openNewProduct() {
  resetForm();
  openModal();
}

function editProduct(product) {
  editingProduct = product;

  $("pid").value = product.id;
  $("name").value = product.name || "";
  $("category").value = product.category || CATEGORIES[0];
  $("brand").value = product.brand || BRANDS[0];
  $("tag").value = product.tag || "";
  $("description").value = product.description || "";

  $("purchaseType").value = product.purchase_type || "toman";
  $("buyPrice").value = grouped(product.buy_price, 4);
  $("freight").value = grouped(product.freight, 0);

  $("profitType").value = product.profit_type || "fixed";
  $("profitValue").value = grouped(product.profit_value, 4);
  $("quantity").value = product.quantity ?? 0;
  $("photo").value = "";

  $("formTitle").textContent = "ویرایش محصول";
  $("saveProduct").textContent = "ذخیره تغییرات";

  setMessage("formMessage", "");
  updateBuyUnit();
  openModal();
}

async function uploadPhoto(file) {
  if (!file) return null;

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await db.storage
    .from("inventory-photos")
    .upload(path, file, { upsert: false });

  if (error) throw error;
  return path;
}

async function saveProduct(event) {
  event.preventDefault();

  if (saving) return;
  saving = true;
  $("saveProduct").disabled = true;

  const name = $("name").value.trim();
  const buyPrice = numberValue($("buyPrice").value);
  const quantity = Number($("quantity").value);

  if (
    !name ||
    !Number.isFinite(buyPrice) ||
    buyPrice < 0 ||
    !Number.isInteger(quantity) ||
    quantity < 0
  ) {
    setMessage("formMessage", "نام، قیمت خرید و موجودی را بررسی کن.", true);
    saving = false;
    $("saveProduct").disabled = false;
    return;
  }

  setMessage("formMessage", "در حال ذخیره محصول...");

  try {
    let imagePath = editingProduct?.image_path || null;
    const file = $("photo").files[0];

    if (file) imagePath = await uploadPhoto(file);

    const row = {
      name,
      category: $("category").value,
      brand: $("brand").value,
      tag: $("tag").value.trim(),
      description: $("description").value.trim(),
      purchase_type: $("purchaseType").value,
      buy_price: buyPrice,
      freight: numberValue($("freight").value),
      profit_type: $("profitType").value,
      profit_value: numberValue($("profitValue").value),
      image_path: imagePath
    };

    if (editingProduct) {
      const { error } = await db
        .from("inventory_products")
        .update(row)
        .eq("id", editingProduct.id);

      if (error) throw error;

      if (Number(editingProduct.quantity) !== quantity) {
        const { error: quantityError } = await db.rpc(
          "set_inventory_quantity",
          {
            p_product_id: editingProduct.id,
            p_quantity: quantity
          }
        );

        if (quantityError) throw quantityError;
      }
    } else {
      const { error } = await db
        .from("inventory_products")
        .insert({ ...row, quantity });

      if (error) throw error;
    }

    resetForm();
    closeModal();
    await refresh();

  } catch (error) {
    console.error("Save error:", error);
    setMessage("formMessage", "خطا در ذخیره: " + error.message, true);
  } finally {
    saving = false;
    $("saveProduct").disabled = false;
  }
}

/* فروش و لغو فروش */

async function sellOne(product) {
  if (sellingProducts.has(product.id)) return;

  if (Number(product.quantity) <= 0) {
    alert("موجودی این محصول تمام شده است.");
    return;
  }

  if (!confirm(`فروش یک عدد «${product.name}» ثبت شود؟`)) return;

  sellingProducts.add(product.id);
  await renderProducts();

  try {
    const { error } = await db.rpc("apply_inventory_sale", {
      p_event_id: crypto.randomUUID(),
      p_product_id: product.id
    });

    if (error) throw error;
    $("sync").textContent = "فروش ثبت شد";

  } catch (error) {
    alert("فروش ثبت نشد: " + error.message);
  } finally {
    sellingProducts.delete(product.id);
    await refresh();
  }
}

async function cancelSale(eventId) {
  if (!confirm("فروش لغو شود و یک عدد به موجودی کالا برگردد؟")) return;

  try {
    const { data, error } = await db.rpc("cancel_inventory_sale", {
      p_event_id: eventId
    });

    if (error) throw error;

    if (!data) {
      alert("این فروش قبلاً لغو شده یا پیدا نشد.");
    }

    await refresh();
  } catch (error) {
    alert("خطا در لغو فروش: " + error.message);
  }
}

/* بایگانی کالا */

async function setArchive(product, archived) {
  const action = archived
    ? "به بایگانی منتقل شود"
    : "به فهرست کالاهای فعال برگردد";

  if (!confirm(`کالای «${product.name}» ${action}؟`)) return;

  try {
    const { error } = await db
      .from("inventory_products")
      .update({ is_active: !archived })
      .eq("id", product.id);

    if (error) throw error;
    await refresh();
  } catch (error) {
    alert("عملیات انجام نشد: " + error.message);
  }
}

/* همگام‌سازی زنده */

function scheduleRefresh() {
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => refresh(), 450);
}

function startRealtime() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
  }

  realtimeChannel = db.channel("inventory-live-v2")
    .on("postgres_changes", {
      event: "*", schema: "public", table: "inventory_products"
    }, scheduleRefresh)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "inventory_settings"
    }, scheduleRefresh)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "inventory_sale_events"
    }, scheduleRefresh)
    .subscribe();
}

/* ورود و خروج */

async function initializeApp() {
  const { data: { user } } = await db.auth.getUser();

  if (!user) {
    showLogin();
    return;
  }

  if (!ALLOWED_EMAILS.includes((user.email || "").toLowerCase())) {
    await db.auth.signOut();
    showLogin();
    setMessage("message", "این ایمیل اجازه ورود ندارد.", true);
    return;
  }

  showApp();
  await refresh();
  startRealtime();
}

async function login() {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (!ALLOWED_EMAILS.includes(email)) {
    setMessage("message", "این ایمیل اجازه ورود ندارد.", true);
    return;
  }

  $("loginBtn").disabled = true;
  setMessage("message", "در حال ورود...");

  try {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await initializeApp();
  } catch (error) {
    setMessage("message", "خطا در ورود: " + error.message, true);
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function logout() {
  if (realtimeChannel) {
    await db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  clearTimeout(realtimeTimer);
  await db.auth.signOut();
  showLogin();
}

/* اتصال دکمه‌ها */

fillSelect("category", CATEGORIES);
fillSelect("brand", BRANDS);

CATEGORIES.forEach(category => {
  const option = document.createElement("option");
  option.value = category;
  option.textContent = category;
  $("categoryFilter").append(option);
});

$("loginBtn").addEventListener("click", login);
$("logout").addEventListener("click", logout);
$("saveRate").addEventListener("click", saveRate);
$("addProductBtn").addEventListener("click", openNewProduct);
$("dashAdd").addEventListener("click", openNewProduct);
$("closeProductModal").addEventListener("click", closeModal);
$("cancelEdit").addEventListener("click", closeModal);

$("productForm").addEventListener("submit", saveProduct);
$("search").addEventListener("input", renderProducts);
$("categoryFilter").addEventListener("change", renderProducts);
$("purchaseType").addEventListener("change", updateBuyUnit);

setupFormattedInput("buyPrice", true);
setupFormattedInput("freight");
setupFormattedInput("rate", true);
setupFormattedInput("profitValue", true);

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => goPage(button.dataset.page));
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => goPage(button.dataset.goto));
});

$("filterSales").addEventListener("click", renderSales);

$("clearSalesFilter").addEventListener("click", () => {
  $("salesFrom").value = "";
  $("salesTo").value = "";
  renderSales();
});

$("runReport").addEventListener("click", renderReports);

$("productModal").addEventListener("click", event => {
  if (event.target === $("productModal")) closeModal();
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

/* شروع برنامه */

initializeApp();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service worker:", error));
  });
}
