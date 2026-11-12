
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ALLOWED_EMAILS = [
  "mmdowhe@gmail.com",
  "hossein5khezri@gmail.com"
];

const CATEGORIES = [
  "جاروبرقی و نظافت",
  "لوازم آشپزخانه",
  "سرخ‌کن و پخت‌وپز",
  "صوتی و تصویری",
  "اسپیکر و هدفون",
  "سرمایشی و گرمایشی",
  "روشنایی و چراغ شارژی",
  "لوازم شخصی و اصلاح",
  "گجت و لوازم جانبی",
  "ماساژور و سلامت",
  "سایر محصولات"
];

const BRANDS = [
  "Philips", "Xiaomi", "Samsung", "Sony",
  "JBL", "Kenwood", "Tefal", "Sheglam", "متفرقه"
];

const $ = id => document.getElementById(id);

let products = [];
let dirhamRate = 0;
let editingProduct = null;
let realtimeChannel = null;

let imageCache = new Map();
let saving = false;
let refreshPromise = null;
let refreshQueued = false;
let realtimeTimer = null;

const sellingProducts = new Set();

/* ---------------- تنظیمات اولیه ---------------- */

function fillSelect(id, values) {
  const select = $(id);
  select.innerHTML = "";

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
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

function showMessage(message, error = false) {
  $("message").textContent = message;
  $("message").style.color = error ? "#b66d62" : "#607b58";
}

function formMessage(message, error = false) {
  $("formMessage").textContent = message;
  $("formMessage").style.color = error ? "#b66d62" : "#607b58";
}

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
  $("freight").value = 0;

  $("formTitle").textContent = "افزودن محصول جدید";
  $("saveProduct").textContent = "ذخیره محصول";

  editingProduct = null;
  formMessage("");
}

function openNewProduct() {
  resetForm();
  openModal();
}

/* ---------------- محاسبات قیمت ---------------- */

function formatMoney(value) {
  return Math.round(Number(value) || 0).toLocaleString("fa-IR") + " تومان";
}

function costPrice(product) {
  const buy = Number(product.buy_price) || 0;
  const freight = Number(product.freight) || 0;

  const converted = product.purchase_type === "dirham"
    ? buy * dirhamRate
    : buy;

  return converted + freight;
}

function sellingPrice(product) {
  const cost = costPrice(product);
  const profit = Number(product.profit_value) || 0;

  if (product.profit_type === "percent") {
    return cost + cost * profit / 100;
  }

  return cost + profit;
}

/* ---------------- عکس محصولات ---------------- */

async function imageUrl(path) {
  if (!path) return "";

  if (imageCache.has(path)) {
    return imageCache.get(path);
  }

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

/* ---------------- دریافت محصولات ---------------- */

async function refresh() {
  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }

  refreshPromise = (async () => {
    do {
      refreshQueued = false;

      $("sync").textContent = "در حال به‌روزرسانی...";

      const [productResult, settingsResult] = await Promise.all([
        db.from("inventory_products")
          .select("*")
          .order("created_at", { ascending: false }),

        db.from("inventory_settings")
          .select("*")
          .eq("id", 1)
          .maybeSingle()
      ]);

      if (productResult.error) {
        throw productResult.error;
      }

      if (settingsResult.error) {
        throw settingsResult.error;
      }

      products = productResult.data || [];
      dirhamRate = Number(settingsResult.data?.dirham_rate) || 0;

      $("rate").value = dirhamRate || "";

      await render();

      $("sync").textContent = "اطلاعات به‌روز است";

    } while (refreshQueued);

  })();

  try {
    await refreshPromise;
  } catch (error) {
    console.error("Refresh error:", error);
    $("sync").textContent = "خطا در دریافت اطلاعات";
  } finally {
    refreshPromise = null;
  }
}

/* ---------------- نمایش محصولات ---------------- */

let renderVersion = 0;

