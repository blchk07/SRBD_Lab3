let selectedGoodId = null;

function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(val) {
  if (val === null || val === undefined) return "0.00";
  return Number(val).toFixed(2);
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { status: res.status, data };
  }
  return data;
}

function showMsg(boxId, status, title, text) {
  const box = document.getElementById(boxId);
  const cls = status === true ? "ok" : status === false ? "err" : status;
  box.className = "msg " + cls;
  box.innerHTML = `<strong>${esc(title)}</strong><br>${esc(text)}`;
}

function showApiError(boxId, err) {
  const d = err?.data || {};
  if (d.source === "SQL Server") {
    const code = d.error_code ? `код ${d.error_code}` : `SQLSTATE ${d.sqlstate || "42000"}`;
    const proc = d.procedure ? `, процедура ${d.procedure}` : "";
    showMsg(boxId, false, `Помилка SQL Server (${code}${proc})`, d.message || "Помилка виконання запиту");
    return;
  }
  showMsg(
    boxId,
    false,
    `Помилка HTTP ${err.status || 500}`,
    typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail || err)
  );
}

// перемикання вкладок
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-link").forEach((a) => a.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    link.classList.add("active");
    document.getElementById("tab-" + link.dataset.tab).classList.add("active");
  });
});

async function loadGoods() {
  const goods = await apiRequest("/api/goods");
  const tbody = document.querySelector("#goods-table tbody");
  tbody.innerHTML = "";

  ["price-good-id", "discount-good-id", "sale-good-id"].forEach((id) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = "";
    goods.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.GoodId;
      opt.textContent = `#${g.GoodId} ${g.Name} (${money(g.Price)} грн, зал. ${g.Quantity})`;
      sel.appendChild(opt);
    });
    if (prev && goods.some((g) => String(g.GoodId) === prev)) {
      sel.value = prev;
    }
  });

  goods.forEach((g) => {
    const tr = document.createElement("tr");
    if (selectedGoodId === g.GoodId) tr.classList.add("selected");
    tr.innerHTML = `
      <td>${g.GoodId}</td>
      <td>${esc(g.Name)}</td>
      <td>${esc(g.DepartmentName)}</td>
      <td>${money(g.Price)}</td>
      <td>${g.Quantity}</td>
      <td>${g.SalesCount}</td>
    `;
    tr.addEventListener("click", () => selectGood(g.GoodId));
    tbody.appendChild(tr);
  });

  if (goods.length > 0 && selectedGoodId === null) {
    await selectGood(goods[0].GoodId);
  } else if (selectedGoodId !== null) {
    await selectGood(selectedGoodId);
  }
}

async function selectGood(goodId) {
  selectedGoodId = goodId;
  document.querySelectorAll("#goods-table tbody tr").forEach((row) => {
    row.classList.toggle("selected", Number(row.cells[0].textContent) === goodId);
  });

  const data = await apiRequest(`/api/goods/${goodId}`);
  const g = data.good;
  const sales = data.sales;

  document.getElementById("good-info-body").innerHTML = `
    <tr><td>Артикул (GoodId)</td><td>${g.GoodId}</td></tr>
    <tr><td>Назва</td><td>${esc(g.Name)}</td></tr>
    <tr><td>Виробник</td><td>${esc(g.Producer)}</td></tr>
    <tr><td>Підрозділ</td><td>${esc(g.DepartmentName)}</td></tr>
    <tr><td>Ціна</td><td>${money(g.Price)} грн</td></tr>
    <tr><td>Залишок на складі</td><td>${g.Quantity} шт.</td></tr>
    <tr><td>Опис</td><td>${esc(g.Description || "-")}</td></tr>
  `;

  const salesBody = document.querySelector("#good-sales-table tbody");
  salesBody.innerHTML = "";
  if (sales.length === 0) {
    salesBody.innerHTML = `<tr><td colspan="6">Продажів для цього товару немає</td></tr>`;
    return;
  }

  sales.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.CheckNo}</td>
      <td>${esc(s.SaleDate)}</td>
      <td>${esc(s.CustomerName)}</td>
      <td>${esc(s.CustomerCity)}</td>
      <td>${s.Quantity}</td>
      <td>${money(s.TotalSum)}</td>
    `;
    salesBody.appendChild(tr);
  });
}

async function loadDepartments() {
  const depts = await apiRequest("/api/departments");
  const tbody = document.querySelector("#departments-table tbody");
  tbody.innerHTML = "";

  depts.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d.DeptId}</td>
      <td>${esc(d.Name)}</td>
      <td>${esc(d.Info || "-")}</td>
    `;
    tbody.appendChild(tr);
  });

  ["report-dept-id", "new-good-dept"].forEach((id) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = "";
    depts.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.DeptId;
      opt.textContent = `#${d.DeptId} ${d.Name}`;
      sel.appendChild(opt);
    });
    if (prev && depts.some((d) => String(d.DeptId) === prev)) {
      sel.value = prev;
    }
  });
}

