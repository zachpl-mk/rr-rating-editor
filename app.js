// Layout mirrors PulsarEngine/IO/RRRating.hpp.
const MAGIC = 0x52525254; // "RRRT"
const VERSION = 2;
const LEGACY_VERSION = 1;
const CAPACITY = 100;
const MAX_RATING = 1000000;
const MAX_PID = 0x7fffffff;
const ENTRY_SIZE = 12;
const FILE_SIZE = 8 + CAPACITY * ENTRY_SIZE; // 1208
const PENDING_SIZE = 8;
const OUTPUT_SIZE = FILE_SIZE + PENDING_SIZE; // 1216
const LEGACY_FILE_SIZE = 8 + CAPACITY * 16; // 1608
const DEFAULT_RATING = 5000;

const rows = document.querySelector("#rows");
const template = document.querySelector("#rowTemplate");
const statusText = document.querySelector("#status");
const importStatus = document.querySelector("#importStatus");
const importFile = document.querySelector("#importFile");
const themeToggle = document.querySelector("#themeToggle");
const downloads = document.querySelector("#downloads");
const rowCount = document.querySelector("#rowCount");
const addRowButton = document.querySelector("#addRow");
const generatedUrls = [];
const themeStorageKey = "rrRatingTheme";

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function getThemePreference() {
  try {
    return localStorage.getItem(themeStorageKey) || "system";
  } catch {
    return "system";
  }
}

function resolveTheme() {
  const preference = getThemePreference();
  return preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const preference = getThemePreference();
  const isDark = theme === "dark";
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.title = preference === "system"
    ? `System theme is ${isDark ? "dark" : "light"}`
    : `Using saved ${preference} mode`;
}

function syncTheme() {
  applyTheme(resolveTheme());
}

function cycleTheme() {
  const current = getThemePreference();
  const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {}
  syncTheme();
}

// ---------- Friend codes (MD5 of LE pid + reversed "RMCJ", see wfc-server common/friend_code.go) ----------

function md5(bytes) {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const length = bytes.length;
  const padded = new Uint8Array(((length + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const m = Array.from({ length: 16 }, (_, i) => view.getUint32(chunk + i * 4, true));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + k[i] + m[g]) >>> 0;
      b = (b + ((sum << s[i]) | (sum >>> (32 - s[i])))) >>> 0;
      a = temp;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true));
  return out;
}

function friendCodeValue(pid) {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setUint32(0, pid >>> 0, true);
  buffer.set([0x4a, 0x43, 0x4d, 0x52], 4); // "RMCJ" reversed
  return BigInt(md5(buffer)[0] >> 1) << 32n | BigInt(pid >>> 0);
}

function friendCode(pid) {
  const digits = friendCodeValue(pid).toString().padStart(12, "0");
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}

// Returns the profile ID for a valid friend code, otherwise null.
function parseFriendCode(text) {
  const digits = String(text).replace(/[\s-]/g, "");
  if (!/^\d{12}$/.test(digits)) return null;
  const value = BigInt(digits);
  const pid = Number(value & 0xffffffffn);
  if (pid < 1 || pid > MAX_PID || friendCodeValue(pid) !== value) return null;
  return pid;
}

// ---------- Rows ----------