async function render() {
  const version = ++renderVersion;

  const query = $("search").value.trim().toLowerCase();

  const filtered = products.filter(product => {
    const text = [
      product.name,
      product.tag,
      product.brand,
      product.category,
      product.description
    ].join(" ").toLowerCase();

    return text.includes(query);
  });

  const container = $("products");
  container.innerHTML = "";

  if (!filtered.length) {
    container.textContent = "محصولی پیدا نشد.";
    return;
  }

  const cards = await Promise.all(filtered.map(async product => {
    const card = document.createElement("article");
    card.className = "product";
    card.dataset.id = product.id;

    const img = document.createElement("img");
    img.alt = product.name || "محصول";

    if (product.image_path) {
      const url = await imageUrl(product.image_path);

      if (url) {
        img.src = url;
      } else {
        img.style.display = "none";
      }
    } else {
      img.style.display = "none";
    }

    const info = document.createElement("div");
    info.className = "info";

    const title = document.createElement("h3");
    title.textContent = product.name || "بدون نام";

    const category = document.createElement("p");
    category.textContent = product.category || "";

    const brand = document.createElement("p");
    brand.textContent = product.brand || "";

    const tag = document.createElement("p");
    tag.textContent = product.tag
      ? "مدل: " + product.tag
      : "";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = formatMoney(sellingPrice(product));

    const stock = document.createElement("span");
    stock.className = "stock";
    stock.textContent = "موجودی: " + (product.quantity ?? 0);

    const actions = document.createElement("div");
    actions.className = "product-actions";

    const sell = document.createElement("button");
    sell.className = "sell-btn";
    sell.textContent = sellingProducts.has(product.id)
      ? "در حال ثبت..."
      : "فروش رفت";

    sell.disabled =
      Number(product.quantity) <= 0 ||
      sellingProducts.has(product.id);

    sell.addEventListener("click", () => sellOne(product));

    const edit = document.createElement("button");
    edit.className = "edit-btn";
    edit.textContent = "ویرایش";

    edit.addEventListener("click", () => editProduct(product));

    actions.append(sell, edit);

    info.append(
      title,
      category,
      brand,
      tag,
      price,
      stock,
      actions
    );

    card.append(img, info);

    return card;
  }));

  if (version !== renderVersion) return;

  container.replaceChildren(...cards);
}

/* ---------------- ثبت نرخ درهم ---------------- */

async function saveRate() {
  const rate = Number($("rate").value);

  if (!Number.isFinite(rate) || rate <= 0) {
    alert("نرخ درهم را درست وارد کن.");
    return;
  }

  $("saveRate").disabled = true;

  try {
    const { error } = await db
      .from("inventory_settings")
      .upsert({
        id: 1,
        dirham_rate: rate
      });

    if (error) throw error;

    dirhamRate = rate;
    await render();

    alert("نرخ درهم ثبت شد.");

  } catch (error) {
    alert("خطا در ثبت نرخ: " + error.message);
  } finally {
    $("saveRate").disabled = false;
  }
}

/* ---------------- ویرایش محصول ---------------- */

function editProduct(product) {
  editingProduct = product;

  $("pid").value = product.id;
  $("name").value = product.name || "";
  $("category").value = product.category || CATEGORIES[0];
  $("brand").value = product.brand || BRANDS[0];
  $("tag").value = product.tag || "";
  $("description").value = product.description || "";

  $("purchaseType").value = product.purchase_type || "toman";
  $("buyPrice").value = product.buy_price ?? "";
  $("freight").value = product.freight ?? 0;

  $("profitType").value = product.profit_type || "fixed";
  $("profitValue").value = product.profit_value ?? 0;
  $("quantity").value = product.quantity ?? 0;

  $("photo").value = "";

  $("formTitle").textContent = "ویرایش محصول";
  $("saveProduct").textContent = "ذخیره تغییرات";

  formMessage("");
  openModal();
}

/* ---------------- آپلود عکس ---------------- */

async function uploadPhoto(file) {
  if (!file) return null;

  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await db.storage
    .from("inventory-photos")
    .upload(path, file, {
      upsert: false
    });

  if (error) throw error;

  return path;
}

/* ---------------- ذخیره محصول ---------------- */

