import { createClient } from
"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = id => document.getElementById(id);
const money = n => Number(n || 0).toLocaleString("en-US");
const digits = value => Number(String(value || "").replace(/[^\d.-]/g, "")) || 0;

let products = [];
let sales = [];
let options = [];
let currentTab = "products";
let currentUser = null;
let channel = null;

const allowedEmails = [
  "mmdowhe@gmail.com",
  "hossein5khezri@gmail.com"
];

function notify(message, target = "formMessage") {
  const el = $(target);
  if (el) el.textContent = message;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  }[char]));
}

function formatInput(input) {
  input.addEventListener("input", () => {
    const raw = input.value.replace(/[^\d]/g, "");
    input.value = raw ? Number(raw).toLocaleString("en-US") : "";
  });
}

["buyPrice", "freight", "profitValue", "rate"].forEach(id => {
  formatInput($(id));
});

function showLogin() {
  $("login").style.display = "flex";
  $("app").classList.add("hidden");
}

function showApp() {
  $("login").style.display = "none";
  $("app").classList.remove("hidden");
}

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    if (allowedEmails.includes((currentUser.email || "").toLowerCase())) {
      showApp();
      await refreshAll();
    } else {
      await supabase.auth.signOut();
      showLogin();
      $("message").textContent = "این حساب اجازه ورود ندارد.";
    }
  } else {
    showLogin();
  }
}

$("loginBtn").addEventListener("click", async () => {
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  notify("در حال ورود...", "message");

  const { data, error } = await supabase.auth.signInWithPassword({
    email, password
  });

  if (error) {
    notify(error.message, "message");
    return;
  }

  if (!allowedEmails.includes((data.user.email || "").toLowerCase())) {
    await supabase.auth.signOut();
    notify("این حساب اجازه ورود ندارد.", "message");
    return;
  }

  currentUser = data.user;
  showApp();
  await refreshAll();
});

$("logout").addEventListener("click", async () => {
  if (channel) await supabase.removeChannel(channel);
  await supabase.auth.signOut();
  currentUser = null;
  showLogin();
});

async function refreshAll() {
  await Promise.all([
    loadProducts(),
    loadRate(),
    loadOptions(),
    loadSales()
  ]);
  render();
  renderSales();
  startRealtime();
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("inventory_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("خطا در دریافت کالاها: " + error.message);
    return;
  }
  products = data || [];
}

async function loadRate() {
  const { data, error } = await supabase
    .from("inventory_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!error && data) $("rate").value = money(data.dirham_rate);
}

async function loadOptions() {
  const { data, error } = await supabase
    .from("inventory_options")
    .select("*")
    .order("option_name");

  if (error) {
    console.error(error);
    notify("دریافت برندها و دسته‌بندی‌ها ناموفق بود: " + error.message,
      "optionsMessage");
    return;
  }

  options = data || [];
  fillOptionSelects();
  renderOptions();
}

async function loadSales() {
  const { data, error } = await supabase
    .from("inventory_sale_events")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  sales = data || [];
}

function fillOptionSelects() {
  const brands = options.filter(x => x.option_type === "brand");
  const categories = options.filter(x => x.option_type === "category");

  const brandValue = $("brand").value;
  const categoryValue = $("category").value;

  $("brand").innerHTML = '<option value="">انتخاب برند</option>' +
    brands.map(x => `<option value="${escapeHTML(x.option_name)}">${escapeHTML(x.option_name)}</option>`).join("");

  $("category").innerHTML = '<option value="">انتخاب دسته‌بندی</option>' +
    categories.map(x => `<option value="${escapeHTML(x.option_name)}">${escapeHTML(x.option_name)}</option>`).join("");

  $("brand").value = brandValue;
  $("category").value = categoryValue;
}

function costPrice(p) {
  const buy = Number(p.buy_price || 0);
  const freight = Number(p.freight || 0);
  if (p.purchase_type === "dirham") {
    const rate = digits($("rate").value);
    return buy * rate + freight;
  }
  return buy + freight;
}

function salePrice(p) {
  const cost = costPrice(p);
  const profit = Number(p.profit_value || 0);
  return p.profit_type === "percent"
    ? cost * (1 + profit / 100)
    : cost + profit;
}

function activeProducts() {
  return products.filter(p => p.is_active !== false);
}

function archivedProducts() {
  return products.filter(p => p.is_active === false);
}

function render() {
  const active = activeProducts();
  const archived = archivedProducts();

  $("statProducts").textContent = money(active.length);
  $("statStock").textContent = money(active.reduce((s, p) => s + Number(p.quantity || 0), 0));
  $("statValue").textContent = money(active.reduce((s, p) => s + costPrice(p) * Number(p.quantity || 0), 0)) + " تومان";
  $("statSales").textContent = money(sales.filter(s => !s.voided_at).length);

  const query = $("search").value.trim().toLowerCase();
  const filtered = active.filter(p =>
    [p.name, p.brand, p.category, p.tag]
      .some(v => String(v || "").toLowerCase().includes(query))
  );

  $("products").innerHTML = filtered.length
    ? filtered.map(productCard).join("")
    : '<div class="empty">کالایی پیدا نشد.</div>';

  $("archivedProducts").innerHTML = archived.length
    ? archived.map(p => productCard(p, true)).join("")
    : '<div class="empty">کالای بایگانی‌شده‌ای وجود ندارد.</div>';
}

function productCard(p, archived = false) {
  const price = salePrice(p);
  const image = p.image_path
    ? `<img src="${escapeHTML(p.image_path)}" alt="${escapeHTML(p.name)}">`
    : '<div class="no-img">▧</div>';

  return `
  <article class="product">
    <div class="product-img">${image}</div>
    <div class="product-info">
      <h3>${escapeHTML(p.name)}</h3>
      <div class="meta">
        ${escapeHTML(p.brand || "بدون برند")}
        ${p.category ? " • " + escapeHTML(p.category) : ""}
        ${p.tag ? " • " + escapeHTML(p.tag) : ""}
      </div>
      <div class="price">${money(price)} تومان</div>
      <div class="stock">موجودی: ${money(p.quantity)}</div>
      <div class="product-actions">
        ${archived
          ? `<button class="btn small" data-action="restore" data-id="${p.id}">بازگردانی</button>`
          : `
            <button class="btn red small" data-action="sell" data-id="${p.id}">فروش رفت</button>
            <button class="btn dark small" data-action="edit" data-id="${p.id}">ویرایش</button>
            <button class="btn small" data-action="archive" data-id="${p.id}">بایگانی</button>
          `}
      </div>
    </div>
  </article>`;
}

$("products").addEventListener("click", handleProductAction);
$("archivedProducts").addEventListener("click", handleProductAction);

async function handleProductAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;
  const product = products.find(p => p.id === id);
  if (!product) return;

  if (action === "edit") openProductModal(product);
  if (action === "sell") await sellProduct(product);
  if (action === "archive") await archiveProduct(product, false);
  if (action === "restore") await archiveProduct(product, true);
}

