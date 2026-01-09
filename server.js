console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { google } = require("googleapis");

const app = express();
app.set("trust proxy", 1);

// ---------- BASIC ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- SECURITY (بدون ما نبلوكي popup.js) ----------
app.use(
  helmet({
    crossOriginResourcePolicy: false, // ✅ مهم باش /popup.js مايتبلوكيش
  })
);

// ✅ زيد هاد headers (مهمين بزاف)
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

// ---------- CORS ----------
app.use(
  cors({
    origin: true, // ✅ خليه true باش يجي من أي دومين (YouCan clients)
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// ---------- RATE LIMIT ----------
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ---------- GOOGLE SHEETS ----------
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON;

if (!ADMIN_SHEET_ID) console.log("⚠️ Missing ADMIN_SHEET_ID in env");
if (!GOOGLE_CREDENTIALS_JSON) console.log("⚠️ Missing GOOGLE_CREDENTIALS_JSON in env");

function normalizeDomain(d) {
  return (d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

async function getSheetsClient() {
  const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readClientsTable() {
  const sheets = await getSheetsClient();
  const range = "'clients'!A1:F"; // clientId, storeDomain, licenseKey, couponCode, sheetId, enabled
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range,
  });

  const rows = resp.data.values || [];
  const header = rows[0] || [];
  const data = rows.slice(1);

  // map by header names (safer)
  const idx = (name) => header.indexOf(name);

  const out = data
    .map((r) => ({
      clientId: r[idx("clientId")] || r[0] || "",
      storeDomain: r[idx("storeDomain")] || r[1] || "",
      licenseKey: r[idx("licenseKey")] || r[2] || "",
      couponCode: r[idx("couponCode")] || r[3] || "",
      sheetId: r[idx("sheetId")] || r[4] || "",
      enabled: String(r[idx("enabled")] || r[5] || "").toUpperCase() === "TRUE",
    }))
    .filter((x) => x.clientId && x.storeDomain);

  return out;
}

async function findClientByStore(store) {
  const s = normalizeDomain(store);
  const clients = await readClientsTable();

  // supports www و بلا www
  return clients.find((c) => {
    const dom = normalizeDomain(c.storeDomain);
    return dom === s || dom === s.replace(/^www\./, "") || ("www." + dom) === s;
  });
}

async function appendLeadToClientSheet(sheetId, lead) {
  const sheets = await getSheetsClient();

  // ✅ فـ sheet ديال client خاص tab اسميتو leads
  const range = "'leads'!A1:E";
  const values = [[lead.time, lead.store, lead.email, lead.coupon, lead.page]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

// ---------- ROUTES ----------
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ verify (SaaS)
app.get("/api/verify", async (req, res) => {
  try {
    const store = normalizeDomain(req.query.store);
    const key = (req.query.key || "").trim();

    const client = await findClientByStore(store);
    if (!client || !client.enabled) return res.json({ ok: true, status: "inactive" });

    if (client.licenseKey && key !== client.licenseKey) {
      return res.json({ ok: true, status: "inactive" });
    }

    return res.json({ ok: true, status: "active", couponCode: client.couponCode || "" });
  } catch (e) {
    console.log("VERIFY ERROR:", e.message);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ popup config per store
app.get("/api/popup-config", async (req, res) => {
  try {
    const store = normalizeDomain(req.query.store || req.headers.origin || "");
    const client = await findClientByStore(store);
    if (!client || !client.enabled) return res.json({ active: false });

    res.json({
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: client.couponCode || "",
      clientId: client.clientId,
    });
  } catch (e) {
    console.log("POPUP CONFIG ERROR:", e.message);
    res.status(500).json({ active: false });
  }
});

// ✅ receive lead + write to client sheet
app.post("/api/lead", async (req, res) => {
  try {
    const store = normalizeDomain(req.body.store || "");
    const email = (req.body.email || "").trim();
    const coupon = (req.body.coupon || "").trim();
    const page = (req.body.page || "").trim();

    if (!store || !email) return res.status(400).json({ ok: false, error: "missing_store_or_email" });

    const client = await findClientByStore(store);
    if (!client || !client.enabled) return res.json({ ok: true });

    const lead = {
      time: new Date().toISOString(),
      store,
      email,
      coupon: coupon || client.couponCode || "",
      page,
      clientId: client.clientId,
    };

    console.log("✅ NEW LEAD:", lead);

    if (!client.sheetId) {
      console.log("LEAD WARN: client sheetId empty");
      return res.json({ ok: true });
    }

    await appendLeadToClientSheet(client.sheetId, lead);

    res.json({ ok: true });
  } catch (e) {
    console.log("LEAD ERROR:", e.message);
    res.status(500).json({ ok: false, error: "lead_error" });
  }
});

// ✅ external script popup.js (must be cross-origin)
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // ✅ باش يسمح بتحميل السكريبت من أي دومين
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.send(`(function () {
  async function run() {
    try {
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;
      const store = window.location.hostname;

      const r = await fetch(base + "/api/popup-config?store=" + encodeURIComponent(store));
      const cfg = await r.json();
      if (!cfg || !cfg.active) return;

      if (localStorage.getItem("popup_done")) return;

      const wrap = document.createElement("div");
      wrap.innerHTML = \`
        <div style="
          position:fixed;top:0;left:0;right:0;bottom:0;
          background:rgba(0,0,0,.45);
          display:flex;align-items:center;justify-content:center;
          z-index:999999;">
          <div style="
            background:#fff;padding:16px;min-width:320px;
            border-radius:12px;box-shadow:0 0 15px rgba(0,0,0,.2);
            font-family:Arial,sans-serif">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>\${cfg.title || ""}</strong>
              <button id="popup_close" style="border:none;background:none;font-size:18px;cursor:pointer">×</button>
            </div>
            <p style="margin:10px 0">\${cfg.text || ""}</p>
            <input id="popup_email" type="email" placeholder="Email"
              style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px"/>
            <button id="popup_btn" style="
              width:100%;margin-top:10px;padding:10px;border:none;
              background:#111;color:#fff;border-radius:8px;cursor:pointer">
              Get coupon
            </button>
          </div>
        </div>\`;

      document.body.appendChild(wrap);
      document.getElementById("popup_close").onclick = () => wrap.remove();

      document.getElementById("popup_btn").onclick = async () => {
        const email = document.getElementById("popup_email").value.trim();
        if (!email) return alert("كتب الإيميل أولاً");

        try {
          await fetch(base + "/api/lead", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              store: store,
              email: email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          });

          localStorage.setItem("popup_done","1");
          alert("🎉 Coupon: " + (cfg.coupon || ""));
          wrap.remove();
        } catch(e) {
          console.log("LEAD POST ERROR:", e);
          alert("وقع مشكل، عاود حاول");
        }
      };

    } catch(e) {
      console.log("POPUP ERROR:", e);
    }
  }
  run();
})();`);
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
