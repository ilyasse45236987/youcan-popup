console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

/* =======================
   CONFIG
======================= */

// 🔹 Admin Sheet ID (ديال sheet اللي فيه tab clients)
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;

// 🔹 Google Service Account JSON (كامل)
const GOOGLE_CREDENTIALS_JSON = JSON.parse(
  process.env.GOOGLE_CREDENTIALS_JSON
);

// 🔹 CORS (زيد domains ديال clients)
const ALLOWED_ORIGINS = [
  "https://gastello.shop",
  "https://www.gastello.shop",
];

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

/* =======================
   GOOGLE SHEETS SETUP
======================= */

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS_JSON,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/* =======================
   HELPERS
======================= */

// normalize domain (يحيد www)
function normalizeDomain(domain = "") {
  return domain.replace(/^www\./, "").toLowerCase();
}

// get client from admin sheet
async function getClientByStore(storeDomain) {
  const cleanStore = normalizeDomain(storeDomain);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range: "clients!A2:F",
  });

  const rows = res.data.values || [];

  for (const row of rows) {
    const [
      clientId,
      store,
      licenseKey,
      couponCode,
      sheetId,
      enabled,
      plan,
      leadLimit,
    ] = row;

    if (normalizeDomain(store) === cleanStore) {
      return {
        clientId,
        store,
        licenseKey,
        couponCode,
        sheetId,
        enabled: String(enabled).toLowerCase() === "true",
        plan,
        leadLimit: Number(leadLimit || 0),
      };
    }
  }

  return null;
}

/* =======================
   ROUTES
======================= */

// 🔹 Health
app.get("/", (req, res) => {
  res.send("🚀 Server khdam mzyan");
});

// 🔹 Verify license
app.get("/api/verify", async (req, res) => {
  try {
    const store = req.query.store || "";
    const key = req.query.key || "";

    const client = await getClientByStore(store);

    if (!client || !client.enabled) {
      return res.json({ ok: true, status: "inactive" });
    }

    if (client.licenseKey !== key) {
      return res.json({ ok: true, status: "inactive" });
    }

    return res.json({
      ok: true,
      status: "active",
      couponCode: client.couponCode || "",
    });
  } catch (e) {
    console.error("VERIFY ERROR:", e.message);
    res.status(500).json({ ok: false, error: "verify_error" });
  }
});

// 🔹 Popup config
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// 🔹 Receive lead + write to client sheet
app.post("/api/lead", async (req, res) => {
  try {
    const { store, email, coupon, page } = req.body || {};
    if (!store || !email) {
      return res.status(400).json({ ok: false });
    }

    const client = await getClientByStore(store);
    if (!client || !client.enabled) {
      return res.json({ ok: true });
    }

    const time = new Date().toISOString();

    console.log("✅ NEW LEAD:", {
      clientId: client.clientId,
      store,
      email,
      coupon,
      page,
      time,
    });

    // ✍️ write to client sheet (tab: leads)
    await sheets.spreadsheets.values.append({
      spreadsheetId: client.sheetId,
      range: "leads!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[time, email, coupon || "", page || "", store]],
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("LEAD ERROR:", e.message);
    res.status(500).json({ ok: false });
  }
});

// 🔹 popup.js (external script)
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.send(`(function () {
    async function run() {
      try {
        const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
        const base = new URL(script.src).origin;

        const r = await fetch(base + "/api/popup-config");
        const cfg = await r.json();
        if (!cfg || !cfg.active) return;

        if (localStorage.getItem("popup_done")) return;

        const wrap = document.createElement("div");
        wrap.innerHTML = \`
        <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:999999">
          <div style="background:#fff;padding:16px;min-width:320px;border-radius:12px;font-family:Arial">
            <div style="display:flex;justify-content:space-between">
              <strong>\${cfg.title||""}</strong>
              <button id="popup_close">×</button>
            </div>
            <p>\${cfg.text||""}</p>
            <input id="popup_email" type="email" placeholder="Email" style="width:100%;padding:8px"/>
            <button id="popup_btn" style="margin-top:10px;width:100%">Get coupon</button>
          </div>
        </div>\`;

        document.body.appendChild(wrap);
        document.getElementById("popup_close").onclick = () => wrap.remove();

        document.getElementById("popup_btn").onclick = async () => {
          const email = document.getElementById("popup_email").value.trim();
          if (!email) return alert("كتب الإيميل أولاً");

          await fetch(base + "/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              store: window.location.hostname,
              email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          });

          localStorage.setItem("popup_done","1");
          alert("🎉 Coupon: " + (cfg.coupon || ""));
          wrap.remove();
        };
      } catch(e) {
        console.log("POPUP ERROR", e);
      }
    }
    run();
  })();`);
});

/* =======================
   START SERVER
======================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("✅ Server running on port " + PORT)
);