async function sellProduct(product) {
  if (Number(product.quantity) <= 0) {
    alert("موجودی این کالا تمام شده است.");
    return;
  }

  if (!confirm(`فروش یک عدد «${product.name}» ثبت شود؟`)) return;

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
}

async function archiveProduct(product, restore) {
  const question = restore
    ? `کالای «${product.name}» بازگردانی شود؟`
    : `کالای «${product.name}» به بایگانی منتقل شود؟`;

  if (!confirm(question)) return;

  const { error } = await supabase
    .from("inventory_products")
    .update({ is_active: restore })
    .eq("id", product.id);

  if (error) {
    alert("عملیات ناموفق بود: " + error.message);
    return;
  }

  await loadProducts();
  render();
}

function openProductModal(product = null) {
  $("productForm").reset();
  $("pid").value = product?.id || "";
  $("formTitle").textContent = product ? "ویرایش محصول" : "افزودن محصول جدید";
  fillOptionSelects();

  if (product) {
    $("name").value = product.name || "";
    $("category").value = product.category || "";
    $("brand").value = product.brand || "";
    $("tag").value = product.tag || "";
    $("purchaseType").value = product.purchase_type || "toman";
    $("buyPrice").value = money(product.buy_price);
    $("freight").value = money(product.freight);
    $("profitType").value = product.profit_type || "fixed";
    $("profitValue").value = money(product.profit_value);
    $("quantity").value = product.quantity ?? 0;
    $("description").value = product.description || "";
  } else {
    $("quantity").value = 1;
    $("freight").value = "0";
    $("profitValue").value = "0";
  }

  $("formMessage").textContent = "";
  $("productModal").classList.add("show");
}

function closeProductModal() {
  $("productModal").classList.remove("show");
}

$("addProductBtn").addEventListener("click", () => openProductModal());
$("closeProductModal").addEventListener("click", closeProductModal);
$("cancelEdit").addEventListener("click", closeProductModal);

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();
  notify("در حال ذخیره محصول...");

  const id = $("pid").value;
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
    quantity: Number($("quantity").value),
    description: $("description").value.trim(),
    is_active: true,
    updated_at: new Date().toISOString()
  };

  if (!payload.name) {
    notify("نام محصول را وارد کن.");
    return;
  }

  if (payload.purchase_type === "dirham" && digits($("rate").value) <= 0) {
    notify("اول نرخ درهم را ثبت کن.");
    return;
  }

  let imagePath = null;
  const photo = $("photo").files[0];

  if (photo) {
    const extension = photo.name.split(".").pop() || "jpg";
    const path = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("inventory-photos")
      .upload(path, photo, { upsert: true });

    if (uploadError) {
      notify("بارگذاری عکس ناموفق بود: " + uploadError.message);
      return;
    }

    const { data: urlData } = await supabase.storage
      .from("inventory-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365);

    imagePath = urlData?.signedUrl || null;
    payload.image_path = imagePath;
  }

  let result;

  if (id) {
    result = await supabase
      .from("inventory_products")
      .update(payload)
      .eq("id", id);
  } else {
    payload.user_id = currentUser.id;
    result = await supabase
      .from("inventory_products")
      .insert(payload);
  }

  if (result.error) {
    notify("ذخیره ناموفق بود: " + result.error.message);
    return;
  }

  closeProductModal();
  await loadProducts();
  render();
});

$("saveRate").addEventListener("click", async () => {
  const rate = digits($("rate").value);
  if (!rate) return alert("نرخ درهم را وارد کن.");

  const { data: existing, error: readError } = await supabase
    .from("inventory_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (readError) return alert(readError.message);

  const result = existing
    ? await supabase.from("inventory_settings").update({ dirham_rate: rate }).eq("id", existing.id)
    : await supabase.from("inventory_settings").insert({ dirham_rate: rate });

  if (result.error) return alert(result.error.message);

  $("rate").value = money(rate);
  render();
  alert("نرخ درهم ثبت شد.");
});

$("search").addEventListener("input", render);
$("sync").addEventListener("click", refreshAll);
