console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { google } = require("googleapis");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(helmet());

// ====== CONFIG ======
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;                 // ID ديال Admin Sheet
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON; // JSON ديال Service Account
const ADMIN_CLIENTS_TAB = process.env.ADMIN_CLIENTS_TAB || "clients"; // اسم tab ديال clients فـ admin
const DEFAULT_LEADS_TAB = process.env.DEFAULT_LEADS_TAB || "leads";   // اسم tab فـ sheet ديال كل client

if (!ADMIN_SHEET_ID) console.log("⚠️ Missing env ADMIN_SHEET_ID");
if (!GOOGLE_CREDENTIALS_JSON) console.log("⚠️ Missing env GOOGLE_CREDENTIALS_JSON");

// CORS: خليه مفتوح شوية حيث clients غادي يكونو بزاف domains
app.use(
  cors({
    origin: function (origin, cb) {
      // allow server-to-server / no-origin
      if (!origin) return cb(null, true);
      return cb(null, true);
    },
  })
);

// Rate limit باش ما يضربكش spam
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ====== GOOGLE SHEETS AUTH ======
function getSheetsClient() {
  const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function normDomain(d) {
  const x = (d || "").trim().toLowerCase();
  if (!x) return "";
  return x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function safeGetValues(sheets, spreadsheetId, range) {
  // range مثال: `'clients'!A1:Z`
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (r.data && r.data.values) || [];
}

async function findClientByStore(storeDomain) {
  const sheets = getSheetsClient();
  const storeN = normDomain(storeDomain);

  // كنقراو clients tab من admin sheet
  // كنستعملو quotes باش حتى إلا كان الاسم فيه شي رمز ما يوقعش error
  const range = `'${ADMIN_CLIENTS_TAB}'!A1:Z`;

  let values;
  try {
    values = await safeGetValues(sheets, ADMIN_SHEET_ID, range);
  } catch (e) {
    // فهاد الحالة 99% ADMIN_SHEET_ID غلط أو tab سميتها ماشي clients
    throw new Error(
      `Unable to read Admin clients tab. Check ADMIN_SHEET_ID and tab name. (${e.message})`
    );
  }

  if (!values.length) return null;

  const header = values[0].map((h) => (h || "").toString().trim());
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const iClientId = idx("clientId");
  const iStore = idx("storeDomain");
  const iKey = idx("licenseKey");
  const iCoupon = idx("couponCode");
  const iSheetId = idx("sheetId");
  const iEnabled = idx("enabled");

  // مطلوبين
  if (iStore < 0 || iKey < 0 || iSheetId < 0) {
    throw new Error(
      `Admin tab '${ADMIN_CLIENTS_TAB}' لازم يكون فيه الأعمدة: storeDomain, licenseKey, sheetId (ويمكن couponCode, enabled, clientId).`
    );
  }

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const rowStore = normDomain(row[iStore] || "");
    if (!rowStore) continue;

    // كنقبل www ولا بلا www
    if (rowStore === storeN) {
      const enabledVal = (row[iEnabled] || "").toString().trim().toLowerCase();
      const enabled =
        iEnabled < 0 ? true : enabledVal === "true" || enabledVal === "1" || enabledVal === "yes";

      return {
        clientId: (iClientId >= 0 ? row[iClientId] : "") || storeN,
        storeDomain: rowStore,
        licenseKey: (row[iKey] || "").toString().trim(),
        couponCode: (iCoupon >= 0 ? row[iCoupon] : "") || "",
        sheetId: (row[iSheetId] || "").toString().trim(),
        enabled,
      };
    }
  }

  return null;
}

async function appendLeadToClientSheet(sheetId, lead) {
  const sheets = getSheetsClient();
  const tab = DEFAULT_LEADS_TAB;

  // نديرو header إلا ما كايناش
  // كنقراو أول صف
  let firstRow = [];
  try {
    firstRow = await safeGetValues(sheets, sheetId, `'${tab}'!A1:E1`);
  } catch (e) {
    // إذا tab leads ما كايناش، Google API غادي يعطي error
    // أسهل حل: خلي client يدير tab سميتها leads فـ sheet ديالو.
    throw new Error(
      `Client sheet missing tab '${tab}'. Create a tab named '${tab}' in client sheet. (${e.message})`
    );
  }

  const headerWanted = ["time", "store", "email", "coupon", "page"];
  const hasHeader =
    firstRow &&
    firstRow[0] &&
    headerWanted.every((h, i) => ((firstRow[0][i] || "").toString().toLowerCase() === h));

  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tab}'!A1:E1`,
      valueInputOption: "RAW",
      requestBody: { values: [headerWanted] },
    });
  }

  // Dedupe بسيط: نفس email + store فآخر 24 ساعة
  // (اختياري) إذا بغيتيه قوي أكثر نقلبو فـ sheet ولكن هادشي كيكون ثقيل.
  const valuesRow = [
    lead.time,
    lead.store,
    lead.email,
    lead.coupon || "",
    lead.page || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${tab}'!A:E`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [valuesRow] },
  });
}

// ====== ROUTES ======
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

app.get("/api/status", (req, res) => res.json({ ok: true }));

// VERIFY: كيتأكد من licenseKey ديال store (للـ SaaS)
app.get("/api/verify", async (req, res) => {
  try {
    const store = (req.query.store || "").trim();
    const key = (req.query.key || "").trim();

    console.log("VERIFY HIT:", { store, key, time: new Date().toISOString() });

    const c = await findClientByStore(store);
    if (!c) return res.json({ ok: true, status: "inactive" });
    if (!c.enabled) return res.json({ ok: true, status: "inactive" });

    if (c.licenseKey && key === c.licenseKey) {
      return res.json({ ok: true, status: "active", couponCode: c.couponCode || "" });
    }
    return res.json({ ok: true, status: "inactive" });
  } catch (e) {
    console.log("VERIFY ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POPUP CONFIG: كيجيب config حسب storeDomain
app.get("/api/popup-config", async (req, res) => {
  try {
    const store = (req.query.store || "").trim();
    const c = await findClientByStore(store);

    if (!c || !c.enabled) {
      return res.json({ active: false });
    }

    // هنا تقدر تزيد title/text per client من admin sheet لاحقاً
    return res.json({
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: c.couponCode || "",
      clientId: c.clientId,
    });
  } catch (e) {
    console.log("POPUP CONFIG ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// LEAD: كيسجل lead فـ sheet ديال client
app.post("/api/lead", async (req, res) => {
  try {
    const body = req.body || {};
    const store = (body.store || "").trim();
    const email = (body.email || "").trim();
    const coupon = (body.coupon || "").trim();
    const page = (body.page || "").trim();

    if (!store || !email) return res.status(400).json({ ok: false, error: "Missing store/email" });

    const c = await findClientByStore(store);
    if (!c || !c.enabled) return res.json({ ok: true, skipped: true });

    const lead = {
      clientId: c.clientId,
      store: normDomain(store),
      email,
      coupon,
      page,
      time: new Date().toISOString(),
    };

    console.log("✅ NEW LEAD:", lead);

    await appendLeadToClientSheet(c.sheetId, lead);

    return res.json({ ok: true });
  } catch (e) {
    console.log("LEAD ERROR:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POPUP JS: كيتخدم فـ YouCan
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  async function run() {
    try {
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;
      const store = encodeURIComponent(window.location.hostname);

      const r = await fetch(base + "/api/popup-config?store=" + store);
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
              store: window.location.hostname,
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

// ====== START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
