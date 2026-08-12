const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const ACCESS_CODES_PATH = path.join(DATA_DIR, "access-codes.json");
const BUNDLED_STORE_PATH = path.join(ROOT, "data", "store.json");
const BUNDLED_ACCESS_CODES_PATH = path.join(ROOT, "data", "access-codes.json");
const INITIAL_DATA_PATH = path.join(ROOT, "src", "data", "initial-data.json");
const ADMIN_CODE = process.env.ADMIN_CODE || "club2026";
const START_PORT = Number(process.env.PORT || 4317);
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
};

async function ensureStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    if (BUNDLED_STORE_PATH !== STORE_PATH && fs.existsSync(BUNDLED_STORE_PATH)) {
      await fsp.copyFile(BUNDLED_STORE_PATH, STORE_PATH);
      return;
    }
    await writeStore({
      submissions: [],
      manualItems: [],
      customAthletes: [],
      removedAthleteIds: [],
      removedSubmissionIds: [],
    });
  }
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readStore() {
  await ensureStore();
  const store = await readJsonFile(STORE_PATH);
  return {
    submissions: Array.isArray(store.submissions) ? store.submissions : [],
    manualItems: Array.isArray(store.manualItems) ? store.manualItems : [],
    customAthletes: Array.isArray(store.customAthletes) ? store.customAthletes : [],
    removedAthleteIds: Array.isArray(store.removedAthleteIds) ? store.removedAthleteIds : [],
    removedSubmissionIds: Array.isArray(store.removedSubmissionIds) ? store.removedSubmissionIds : [],
  };
}

async function writeStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fsp.rename(tmp, STORE_PATH);
}

async function readAccessCodes() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACCESS_CODES_PATH) && BUNDLED_ACCESS_CODES_PATH !== ACCESS_CODES_PATH && fs.existsSync(BUNDLED_ACCESS_CODES_PATH)) {
    await fsp.copyFile(BUNDLED_ACCESS_CODES_PATH, ACCESS_CODES_PATH);
  }
  return readJsonFile(ACCESS_CODES_PATH, []);
}

async function writeAccessCodes(codes) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${ACCESS_CODES_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(codes, null, 2), "utf8");
  await fsp.rename(tmp, ACCESS_CODES_PATH);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("El archivo o formulario supera el limite permitido."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("No se pudo leer el formulario enviado."));
      }
    });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  return req.headers["x-admin-code"] === ADMIN_CODE;
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function slug(value) {
  return String(value || "sin-nombre")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "sin-nombre";
}

function safeName(value) {
  return String(value || "soporte")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "soporte";
}

