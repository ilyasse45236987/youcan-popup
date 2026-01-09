console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// ✅ CORS: خليه مفتوح باش يخدم مع أي دومين ديال clients
app.use(cors({ origin: true }));

/** =========================
 *  ENV
 *  ========================= */
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID || "";
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON || "";

if (!ADMIN_SHEET_ID) console.log("⚠️ ADMIN_SHEET_ID is missing");
if (!GOOGLE_CREDENTIALS_JSON) console.log("⚠️ GOOGLE_CREDENTIALS_JSON is missing");

/** =========================
 *  GOOGLE SHEETS AUTH
 *  ========================= */
function getSheetsClient() {
  const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

/** =========================
 *  HELPERS
 *  ========================= */
const normalizeDomain = (d) =>
  (d || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");

function toBool(v) {
  return String(v || "")
    .trim()
    .toLowerCase() === "true";
}

/** =========================
 *  READ CLIENTS FROM ADMIN SHEET
 *  - reads clients!A1:Z
 *  - headers-driven (no A2:F)
 *  ========================= */
async function getClientsTable() {
  const sheets = getSheetsClient();

  // ✅ safe range
  const range = "clients!A1:Z";

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range,
  });

  const rows = resp.data.values || [];
  if (rows.length < 2) {
    return { headers: [], data: [] };
  }

  const headers = rows[0].map((h) => (h || "").trim());
  const data = rows.slice(1);

  const idx = (name) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  return { headers, data, idx };
}

async function findClientByStore(store) {
  const storeN = normalizeDomain(store);

  const { headers, data, idx } = await getClientsTable();
  if (!headers.length) return null;

  const iClientId = idx("clientId");
  const iStore = idx("storeDomain");
  const iLicense = idx("licenseKey");
  const iCoupon = idx("couponCode");
  const iSheetId = idx("sheetId");
  const iEnabled = idx("enabled");

  if (iStore === -1 || iSheetId === -1 || iEnabled === -1) {
    throw new Error(
      "Missing headers in clients tab. Required: storeDomain, sheetId, enabled"
    );
  }

  const row = data.find((r) => normalizeDomain(r[iStore]) === storeN);
  if (!row) return null;

  return {
    clientId: (iClientId >= 0 ? row[iClientId] : "") || "",
    storeDomain: row[iStore] || "",
    licenseKey: (iLicense >= 0 ? row[iLicense] : "") || "",
    couponCode: (iCoupon >= 0 ? row[iCoupon] : "") || "",
    sheetId: row[iSheetId] || "",
    enabled: toBool(row[iEnabled]),
  };
}

/** =========================
 *  ROUTES
 *  ========================= */

// health
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// status
app.get("/api/status", (req, res) => res.json({ ok: true, status: "active" }));

/**
 * VERIFY: /api/verify?store=...&key=...
 * - checks clients tab
 */
app.get("/api/verify", async (req, res) => {
  try {
    const store = (req.query.store || "").trim();
    const key = (req.query.key || "").trim();

    const client = await findClientByStore(store);

    console.log("VERIFY HIT:", {
      store,
      key,
      found: !!client,
      time: new Date().toISOString(),
    });

    if (!client || !client.enabled) {
      return res.json({ ok: true, status: "inactive" });
    }

    // إذا بغيت licenseKey يكون إجباري:
    if (client.licenseKey && key !== client.licenseKey) {
      return res.json({ ok: true, status: "inactive" });
    }

    return res.json({
      ok: true,
      status: "active",
      couponCode: client.couponCode || "",
      clientId: client.clientId || "",
    });
  } catch (e) {
    console.log("VERIFY ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POPUP CONFIG: /api/popup-config?store=...
 * returns coupon from clients tab
 */
app.get("/api/popup-config", async (req, res) => {
  try {
    const store = (req.query.store || "").trim() || req.headers.host;

    const client = await findClientByStore(store);

    if (!client || !client.enabled) {
      return res.json({ active: false });
    }

    return res.json({
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: client.couponCode || "",
      clientId: client.clientId || "",
    });
  } catch (e) {
    console.log("POPUP CONFIG ERROR:", e?.message || e);
    return res.status(500).json({ active: false });
  }
});

/**
 * LEAD: POST /api/lead
 * body: { store, email, coupon, page }
 * writes to client sheet => leads tab
 */
app.post("/api/lead", async (req, res) => {
  try {
    const { store, email, coupon, page } = req.body || {};

    const client = await findClientByStore(store);

    const payload = {
      clientId: client?.clientId || "",
      store: normalizeDomain(store),
      email: (email || "").trim(),
      coupon: (coupon || "").trim(),
      page: page || "",
      time: new Date().toISOString(),
    };

    console.log("✅ NEW LEAD:", payload);

    if (!client || !client.enabled) {
      return res.json({ ok: true, saved: false, reason: "inactive client" });
    }

    if (!client.sheetId) {
      return res
        .status(500)
        .json({ ok: false, error: "sheetId missing for this client" });
    }

    const sheets = getSheetsClient();

    // ✅ append to "leads" tab in client sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: client.sheetId.trim(),
      range: "leads!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[payload.time, payload.store, payload.email, payload.coupon, payload.page]],
      },
    });

    console.log("✅ LEAD SAVED TO CLIENT SHEET:", client.sheetId);

    return res.json({ ok: true, saved: true });
  } catch (e) {
    console.log("LEAD ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * POPUP SCRIPT
 * used in YouCan:
 * <script src="https://youcan-popup.onrender.com/popup.js"></script>
 */
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  async function run() {
    try {
      var script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      var base = new URL(script.src).origin;

      var store = window.location.hostname; // includes www maybe
      var r = await fetch(base + "/api/popup-config?store=" + encodeURIComponent(store));
      var cfg = await r.json();
      if (!cfg || !cfg.active) return;

      if (localStorage.getItem("popup_done")) return;

      var wrap = document.createElement("div");
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

      document.getElementById("popup_close").onclick = function () { wrap.remove(); };

      document.getElementById("popup_btn").onclick = async function () {
        var email = document.getElementById("popup_email").value.trim();
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

// ✅ Render PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