function parseIntField(input) {
  const text = input.value.trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function validateRow(row) {
  const fcInput = row.querySelector(".fc");
  const vrInput = row.querySelector(".vr");
  const brInput = row.querySelector(".br");
  const empty = fcInput.value.trim() === "";
  const pid = parseFriendCode(fcInput.value);
  const vr = parseIntField(vrInput);
  const br = parseIntField(brInput);
  const vrOk = vr !== null && vr >= 1 && vr <= MAX_RATING;
  const brOk = br !== null && br >= 1 && br <= MAX_RATING;
  fcInput.classList.toggle("invalid", !empty && pid === null);
  vrInput.classList.toggle("invalid", !vrOk);
  brInput.classList.toggle("invalid", !brOk);
  return { pid, vr, br, ok: pid !== null && vrOk && brOk, empty };
}

function rowData() {
  const seen = new Set();
  const result = [];
  const problems = [];
  [...rows.querySelectorAll(".row")].forEach((row, index) => {
    const data = validateRow(row);
    if (data.empty) return;
    if (!data.ok) {
      problems.push(`Row ${index + 1} has an invalid value.`);
      return;
    }
    if (seen.has(data.pid)) {
      row.querySelector(".fc").classList.add("invalid");
      problems.push(`Row ${index + 1} repeats friend code ${friendCode(data.pid)}.`);
      return;
    }
    seen.add(data.pid);
    result.push({ pid: data.pid, vr: data.vr, br: data.br });
  });
  return { entries: result, problems };
}

function updateRowCount() {
  const count = rows.querySelectorAll(".row").length;
  rowCount.textContent = `${count} / ${CAPACITY} slots`;
  addRowButton.disabled = count >= CAPACITY;
}

function addRow(defaults = {}) {
  if (rows.querySelectorAll(".row").length >= CAPACITY) return;
  const node = template.content.firstElementChild.cloneNode(true);
  const fcInput = node.querySelector(".fc");
  fcInput.value = defaults.pid ? friendCode(defaults.pid) : "";
  node.querySelector(".vr").value = defaults.vr ?? DEFAULT_RATING;
  node.querySelector(".br").value = defaults.br ?? DEFAULT_RATING;
  node.querySelector(".remove").addEventListener("click", () => {
    node.remove();
    if (!rows.children.length) addRow();
    updateRowCount();
    refresh();
  });
  fcInput.addEventListener("blur", () => {
    const pid = parseFriendCode(fcInput.value);
    if (pid !== null) fcInput.value = friendCode(pid);
  });
  node.querySelector(".fetch").addEventListener("click", async () => {
    const button = node.querySelector(".fetch");
    button.disabled = true;
    button.textContent = "Loading...";
    const result = await fetchRowVr(node);
    button.disabled = false;
    button.textContent = "Get VR";
    statusText.textContent = result.message;
  });
  node.addEventListener("input", refresh);
  rows.appendChild(node);
  updateRowCount();
}

function setRows(entries) {
  rows.textContent = "";
  for (const entry of entries.slice(0, CAPACITY)) addRow(entry);
  if (!rows.children.length) addRow();
  updateRowCount();
  refresh();
}

function refresh() {
  rowData();
  statusText.textContent = "";
  clearDownloads();
}

// ---------- Leaderboard ----------

const LEADERBOARD_URL = "https://rwfc.net/api/leaderboard/player/";

async function fetchLeaderboardVr(pid) {
  const response = await fetch(LEADERBOARD_URL + encodeURIComponent(friendCode(pid)), { headers: { Accept: "application/json" } });
  if (response.status === 404) throw new Error("not on the leaderboard");
  if (!response.ok) throw new Error(`leaderboard returned HTTP ${response.status}`);
  const data = await response.json();
  const vr = Number(data?.vr);
  if (!Number.isFinite(vr)) throw new Error("leaderboard response has no VR");
  return { vr: clampRating(Math.round(vr)), name: typeof data.name === "string" ? data.name : "" };
}

// Updates one row's VR from the leaderboard; returns { ok, message }.
async function fetchRowVr(row) {
  const index = [...rows.children].indexOf(row) + 1;
  const fcInput = row.querySelector(".fc");
  const pid = parseFriendCode(fcInput.value);
  if (pid === null) return { ok: false, message: `Row ${index}: enter a valid friend code first.` };
  try {
    const { vr, name } = await fetchLeaderboardVr(pid);
    row.querySelector(".vr").value = vr;
    if (name) fcInput.title = name;
    refresh();
    return { ok: true, message: `Row ${index}: ${name || friendCode(pid)} has ${vr} VR.` };
  } catch (error) {
    return { ok: false, message: `Row ${index}: ${error.message}.` };
  }
}

async function fetchAllVr(button) {
  const targets = [...rows.children].filter(row => parseFriendCode(row.querySelector(".fc").value) !== null);
  if (!targets.length) {
    statusText.textContent = "Enter at least one valid friend code first.";
    return;
  }
  const label = button.textContent;
  button.disabled = true;
  const failures = [];
  for (let i = 0; i < targets.length; i++) {
    button.textContent = `Loading ${i + 1} / ${targets.length}...`;
    const result = await fetchRowVr(targets[i]);
    if (!result.ok) failures.push(result.message);
  }
  button.disabled = false;
  button.textContent = label;
  const updated = targets.length - failures.length;
  statusText.textContent = [`Updated ${updated} of ${targets.length} profile${targets.length === 1 ? "" : "s"}.`, ...failures].join(" ");
}

// ---------- File format ----------

// The pending race marker is always written cleared.
function buildFile(entries) {
  const bytes = new Uint8Array(OUTPUT_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint16(4, VERSION, false);
  view.setUint16(6, CAPACITY, false);
  entries.forEach((entry, i) => {
    const offset = 8 + i * ENTRY_SIZE;
    view.setUint32(offset, entry.pid, false);
    view.setUint32(offset + 4, entry.vr, false);
    view.setUint32(offset + 8, entry.br, false);
  });
  return bytes;
}

// Keeps the highest-VR copy of a repeated profile, like CreateRatingFile does.
function dedupe(entries) {
  const byPid = new Map();
  for (const entry of entries) {
    const existing = byPid.get(entry.pid);
    if (!existing || entry.vr > existing.vr) byPid.set(entry.pid, entry);
  }
  return [...byPid.values()];
}

function clampRating(value) {
  return Math.min(Math.max(value, 1), MAX_RATING);
}

function parseFile(bytes) {
  if (bytes.length < 8) throw new Error("File is too small.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== MAGIC) throw new Error("Not an RRRating file (missing RRRT magic).");
  const version = view.getUint16(4, false);
  const capacity = view.getUint16(6, false);
  if (capacity !== CAPACITY) throw new Error(`Unexpected entry capacity ${capacity}.`);

  const entries = [];
  const notes = [];

  if (version === VERSION) {
    if (bytes.length < FILE_SIZE) throw new Error(`Version 2 file is truncated (${bytes.length} bytes).`);
    for (let i = 0; i < CAPACITY; i++) {
      const offset = 8 + i * ENTRY_SIZE;
      const pid = view.getUint32(offset, false);
      if (!pid) continue;
      entries.push({ pid, vr: view.getUint32(offset + 4, false), br: view.getUint32(offset + 8, false) });
    }
    if (bytes.length >= OUTPUT_SIZE && view.getUint32(FILE_SIZE, false) !== 0)
      notes.push("Cleared a pending race penalty.");
  } else if (version === LEGACY_VERSION) {
    if (bytes.length < LEGACY_FILE_SIZE) throw new Error(`Version 1 file is truncated (${bytes.length} bytes).`);
    for (let i = 0; i < CAPACITY; i++) {
      const offset = 8 + i * 16;
      const pid = view.getUint32(offset, false);
      if (!pid) continue;
      const vr = view.getFloat32(offset + 4, false);
      const br = view.getFloat32(offset + 8, false);
      if (!(vr >= 0 && vr <= 42949672 && br >= 0 && br <= 42949672)) throw new Error(`Legacy entry ${i} has an invalid rating.`);
      entries.push({ pid, vr: Math.floor(vr * 100 + 0.5), br: Math.floor(br * 100 + 0.5) });
    }
    notes.push("Converted from the legacy version 1 format.");
  } else {
    throw new Error(`Unsupported file version ${version}.`);
  }

  const unique = dedupe(entries);
  if (unique.length !== entries.length) notes.push("Merged repeated profiles.");
  let clamped = false;
  for (const entry of unique) {
    if (entry.pid > MAX_PID) notes.push(`Friend code ${friendCode(entry.pid)} is invalid.`);
    const vr = clampRating(entry.vr);
    const br = clampRating(entry.br);
    if (vr !== entry.vr || br !== entry.br) clamped = true;
    entry.vr = vr;
    entry.br = br;
  }
  if (clamped) notes.push(`Clamped ratings to 1-${MAX_RATING}.`);
  return { entries: unique, version, notes };
}

// ---------- Import / export ----------

async function importFromInput(file) {
  try {
    const parsed = parseFile(new Uint8Array(await file.arrayBuffer()));
    setRows(parsed.entries);
    const parts = [`Imported ${parsed.entries.length} profile${parsed.entries.length === 1 ? "" : "s"} from ${file.name}.`, ...parsed.notes];
    importStatus.textContent = parts.join(" ");
  } catch (error) {
    importStatus.textContent = error.message;
  }
}

function downloadBlob(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  generatedUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.textContent = name;
  downloads.appendChild(link);
}

function clearDownloads() {
  for (const url of generatedUrls) URL.revokeObjectURL(url);
  generatedUrls.length = 0;
  downloads.textContent = "";
}

function generate() {
  clearDownloads();
  const { entries, problems } = rowData();
  if (problems.length) {
    statusText.textContent = "Fix the highlighted fields first.";
    return;
  }
  downloadBlob("RRRating.pul", buildFile(entries));
  statusText.textContent = `Done. ${entries.length} profile${entries.length === 1 ? "" : "s"} written. Place it at /RRRating/RRRating.pul.`;
}

function newFile() {
  setRows([]);
  importStatus.textContent = "Started a new file.";
}

addRowButton.addEventListener("click", () => addRow());
document.querySelector("#fetchAll").addEventListener("click", event => fetchAllVr(event.currentTarget));
document.querySelector("#generate").addEventListener("click", generate);
document.querySelector("#newFile").addEventListener("click", newFile);
themeToggle.addEventListener("click", cycleTheme);
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  importStatus.textContent = "Importing...";
  await importFromInput(file);
  importFile.value = "";
});
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
  if (getThemePreference() === "system") syncTheme();
});
syncTheme();
addRow();