function teamCode(team) {
  return String(team || "EQ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 5)
    .toUpperCase() || "EQ";
}

function makeAccessCode(team, serial) {
  const token = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `MAS-${teamCode(team)}-${String(serial).padStart(3, "0")}-${token}`;
}

function makeResetCode(team) {
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `MAS-${teamCode(team)}-${token}`;
}

function activeRemovedSet(store) {
  return new Set(store.removedAthleteIds || []);
}

function stripPrivateAthlete(athlete) {
  return {
    id: athlete.id,
    name: athlete.name,
    team: athlete.team,
    teamId: athlete.teamId,
  };
}

function composeTeams(initialData, store, includeCharges) {
  const removed = activeRemovedSet(store);
  const teams = clone(initialData.teams || []).map((team) => ({
    ...team,
    athletes: (team.athletes || [])
      .filter((athlete) => !removed.has(athlete.id))
      .map((athlete) => includeCharges ? athlete : stripPrivateAthlete(athlete)),
  }));

  const byName = new Map(teams.map((team) => [team.name, team]));
  for (const athlete of store.customAthletes || []) {
    if (athlete.active === false || removed.has(athlete.id)) continue;
    const team = byName.get(athlete.team);
    if (!team) continue;
    team.athletes.push(includeCharges ? clone(athlete) : stripPrivateAthlete(athlete));
  }

  for (const team of teams) {
    team.athletes.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
  return teams;
}

function allActiveAthletes(initialData, store, includeCharges = true) {
  return composeTeams(initialData, store, includeCharges).flatMap((team) => team.athletes);
}

function findAthlete(initialData, store, athleteId) {
  return allActiveAthletes(initialData, store, true).find((athlete) => athlete.id === athleteId) || null;
}

function relevantManualItems(store, athlete) {
  if (!athlete) return [];
  return (store.manualItems || []).filter(
    (item) => item.active !== false && item.team === athlete.team && (!item.athleteId || item.athleteId === athlete.id)
  );
}

function athleteSubmissions(initialData, store, athleteId) {
  return allSubmissionsForServer(initialData, store).filter((submission) => submission.athleteId === athleteId);
}

async function ensureAccessCodes() {
  const initialData = await readJsonFile(INITIAL_DATA_PATH);
  const store = await readStore();
  const athletes = allActiveAthletes(initialData, store, false);
  const activeIds = new Set(athletes.map((athlete) => athlete.id));
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const codes = await readAccessCodes();
  const byId = new Map(codes.map((code) => [code.athleteId, code]));
  let serial = codes.length + 1;
  let changed = false;

  for (const athlete of athletes) {
    const existing = byId.get(athlete.id);
    if (existing) {
      if (existing.athleteName !== athlete.name || existing.team !== athlete.team || existing.active === false) {
        existing.athleteName = athlete.name;
        existing.team = athlete.team;
        existing.active = true;
        changed = true;
      }
      if (existing.mustChangePassword === undefined) {
        existing.mustChangePassword = true;
        changed = true;
      }
    } else {
      const record = {
        athleteId: athlete.id,
        athleteName: athlete.name,
        team: athlete.team,
        accessCode: makeAccessCode(athlete.team, serial++),
        mustChangePassword: true,
        active: true,
        createdAt: new Date().toISOString(),
      };
      codes.push(record);
      byId.set(record.athleteId, record);
      changed = true;
    }
  }

  for (const code of codes) {
    if (!activeIds.has(code.athleteId) && code.active !== false) {
      const known = athleteById.get(code.athleteId);
      if (!known) code.active = false;
      changed = true;
    }
  }

  if (changed) await writeAccessCodes(codes);
  return codes;
}

async function verifyAthleteCode(athleteId, accessCode) {
  const codes = await ensureAccessCodes();
  const normalized = normalizeCode(accessCode);
  return codes.find(
    (code) =>
      code.active !== false &&
      code.athleteId === athleteId &&
      normalizeCode(code.accessCode) === normalized
  );
}

async function updateAthletePassword(athleteId, currentCode, newCode) {
  const codes = await ensureAccessCodes();
  const normalizedCurrent = normalizeCode(currentCode);
  const record = codes.find(
    (code) =>
      code.active !== false &&
      code.athleteId === athleteId &&
      normalizeCode(code.accessCode) === normalizedCurrent
  );
  if (!record) return null;
  const cleaned = String(newCode || "").trim();
  if (cleaned.length < 6) {
    throw new Error("La nueva contraseña debe tener al menos 6 caracteres.");
  }
  record.accessCode = cleaned;
  record.mustChangePassword = false;
  record.passwordChangedAt = new Date().toISOString();
  await writeAccessCodes(codes);
  return record;
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match || !match[2]) return null;
  return {
    mime: match[1] || "application/octet-stream",
    bytes: Buffer.from(match[3], "base64"),
  };
}

async function saveSupport(support) {
  if (!support || !support.dataUrl) {
    throw new Error("Adjunta el soporte del pago.");
  }
  const parsed = parseDataUrl(support.dataUrl);
  if (!parsed || !parsed.bytes.length) {
    throw new Error("El soporte no tiene un formato valido.");
  }
  const originalName = safeName(support.fileName || "soporte");
  const extension = path.extname(originalName) || ".bin";
  const id = crypto.randomUUID();
  const fileName = `${id}${extension}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, fileName), parsed.bytes);
  return {
    supportUrl: `/uploads/${fileName}`,
    supportName: originalName,
    supportMime: parsed.mime,
  };
}

async function saveOptionalSupport(support) {
  if (!support || !support.dataUrl) return {};
  return saveSupport(support);
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      chargeId: String(line.chargeId || `manual-${crypto.randomUUID()}`),
      category: String(line.category || "Concepto").trim(),
      itemName: String(line.itemName || "").trim(),
      amount: Number(line.amount || 0),
      detail: String(line.detail || "").trim(),
    }))
    .filter((line) => line.itemName && Number.isFinite(line.amount) && line.amount > 0);
}

function filteredImportedSubmissions(initialData, store) {
  const removed = new Set(store.removedSubmissionIds || []);
  return (initialData.importedSubmissions || []).filter((submission) => !removed.has(submission.id));
}

function allSubmissionsForServer(initialData, store) {
  const removed = new Set(store.removedSubmissionIds || []);
  return [
    ...filteredImportedSubmissions(initialData, store),
    ...(store.submissions || []).filter((submission) => !removed.has(submission.id)),
  ];
}

function createSubmission({ athlete, body, lines, source, status, savedSupport = {} }) {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    id: `pay-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    paidAt: String(body.paidAt || new Date().toISOString().slice(0, 10)),
    athleteId: athlete.id,
    athleteName: athlete.name,
    team: athlete.team,
    payerName: String(body.payerName || "").trim(),
    status: status || String(body.status || "pendiente").trim() || "pendiente",
    source,
    notes: String(body.notes || "").trim(),
    total,
    lines,
    ...savedSupport,
  };
}

