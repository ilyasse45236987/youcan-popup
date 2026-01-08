console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ✅ CORS: سمح لمواقع الزبائن (أسهل: * فالبداية)
app.use(cors({ origin: true }));

// ----------------------
// ✅ ENV
// ----------------------
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID || "";
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON || "";

function mustEnv() {
  if (!ADMIN_SHEET_ID) throw new Error("Missing ADMIN_SHEET_ID env");
  if (!GOOGLE_CREDENTIALS_JSON) throw new Error("Missing GOOGLE_CREDENTIALS_JSON env");
}

function getSheetsClient() {
  mustEnv();
  const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

async function getValues(spreadsheetId, range) {
  const sheets = getSheetsClient();
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return r.data.values || [];
}

async function appendRow(spreadsheetId, range, values) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
}

// 🔒 anti-duplicate (10 min)
const seen = new Map();
function isDuplicate(key) {
  const now = Date.now();
  const ttl = 10 * 60 * 1000;
  for (const [k, t] of seen.entries()) {
    if (now - t > ttl) seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

function hashLead({ clientId, store, email, coupon, page }) {
  const s = `${clientId}|${store}|${email}|${coupon}|${page}`;
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ----------------------
// ✅ Load client config from Admin Sheet
// Tab name: clients
// Columns: clientId, storeDomain, licenseKey, couponCode, sheetId, enabled
// ----------------------
let CLIENTS_CACHE = new Map();
let lastLoad = 0;

async function loadClients() {
  const now = Date.now();
  if (now - lastLoad < 30 * 1000 && CLIENTS_CACHE.size) return; // cache 30s

  const rows = await getValues(ADMIN_SHEET_ID, "clients!A2:F");
  const map = new Map();

  for (const r of rows) {
    const clientId = (r[0] || "").trim();
    const storeDomain = (r[1] || "").trim();
    const licenseKey = (r[2] || "").trim();
    const couponCode = (r[3] || "").trim();
    const sheetId = (r[4] || "").trim();
    const enabled = String(r[5] || "").trim().toLowerCase();

    if (!clientId) continue;
    map.set(clientId, {
      clientId,
      storeDomain,
      licenseKey,
      couponCode,
      sheetId,
      enabled: enabled === "true" || enabled === "1" || enabled === "yes",
    });
  }

  CLIENTS_CACHE = map;
  lastLoad = now;
  console.log("✅ Clients loaded:", CLIENTS_CACHE.size);
}

function findClient(clientId) {
  return CLIENTS_CACHE.get(clientId);
}

// ----------------------
// ✅ Routes
// ----------------------
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

app.get("/api/status", (req, res) => res.json({ ok: true, status: "active" }));

// ✅ Verify: كيتأكد بالclientId+key (+ domain optional)
app.get("/api/verify", async (req, res) => {
  try {
    await loadClients();

    const clientId = (req.query.clientId || "").trim();
    const store = (req.query.store || "").trim();
    const key = (req.query.key || "").trim();

    const c = findClient(clientId);
    if (!c || !c.enabled) return res.json({ ok: true, status: "inactive" });

    if (c.licenseKey && key !== c.licenseKey) return res.json({ ok: true, status: "inactive" });

    // optional domain check
    if (c.storeDomain && store && store !== c.storeDomain) return res.json({ ok: true, status: "inactive" });

    return res.json({ ok: true, status: "active", couponCode: c.couponCode || "" });
  } catch (e) {
    console.log("❌ VERIFY ERROR:", e);
    res.json({ ok: true, status: "inactive" });
  }
});

// ✅ Popup config: كيجيب coupon ديال client من Admin sheet
app.get("/api/popup-config", async (req, res) => {
  try {
    await loadClients();
    const clientId = (req.query.clientId || "").trim();
    const c = findClient(clientId);

    const coupon = c?.couponCode || "GASTELLO10";

    res.json({
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon,
    });
  } catch (e) {
    console.log("❌ POPUP-CONFIG ERROR:", e);
    res.json({ active: true, title: "🔥 خصم خاص!", text: "دخل الإيميل ديالك وخد 10% دابا", coupon: "GASTELLO10" });
  }
});

// ✅ Lead -> يكتب فـ Sheet ديال client
app.post("/api/lead", async (req, res) => {
  try {
    await loadClients();

    const body = req.body || {};
    const clientId = (body.clientId || "").trim();
    const store = (body.store || "").trim();
    const email = (body.email || "").trim();
    const coupon = (body.coupon || "").trim();
    const page = (body.page || "").trim();
    const time = new Date().toISOString();

    if (!clientId || !store || !email) {
      return res.status(400).json({ ok: false, error: "missing clientId/store/email" });
    }

    const c = findClient(clientId);
    if (!c || !c.enabled) return res.status(403).json({ ok: false, error: "client_inactive" });
    if (!c.sheetId) return res.status(400).json({ ok: false, error: "missing_client_sheetId" });

    // optional domain check
    if (c.storeDomain && store !== c.storeDomain) return res.status(403).json({ ok: false, error: "domain_mismatch" });

    const keyHash = hashLead({ clientId, store, email, coupon, page });
    if (isDuplicate(keyHash)) return res.json({ ok: true, skipped: true });

    // لازم فـ Sheet ديال client يكون tab سميتو leads (ولا نخلي append حتى بلا tab؟ الأفضل نديرو leads)
    await appendRow(c.sheetId, "leads!A1", [time, store, email, coupon, page]);

    console.log("✅ LEAD SAVED TO CLIENT SHEET:", { clientId, sheetId: c.sheetId, email, store });
    res.json({ ok: true });
  } catch (e) {
    console.log("❌ LEAD ERROR:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ popup.js
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  async function run() {
    try {
      var script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      var base = new URL(script.src).origin;

      var cfgClient = (window.YOUCAN_POPUP || {});
      var clientId = (cfgClient.clientId || "").trim();
      var key = (cfgClient.key || "").trim();

      if (!clientId || !key) return;

      // verify
      var vr = await fetch(base + "/api/verify?clientId=" + encodeURIComponent(clientId) + "&store=" + encodeURIComponent(window.location.host) + "&key=" + encodeURIComponent(key));
      var vj = await vr.json();
      if (!vj || vj.status !== "active") return;

      var r = await fetch(base + "/api/popup-config?clientId=" + encodeURIComponent(clientId));
      var cfg = await r.json();
      if (!cfg || !cfg.active) return;

      if (localStorage.getItem("popup_done")) return;

      var wrap = document.createElement("div");
      wrap.innerHTML =
        '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:999999;">' +
        '<div style="background:#fff;padding:20px;width:90%;max-width:360px;border-radius:12px;font-family:Arial,sans-serif">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<strong>' + (cfg.title || "") + '</strong>' +
        '<button id="popup_close" style="border:none;background:none;font-size:18px;cursor:pointer">×</button>' +
        '</div>' +
        '<p style="margin:10px 0">' + (cfg.text || "") + '</p>' +
        '<input id="popup_email" type="email" placeholder="Email" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px"/>' +
        '<button id="popup_btn" style="margin-top:10px;width:100%;padding:10px;border:none;border-radius:8px;cursor:pointer;background:#111;color:#fff">Get Code</button>' +
        '</div></div>';

      document.body.appendChild(wrap);

      document.getElementById("popup_close").onclick = function () { wrap.remove(); };

      document.getElementById("popup_btn").onclick = async function () {
        var email = (document.getElementById("popup_email").value || "").trim();
        if (!email) return alert("كتب الإيميل أولاً");

        try {
          await fetch(base + "/api/lead", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              clientId: clientId,
              store: window.location.host,
              email: email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          });

          localStorage.setItem("popup_done", "1");
          alert("🎉 Coupon: " + (cfg.coupon || ""));
          wrap.remove();
        } catch(e) {
          alert("وقع مشكل، عاود حاول");
        }
      };
    } catch (e) {}
  }
  run();
})();`);
});

// ✅ Render PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
