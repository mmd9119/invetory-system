import { createClient } from
"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const money = n => Number(n || 0).toLocaleString("en-US");
const digits = v => Number(String(v || "").replace(/[^\d.-]/g, "")) || 0;

const allowedEmails = ["mmdowhe@gmail.com", "hossein5khezri@gmail.com"];
let currentUser = null;
let products = [], sales = [], options = [], channel = null;

function msg(text, id = "formMessage") {
  $(id).textContent = text;
}
function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}
["buyPrice","freight","profitValue","rate"].forEach(id => {
  $(id).addEventListener("input", e => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    e.target.value = raw ? Number(raw).toLocaleString("en-US") : "";
  });
});

function showLogin() {
  $("login").style.display = "flex";
  $("app").classList.add("hidden");
}
function showApp() {
  $("login").style.display = "none";
  $("app").classList.remove("hidden");
  showPage("productsPage");
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  $(pageId).classList.remove("hidden");
  document.querySelectorAll(".navbtn").forEach(b => {
    b.classList.toggle("active", b.dataset.page === pageId);
  });
  if (pageId === "salesPage") renderSales();
  if (pageId === "dashboardPage") renderDashboard();
  if (pageId === "archivePage") render();
}

document.querySelectorAll(".navbtn").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

$("loginBtn").addEventListener("click", async () => {
  msg("در حال ورود...", "message");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim().toLowerCase(),
    password: $("password").value
  });
  if (error) return msg(error.message, "message");
  if (!allowedEmails.includes((data.user.email || "").toLowerCase())) {
    await supabase.auth.signOut();
    return msg("این حساب اجازه ورود ندارد.", "message");
  }
  currentUser = data.user;
  showApp();
  await refreshAll();
});

$("logout").addEventListener("click", async () => {
  if (channel) await supabase.removeChannel(channel);
  channel = null;
  await supabase.auth.signOut();
  currentUser = null;
  showLogin();
});

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return showLogin();

  currentUser = data.session.user;
  if (!allowedEmails.includes((currentUser.email || "").toLowerCase())) {
    await supabase.auth.signOut();
    return showLogin();
  }
  showApp();
  await refreshAll();
}

async function refreshAll() {
  await Promise.all([loadProducts(), loadRate(), loadOptions(), loadSales()]);
  render();
  renderDashboard();
  renderSales();
  startRealtime();
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("inventory_products").select("*")
    .order("created_at", { ascending: false });
  if (error) return alert("خطای دریافت کالاها: " + error.message);
  products = data || [];
}

async function loadRate() {
  const { data, error } = await supabase
    .from("inventory_settings").select("*").limit(1).maybeSingle();
  if (!error && data) $("rate").value = money(data.dirham_rate);
}

async function loadOptions() {
  const { data, error } = await supabase
    .from("inventory_options").select("*").order("option_name");
  if (error) {
    console.error(error);
    msg("خطای دریافت برندها: " + error.message, "optionsMessage");
    return;
  }
  options = data || [];
  fillSelects();
  renderOptions();
}

async function loadSales() {
  const { data, error } = await supabase
    .from("inventory_sale_events").select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  sales = data || [];
}

function fillSelects() {
  const brandValue = $("brand").value;
  const categoryValue = $("category").value;
  $("brand").innerHTML = '<option value="">انتخاب برند</option>' +
    options.filter(x => x.option_type === "brand")
      .map(x => `<option value="${esc(x.option_name)}">${esc(x.option_name)}</option>`).join("");
  $("category").innerHTML = '<option value="">انتخاب دسته‌بندی</option>' +
    options.filter(x => x.option_type === "category")
      .map(x => `<option value="${esc(x.option_name)}">${esc(x.option_name)}</option>`).join("");
  $("brand").value = brandValue;
  $("category").value = categoryValue;
}

