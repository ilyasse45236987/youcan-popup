console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { google } = require("googleapis");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(helmet());

// ✅ CORS (خليه permissive باش يخدم لأي client domain)
app.use(cors({ origin: true }));

// ✅ basic anti-spam
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID || "";
const GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON || "";

function normHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function getGoogleClient() {
  const creds = safeJsonParse(GOOGLE_CREDENTIALS_JSON);
  if (!creds) throw new Error("GOOGLE_CREDENTIALS_JSON invalid JSON");
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function sheetsApi() {
  const auth = getGoogleClient();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// ✅ Read clients tab safely (A:F only, and we validate headers)
async function getClientsRows() {
  if (!ADMIN_SHEET_ID) throw new Error("ADMIN_SHEET_ID missing");

  const sheets = await sheetsApi();

  // ✅ IMPORTANT: we read the whole tab range without hardcoding A2:H
  // first row = headers, following rows = data
  const range = "clients!A1:F";
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ADMIN_SHEET_ID,
    range,
  });

  const values = resp.data.values || [];
  if (values.length < 2) return [];

  const headers = values[0].map((h) => String(h || "").trim());
  const rows = values.slice(1);

  // expected headers:
  // clientId | storeDomain | licenseKey | couponCode | sheetId | enabled
  const idx = {
    clientId: headers.indexOf("clientId"),
    storeDomain: headers.indexOf("storeDomain"),
    licenseKey: headers.indexOf("licenseKey"),
    couponCode: headers.indexOf("couponCode"),
    sheetId: headers.indexOf("sheetId"),
    enabled: headers.indexOf("enabled"),
  };

  // fallback if user didn't keep exact header names
  // assume fixed positions A..F
  const useFixed = Object.values(idx).some((v) => v === -1);

  return rows
    .map((r) => {
      if (useFixed) {
        return {
          clientId: String(r[0] || "").trim(),
          storeDomain: String(r[1] || "").trim(),
          licenseKey: String(r[2] || "").trim(),
          couponCode: String(r[3] || "").trim(),
          sheetId: String(r[4] || "").trim(),
          enabled: String(r[5] || "").trim(),
        };
      }
      return {
        clientId: String(r[idx.clientId] || "").trim(),
        storeDomain: String(r[idx.storeDomain] || "").trim(),
        licenseKey: String(r[idx.licenseKey] || "").trim(),
        couponCode: String(r[idx.couponCode] || "").trim(),
        sheetId: String(r[idx.sheetId] || "").trim(),
        enabled: String(r[idx.enabled] || "").trim(),
      };
    })
    .filter((x) => x.clientId && x.storeDomain);
}

async function findClientByStore(storeHost) {
  const host = normHost(storeHost);
  const rows = await getClientsRows();

  return rows.find((c) => normHost(c.storeDomain) === host) || null;
}

async function ensureLeadsTab(sheetId) {
  const sheets = await sheetsApi();
  // create tab "leads" if missing + headers
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "leads!A1:A1",
    });
  } catch (e) {
    // if tab missing, create it
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const has = (meta.data.sheets || []).some(
      (s) => s.properties && s.properties.title === "leads"
    );
    if (!has) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              addSheet: { properties: { title: "leads" } },
            },
          ],
        },
      });
    }
  }

  // set headers if empty
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "leads!A1:F1",
  });
  const headerVals = headerResp.data.values || [];
  if (headerVals.length === 0 || headerVals[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "leads!A1:F1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["time", "store", "email", "coupon", "page", "clientId"]],
      },
    });
  }
}

async function appendLeadToClientSheet(sheetId, lead) {
  const sheets = await sheetsApi();

  await ensureLeadsTab(sheetId);

  // ✅ anti-duplicate: check last 50 emails quickly
  const checkResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "leads!C2:C51",
  });
  const emails = (checkResp.data.values || []).flat().map((x) => String(x || "").trim().toLowerCase());
  if (emails.includes(String(lead.email || "").trim().toLowerCase())) {
    return { appended: false, reason: "duplicate" };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "leads!A:F",
    valueInputOption: "RAW",
    requestBody: {
      values: [[lead.time, lead.store, lead.email, lead.coupon, lead.page, lead.clientId]],
    },
  });

  return { appended: true };
}

// ✅ Health
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ Popup config (NEVER 500)
app.get("/api/popup-config", async (req, res) => {
  try {
    const store = normHost(req.query.store || req.headers.host || "");
    if (!store) return res.json({ active: false });

    const client = await findClientByStore(store);
    if (!client) return res.json({ active: false, reason: "store_not_found" });

    const enabled = String(client.enabled || "").toLowerCase();
    if (!(enabled === "true" || enabled === "1" || enabled === "yes")) {
      return res.json({ active: false, reason: "disabled" });
    }

    return res.json({
      active: true,
      clientId: client.clientId,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: client.couponCode || "",
    });
  } catch (e) {
    console.log("POPUP-CONFIG ERROR:", e.message);
    // ✅ NO 500: return safe inactive
    return res.json({ active: false, error: "server_error" });
  }
});

// ✅ Receive lead
app.post("/api/lead", async (req, res) => {
  try {
    const body = req.body || {};
    const store = normHost(body.store || req.headers.origin || req.headers.host || "");
    const email = String(body.email || "").trim();
    const coupon = String(body.coupon || "").trim();
    const page = String(body.page || "").trim();

    console.log("📩 LEAD BODY:", { store, email, coupon, page });

    if (!store || !email) return res.status(400).json({ ok: false, error: "missing_store_or_email" });

    const client = await findClientByStore(store);
    if (!client) return res.json({ ok: true, saved: false, reason: "store_not_found" });

    const enabled = String(client.enabled || "").toLowerCase();
    if (!(enabled === "true" || enabled === "1" || enabled === "yes")) {
      return res.json({ ok: true, saved: false, reason: "disabled" });
    }

    const lead = {
      clientId: client.clientId,
      store,
      email,
      coupon: coupon || client.couponCode || "",
      page,
      time: new Date().toISOString(),
    };

    console.log("✅ NEW LEAD:", lead);

    // ✅ save to client sheet if sheetId exists
    if (client.sheetId) {
      const r = await appendLeadToClientSheet(client.sheetId, lead);
      return res.json({ ok: true, saved: true, ...r });
    }

    return res.json({ ok: true, saved: false, reason: "missing_sheetId" });
  } catch (e) {
    console.log("LEAD ERROR:", e.message);
    // ✅ also avoid crashing, but here 500 is ok (optional)
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ popup.js
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
             