async function loadSalesSelect() {
  const sales = await apiRequest("/api/sales");
  const sel = document.getElementById("upd-sale-id");
  const prev = sel.value;
  sel.innerHTML = "";
  sales.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.SaleId;
    opt.dataset.qty = s.Quantity;
    opt.textContent = `#${s.SaleId} (Чек ${s.CheckNo}) — ${s.GoodName} (${s.Quantity} шт.)`;
    sel.appendChild(opt);
  });
  if (prev && sales.some((s) => String(s.SaleId) === prev)) {
    sel.value = prev;
  }
  const currentOpt = sel.options[sel.selectedIndex];
  if (currentOpt && currentOpt.dataset.qty) {
    document.getElementById("upd-sale-qty").value = Number(currentOpt.dataset.qty) + 1;
  }
}

async function loadWorkers() {
  const workers = await apiRequest("/api/workers");
  const sel = document.getElementById("worker-select");
  sel.innerHTML = "";
  workers.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.Name;
    opt.textContent = `${w.Name} (${w.DepartmentName})`;
    sel.appendChild(opt);
  });
}

async function loadScalarFunctions() {
  const maxPrice = Number(document.getElementById("scalar-max-price").value || 0);
  const res = await apiRequest(`/api/functions/scalar?max_price=${encodeURIComponent(maxPrice)}`);
  document.getElementById("res-avg-price").textContent = `${money(res.avg_price)} грн`;
  document.getElementById("res-below-avg").textContent = `${res.below_avg_count} шт.`;
  document.getElementById("res-within-limit").textContent = `${res.within_limit_count} шт.`;
}