function findAthleteByName(initialData, store, teamName, athleteName) {
  const normalizedName = slug(athleteName);
  return allActiveAthletes(initialData, store, true).find(
    (athlete) => athlete.team === teamName && slug(athlete.name) === normalizedName
  ) || null;
}

function teamChargeTemplates(initialData, teamName) {
  const team = (initialData.teams || []).find((item) => item.name === teamName);
  const templates = new Map();
  for (const athlete of team?.athletes || []) {
    for (const charge of athlete.charges || []) {
      const key = `${charge.category}::${charge.itemName}`;
      if (!templates.has(key)) {
        templates.set(key, {
          category: charge.category,
          itemName: charge.itemName,
          itemKey: charge.itemKey,
          suggestedAmount: Number(charge.suggestedAmount || charge.excelAmount || 0),
          expectedAmount: Number(charge.expectedAmount || charge.suggestedAmount || charge.excelAmount || 0),
          monthNo: charge.monthNo,
          baseAmount: charge.baseAmount,
          lateAmount: charge.lateAmount,
          lateDay: charge.lateDay,
          unitAmount: charge.unitAmount,
          quantity: charge.quantity,
        });
      } else if (!templates.get(key).suggestedAmount && charge.suggestedAmount) {
        templates.get(key).suggestedAmount = Number(charge.suggestedAmount);
      }
    }
  }
  return [...templates.values()];
}

function createCustomAthlete(initialData, teamName, athleteName) {
  const team = (initialData.teams || []).find((item) => item.name === teamName);
  if (!team) throw new Error("Equipo no encontrado.");
  const athleteId = `custom::${slug(teamName)}::${slug(athleteName)}-${crypto.randomUUID().slice(0, 8)}`;
  const charges = teamChargeTemplates(initialData, teamName).map((template) => {
    const seed = `${athleteId}|${template.category}|${template.itemName}`;
    return {
      id: crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16),
      category: template.category,
      itemName: template.itemName,
      itemKey: template.itemKey || slug(`${template.category}-${template.itemName}`),
      sourceCell: "Creado desde administrador",
      excelAmount: 0,
      suggestedAmount: template.suggestedAmount || 0,
      expectedAmount: template.expectedAmount || template.suggestedAmount || 0,
      monthNo: template.monthNo,
      baseAmount: template.baseAmount,
      lateAmount: template.lateAmount,
      lateDay: template.lateDay,
      unitAmount: template.unitAmount,
      quantity: template.quantity,
    };
  });

  return {
    id: athleteId,
    name: athleteName,
    team: teamName,
    teamId: team.id,
    charges,
    active: true,
    createdAt: new Date().toISOString(),
  };
}

