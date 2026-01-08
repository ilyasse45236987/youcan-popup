console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(cors({ origin: true })); // فالتجارب خليه مفتوح، من بعد نقدر نسدو

// =====================
// ✅ ENV REQUIRED
// =====================
// ADMIN_SHEET_ID=...
// GOOGLE_CREDENTIALS_JSON={...}  (JSON كامل فـ render env)
// OPTIONAL:
// DEFAULT_TAB_LEADS=leads

const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;
const DEFAULT_TAB_LEADS = process.env.DEFAULT_TAB_LEADS || "leads";

// =====================
// ✅ Google Sheets Auth
// =====================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// =====================
// ✅ Helpers
// =====================
function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0];
  s = s.split(":")[0];
  s = s.replace(/^www\./, "");
  return s;
}

function asUpper(v) {
  return String(v || "").trim().toUpperCase();
}
function asLower(v) {
  return String(v || "").trim().toLowerCase();
}
function nowISO() {
  return new Date().toISOString();
}

// =====================
// ✅ Simple Anti-Spam (rate limit)
// =====================
const RATE_WINDOW_MS = 60_000; // 1 min
const RATE_MAX = 12; // 12 clicks/min per IP
const ipHits = new Map(); // ip -> {ts, count}

function rateLimit(req, res, next) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const t = Date.now();
  const item = ipHits.get(ip) || { ts: t, count: 0 };

  // reset window
  if (t - item.ts > RATE_WINDOW_MS) {
    item.ts = t;
    item.count = 0;
  }

  item.count += 1;
  ipHits.set(ip, item);

  if (item.count > RATE_MAX) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  next();
}

// =====================
// ✅ Read clients table
// =====================
// Admin Sheet: tab name = clients
// Columns (A..H):
// A clientId
// B storeDomain
// C licenseKey
// D couponCode
// E sheetId
// F enabled (TRUE/FALSE)
// G plan (FREE/PRO)
// H leadLimit (number)  // only for FREE
async function getAllClients() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range: "clients!A2:H",
  });

  const rows = res.data.values || [];
  return rows.map((r) => ({
    clientId: asLower(r[0]),
    storeDomain: normalizeDomain(r[1]),
    licenseKey: String(r[2] || "").trim(),
    couponCode: String(r[3] || "").trim(),
    sheetId: String(r[4] || "").trim(),
    enabled: asUpper(r[5]) === "TRUE",
    plan: asUpper(r[6] || "FREE"), // FREE / PRO
    leadLimit: Number(r[7] || 0) || 0,
  }));
}

async function getClient(clientId) {
  const all = await getAllClients();
  return all.find((c) => c.clientId === asLower(clientId)) || null;
}

async function getClientByStore(store) {
  const st = normalizeDomain(store);
  const all = await getAllClients();
  return all.find((c) => c.storeDomain === st) || null;
}

// =====================
// ✅ Health
// =====================
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// =====================
// ✅ Verify license (FROM SHEET)
// =====================
app.get("/api/verify", async (req, res) => {
  try {
    const clientId = asLower(req.query.clientId);
    const store = normalizeDomain(req.query.store);
    const key = String(req.query.key || "").trim();

    console.log("VERIFY HIT:", { clientId, store, key, time: nowISO() });

    if (!clientId || !store || !key) {
      return res.json({ ok: true, status: "inactive" });
    }

    const client = await getClient(clientId);
    if (!client || !client.enabled) return res.json({ ok: true, status: "inactive" });

    // ✅ accept www/bare because we normalize both
    if (normalizeDomain(client.storeDomain) !== store) {
      return res.json({ ok: true, status: "inactive" });
    }

    if (client.licenseKey !== key) return res.json({ ok: true, status: "inactive" });

    return res.json({
      ok: true,
      status: "active",
      couponCode: client.couponCode || "",
      plan: client.plan || "FREE",
    });
  } catch (e) {
    console.log("VERIFY ERROR:", e.message);
    return res.json({ ok: true, status: "inactive" });
  }
});