async function loadDeptReport() {
  const deptId = document.getElementById("report-dept-id").value;
  if (!deptId) return;
  const res = await apiRequest(`/api/functions/department-report/${encodeURIComponent(deptId)}`);
  const tbody = document.querySelector("#dept-report-table tbody");
  tbody.innerHTML = "";

  if (res.rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6">Дані відсутні</td></tr>`;
    return;
  }

  res.rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.DepartmentName)}</td>
      <td>${r.GoodId}</td>
      <td>${esc(r.GoodName)}</td>
      <td>${money(r.Price)}</td>
      <td>${r.UnitsSold}</td>
      <td>${money(r.TotalRevenue)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadWorkerTopGood() {
  const custom = document.getElementById("worker-custom").value.trim();
  const workerName = custom || document.getElementById("worker-select").value;
  if (!workerName) return;

  const res = await apiRequest(`/api/functions/top-good-by-worker?worker_name=${encodeURIComponent(workerName)}`);
  const tbody = document.querySelector("#worker-top-table tbody");
  tbody.innerHTML = "";

  res.rows.forEach((r) => {
    const isOk = r.StatusMessage === "Успішно";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(r.WorkerName)}</td>
      <td>${esc(r.GoodName || "NULL")}</td>
      <td>${r.UnitsSold !== null ? r.UnitsSold : "NULL"}</td>
      <td class="${isOk ? "status-ok" : "status-err"}">${esc(r.StatusMessage)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLogs() {
  const logs = await apiRequest("/api/logs");
  const salesBody = document.querySelector("#sales-logs-table tbody");
  salesBody.innerHTML = "";
  if (logs.sales_logs.length === 0) {
    salesBody.innerHTML = `<tr><td colspan="5">Записів немає</td></tr>`;
  } else {
    logs.sales_logs.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.Id}</td>
        <td>${r.SaleId}</td>
        <td>${r.OldQuantity ?? "-"}</td>
        <td>${r.NewQuantity ?? "-"}</td>
        <td>${esc(r.ModifyDate)}</td>
      `;
      salesBody.appendChild(tr);
    });
  }

  const accessBody = document.querySelector("#access-logs-table tbody");
  accessBody.innerHTML = "";
  if (logs.access_logs.length === 0) {
    accessBody.innerHTML = `<tr><td colspan="5">Записів немає</td></tr>`;
  } else {
    logs.access_logs.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.LogId}</td>
        <td>${esc(r.GoodName)}</td>
        <td>${esc(r.AttemptDate)}</td>
        <td>${esc(r.UserName)}</td>
        <td>${esc(r.StatusMessage)}</td>
      `;
      accessBody.appendChild(tr);
    });
  }
}

async function runProcedure(url, method, bodyObj) {
  try {
    const res = await apiRequest(url, {
      method,
      body: JSON.stringify(bodyObj),
    });
    showMsg("proc-result-box", true, "Виконано", res.message);
    await Promise.all([loadGoods(), loadDepartments(), loadLogs()]);
  } catch (err) {
    showApiError("proc-result-box", err);
  }
}

document.getElementById("form-department").addEventListener("submit", (e) => {
  e.preventDefault();
  runProcedure("/api/procedures/department", "POST", {
    name: document.getElementById("dept-name").value,
    info: document.getElementById("dept-info").value,
  });
});

document.getElementById("form-price").addEventListener("submit", (e) => {
  e.preventDefault();
  runProcedure("/api/procedures/good-price", "PUT", {
    good_id: Number(document.getElementById("price-good-id").value || 0),
    new_price: Number(document.getElementById("price-value").value || 0),
  });
});

document.getElementById("form-discount").addEventListener("submit", (e) => {
  e.preventDefault();
  runProcedure("/api/procedures/good-discount", "POST", {
    good_id: Number(document.getElementById("discount-good-id").value || 0),
    discount: Number(document.getElementById("discount-value").value || 0),
  });
});

document.getElementById("form-sale").addEventListener("submit", (e) => {
  e.preventDefault();
  const checkRaw = document.getElementById("sale-check").value.trim();
  runProcedure("/api/procedures/process-sale", "POST", {
    good_id: Number(document.getElementById("sale-good-id").value || 0),
    quantity: Number(document.getElementById("sale-qty").value || 0),
    check_no: checkRaw ? Number(checkRaw) : null,
  });
});

// швидка перевірка користувацьких виключень SQL Server
document.getElementById("btn-err-empty-dept").addEventListener("click", () => {
  runProcedure("/api/procedures/department", "POST", { name: "", info: null });
});
document.getElementById("btn-err-neg-price").addEventListener("click", () => {
  const goodId = Number(document.getElementById("price-good-id").value || 1);
  runProcedure("/api/procedures/good-price", "PUT", { good_id: goodId, new_price: -100 });
});
document.getElementById("btn-err-stock").addEventListener("click", () => {
  const goodId = Number(document.getElementById("sale-good-id").value || 1);
  runProcedure("/api/procedures/process-sale", "POST", { good_id: goodId, quantity: 9999, check_no: null });
});
document.getElementById("btn-err-discount").addEventListener("click", () => {
  const goodId = Number(document.getElementById("discount-good-id").value || 1);
  runProcedure("/api/procedures/good-discount", "POST", { good_id: goodId, discount: 150 });
});

document.getElementById("form-scalar").addEventListener("submit", (e) => {
  e.preventDefault();
  loadScalarFunctions().catch((err) => showApiError("global-alert", err));
});
document.getElementById("form-dept-report").addEventListener("submit", (e) => {
  e.preventDefault();
  loadDeptReport().catch((err) => showApiError("global-alert", err));
});
document.getElementById("form-worker-top").addEventListener("submit", (e) => {
  e.preventDefault();
  loadWorkerTopGood().catch((err) => showApiError("global-alert", err));
});

document.getElementById("btn-refresh-goods").addEventListener("click", () => {
  loadGoods().catch((err) => showApiError("global-alert", err));
});
document.getElementById("btn-refresh-depts").addEventListener("click", () => {
  loadDepartments().catch((err) => showApiError("global-alert", err));
});
document.getElementById("upd-sale-id").addEventListener("change", (e) => {
  const opt = e.target.options[e.target.selectedIndex];
  if (opt && opt.dataset.qty) {
    document.getElementById("upd-sale-qty").value = Number(opt.dataset.qty) + 1;
  }
});

document.getElementById("form-update-sale").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saleId = Number(document.getElementById("upd-sale-id").value || 0);
  const qty = Number(document.getElementById("upd-sale-qty").value || 0);
  try {
    const res = await apiRequest(`/api/sales/${saleId}`, {
      method: "PUT",
      body: JSON.stringify({ quantity: qty }),
    });
    showMsg("logs-result-box", "ok", "Виконано", res.message);
    await Promise.all([loadLogs(), loadSalesSelect(), loadGoods()]);
  } catch (err) {
    showApiError("logs-result-box", err);
  }
});

document.getElementById("form-add-good").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const res = await apiRequest("/api/goods", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("new-good-name").value,
        producer: document.getElementById("new-good-producer").value,
        price: Number(document.getElementById("new-good-price").value || 0),
        quantity: Number(document.getElementById("new-good-qty").value || 0),
        dept_id: Number(document.getElementById("new-good-dept").value || 1),
        description: document.getElementById("new-good-desc").value,
      }),
    });
    if (res.blocked_by_trigger) {
      showMsg("logs-result-box", "warn", "Вставку заблоковано на боці БД", res.message);
    } else {
      showMsg("logs-result-box", "ok", "Виконано", res.message);
    }
    await Promise.all([loadLogs(), loadGoods()]);
  } catch (err) {
    showApiError("logs-result-box", err);
  }
});

document.getElementById("btn-refresh-logs").addEventListener("click", () => {
  Promise.all([loadLogs(), loadSalesSelect()]).catch((err) => showApiError("global-alert", err));
});

async function init() {
  try {
    await Promise.all([loadGoods(), loadDepartments(), loadWorkers(), loadLogs(), loadSalesSelect()]);
    await Promise.all([loadScalarFunctions(), loadDeptReport(), loadWorkerTopGood()]);
  } catch (err) {
    showApiError("global-alert", err);
  }
}

init();