async function clientData(req) {
  const includePrivate = isAdmin(req);
  const initialData = await readJsonFile(INITIAL_DATA_PATH);
  const store = await readStore();
  const shapedInitialData = clone(initialData);
  shapedInitialData.teams = composeTeams(initialData, store, includePrivate);
  shapedInitialData.importedSubmissions = includePrivate ? filteredImportedSubmissions(initialData, store) : [];
  const payload = {
    initialData: shapedInitialData,
    store: includePrivate
      ? store
      : { submissions: [], manualItems: [], customAthletes: [], removedAthleteIds: [], removedSubmissionIds: [] },
  };
  if (includePrivate) {
    payload.accessCodes = (await ensureAccessCodes()).filter((code) => code.active !== false);
  }
  return payload;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/data") {
    sendJson(res, 200, await clientData(req));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/check") {
    sendJson(res, isAdmin(req) ? 200 : 401, { ok: isAdmin(req) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/athlete/check") {
    const body = await readBody(req);
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const athlete = findAthlete(initialData, store, String(body.athleteId || ""));
    const code = athlete ? await verifyAthleteCode(athlete.id, body.accessCode) : null;
    if (!athlete || !code) {
      sendError(res, 401, "Codigo de acceso invalido para este deportista.");
      return;
    }
    if (code.mustChangePassword) {
      sendJson(res, 200, {
        requiresPasswordChange: true,
        athlete: stripPrivateAthlete(athlete),
        message: "Debes crear una contraseña nueva para continuar.",
      });
      return;
    }
    sendJson(res, 200, {
      athlete,
      submissions: athleteSubmissions(initialData, store, athlete.id),
      manualItems: relevantManualItems(store, athlete),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/athlete/password") {
    const body = await readBody(req);
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const athlete = findAthlete(initialData, store, String(body.athleteId || ""));
    if (!athlete) {
      sendError(res, 404, "Deportista no encontrado.");
      return;
    }
    try {
      const updated = await updateAthletePassword(athlete.id, body.currentAccessCode, body.newAccessCode);
      if (!updated) {
        sendError(res, 401, "Codigo de acceso actual invalido.");
        return;
      }
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    const code = await verifyAthleteCode(athlete.id, body.newAccessCode);
    if (!code) {
      sendError(res, 401, "Codigo de acceso actual invalido.");
      return;
    }
    sendJson(res, 200, {
      athlete,
      submissions: athleteSubmissions(initialData, store, athlete.id),
      manualItems: relevantManualItems(store, athlete),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/payments") {
    const body = await readBody(req);
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const athlete = findAthlete(initialData, store, String(body.athleteId || ""));
    const code = athlete ? await verifyAthleteCode(athlete.id, body.accessCode) : null;
    if (!athlete || !code) {
      sendError(res, 401, "Codigo de acceso invalido para este deportista.");
      return;
    }
    if (code.mustChangePassword) {
      sendError(res, 403, "Debes cambiar la contraseña inicial antes de registrar pagos.");
      return;
    }

    const lines = normalizeLines(body.lines);
    if (!lines.length) {
      sendError(res, 400, "Agrega al menos un item con valor mayor a cero.");
      return;
    }

    let savedSupport;
    try {
      savedSupport = await saveSupport(body.support);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }

    const submission = createSubmission({
      athlete,
      body,
      lines,
      source: "Formulario web",
      status: "pendiente",
      savedSupport,
    });
    store.submissions.unshift(submission);
    await writeStore(store);
    sendJson(res, 201, { submission });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/athletes") {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const body = await readBody(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const created = [];
    const errors = [];
    for (const [index, row] of rows.entries()) {
      const team = String(row.team || row.equipo || "").trim();
      const name = String(row.name || row.deportista || row.athleteName || "").trim();
      if (!team || !name) {
        errors.push({ row: index + 2, error: "Falta equipo o deportista." });
        continue;
      }
      try {
        const duplicate = allActiveAthletes(initialData, store, false).find(
          (athlete) => athlete.team === team && slug(athlete.name) === slug(name)
        );
        if (duplicate) {
          errors.push({ row: index + 2, error: "Ya existe.", team, name });
          continue;
        }
        const athlete = createCustomAthlete(initialData, team, name);
        store.customAthletes.unshift(athlete);
        created.push(athlete);
      } catch (error) {
        errors.push({ row: index + 2, error: error.message, team, name });
      }
    }
    await writeStore(store);
    await ensureAccessCodes();
    sendJson(res, 201, { created, errors });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/items") {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const body = await readBody(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const created = [];
    const errors = [];
    for (const [index, row] of rows.entries()) {
      const team = String(row.team || row.equipo || "").trim();
      const athleteName = String(row.athleteName || row.deportista || "").trim();
      const category = String(row.category || row.categoria || "Concepto").trim();
      const itemName = String(row.itemName || row.item || row.concepto || "").trim();
      const suggestedAmount = Number(row.amount || row.valor || row.suggestedAmount || 0);
      if (!team || !itemName || !category || !Number.isFinite(suggestedAmount) || suggestedAmount < 0) {
        errors.push({ row: index + 2, error: "Falta equipo, categoria, item o valor valido.", team, itemName });
        continue;
      }
      let athlete = null;
      if (athleteName) {
        athlete = findAthleteByName(initialData, store, team, athleteName);
        if (!athlete) {
          errors.push({ row: index + 2, error: "No se encontro el deportista indicado.", team, athleteName });
          continue;
        }
      }
      const manualItem = {
        id: `item-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        team,
        athleteId: athlete?.id || "",
        athleteName: athlete?.name || "",
        category,
        itemName,
        suggestedAmount,
        active: true,
      };
      store.manualItems.unshift(manualItem);
      created.push(manualItem);
    }
    await writeStore(store);
    sendJson(res, 201, { created, errors });
    return;
  }

  const paymentMatch = /^\/api\/payments\/([^/]+)$/.exec(url.pathname);
  if (req.method === "PATCH" && paymentMatch) {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const body = await readBody(req);
    const allowed = new Set(["pendiente", "aprobado", "rechazado"]);
    if (!allowed.has(body.status)) {
      sendError(res, 400, "Estado no valido.");
      return;
    }
    const store = await readStore();
    const item = store.submissions.find((submission) => submission.id === paymentMatch[1]);
    if (!item) {
      sendError(res, 404, "Pago no encontrado.");
      return;
    }
    item.status = body.status;
    item.adminNote = String(body.adminNote || "").trim();
    item.reviewedAt = new Date().toISOString();
    await writeStore(store);
    sendJson(res, 200, { submission: item });
    return;
  }

  if (req.method === "DELETE" && paymentMatch) {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const paymentId = decodeURIComponent(paymentMatch[1]);
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const before = store.submissions.length;
    store.submissions = store.submissions.filter((submission) => submission.id !== paymentId);
    const imported = (initialData.importedSubmissions || []).some((submission) => submission.id === paymentId);
    if (imported && !store.removedSubmissionIds.includes(paymentId)) {
      store.removedSubmissionIds.push(paymentId);
    }
    if (before === store.submissions.length && !imported) {
      sendError(res, 404, "Pago no encontrado.");
      return;
    }
    await writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/items") {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const body = await readBody(req);
    const team = String(body.team || "").trim();
    const itemName = String(body.itemName || "").trim();
    const category = String(body.category || "Concepto").trim();
    const suggestedAmount = Number(body.suggestedAmount || 0);
    if (!team || !itemName || !category || !Number.isFinite(suggestedAmount) || suggestedAmount < 0) {
      sendError(res, 400, "Completa equipo, categoria, item y valor sugerido.");
      return;
    }
    const store = await readStore();
    const manualItem = {
      id: `item-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      team,
      athleteId: body.athleteId ? String(body.athleteId) : "",
      athleteName: body.athleteName ? String(body.athleteName) : "",
      category,
      itemName,
      suggestedAmount,
      active: true,
    };
    store.manualItems.unshift(manualItem);
    await writeStore(store);
    sendJson(res, 201, { manualItem });
    return;
  }

  const itemMatch = /^\/api\/items\/([^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && itemMatch) {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const itemId = decodeURIComponent(itemMatch[1]);
    const store = await readStore();
    const item = store.manualItems.find((manualItem) => manualItem.id === itemId);
    if (!item) {
      sendError(res, 404, "Item no encontrado.");
      return;
    }
    item.active = false;
    item.deletedAt = new Date().toISOString();
    await writeStore(store);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/access-codes") {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    sendJson(res, 200, { accessCodes: (await ensureAccessCodes()).filter((code) => code.active !== false) });
    return;
  }

  const accessCodeMatch = /^\/api\/access-codes\/([^/]+)$/.exec(url.pathname);
  if (req.method === "PATCH" && accessCodeMatch) {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const athleteId = decodeURIComponent(accessCodeMatch[1]);
    const body = await readBody(req);
    const codes = await ensureAccessCodes();
    const record = codes.find((code) => code.athleteId === athleteId && code.active !== false);
    if (!record) {
      sendError(res, 404, "Codigo no encontrado.");
      return;
    }
    const newCode = String(body.accessCode || "").trim() || makeResetCode(record.team);
    if (newCode.length < 6) {
      sendError(res, 400, "La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    record.accessCode = newCode;
    record.mustChangePassword = body.mustChangePassword !== false;
    record.resetAt = new Date().toISOString();
    await writeAccessCodes(codes);
    sendJson(res, 200, { accessCode: record });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/athletes") {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const team = String(body.team || "").trim();
    if (!name || !team) {
      sendError(res, 400, "Completa equipo y nombre del deportista.");
      return;
    }
    const initialData = await readJsonFile(INITIAL_DATA_PATH);
    const store = await readStore();
    const duplicate = allActiveAthletes(initialData, store, false).find(
      (athlete) => athlete.team === team && slug(athlete.name) === slug(name)
    );
    if (duplicate) {
      sendError(res, 409, "Ya existe un deportista con ese nombre en el equipo.");
      return;
    }
    const athlete = createCustomAthlete(initialData, team, name);
    store.customAthletes.unshift(athlete);
    await writeStore(store);
    const code = (await ensureAccessCodes()).find((item) => item.athleteId === athlete.id);
    sendJson(res, 201, { athlete, accessCode: code?.accessCode || "" });
    return;
  }

  const athleteMatch = /^\/api\/athletes\/([^/]+)$/.exec(url.pathname);
  if (req.method === "DELETE" && athleteMatch) {
    if (!isAdmin(req)) {
      sendError(res, 401, "Codigo de administrador invalido.");
      return;
    }
    const athleteId = decodeURIComponent(athleteMatch[1]);
    const store = await readStore();
    const custom = store.customAthletes.find((athlete) => athlete.id === athleteId);
    if (custom) custom.active = false;
    if (!store.removedAthleteIds.includes(athleteId)) store.removedAthleteIds.push(athleteId);
    await writeStore(store);
    const codes = await readAccessCodes();
    for (const code of codes) {
      if (code.athleteId === athleteId) code.active = false;
    }
    await writeAccessCodes(codes);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendError(res, 404, "Ruta no encontrada.");
}

function resolveStaticPath(urlPath) {
  const isUpload = urlPath.startsWith("/uploads/");
  const baseDir = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
  const relative = isUpload ? urlPath.replace(/^\/uploads\//, "") : urlPath.replace(/^\//, "");
  const target = path.resolve(baseDir, decodeURIComponent(relative || "index.html"));
  if (!target.startsWith(path.resolve(baseDir))) return null;
  return target;
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolveStaticPath(requestedPath);
  if (!filePath) {
    sendError(res, 403, "Archivo no permitido.");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("not file");
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": requestedPath.startsWith("/uploads/") ? "private, max-age=3600" : "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendError(res, 404, "Archivo no encontrado.");
  }
}

async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Error interno.");
  }
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

async function start(port, attempts = 0) {
  await ensureStore();
  await ensureAccessCodes();
  const server = http.createServer(requestHandler);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 20) {
      start(port + 1, attempts + 1);
    } else {
      console.error(error);
      process.exit(1);
    }
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Club Cobros local: http://localhost:${port}`);
    for (const url of lanUrls(port)) console.log(`Club Cobros red local: ${url}`);
    console.log(`Codigo admin inicial: ${ADMIN_CODE}`);
  });
}

start(START_PORT);