function activeProducts() {
  return products.filter(p => p.is_active !== false);
}
function archivedProducts() {
  return products.filter(p => p.is_active === false);
}
function costPrice(p) {
  const buy = Number(p.buy_price || 0);
  const freight = Number(p.freight || 0);
  if (p.purchase_type === "dirham") {
    return buy * digits($("rate").value) + freight;
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

function card(p, archived = false) {
  const image = p.image_path
    ? `<img src="${esc(p.image_path)}" alt="${esc(p.name)}">`
    : '<div class="no-img">▧</div>';
  return `<article class="product">
    <div class="product-img">${image}</div>
    <div class="product-info">
      <h3>${esc(p.name)}</h3>
      <div class="meta">${esc(p.brand || "بدون برند")} ${p.category ? " • " + esc(p.category) : ""} ${p.tag ? " • " + esc(p.tag) : ""}</div>
      <div class="price">${money(salePrice(p))} تومان</div>
      <div class="stock">موجودی: ${money(p.quantity)}</div>
      <div class="product-actions">
      ${archived
        ? `<button class="btn small" data-action="restore" data-id="${p.id}">بازگردانی</button>`
        : `<button class="btn red small" data-action="sell" data-id="${p.id}">فروش</button>
           <button class="btn dark small" data-action="edit" data-id="${p.id}">ویرایش</button>
           <button class="btn small" data-action="archive" data-id="${p.id}">بایگانی</button>`}
      </div>
    </div>
  </article>`;
}

function render() {
  const query = $("search").value.trim().toLowerCase();
  const list = activeProducts().filter(p =>
    [p.name,p.brand,p.category,p.tag].some(v =>
      String(v || "").toLowerCase().includes(query)
    )
  );
  $("products").innerHTML = list.length
    ? list.map(p => card(p)).join("")
    : '<div class="empty">کالایی پیدا نشد.</div>';

  const archived = archivedProducts();
  $("archivedProducts").innerHTML = archived.length
    ? archived.map(p => card(p, true)).join("")
    : '<div class="empty">کالای بایگانی‌شده‌ای وجود ندارد.</div>';
}

function renderDashboard() {
  const list = activeProducts();
  $("statProducts").textContent = money(list.length);
  $("statStock").textContent = money(list.reduce((s,p) => s + Number(p.quantity || 0),0));
  $("statValue").textContent = money(list.reduce((s,p) => s + costPrice(p) * Number(p.quantity || 0),0)) + " تومان";
  $("statSales").textContent = money(sales.filter(s => !s.voided_at).length);

  const groups = {};
  sales.filter(s => !s.voided_at).forEach(s => {
    const name = s.product_name || "فروش قدیمی";
    groups[name] = (groups[name] || 0) + 1;
  });
  const top = Object.entries(groups).sort((a,b) => b[1]-a[1]).slice(0,5);
  $("dashboardTop").innerHTML = top.length
    ? top.map(([name,count]) => `<div class="option-row"><span>${esc(name)}</span><b>${count} عدد</b></div>`).join("")
    : "هنوز فروشی ثبت نشده است.";
}

async function handleProductAction(e) {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const p = products.find(x => x.id === button.dataset.id);
  if (!p) return;

  if (button.dataset.action === "edit") openProductModal(p);
  if (button.dataset.action === "sell") await sellProduct(p);
  if (button.dataset.action === "archive") await setArchive(p, false);
  if (button.dataset.action === "restore") await setArchive(p, true);
}
$("products").addEventListener("click", handleProductAction);
$("archivedProducts").addEventListener("click", handleProductAction);

async function sellProduct(p) {
  if (Number(p.quantity) <= 0) return alert("موجودی کالا تمام شده است.");
  if (!confirm(`فروش یک عدد «${p.name}» ثبت شود؟`)) return;
  const { error } = await supabase.rpc("apply_inventory_sale", {
    p_event_id: crypto.randomUUID(),
    p_product_id: p.id
  });
  if (error) return alert("ثبت فروش ناموفق بود: " + error.message);
  await refreshAll();
}

async function setArchive(p, active) {
  const text = active ? "بازگردانی" : "بایگانی";
  if (!confirm(`${p.name} ${text} شود؟`)) return;
  const { error } = await supabase.from("inventory_products")
    .update({ is_active: active }).eq("id", p.id);
  if (error) return alert(error.message);
  await loadProducts();
  render();
  renderDashboard();
}

function openProductModal(p = null) {
  $("productForm").reset();
  fillSelects();
  $("pid").value = p?.id || "";
  $("formTitle").textContent = p ? "ویرایش محصول" : "افزودن محصول";
  if (p) {
    $("name").value = p.name || "";
    $("category").value = p.category || "";
    $("brand").value = p.brand || "";
    $("tag").value = p.tag || "";
    $("purchaseType").value = p.purchase_type || "toman";
    $("buyPrice").value = money(p.buy_price);
    $("freight").value = money(p.freight);
    $("profitType").value = p.profit_type || "fixed";
    $("profitValue").value = money(p.profit_value);
    $("quantity").value = p.quantity ?? 0;
    $("description").value = p.description || "";
  } else {
    $("quantity").value = 1;
    $("freight").value = "0";
    $("profitValue").value = "0";
  }
  msg("");
  $("productModal").classList.add("show");
}
function closeProductModal() {
  $("productModal").classList.remove("show");
}
$("addProductBtn").addEventListener("click", () => openProductModal());
$("closeProductModal").addEventListener("click", closeProductModal);
$("cancelEdit").addEventListener("click", closeProductModal);

$("productForm").addEventListener("submit", async e => {
  e.preventDefault();
  msg("در حال ذخیره...");
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
  if (!payload.name) return msg("نام محصول را وارد کن.");
  if (payload.purchase_type === "dirham" && digits($("rate").value) <= 0)
    return msg("ابتدا نرخ درهم را در داشبورد ثبت کن.");

  const photo = $("photo").files[0];
  if (photo) {
    const ext = photo.name.split(".").pop() || "jpg";
    const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("inventory-photos").upload(path, photo, { upsert: true });
    if (uploadError) return msg("خطای عکس: " + uploadError.message);
    const { data } = await supabase.storage
      .from("inventory-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
    payload.image_path = data?.signedUrl || null;
  }

  const result = id
    ? await supabase.from("inventory_products").update(payload).eq("id", id)
    : await supabase.from("inventory_products").insert({
        ...payload, user_id: currentUser.id
      });

  if (result.error) return msg("خطای ذخیره: " + result.error.message);
  closeProductModal();
  await loadProducts();
  render();
  renderDashboard();
});

$("search").addEventListener("input", render);
$("sync").addEventListener("click", refreshAll);

$("saveRate").addEventListener("click", async () => {
  const rate = digits($("rate").value);
  if (!rate) return alert("نرخ درهم را وارد کن.");
  const { data, error } = await supabase.from("inventory_settings")
    .select("id").limit(1).maybeSingle();
  if (error) return alert(error.message);
  const result = data
    ? await supabase.from("inventory_settings").update({dirham_rate:rate}).eq("id",data.id)
    : await supabase.from("inventory_settings").insert({dirham_rate:rate});
  if (result.error) return alert(result.error.message);
  $("rate").value = money(rate);
  render();
  renderDashboard();
  alert("نرخ درهم ثبت شد.");
});
// مدیریت برندها و دسته‌بندی‌ها

$("manageOptionsBtn").addEventListener("click", () => {
  $("optionsModal").classList.add("show");
  renderOptions();
});
$("closeOptions").addEventListener("click", () =>
  $("optionsModal").classList.remove("show")
);

function renderOptions() {
  $("brandOptions").innerHTML = options
    .filter(x => x.option_type === "brand")
    .map(x => `<div class="option-row">
      <span>${esc(x.option_name)}</span>
      <button class="btn red small" data-remove="${x.id}">حذف</button>
    </div>`).join("");

  $("categoryOptions").innerHTML = options
    .filter(x => x.option_type === "category")
    .map(x => `<div class="option-row">
      <span>${esc(x.option_name)}</span>
      <button class="btn red small" data-remove="${x.id}">حذف</button>
    </div>`).join("");

  fillSelects();
}

async function addOption(type, inputId) {
  const name = $(inputId).value.trim();
  if (!name) return msg("نام را وارد کن.", "optionsMessage");

  if (options.some(x => x.option_type === type &&
    x.option_name.toLowerCase() === name.toLowerCase())) {
    return msg("این مورد قبلاً ثبت شده است.", "optionsMessage");
  }

  const { error } = await supabase.from("inventory_options").insert({
    option_type: type,
    option_name: name,
    user_id: currentUser.id
  });

  if (error) return msg("خطا: " + error.message, "optionsMessage");
  $(inputId).value = "";
  msg("با موفقیت اضافه شد.", "optionsMessage");
  await loadOptions();
}

$("addBrand").addEventListener("click", () => addOption("brand", "newBrand"));
$("addCategory").addEventListener("click", () => addOption("category", "newCategory"));

$("optionsModal").addEventListener("click", async e => {
  const button = e.target.closest("[data-remove]");
  if (!button) return;
  const id = Number(button.dataset.remove);
  const option = options.find(x => x.id === id);
  if (!option || !confirm(`«${option.option_name}» از فهرست حذف شود؟`)) return;

  const { error } = await supabase.from("inventory_options").delete().eq("id", id);
  if (error) return msg(error.message, "optionsMessage");
  msg("حذف شد.", "optionsMessage");
  await loadOptions();
});

// گزارش روزانه و دفتر فروش

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function salesForDate(dateString) {
  return sales.filter(s => localDate(new Date(s.created_at)) === dateString && !s.voided_at);
}

function groupSales(list, target) {
  const groups = {};
  list.forEach(s => {
    const name = s.product_name || "فروش قدیمی";
    if (!groups[name]) groups[name] = { count:0, total:0 };
    groups[name].count++;
    groups[name].total += Number(s.sale_price || 0);
  });

  const sorted = Object.entries(groups).sort((a,b) => b[1].count-a[1].count);
  $(target).innerHTML = sorted.length
    ? sorted.map(([name,v]) => `
      <div class="option-row">
        <span>${esc(name)} — ${v.count} عدد</span>
        <b>${money(v.total)} تومان</b>
      </div>`).join("")
    : "فروشی ثبت نشده است.";
}

function renderDaily() {
  const day = $("dailyDate").value || localDate(new Date());
  const list = salesForDate(day);
  $("dailyCount").textContent = money(list.length);
  $("dailyTotal").textContent = money(
    list.reduce((sum,s) => sum + Number(s.sale_price || 0),0)
  ) + " تومان";
  groupSales(list, "dailyGroups");
}

function renderSales() {
  renderDaily();

  const from = $("salesFrom").value;
  const to = $("salesTo").value;

  const list = sales.filter(s => {
    const day = localDate(new Date(s.created_at));
    return (!from || day >= from) && (!to || day <= to);
  });

  const valid = list.filter(s => !s.voided_at);
  $("salesCount").textContent = money(valid.length);
  $("salesTotal").textContent = money(
    valid.reduce((sum,s) => sum + Number(s.sale_price || 0),0)
  ) + " تومان";

  $("salesRows").innerHTML = list.length
    ? list.map(s => {
      const canceled = Boolean(s.voided_at);
      return `<tr>
        <td>${esc(s.product_name || "فروش قدیمی")}</td>
        <td>${s.sale_price == null ? "ثبت نشده" : money(s.sale_price) + " تومان"}</td>
        <td>${new Date(s.created_at).toLocaleString("fa-IR")}</td>
        <td>${canceled ? "لغوشده" : "ثبت‌شده"}</td>
        <td>${canceled ? "—" :
          `<button class="btn red small" data-cancel="${s.event_id}">لغو فروش</button>`}</td>
      </tr>`;
    }).join("")
    : '<tr><td colspan="5">فروشی در این بازه ثبت نشده است.</td></tr>';

  groupSales(valid, "salesByProduct");
}

$("dailyDate").value = localDate(new Date());
$("dailyFilter").addEventListener("click", renderDaily);
$("filterSales").addEventListener("click", renderSales);

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

$("salesRows").addEventListener("click", async e => {
  const button = e.target.closest("[data-cancel]");
  if (!button) return;
  if (!confirm("فروش لغو شود و یک عدد به موجودی برگردد؟")) return;

  const { data, error } = await supabase.rpc("cancel_inventory_sale", {
    p_event_id: button.dataset.cancel
  });

  if (error) return alert("خطا در لغو فروش: " + error.message);
  if (data !== true) return alert("این فروش قبلاً لغو شده یا قابل لغو نیست.");

  await refreshAll();
  alert("فروش لغو شد و موجودی برگشت.");
});

// همگام‌سازی زنده اطلاعات بین دستگاه‌ها

function startRealtime() {
  if (channel) supabase.removeChannel(channel);

  channel = supabase.channel("inventory-live")
    .on("postgres_changes", {
      event:"*", schema:"public", table:"inventory_products"
    }, async () => {
      await loadProducts();
      render();
      renderDashboard();
    })
    .on("postgres_changes", {
      event:"*", schema:"public", table:"inventory_settings"
    }, async () => {
      await loadRate();
      render();
      renderDashboard();
    })
    .on("postgres_changes", {
      event:"*", schema:"public", table:"inventory_options"
    }, loadOptions)
    .on("postgres_changes", {
      event:"*", schema:"public", table:"inventory_sale_events"
    }, async () => {
      await loadSales();
      renderSales();
      renderDashboard();
    })
    .subscribe();
}

// ثبت Service Worker قبلی

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session) {
    currentUser = null;
    if (channel) supabase.removeChannel(channel);
    channel = null;
    showLogin();
    return;
  }

  const email = (session.user.email || "").toLowerCase();
  if (!allowedEmails.includes(email)) {
    await supabase.auth.signOut();
    showLogin();
    $("message").textContent = "این حساب اجازه ورود ندارد.";
  }
});

checkSession();
// اصلاح قطعی جابه‌جایی بین صفحات منو
document.addEventListener("click", function (event) {
  const button = event.target.closest(".navbtn");

  if (!button) return;

  event.preventDefault();

  const pageId = button.dataset.page;
  const target = document.getElementById(pageId);

  if (!target) {
    console.error("صفحه پیدا نشد:", pageId);
    return;
  }

  document.querySelectorAll(".content .page").forEach(page => {
    page.classList.add("hidden");
  });

  target.classList.remove("hidden");

  document.querySelectorAll(".navbtn").forEach(item => {
    item.classList.remove("active");
  });

  button.classList.add("active");

  if (pageId === "dashboardPage") {
    renderDashboard();
  }

  if (pageId === "salesPage") {
    renderSales();
  }

  if (pageId === "archivePage") {
    render();
  }
}, true);