async function saveProduct() {
  // جلوگیری از ثبت چندباره با کلیک پشت سر هم
  if (saving) return;

  saving = true;
  $("saveProduct").disabled = true;

  const name = $("name").value.trim();
  const buyPrice = Number($("buyPrice").value);
  const quantity = Number($("quantity").value);

  if (
    !name ||
    !Number.isFinite(buyPrice) ||
    buyPrice < 0 ||
    !Number.isInteger(quantity) ||
    quantity < 0
  ) {
    formMessage("اطلاعات نام، قیمت و موجودی را درست وارد کن.", true);
    saving = false;
    $("saveProduct").disabled = false;
    return;
  }

  formMessage("در حال ذخیره محصول...");

  try {
    let imagePath = editingProduct?.image_path || null;

    const file = $("photo").files[0];

    if (file) {
      imagePath = await uploadPhoto(file);
    }

    const row = {
      name,
      category: $("category").value,
      brand: $("brand").value,
      tag: $("tag").value.trim(),
      description: $("description").value.trim(),
      purchase_type: $("purchaseType").value,
      buy_price: buyPrice,
      freight: Number($("freight").value) || 0,
      profit_type: $("profitType").value,
      profit_value: Number($("profitValue").value) || 0,
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
        .insert(rowWithQuantity(row, quantity));

      if (error) throw error;
    }

    resetForm();
    closeModal();

    await refresh();

  } catch (error) {
    console.error("Save error:", error);
    formMessage("خطا در ذخیره: " + error.message, true);

  } finally {
    saving = false;
    $("saveProduct").disabled = false;
  }
}

function rowWithQuantity(row, quantity) {
  return {
    ...row,
    quantity
  };
}

/* ---------------- فروش محصول ---------------- */

async function sellOne(product) {
  if (sellingProducts.has(product.id)) return;

  if (Number(product.quantity) <= 0) {
    alert("موجودی این محصول تمام شده است.");
    return;
  }

  sellingProducts.add(product.id);

  // تغییر فوری موجودی روی صفحه
  const oldQuantity = Number(product.quantity);

  product.quantity = oldQuantity - 1;
  await render();

  try {
    const eventId = crypto.randomUUID();

    const { error } = await db.rpc("apply_inventory_sale", {
      p_event_id: eventId,
      p_product_id: product.id
    });

    if (error) throw error;

    $("sync").textContent = "فروش ثبت شد";

  } catch (error) {
    console.error("Sale error:", error);
    alert("فروش ثبت نشد: " + error.message);

  } finally {
    sellingProducts.delete(product.id);
    await refresh();
  }
}

/* ---------------- همگام‌سازی زنده ---------------- */

function scheduleRefresh() {
  clearTimeout(realtimeTimer);

  realtimeTimer = setTimeout(() => {
    refresh();
  }, 500);
}

function startRealtime() {
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
  }

  realtimeChannel = db.channel("inventory-live")

    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "inventory_products"
    }, scheduleRefresh)

    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "inventory_settings"
    }, scheduleRefresh)

    .subscribe();
}

/* ---------------- ورود و خروج ---------------- */

async function initializeApp() {
  const {
    data: { user }
  } = await db.auth.getUser();

  if (!user) {
    showLogin();
    return;
  }

  if (!ALLOWED_EMAILS.includes((user.email || "").toLowerCase())) {
    await db.auth.signOut();
    showLogin();
    showMessage("این ایمیل اجازه ورود ندارد.", true);
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
    showMessage("این ایمیل اجازه ورود ندارد.", true);
    return;
  }

  $("loginBtn").disabled = true;
  showMessage("در حال ورود...");

  try {
    const { error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    await initializeApp();

  } catch (error) {
    showMessage("خطا در ورود: " + error.message, true);

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

/* ---------------- اتصال دکمه‌ها ---------------- */

$("loginBtn").addEventListener("click", login);
$("logout").addEventListener("click", logout);

$("saveRate").addEventListener("click", saveRate);
$("saveProduct").addEventListener("click", saveProduct);

$("addProductBtn").addEventListener("click", openNewProduct);
$("closeProductModal").addEventListener("click", closeModal);
$("cancelEdit").addEventListener("click", closeModal);

$("search").addEventListener("input", render);

$("productModal").addEventListener("click", event => {
  if (event.target === $("productModal")) {
    closeModal();
  }
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeModal();
  }
});

/* ---------------- شروع برنامه ---------------- */

fillSelect("category", CATEGORIES);
fillSelect("brand", BRANDS);

initializeApp();