// =====================
// ✅ Popup config (PER CLIENT)
// =====================
app.get("/api/popup-config", async (req, res) => {
  try {
    const clientId = asLower(req.query.clientId);
    if (!clientId) {
      return res.json({ active: false });
    }

    const client = await getClient(clientId);
    if (!client || !client.enabled) return res.json({ active: false });

    // تقدر تبدل هاد النصوص لاحقاً و حتى تخليهم فـ Sheet (نسخة قادمة)
    return res.json({
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: client.couponCode || "",
    });
  } catch (e) {
    console.log("POPUP-CONFIG ERROR:", e.message);
    return res.json({ active: false });
  }
});

// =====================
// ✅ Count leads in client sheet (for FREE limit)
// =====================
async function getLeadCount(clientSheetId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: clientSheetId,
    range: `${DEFAULT_TAB_LEADS}!A2:A`,
  });
  const rows = resp.data.values || [];
  return rows.length;
}

// =====================
// ✅ Anti-duplicate by email
// =====================
async function emailExists(clientSheetId, emailLower) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: clientSheetId,
    range: `${DEFAULT_TAB_LEADS}!A2:E`,
  });
  const rows = resp.data.values || [];
  return rows.some((r) => asLower(r[2]) === emailLower);
}

// =====================
// ✅ Save lead to client sheet
// =====================
app.post("/api/lead", rateLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const clientId = asLower(body.clientId);
    const store = normalizeDomain(body.store);
    const email = asLower(body.email);
    const coupon = String(body.coupon || "").trim();
    const page = String(body.page || "").trim();

    console.log("✅ NEW LEAD:", { clientId, store, email, coupon, page, time: nowISO() });

    if (!clientId || !store || !email) {
      return res.json({ ok: false, error: "missing_fields" });
    }

    const client = await getClient(clientId);
    if (!client || !client.enabled) {
      return res.json({ ok: false, error: "inactive_client" });
    }

    // verify store matches client store
    if (normalizeDomain(client.storeDomain) !== store) {
      return res.json({ ok: false, error: "store_mismatch" });
    }

    // must have sheetId
    if (!client.sheetId) {
      return res.json({ ok: false, error: "missing_sheetId" });
    }

    // FREE plan limit
    if (client.plan === "FREE" && client.leadLimit > 0) {
      const cnt = await getLeadCount(client.sheetId);
      if (cnt >= client.leadLimit) {
        return res.json({ ok: false, error: "free_limit_reached" });
      }
    }

    // anti-duplicate
    const exists = await emailExists(client.sheetId, email);
    if (exists) {
      return res.json({ ok: true, duplicate: true });
    }

    // append
    await sheets.spreadsheets.values.append({
      spreadsheetId: client.sheetId,
      range: `${DEFAULT_TAB_LEADS}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[nowISO(), store, email, coupon, page]],
      },
    });

    console.log("✅ LEAD SAVED TO SHEET:", clientId, email);
    return res.json({ ok: true });
  } catch (e) {
    console.log("❌ LEAD ERROR:", e.message);
    return res.json({ ok: false, error: "server_error" });
  }
});

// =====================
// ✅ popup.js (client mode)
// =====================
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  async function run() {
    try {
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;

      const s = (window.YOUCAN_POPUP || {});
      const clientId = String(s.clientId || "").trim();
      const key = String(s.key || "").trim();

      if (!clientId || !key) {
        console.log("POPUP: missing clientId/key");
        return;
      }

      // Verify first
      const vr = await fetch(base + "/api/verify?clientId=" + encodeURIComponent(clientId)
        + "&store=" + encodeURIComponent(window.location.hostname)
        + "&key=" + encodeURIComponent(key));
      const vj = await vr.json();
      if (!vj || vj.status !== "active") {
        console.log("POPUP: inactive");
        return;
      }

      // Get per-client config
      const r = await fetch(base + "/api/popup-config?clientId=" + encodeURIComponent(clientId));
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
          const rr = await fetch(base + "/api/lead", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              clientId: clientId,
              store: window.location.hostname,
              email: email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          });

          const jj = await rr.json().catch(() => ({}));

          if (jj && jj.error === "free_limit_reached") {
            alert("وصلتو للحد ديال النسخة المجانية");
            return;
          }

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

// =====================
// ✅ Start
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
