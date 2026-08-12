const state = {
  initialData: null,
  store: { submissions: [], manualItems: [], customAthletes: [], removedAthleteIds: [] },
  accessCodes: [],
  unlockedAthletes: {},
  pendingPasswordChange: null,
  selectedAthleteId: "",
  activeView: "athlete",
  activeCategory: "Todos",
  manualDraftLines: [],
  adminUnlocked: false,
  adminCode: "",
  adminTab: "payments",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const currency = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function money(value) {
  return currency.format(Number(value || 0));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function api(path, options = {}) {
  const { admin: forceAdmin, ...fetchOptions } = options;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (state.adminCode && (state.adminUnlocked || path === "/api/admin/check" || forceAdmin)) {
    headers["X-Admin-Code"] = state.adminCode;
  }
  const response = await fetch(path, {
    ...fetchOptions,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la accion.");
  return payload;
}

async function loadData() {
  const payload = await api("/api/data");
  state.initialData = payload.initialData;
  state.store = payload.store;
  state.accessCodes = payload.accessCodes || [];
  renderAll();
}

function teams() {
  return state.initialData?.teams || [];
}

function allAthletes() {
  return teams()
    .flatMap((team) => team.athletes)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function selectedAthlete() {
  return state.unlockedAthletes[state.selectedAthleteId]?.athlete ||
    allAthletes().find((athlete) => athlete.id === state.selectedAthleteId) ||
    null;
}

function selectedUnlock() {
  return state.unlockedAthletes[state.selectedAthleteId] || null;
}

function athleteIsUnlocked(athleteId = state.selectedAthleteId) {
  return state.adminUnlocked || Boolean(state.unlockedAthletes[athleteId]);
}

function allSubmissions() {
  if (state.adminUnlocked) {
    return [
      ...(state.initialData?.importedSubmissions || []),
      ...(state.store.submissions || []),
    ];
  }
  return Object.values(state.unlockedAthletes).flatMap((record) => record.submissions || []);
}

function statusLabel(status) {
  return {
    importado: "Excel",
    pendiente: "Pendiente",
    aprobado: "Aprobado",
    rechazado: "Rechazado",
  }[status] || status;
}

function activePayment(status) {
  return status !== "rechazado";
}

function flattenSubmissions(submissions = allSubmissions()) {
  return submissions.flatMap((submission) =>
    (submission.lines || []).map((line) => ({
      submissionId: submission.id,
      createdAt: submission.createdAt,
      paidAt: submission.paidAt,
      athleteId: submission.athleteId,
      athleteName: submission.athleteName,
      team: submission.team,
      payerName: submission.payerName,
      status: submission.status,
      source: submission.source,
      supportUrl: submission.supportUrl,
      supportName: submission.supportName,
      notes: submission.notes,
      category: line.category,
      itemName: line.itemName,
      chargeId: line.chargeId,
      amount: Number(line.amount || 0),
      detail: line.detail,
    }))
  );
}

function athleteSubmissions(athleteId) {
  const source = state.adminUnlocked
    ? allSubmissions()
    : state.unlockedAthletes[athleteId]?.submissions || [];
  return source
    .filter((submission) => submission.athleteId === athleteId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function athleteLineTotal(athleteId, predicate = () => true) {
  return flattenSubmissions().reduce((sum, line) => {
    if (line.athleteId !== athleteId || !activePayment(line.status) || !predicate(line)) return sum;
    return sum + line.amount;
  }, 0);
}

function chargesForAthlete(athlete) {
  if (!athlete || !athleteIsUnlocked(athlete.id)) return [];
  const manualItems = state.adminUnlocked
    ? state.store.manualItems || []
    : state.unlockedAthletes[athlete.id]?.manualItems || [];
  const manualCharges = manualItems
    .filter((item) => item.active && item.team === athlete.team && (!item.athleteId || item.athleteId === athlete.id))
    .map((item) => ({
      id: item.id,
      category: item.category,
      itemName: item.itemName,
      suggestedAmount: Number(item.suggestedAmount || 0),
      expectedAmount: Number(item.suggestedAmount || 0),
      excelAmount: 0,
      sourceCell: "Panel administrador",
      manual: true,
    }));
  return [...(athlete.charges || []), ...manualCharges];
}

function chargePaidTotal(athleteId, chargeId) {
  return flattenSubmissions().reduce((sum, line) => {
    if (line.athleteId === athleteId && line.chargeId === chargeId && activePayment(line.status)) {
      return sum + line.amount;
    }
    return sum;
  }, 0);
}

function chargeExpectedAmount(charge) {
  if (charge.category === "Mensualidad" && charge.monthNo) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const paid = chargePaidTotal(state.selectedAthleteId, charge.id);
    const base = Number(charge.baseAmount || 80000);
    const late = Number(charge.lateAmount || 90000);
    const lateDay = Number(charge.lateDay || 10);
    if (Number(charge.monthNo) === currentMonth && now.getDate() > lateDay && paid < base) {
      return late;
    }
    if (Number(charge.monthNo) > currentMonth) return base;
    return Math.max(base, paid);
  }
  return Number(charge.expectedAmount || charge.suggestedAmount || charge.excelAmount || 0);
}

function chargeBalance(athleteId, charge) {
  return Math.max(chargeExpectedAmount(charge) - chargePaidTotal(athleteId, charge.id), 0);
}

function athleteBalance(athlete) {
  return chargesForAthlete(athlete).reduce((sum, charge) => sum + chargeBalance(athlete.id, charge), 0);
}

function showAlert(message, type = "success") {
  const region = $("#alertRegion");
  region.innerHTML = `<div class="alert ${type}">${escapeHtml(message)}</div>`;
  window.setTimeout(() => {
    if (region.textContent.includes(message)) region.innerHTML = "";
  }, 5200);
}

function renderAll() {
  renderTeamFilters();
  renderDatasetStatus();
  renderAthleteSearch();
  renderSelectedAthlete();
  renderHistoryView();
  renderAdmin();
}

function renderDatasetStatus() {
  const athleteCount = allAthletes().length;
  const imported = state.adminUnlocked ? state.initialData?.importedSubmissions?.length || 0 : null;
  $("#datasetStatus").textContent = state.adminUnlocked
    ? `${athleteCount} deportistas - ${imported} pagos Excel`
    : `${athleteCount} deportistas - datos protegidos`;
}

function renderTeamFilters() {
  const options = [`<option value="">Todos los equipos</option>`]
    .concat(teams().map((team) => `<option value="${escapeHtml(team.name)}">${escapeHtml(team.name)}</option>`))
    .join("");
  for (const id of ["teamFilter", "adminTeamFilter"]) {
    const select = $(`#${id}`);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = options;
    select.value = current;
  }
}

function filteredAthletesForSearch() {
  const team = $("#teamFilter").value;
  const query = normalizeText($("#athleteSearch").value);
  return allAthletes()
    .filter((athlete) => !team || athlete.team === team)
    .filter((athlete) => !query || normalizeText(`${athlete.name} ${athlete.team}`).includes(query))
    .slice(0, 12);
}

function renderAthleteSearch() {
  const results = $("#searchResults");
  const query = $("#athleteSearch").value.trim();
  if (!query) {
    results.classList.remove("active");
    results.innerHTML = "";
    return;
  }

  const matches = filteredAthletesForSearch();
  results.innerHTML = matches.length
    ? matches
        .map(
          (athlete) => `
            <button class="search-result" type="button" data-athlete-id="${escapeHtml(athlete.id)}">
              <span>${escapeHtml(athlete.name)}</span>
              <strong>${escapeHtml(athlete.team)}</strong>
            </button>
          `
        )
        .join("")
    : `<div class="search-result">Sin coincidencias</div>`;
  results.classList.add("active");
}

function selectAthlete(id) {
  const changedAthlete = state.selectedAthleteId && state.selectedAthleteId !== id;
  if (changedAthlete) state.unlockedAthletes = {};
  state.selectedAthleteId = id;
  state.activeCategory = "Todos";
  state.manualDraftLines = [];
  state.pendingPasswordChange = null;
  const athlete = selectedAthlete();
  if (athlete) {
    $("#athleteSearch").value = athlete.name;
    $("#teamFilter").value = athlete.team;
    $("#searchResults").classList.remove("active");
  }
  renderSelectedAthlete();
  renderHistoryView();
}

function logoutAthlete() {
  if (state.selectedAthleteId) delete state.unlockedAthletes[state.selectedAthleteId];
  state.manualDraftLines = [];
  state.pendingPasswordChange = null;
  $("#athleteAccessCode").value = "";
  $("#newAthletePassword").value = "";
  $("#confirmAthletePassword").value = "";
  renderSelectedAthlete();
  renderHistoryView();
  showAlert("Sesion privada cerrada.");
}

function renderSelectedAthlete() {
  const athlete = selectedAthlete();
  $("#paidAt").value = $("#paidAt").value || today();
  $("#selectedAthletePanel").classList.toggle("hidden", !athlete);
  $("#emptyAthleteState").classList.toggle("hidden", Boolean(athlete));
  if (!athlete) return;

  $("#selectedAthleteName").textContent = athlete.name;
  $("#selectedTeamBadge").textContent = athlete.team;
  const unlocked = athleteIsUnlocked(athlete.id);
  const changingPassword = state.pendingPasswordChange?.athleteId === athlete.id;
  $("#athleteAccessForm").classList.toggle("hidden", unlocked || changingPassword);
  $("#athletePasswordForm").classList.toggle("hidden", unlocked || !changingPassword);
  $("#athletePrivateArea").classList.toggle("hidden", !unlocked);
  if (!unlocked) {
    if (changingPassword) {
      $("#newAthletePassword").focus();
    } else {
      $("#athleteAccessCode").value = "";
      $("#athleteAccessCode").focus();
    }
    return;
  }
  renderAthleteSummary(athlete);
  renderCategoryFilters(athlete);
  renderChargeList(athlete);
  renderManualDraftList();
  renderAthleteHistory(athlete);
  updatePaymentTotal();
}

function renderAthleteSummary(athlete) {
  const submissions = athleteSubmissions(athlete.id);
  const total = athleteLineTotal(athlete.id);
  const balance = athleteBalance(athlete);
  const pending = submissions.filter((item) => item.status === "pendiente").length;
  const charges = chargesForAthlete(athlete);
  $("#athleteSummary").innerHTML = [
    ["Pagado registrado", money(total)],
    ["Saldo estimado", money(balance)],
    ["Pagos en historial", submissions.length],
    ["Items pendientes", charges.filter((charge) => chargeBalance(athlete.id, charge) > 0).length],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function categoryList(athlete) {
  return ["Todos", ...new Set(chargesForAthlete(athlete).map((charge) => charge.category))];
}

function renderCategoryFilters(athlete) {
  const categories = categoryList(athlete);
  if (!categories.includes(state.activeCategory)) state.activeCategory = "Todos";
  $("#categoryFilters").innerHTML = categories
    .map(
      (category) => `
        <button type="button" class="${category === state.activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `
    )
    .join("");
}

function renderChargeList(athlete) {
  const charges = chargesForAthlete(athlete).filter(
    (charge) => state.activeCategory === "Todos" || charge.category === state.activeCategory
  );
  $("#chargeList").innerHTML = charges
    .map((charge) => {
      const paid = chargePaidTotal(athlete.id, charge.id);
      const expected = chargeExpectedAmount(charge);
      const balance = chargeBalance(athlete.id, charge);
      const settled = balance <= 0 && expected > 0;
      return `
        <div class="charge-row ${settled ? "settled" : ""}" data-charge-id="${escapeHtml(charge.id)}">
          <input type="checkbox" class="charge-check" data-charge-id="${escapeHtml(charge.id)}" aria-label="${escapeHtml(charge.itemName)}" ${settled ? "disabled" : ""} />
          <div class="charge-title">
            <strong>${escapeHtml(charge.itemName)}</strong>
            <span>${escapeHtml(charge.category)} - ${escapeHtml(charge.sourceCell || "Item manual")}</span>
          </div>
          <div class="charge-amount">
            <span>Total</span>
            <strong>${money(expected)}</strong>
            <span>Abonado ${money(paid)} Â· saldo ${money(balance)}</span>
          </div>
          <label class="field line-input">
            <span>Valor a pagar</span>
            <input class="charge-value" data-charge-id="${escapeHtml(charge.id)}" type="number" min="0" step="1000" value="${Math.round(balance)}" ${settled ? "disabled" : ""} />
          </label>
        </div>
      `;
    })
    .join("");
}

function renderManualDraftList() {
  $("#manualDraftList").innerHTML = state.manualDraftLines
    .map(
      (line) => `
        <div class="manual-draft">
          <span><strong>${escapeHtml(line.itemName)}</strong> Â· ${escapeHtml(line.category)} Â· ${money(line.amount)}</span>
          <button type="button" data-remove-manual="${escapeHtml(line.id)}">Quitar</button>
        </div>
      `
    )
    .join("");
}

function renderAthleteHistory(athlete) {
  const submissions = athleteSubmissions(athlete.id).slice(0, 8);
  $("#athleteHistoryCount").textContent = `${athleteSubmissions(athlete.id).length} pagos`;
  $("#athleteHistoryList").innerHTML = submissions.length
    ? submissions.map(historyListItem).join("")
    : `<div class="list-item"><span class="list-meta">Sin pagos registrados.</span></div>`;
}

function historyListItem(submission) {
  const items = (submission.lines || []).map((line) => line.itemName).join(", ");
  return `
    <div class="list-item">
      <div class="list-line">
        <strong>${money(submission.total)}</strong>
        <span class="status-pill ${escapeHtml(submission.status)}">${escapeHtml(statusLabel(submission.status))}</span>
      </div>
      <span class="list-title">${escapeHtml(items)}</span>
      <span class="list-meta">${escapeHtml(submission.paidAt || "")} Â· ${escapeHtml(submission.source || "")}</span>
      ${submission.supportUrl ? `<a href="${escapeHtml(submission.supportUrl)}" target="_blank" rel="noreferrer">Ver soporte</a>` : ""}
    </div>
  `;
}

function updatePaymentTotal() {
  const athlete = selectedAthlete();
  if (!athlete) return;
  const checkedTotal = $$(".charge-check:checked").reduce((sum, checkbox) => {
    const input = $(`.charge-value[data-charge-id="${CSS.escape(checkbox.dataset.chargeId)}"]`);
    return sum + Number(input?.value || 0);
  }, 0);
  const manualTotal = state.manualDraftLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  $("#paymentTotal").textContent = money(checkedTotal + manualTotal);
  $("#selectedItemCount").textContent = `${$$(".charge-check:checked").length + state.manualDraftLines.length} items`;
}

function addManualLine() {
  const category = $("#manualCategory").value.trim();
  const itemName = $("#manualItemName").value.trim();
  const amount = Number($("#manualAmount").value || 0);
  if (!itemName || !amount || amount <= 0) {
    showAlert("Completa el item manual y un valor mayor a cero.", "error");
    return;
  }
  state.manualDraftLines.push({
    id: `manual-ui-${crypto.randomUUID()}`,
    chargeId: `manual-${crypto.randomUUID()}`,
    category,
    itemName,
    amount,
    detail: "Item agregado en el formulario",
  });
  $("#manualItemName").value = "";
  $("#manualAmount").value = "";
  renderManualDraftList();
  updatePaymentTotal();
}

function selectedPaymentLines() {
  const athlete = selectedAthlete();
  if (!athlete) return [];
  const chargeMap = new Map(chargesForAthlete(athlete).map((charge) => [charge.id, charge]));
  const checked = $$(".charge-check:checked").map((checkbox) => {
    const charge = chargeMap.get(checkbox.dataset.chargeId);
    const input = $(`.charge-value[data-charge-id="${CSS.escape(checkbox.dataset.chargeId)}"]`);
    return {
      chargeId: checkbox.dataset.chargeId,
      category: charge?.category || "Concepto",
      itemName: charge?.itemName || "Item",
      amount: Number(input?.value || 0),
      detail: charge?.sourceCell || "",
    };
  });
  return [...checked, ...state.manualDraftLines].filter((line) => line.amount > 0);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el soporte."));
    reader.readAsDataURL(file);
  });
}

async function unlockAthlete(athleteId, accessCode, options = {}) {
  const payload = await api("/api/athlete/check", {
    method: "POST",
    body: { athleteId, accessCode },
  });
  if (payload.requiresPasswordChange) {
    state.pendingPasswordChange = { athleteId, currentAccessCode: accessCode };
    if (!options.silent) showAlert("Crea una contraseÃ±a nueva para continuar.");
    renderSelectedAthlete();
    renderHistoryView();
    return;
  }
  state.unlockedAthletes[athleteId] = {
    athlete: payload.athlete,
    submissions: payload.submissions || [],
    manualItems: payload.manualItems || [],
    accessCode,
  };
  if (!options.silent) showAlert("Acceso validado.");
  renderSelectedAthlete();
  renderHistoryView();
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const athlete = selectedAthlete();
  const pending = state.pendingPasswordChange;
  const newPassword = $("#newAthletePassword").value.trim();
  const confirmPassword = $("#confirmAthletePassword").value.trim();
  if (!athlete || !pending || pending.athleteId !== athlete.id) return;
  if (newPassword.length < 6) {
    showAlert("La nueva contraseÃ±a debe tener al menos 6 caracteres.", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showAlert("La confirmaciÃ³n no coincide.", "error");
    return;
  }
  try {
    const payload = await api("/api/athlete/password", {
      method: "POST",
      body: {
        athleteId: athlete.id,
        currentAccessCode: pending.currentAccessCode,
        newAccessCode: newPassword,
      },
    });
    state.pendingPasswordChange = null;
    state.unlockedAthletes[athlete.id] = {
      athlete: payload.athlete,
      submissions: payload.submissions || [],
      manualItems: payload.manualItems || [],
      accessCode: newPassword,
    };
    $("#newAthletePassword").value = "";
    $("#confirmAthletePassword").value = "";
    showAlert("ContraseÃ±a actualizada.");
    renderSelectedAthlete();
    renderHistoryView();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function submitAthleteAccess(event) {
  event.preventDefault();
  const athlete = selectedAthlete();
  const accessCode = $("#athleteAccessCode").value.trim();
  if (!athlete || !accessCode) {
    showAlert("Ingresa el codigo asignado para este deportista.", "error");
    return;
  }
  try {
    await unlockAthlete(athlete.id, accessCode);
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function submitPayment(event) {
  event.preventDefault();
  const athlete = selectedAthlete();
  if (!athlete) return;
  const unlock = selectedUnlock();
  if (!unlock && !state.adminUnlocked) {
    showAlert("Primero valida el codigo de acceso del deportista.", "error");
    return;
  }
  const lines = selectedPaymentLines();
  const file = $("#supportFile").files[0];
  if (!lines.length) {
    showAlert("Selecciona al menos un item o agrega uno manual.", "error");
    return;
  }
  if (!file) {
    showAlert("Adjunta el soporte del pago.", "error");
    return;
  }

  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Enviando...";
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await api("/api/payments", {
      method: "POST",
      body: {
        athleteId: athlete.id,
        athleteName: athlete.name,
        team: athlete.team,
        accessCode: unlock?.accessCode || "",
        payerName: $("#payerName").value,
        paidAt: $("#paidAt").value || today(),
        notes: $("#paymentNotes").value,
        lines,
        support: { fileName: file.name, type: file.type, dataUrl },
      },
    });
    showAlert("Pago enviado. Queda pendiente de revisiÃ³n administrativa.");
    state.manualDraftLines = [];
    $("#paymentForm").reset();
    $("#paidAt").value = today();
    if (unlock?.accessCode) await unlockAthlete(athlete.id, unlock.accessCode, { silent: true });
    renderSelectedAthlete();
  } catch (error) {
    showAlert(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Enviar pago";
  }
}

function renderHistoryView() {
  const athlete = selectedAthlete();
  $("#historyAthleteBadge").textContent = athlete ? athlete.team : "Sin deportista";
  if (!athlete) {
    $("#historySummary").innerHTML = `<div class="metric"><span>Deportista</span><strong>Selecciona un nombre</strong></div>`;
    $("#historyTable").innerHTML = "";
    return;
  }
  if (!athleteIsUnlocked(athlete.id)) {
    $("#historySummary").innerHTML = `<div class="metric"><span>Acceso</span><strong>Valida el codigo del deportista</strong></div>`;
    $("#historyTable").innerHTML = `<div class="empty-state"><h2>Historial protegido</h2><p>Ingresa el codigo en Registrar pago para ver estos movimientos.</p></div>`;
    return;
  }
  const submissions = athleteSubmissions(athlete.id);
  const total = athleteLineTotal(athlete.id);
  const balance = athleteBalance(athlete);
  const approved = athleteLineTotal(athlete.id, (line) => line.status === "aprobado" || line.status === "importado");
  const pending = athleteLineTotal(athlete.id, (line) => line.status === "pendiente");
  $("#historySummary").innerHTML = [
    ["Deportista", athlete.name],
    ["Total registrado", money(total)],
    ["Saldo estimado", money(balance)],
    ["Aprobado / Excel", money(approved)],
  ]
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  $("#historyTable").innerHTML = renderSubmissionTable(submissions, { admin: false });
}

function adminRows() {
  const team = $("#adminTeamFilter")?.value || "";
  const status = $("#adminStatusFilter")?.value || "";
  const item = $("#adminItemFilter")?.value || "";
  const query = normalizeText($("#adminSearch")?.value || "");
  return flattenSubmissions().filter((line) => {
    if (team && line.team !== team) return false;
    if (status && line.status !== status) return false;
    if (item && `${line.category}::${line.itemName}` !== item) return false;
    if (query && !normalizeText(`${line.athleteName} ${line.team} ${line.itemName} ${line.notes} ${line.payerName}`).includes(query)) return false;
    return true;
  });
}

function adminSubmissions() {
  const rows = adminRows();
  const ids = new Set(rows.map((row) => row.submissionId));
  return allSubmissions().filter((submission) => ids.has(submission.id));
}

function renderAdmin() {
  $("#adminLocked").classList.toggle("hidden", state.adminUnlocked);
  $("#adminPanel").classList.toggle("hidden", !state.adminUnlocked);
  if (!state.adminUnlocked || !state.initialData) return;
  renderAdminItemFilter();
  renderAdminMetrics();
  renderAdminContent();
}

function renderAdminItemFilter() {
  const select = $("#adminItemFilter");
  const current = select.value;
  const items = [...new Map(flattenSubmissions().map((row) => [`${row.category}::${row.itemName}`, row])).entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"));
  select.innerHTML = `<option value="">Todos</option>` + items
    .map(([key, row]) => `<option value="${escapeHtml(key)}">${escapeHtml(row.category)} Â· ${escapeHtml(row.itemName)}</option>`)
    .join("");
  select.value = current;
}

function renderAdminMetrics() {
  const rows = adminRows();
  const activeRows = rows.filter((row) => activePayment(row.status));
  const total = activeRows.reduce((sum, row) => sum + row.amount, 0);
  const pendingSubmissions = adminSubmissions().filter((item) => item.status === "pendiente").length;
  const athletes = new Set(rows.map((row) => row.athleteId)).size;
  $("#adminMetrics").innerHTML = [
    ["Total filtrado", money(total)],
    ["Pagos pendientes", pendingSubmissions],
    ["Deportistas", athletes],
    ["Lineas de pago", rows.length],
  ]
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderAdminContent() {
  const content = $("#adminContent");
  if (state.adminTab === "payments") {
    content.innerHTML = renderSubmissionTable(adminSubmissions(), { admin: true });
    return;
  }
  if (state.adminTab === "catalog") {
    content.innerHTML = renderCatalog();
    populateCatalogAthletes();
    return;
  }
  if (state.adminTab === "athletes") {
    content.innerHTML = renderAthletesAdmin();
    populateAthleteAdminTeams();
    return;
  }
  if (state.adminTab === "imports") {
    content.innerHTML = renderImportsAdmin();
    return;
  }
  const key = state.adminTab === "team" ? "team" : state.adminTab === "athlete" ? "athleteName" : "itemName";
  const label = state.adminTab === "team" ? "Equipo" : state.adminTab === "athlete" ? "Deportista" : "Item";
  content.innerHTML = renderGroupTable(adminRows(), key, label);
}

function renderSubmissionTable(submissions, { admin }) {
  if (!submissions.length) {
    return `<div class="empty-state"><h2>Sin registros</h2><p>No hay pagos para los filtros actuales.</p></div>`;
  }
  const rows = submissions
    .map((submission) => {
      const items = (submission.lines || [])
        .map((line) => `${escapeHtml(line.category)}: ${escapeHtml(line.itemName)} (${money(line.amount)})`)
        .join("<br>");
      const support = submission.supportUrl
        ? `<a href="${escapeHtml(submission.supportUrl)}" target="_blank" rel="noreferrer">${escapeHtml(submission.supportName || "Soporte")}</a>`
        : `<span class="list-meta">Excel</span>`;
      const reviewActions = admin && submission.source !== "Excel 2026"
        ? `
            <button class="status-button approve" type="button" data-status-id="${escapeHtml(submission.id)}" data-status="aprobado">Aprobar</button>
            <button class="status-button reject" type="button" data-status-id="${escapeHtml(submission.id)}" data-status="rechazado">Rechazar</button>
            <button class="status-button" type="button" data-status-id="${escapeHtml(submission.id)}" data-status="pendiente">Pendiente</button>
          `
        : "";
      const actions = admin
        ? `<div class="status-actions">
            ${reviewActions}
            <button class="status-button reject" type="button" data-delete-payment="${escapeHtml(submission.id)}">Eliminar</button>
          </div>`
        : "";
      return `
        <tr>
          <td>${escapeHtml(submission.paidAt || "")}</td>
          <td><strong>${escapeHtml(submission.athleteName)}</strong><br><span class="list-meta">${escapeHtml(submission.team)}</span></td>
          <td>${items}</td>
          <td class="money"><strong>${money(submission.total)}</strong></td>
          <td><span class="status-pill ${escapeHtml(submission.status)}">${escapeHtml(statusLabel(submission.status))}</span></td>
          <td>${support}</td>
          ${admin ? `<td>${actions}</td>` : ""}
        </tr>
      `;
    })
    .join("");
  return `
    <div class="data-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Deportista</th>
            <th>Detalle</th>
            <th class="money">Valor</th>
            <th>Estado</th>
            <th>Soporte</th>
            ${admin ? "<th>Acciones</th>" : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderGroupTable(rows, key, label) {
  const groups = new Map();
  for (const row of rows) {
    const groupKey = key === "itemName" ? `${row.category} Â· ${row.itemName}` : row[key];
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { total: 0, count: 0, pending: 0, approved: 0, rejected: 0 });
    }
    const group = groups.get(groupKey);
    group.count += 1;
    if (row.status === "pendiente") group.pending += row.amount;
    if (row.status === "aprobado" || row.status === "importado") group.approved += row.amount;
    if (row.status === "rechazado") group.rejected += row.amount;
    if (activePayment(row.status)) group.total += row.amount;
  }
  const body = [...groups.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(
      ([name, group]) => `
        <tr>
          <td><strong>${escapeHtml(name)}</strong></td>
          <td class="money">${money(group.total)}</td>
          <td class="money">${money(group.approved)}</td>
          <td class="money">${money(group.pending)}</td>
          <td class="money">${money(group.rejected)}</td>
          <td>${group.count}</td>
        </tr>
      `
    )
    .join("");
  return `
    <div class="data-table-wrap">
      <table>
        <thead>
          <tr>
            <th>${escapeHtml(label)}</th>
            <th class="money">Total activo</th>
            <th class="money">Aprobado / Excel</th>
            <th class="money">Pendiente</th>
            <th class="money">Rechazado</th>
            <th>Lineas</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="6">Sin datos</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderCatalog() {
  const manualRows = (state.store.manualItems || [])
    .filter((item) => item.active !== false)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.team)}</td>
          <td>${escapeHtml(item.athleteName || "Todo el equipo")}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.itemName)}</td>
          <td class="money">${money(item.suggestedAmount)}</td>
          <td class="status-actions"><button class="status-button reject" type="button" data-delete-item="${escapeHtml(item.id)}">Eliminar</button></td>
        </tr>
      `
    )
    .join("");
  return `
    <div class="admin-action-title">
      <h3>Agregar item de cobro</h3>
      <span>Puede ser para todo el equipo o para un solo deportista.</span>
    </div>
    <form id="catalogForm" class="catalog-form">
      <label class="field">
        <span>Equipo</span>
        <select id="catalogTeam"></select>
      </label>
      <label class="field">
        <span>Deportista</span>
        <select id="catalogAthlete"></select>
      </label>
      <label class="field">
        <span>Tipo</span>
        <select id="catalogCategory">
          <option>Mensualidad</option>
          <option>Concepto</option>
          <option>Flexibilidad</option>
          <option>Otro</option>
        </select>
      </label>
      <label class="field">
        <span>Item</span>
        <input id="catalogItemName" type="text" placeholder="Nombre del cobro" />
      </label>
      <label class="field">
        <span>Valor</span>
        <input id="catalogAmount" type="number" min="0" step="1000" placeholder="0" />
      </label>
      <button class="primary-button" type="submit">Agregar cobro</button>
    </form>
    <div class="data-table-wrap">
      <table>
        <thead>
          <tr><th>Equipo</th><th>Deportista</th><th>Tipo</th><th>Item</th><th class="money">Valor</th><th>Acciones</th></tr>
        </thead>
        <tbody>${manualRows || `<tr><td colspan="6">Sin items manuales.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderImportsAdmin() {
  return `
    <div class="admin-action-title">
      <h3>Cargas masivas</h3>
      <span>Pega datos copiados desde Excel o CSV. La primera fila debe contener encabezados.</span>
    </div>
    <div class="bulk-grid">
      <form id="bulkAthletesForm" class="bulk-card">
        <h3>Cargar deportistas</h3>
        <p>Columnas: equipo, deportista</p>
        <textarea id="bulkAthletesText" rows="10" spellcheck="false">equipo\tdeportista
KIDS\tNombre Ejemplo</textarea>
        <button class="primary-button" type="submit">Cargar deportistas</button>
      </form>
      <form id="bulkItemsForm" class="bulk-card">
        <h3>Cargar items de cobro</h3>
        <p>Columnas: equipo, deportista, categoria, item, valor. Deja deportista vacio para todo el equipo.</p>
        <textarea id="bulkItemsText" rows="10" spellcheck="false">equipo\tdeportista\tcategoria\titem\tvalor
KIDS\t\tConcepto\tMono\t30000</textarea>
        <button class="primary-button" type="submit">Cargar items de cobro</button>
      </form>
    </div>
    <div class="empty-state compact-empty">
      <h2>Plantillas</h2>
      <p>Tambien deje plantillas Excel en la carpeta outputs para llenar y copiar/pegar aqui.</p>
    </div>
  `;
}

function normalizeHeader(value) {
  const key = normalizeText(value).replace(/[^a-z0-9]/g, "");
  return {
    equipo: "team",
    team: "team",
    deportista: "athleteName",
    nombre: "name",
    athlete: "athleteName",
    athletename: "athleteName",
    iddeportista: "athleteId",
    athleteid: "athleteId",
    fecha: "paidAt",
    paidat: "paidAt",
    categoria: "category",
    category: "category",
    tipo: "category",
    item: "itemName",
    concepto: "itemName",
    itemname: "itemName",
    valor: "amount",
    abono: "amount",
    amount: "amount",
    estado: "status",
    status: "status",
    pagador: "payerName",
    payer: "payerName",
    payername: "payerName",
    notas: "notes",
    nota: "notes",
    notes: "notes",
    detalle: "detail",
    detail: "detail",
  }[key] || key;
}

function splitDelimitedLine(line, delimiter) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseAmount(value) {
  let cleaned = String(value || "")
    .replace(/\$/g, "")
    .replace(/\s/g, "");
  if (cleaned.includes(".") && cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  } else if (/,\d{3}$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, ".");
  } else {
    cleaned = cleaned.replace(/\./g, "");
  }
  return Number(cleaned || 0);
}

function parseBulkRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const first = lines[0];
  const delimiter = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const headers = splitDelimitedLine(first, delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    if (row.amount !== undefined) row.amount = parseAmount(row.amount);
    return row;
  });
}

function accessCodeFor(athleteId) {
  return state.accessCodes.find((item) => item.athleteId === athleteId)?.accessCode || "";
}

function accessRecordFor(athleteId) {
  return state.accessCodes.find((item) => item.athleteId === athleteId) || {};
}

function renderAthletesAdmin() {
  const query = normalizeText($("#adminSearch")?.value || "");
  const team = $("#adminTeamFilter")?.value || "";
  const athletes = allAthletes()
    .filter((athlete) => !team || athlete.team === team)
    .filter((athlete) => !query || normalizeText(`${athlete.name} ${athlete.team}`).includes(query));
  const rows = athletes
    .map(
      (athlete) => {
        const access = accessRecordFor(athlete.id);
        return `
        <tr>
          <td><strong>${escapeHtml(athlete.name)}</strong></td>
          <td>${escapeHtml(athlete.team)}</td>
          <td><code>${escapeHtml(access.accessCode || "")}</code></td>
          <td>${access.mustChangePassword ? "Debe cambiar" : "Actualizada"}</td>
          <td class="status-actions">
            <button class="status-button" type="button" data-reset-password="${escapeHtml(athlete.id)}">Cambiar codigo</button>
            <button class="status-button reject" type="button" data-remove-athlete="${escapeHtml(athlete.id)}">Quitar</button>
          </td>
        </tr>
      `;
      }
    )
    .join("");
  return `
    <div class="admin-action-title">
      <h3>Agregar deportista</h3>
      <span>El sistema crea automaticamente un codigo inicial privado.</span>
    </div>
    <form id="athleteAdminForm" class="athlete-admin-form">
      <label class="field">
        <span>Equipo</span>
        <select id="athleteAdminTeam"></select>
      </label>
      <label class="field">
        <span>Nombre</span>
        <input id="athleteAdminName" type="text" placeholder="Nombre del deportista" />
      </label>
      <button class="primary-button" type="submit">Agregar deportista</button>
      <button class="secondary-button" type="button" id="exportCodesCsv">Exportar codigos</button>
    </form>
    <div class="data-table-wrap">
      <table>
        <thead>
          <tr><th>Deportista</th><th>Equipo</th><th>Codigo</th><th>Estado</th><th>Acciones</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5">Sin deportistas.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function populateAthleteAdminTeams() {
  const select = $("#athleteAdminTeam");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = teams().map((team) => `<option value="${escapeHtml(team.name)}">${escapeHtml(team.name)}</option>`).join("");
  select.value = previous || teams()[0]?.name || "";
}

function populateCatalogAthletes() {
  const teamSelect = $("#catalogTeam");
  if (!teamSelect) return;
  const previousTeam = teamSelect.value;
  teamSelect.innerHTML = teams().map((team) => `<option value="${escapeHtml(team.name)}">${escapeHtml(team.name)}</option>`).join("");
  teamSelect.value = previousTeam || teams()[0]?.name || "";
  renderCatalogAthleteOptions();
}

function renderCatalogAthleteOptions() {
  const team = $("#catalogTeam")?.value;
  const athleteSelect = $("#catalogAthlete");
  if (!athleteSelect) return;
  const options = allAthletes()
    .filter((athlete) => athlete.team === team)
    .map((athlete) => `<option value="${escapeHtml(athlete.id)}">${escapeHtml(athlete.name)}</option>`)
    .join("");
  athleteSelect.innerHTML = `<option value="">Todo el equipo</option>${options}`;
}

async function adminLogin(event) {
  event.preventDefault();
  state.adminCode = $("#adminCode").value.trim();
  try {
    await api("/api/admin/check", { method: "POST", body: {} });
    state.adminUnlocked = true;
    await loadData();
    showAlert("Panel administrador activo.");
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function updatePaymentStatus(id, status) {
  try {
    await api(`/api/payments/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
    await loadData();
    state.adminUnlocked = true;
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function deletePayment(paymentId) {
  const confirmed = window.confirm("Eliminar este pago del reporte?");
  if (!confirmed) return;
  try {
    await api(`/api/payments/${encodeURIComponent(paymentId)}`, { method: "DELETE" });
    showAlert("Pago eliminado.");
    await loadData();
    state.adminUnlocked = true;
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function createCatalogItem(event) {
  event.preventDefault();
  const athleteId = $("#catalogAthlete").value;
  const athlete = allAthletes().find((item) => item.id === athleteId);
  try {
    await api("/api/items", {
      method: "POST",
      body: {
        team: $("#catalogTeam").value,
        athleteId,
        athleteName: athlete?.name || "",
        category: $("#catalogCategory").value,
        itemName: $("#catalogItemName").value,
        suggestedAmount: Number($("#catalogAmount").value || 0),
      },
    });
    showAlert("Item creado.");
    await loadData();
    state.adminUnlocked = true;
    state.adminTab = "catalog";
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function deleteCatalogItem(itemId) {
  const confirmed = window.confirm("Eliminar este item de cobro?");
  if (!confirmed) return;
  try {
    await api(`/api/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
    showAlert("Item eliminado.");
    await loadData();
    state.adminUnlocked = true;
    state.adminTab = "catalog";
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function createAthlete(event) {
  event.preventDefault();
  try {
    await api("/api/athletes", {
      method: "POST",
      body: {
        team: $("#athleteAdminTeam").value,
        name: $("#athleteAdminName").value,
      },
    });
    showAlert("Deportista agregado con codigo de acceso.");
    state.adminTab = "athletes";
    await loadData();
    state.adminUnlocked = true;
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function importAthletesBulk(event) {
  event.preventDefault();
  const rows = parseBulkRows($("#bulkAthletesText").value);
  if (!rows.length) {
    showAlert("Pega al menos una fila de deportistas.", "error");
    return;
  }
  try {
    const payload = await api("/api/import/athletes", { method: "POST", body: { rows } });
    showAlert(`Deportistas creados: ${payload.created.length}. Errores: ${payload.errors.length}.`);
    await loadData();
    state.adminUnlocked = true;
    state.adminTab = "athletes";
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function importItemsBulk(event) {
  event.preventDefault();
  const rows = parseBulkRows($("#bulkItemsText").value);
  if (!rows.length) {
    showAlert("Pega al menos una fila de items de cobro.", "error");
    return;
  }
  try {
    const payload = await api("/api/import/items", { method: "POST", body: { rows } });
    showAlert(`Items creados: ${payload.created.length}. Errores: ${payload.errors.length}.`);
    await loadData();
    state.adminUnlocked = true;
    state.adminTab = "catalog";
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function removeAthlete(athleteId) {
  const athlete = allAthletes().find((item) => item.id === athleteId);
  if (!athlete) return;
  const confirmed = window.confirm(`Quitar a ${athlete.name} del equipo ${athlete.team}?`);
  if (!confirmed) return;
  try {
    await api(`/api/athletes/${encodeURIComponent(athleteId)}`, { method: "DELETE" });
    showAlert("Deportista retirado.");
    state.adminTab = "athletes";
    await loadData();
    state.adminUnlocked = true;
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function resetAthletePassword(athleteId) {
  const athlete = allAthletes().find((item) => item.id === athleteId);
  if (!athlete) return;
  const newCode = window.prompt(`Nueva contraseÃ±a para ${athlete.name}. Deja vacio para generar una automaticamente:`);
  if (newCode === null) return;
  try {
    const payload = await api(`/api/access-codes/${encodeURIComponent(athleteId)}`, {
      method: "PATCH",
      body: { accessCode: newCode, mustChangePassword: true },
    });
    showAlert(`Codigo actualizado: ${payload.accessCode.accessCode}`);
    state.adminTab = "athletes";
    await loadData();
    state.adminUnlocked = true;
    renderAdmin();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

function exportCodesCsv() {
  const headers = ["equipo", "deportista", "codigo", "debeCambiar", "athleteId"];
  const rows = allAthletes().map((athlete) => {
    const access = accessRecordFor(athlete.id);
    return [
      athlete.team,
      athlete.name,
      access.accessCode || "",
      access.mustChangePassword ? "SI" : "NO",
      athlete.id,
    ];
  });
  const csv = [headers, ...rows].map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `codigos-acceso-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const rows = adminRows();
  const headers = ["fecha", "equipo", "deportista", "estado", "categoria", "item", "valor", "pagador", "soporte", "notas"];
  const lines = [headers, ...rows.map((row) => [
    row.paidAt,
    row.team,
    row.athleteName,
    statusLabel(row.status),
    row.category,
    row.itemName,
    row.amount,
    row.payerName,
    row.supportUrl,
    row.notes,
  ])];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-cobros-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function switchView(view) {
  state.activeView = view;
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const titles = {
    athlete: ["Registrar pago", "Pagos, soportes y reportes del club."],
    history: ["Mis pagos", "Consulta del historial por deportista."],
    admin: ["Administrador", "Reportes por persona, equipo e item."],
  };
  $("#pageTitle").textContent = titles[view][0];
  $("#pageSubtitle").textContent = titles[view][1];
  if (view === "admin") renderAdmin();
}

function switchAdminTab(tab) {
  state.adminTab = tab;
  $$(".admin-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.adminTab === state.adminTab));
  renderAdminContent();
}

function bindEvents() {
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#refreshData").addEventListener("click", () => loadData().then(() => showAlert("Datos actualizados.")));
  $("#teamFilter").addEventListener("change", renderAthleteSearch);
  $("#athleteSearch").addEventListener("input", renderAthleteSearch);
  $("#searchResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-athlete-id]");
    if (button) selectAthlete(button.dataset.athleteId);
  });
  $("#categoryFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.activeCategory = button.dataset.category;
    renderSelectedAthlete();
  });
  $("#chargeList").addEventListener("input", updatePaymentTotal);
  $("#chargeList").addEventListener("change", updatePaymentTotal);
  $("#addManualLine").addEventListener("click", addManualLine);
  $("#manualDraftList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-manual]");
    if (!button) return;
    state.manualDraftLines = state.manualDraftLines.filter((line) => line.id !== button.dataset.removeManual);
    renderManualDraftList();
    updatePaymentTotal();
  });
  $("#athleteAccessForm").addEventListener("submit", submitAthleteAccess);
  $("#athletePasswordForm").addEventListener("submit", submitPasswordChange);
  $("#athleteLogout").addEventListener("click", logoutAthlete);
  $("#paymentForm").addEventListener("submit", submitPayment);
  $("#adminLoginForm").addEventListener("submit", adminLogin);
  $("#adminPanel").addEventListener("click", (event) => {
    const quickAddPaymentItem = event.target.closest("#quickAddPaymentItem");
    if (quickAddPaymentItem) {
      switchAdminTab("catalog");
      $("#catalogItemName")?.focus();
      return;
    }
    const quickAddAthlete = event.target.closest("#quickAddAthlete");
    if (quickAddAthlete) {
      switchAdminTab("athletes");
      $("#athleteAdminName")?.focus();
      return;
    }
    const quickBulkImport = event.target.closest("#quickBulkImport");
    if (quickBulkImport) {
      switchAdminTab("imports");
      $("#bulkAthletesText")?.focus();
      return;
    }
    const tab = event.target.closest("[data-admin-tab]");
    if (tab) {
      switchAdminTab(tab.dataset.adminTab);
      return;
    }
    const statusButton = event.target.closest("[data-status-id]");
    if (statusButton) updatePaymentStatus(statusButton.dataset.statusId, statusButton.dataset.status);
    const deletePaymentButton = event.target.closest("[data-delete-payment]");
    if (deletePaymentButton) deletePayment(deletePaymentButton.dataset.deletePayment);
    const deleteItemButton = event.target.closest("[data-delete-item]");
    if (deleteItemButton) deleteCatalogItem(deleteItemButton.dataset.deleteItem);
    const removeButton = event.target.closest("[data-remove-athlete]");
    if (removeButton) removeAthlete(removeButton.dataset.removeAthlete);
    const resetButton = event.target.closest("[data-reset-password]");
    if (resetButton) resetAthletePassword(resetButton.dataset.resetPassword);
    const exportCodesButton = event.target.closest("#exportCodesCsv");
    if (exportCodesButton) exportCodesCsv();
  });
  $("#adminPanel").addEventListener("change", (event) => {
    if (event.target.id === "catalogTeam") renderCatalogAthleteOptions();
    if (["adminTeamFilter", "adminStatusFilter", "adminItemFilter"].includes(event.target.id)) {
      renderAdminMetrics();
      renderAdminContent();
    }
  });
  $("#adminPanel").addEventListener("input", (event) => {
    if (event.target.id === "adminSearch") {
      renderAdminMetrics();
      renderAdminContent();
    }
  });
  $("#adminPanel").addEventListener("submit", (event) => {
    if (event.target.id === "catalogForm") createCatalogItem(event);
    if (event.target.id === "athleteAdminForm") createAthlete(event);
    if (event.target.id === "bulkAthletesForm") importAthletesBulk(event);
    if (event.target.id === "bulkItemsForm") importItemsBulk(event);
  });
  $("#exportCsv").addEventListener("click", exportCsv);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-field")) $("#searchResults").classList.remove("active");
  });
}

async function init() {
  localStorage.removeItem("clubCobrosAdminCode");
  bindEvents();
  $("#paidAt").value = today();
  $("#adminCode").value = state.adminCode;
  try {
    await loadData();
  } catch (error) {
    showAlert(error.message, "error");
  }
}

init();
