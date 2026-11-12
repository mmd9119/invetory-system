
function renderSales() {
  const rows = $("salesRows");

  if (!rows) {
    console.error("عنصر salesRows در HTML پیدا نشد.");
    return;
  }

  const from = $("salesFrom")?.value || "";
  const to = $("salesTo")?.value || "";

  const allSales = Array.isArray(sales) ? sales : [];

  const list = allSales.filter(s => {
    if (!s || !s.created_at) return false;

    const day = localDate(new Date(s.created_at));

    return (!from || day >= from) && (!to || day <= to);
  });

  const valid = list.filter(s => !s.voided_at);

  $("salesCount").textContent = money(valid.length);

  $("salesTotal").textContent =
    money(valid.reduce((sum, s) => {
      return sum + Number(s.sale_price || 0);
    }, 0)) + " تومان";

  if (list.length === 0) {
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
          <td>
            ${canceled ? "لغوشده" : "ثبت‌شده"}
          </td>
          <td>
            ${canceled
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

  if ($("salesByProduct")) {
    groupSales(valid, "salesByProduct");
  }

  // محاسبه پرفروش‌ترین کالا
  const products = {};

  valid.forEach(s => {
    const name = s.product_name || "کالای نامشخص";

    if (!products[name]) {
      products[name] = {
        name,
        count: 0,
        total: 0
      };
    }

    products[name].count++;
    products[name].total += Number(s.sale_price || 0);
  });

  const ranking = Object.values(products).sort(
    (a, b) => b.count - a.count
  );

  if ($("topSellerName")) {
    $("topSellerName").textContent =
      ranking.length ? ranking[0].name : "فروشی ثبت نشده";
  }

  if ($("topSellerCount")) {
    $("topSellerCount").textContent =
      ranking.length ? ranking[0].count + " عدد فروش" : "۰";
  }

  if ($("topSellerTotal")) {
    $("topSellerTotal").textContent =
      ranking.length
        ? money(ranking[0].total) + " تومان"
        : "۰ تومان";
  }

  if ($("topSellerRanking")) {
    $("topSellerRanking").innerHTML = ranking.map((p, i) => `
      <div class="ranking-row">
        <span>${i + 1}. ${esc(p.name)}</span>
        <span>${p.count} عدد</span>
        <span>${money(p.total)} تومان</span>
      </div>
    `).join("");
  }
}

document.addEventListener("click", function (event) {
  const button = event.target.closest("#filterSales");

  if (!button) return;

  event.preventDefault();

  try {
    renderSales();
  } catch (error) {
    console.error("خطای فیلتر سابقه فروش:", error);
    alert("خطا در فیلتر سابقه فروش. کنسول را بررسی کنید.");
  }
});
