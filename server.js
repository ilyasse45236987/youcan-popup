const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { google } = require("googleapis");

const app = express();

// 🔓 يسمح بالتحميل من أي دومين (YouCan)
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.use(cors({ origin: true }));
app.use(express.json());

// ===== Google Auth (Service Account) =====
function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) throw new Error("Missing GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY");

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

// ===== Clients cache (باش ما نقراوش admin sheet كل مرة) =====
let clientsCache = { at: 0, rows: [] };

async function loadClients() {
  const ttl = parseInt(process.env.CLIENTS_CACHE_TTL_MS || "60000", 10);
  const now = Date.now();

  if (clientsCache.rows.length && now - clientsCache.at < ttl) {
    return clientsCache.rows;
  }

  const adminSheetId = process.env.ADMIN_SHEET_ID;
  if (!adminSheetId) throw new Error("Missing ADMIN_SHEET_ID");

  const sheets = getSheetsClient();

  // نقرا tab: clients columns A:F
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: adminSheetId,
    range: "clients!A:F",
  });

  const values = resp.data.values || [];
  if (values.length < 2) {
    clientsCache = { at: now, rows: [] };
    return [];
  }

  const headers = values[0].map((h) => String(h || "").trim());
  const rows = values.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i]));
    return obj;
  });

  clientsCache = { at: now, rows };
  return rows;
}

function normalizeDomain(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

async function findClient({ store, licenseKey }) {
  const storeN = normalizeDomain(store);
  const key = String(licenseKey || "").trim();

  const rows = await loadClients();

  const hit = rows.find((r) => {
    const enabled = String(r.enabled || "").toUpperCase() === "TRUE" || String(r.enabled || "") === "1";
    const domainOk = normalizeDomain(r.storeDomain) === storeN;
    const keyOk = String(r.licenseKey || "").trim() === key;
    return enabled && domainOk && keyOk;
  });

  return hit || null;
}

async function appendLeadToClientSheet({ clientSheetId, store, email, coupon, page }) {
  const sheets = getSheetsClient();
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: clientSheetId,
    range: "Leads!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[now, store || "", email || "", coupon || "", page || ""]],
    },
  });
}

// ✅ Health check
app.get("/", (req, res) => res.send("OK"));

// ✅ Popup config (ثابت) — (من بعد نولّيوها per-client)
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ استقبال Lead + تحديد client + الكتابة فـ Sheet ديالو
app.post("/api/lead", async (req, res) => {
  try {
    const { store, email, coupon, page, licenseKey } = req.body || {};

    console.log("✅ NEW LEAD:", {
      store,
      email,
      coupon,
      page,
      licenseKey,
      time: new Date().toISOString(),
    });

    if (!email) return res.status(400).json({ ok: false, error: "email required" });
    if (!store) return res.status(400).json({ ok: false, error: "store required" });
    if (!licenseKey) return res.status(400).json({ ok: false, error: "licenseKey required" });

    const client = await findClient({ store, licenseKey });
    if (!client) {
      return res.status(403).json({ ok: false, error: "client not found or disabled" });
    }

    const clientSheetId = String(client.sheetId || "").trim();
    if (!clientSheetId) {
      return res.status(500).json({ ok: false, error: "client sheetId missing" });
    }

    // coupon: إذا بغيتي نخليو coupon ديال admin sheet كياخد الأولوية
    const finalCoupon = String(client.couponCode || "").trim() || coupon || "";

    // fire-and-forget باش ما نحبسوش request بزاف
    appendLeadToClientSheet({
      clientSheetId,
      store: normalizeDomain(store),
      email,
      coupon: finalCoupon,
      page: page || "",
    }).catch((e) => console.log("⚠️ append error:", e?.message || e));

    return res.json({ ok: true, clientId: client.clientId || "" });
  } catch (e) {
    console.log("❌ /api/lead error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

// ✅ popup.js (خاصنا نزيدو licenseKey)
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.send(`(function () {
    function ready(fn){
      if(document.readyState !== "loading") return setTimeout(fn, 100);
      document.addEventListener("DOMContentLoaded", fn);
    }

    async function run(){
      try{
        const script = document.currentScript || document.scripts[document.scripts.length-1];
        const base = new URL(script.src).origin;

        // ✅ licenseKey جاية من query: popup.js?key=XXXX
        const url = new URL(script.src);
        const licenseKey = url.searchParams.get("key") || "";

        const r = await fetch(base + "/api/popup-config");
        const cfg = await r.json();
        if(!cfg || !cfg.active) return;

        if(localStorage.getItem("popup_done")) return;

        ready(() => {
          const wrap = document.createElement("div");
          wrap.innerHTML = \`
          <div style="position:fixed;inset:0;background:rgba(0,0,0,.45);
            display:flex;align-items:center;justify-content:center;z-index:2147483647">
            <div style="background:#fff;padding:16px;min-width:320px;border-radius:14px;
              box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:Arial">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <strong>\${cfg.title}</strong>
                <button id="pclose" style="border:none;background:none;font-size:20px;cursor:pointer">×</button>
              </div>
              <p style="margin:10px 0">\${cfg.text}</p>
              <input id="pemail" type="email" placeholder="Email"
                style="width:100%;padding:10px;border:1px solid #ddd;border-radius:10px"/>
              <button id="pbtn" style="margin-top:10px;width:100%;padding:10px;
                border:none;background:#111;color:#fff;border-radius:10px;cursor:pointer">
                Get coupon
              </button>
            </div>
          </div>\`;

          document.body.appendChild(wrap);

          document.getElementById("pclose").onclick = () => wrap.remove();

          document.getElementById("pbtn").onclick = async () => {
            const email = document.getElementById("pemail").value.trim();
            if(!email) return alert("كتب الإيميل أولاً");

            fetch(base + "/api/lead", {
              method: "POST",
              headers: {"Content-Type":"application/json"},
              body: JSON.stringify({
                store: location.hostname,
                email: email,
                coupon: cfg.coupon,
                page: location.href,
                licenseKey: licenseKey
              })
            }).catch(()=>{});

            localStorage.setItem("popup_done","1");
            alert("🎉 Coupon: " + cfg.coupon);
            wrap.remove();
          };
        });

      }catch(e){}
    }

    run();
  })();`);
});

// 🚀 Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
