console.log("✅ server.js loaded");

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "200kb" }));

/**
 * =========================================
 * 1) CLIENTS CONFIG (SaaS)
 * كل client كتزيدو هنا:
 *  - domains: الدومينات اللي غادي يخدم فيهم popup
 *  - licenseKey: key اللي كتبيع بيه (اختياري إلا بغيت verify)
 *  - popup: النص + الكوبون
 * =========================================
 */
const CLIENTS = [
  {
    id: "gastello",
    domains: ["gastello.shop", "www.gastello.shop"],
    licenseKey: "GASTELLO-KEY-123", // بدلو لاحقاً
    popup: {
      active: true,
      title: "🔥 خصم خاص!",
      text: "دخل الإيميل ديالك وخد 10% دابا",
      coupon: "GASTELLO10",
    },
  },

  // مثال ديال client-test
  {
    id: "client-test",
    domains: ["client-test.shop", "www.client-test.shop"],
    licenseKey: "TEST-123",
    popup: {
      active: true,
      title: "🎁 Welcome!",
      text: "دخل الإيميل وخد كوبون الترحيب",
      coupon: "TEST10",
    },
  },
];

/**
 * Helper: نجيبو client حسب domain
 */
function getClientByDomain(domain) {
  const d = (domain || "").toLowerCase().trim();
  return CLIENTS.find((c) => c.domains.map((x) => x.toLowerCase()).includes(d));
}

/**
 * Helper: نجيبو domain من request
 * - كنستعملو Origin أو Referer أو Host
 */
function getReqDomain(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const host = req.headers.host || "";

  function toDomain(urlOrHost) {
    try {
      if (!urlOrHost) return "";
      if (urlOrHost.includes("http")) return new URL(urlOrHost).hostname;
      return urlOrHost.split(":")[0]; // remove port
    } catch {
      return "";
    }
  }

  return toDomain(origin) || toDomain(referer) || toDomain(host);
}

/**
 * =========================================
 * 2) CORS ديناميكي: كنسمحو غير للدومينات اللي مسجلين
 * =========================================
 */
app.use(
  cors({
    origin: function (origin, cb) {
      // requests بلا origin (بحال curl) كنسمحو ليها
      if (!origin) return cb(null, true);

      let domain = "";
      try {
        domain = new URL(origin).hostname.toLowerCase();
      } catch {
        return cb(new Error("Bad origin: " + origin));
      }

      const client = getClientByDomain(domain);
      if (client) return cb(null, true);

      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

/**
 * =========================================
 * 3) Health
 * =========================================
 */
app.get("/", (req, res) => res.send("🚀 Server running OK"));

/**
 * =========================================
 * 4) License verify
 * GET /api/verify?store=clientdomain.com&key=XXXX
 * =========================================
 */
app.get("/api/verify", (req, res) => {
  const store = (req.query.store || "").trim().toLowerCase();
  const key = (req.query.key || "").trim();

  const client = getClientByDomain(store);

  console.log("VERIFY HIT:", { store, key, time: new Date().toISOString() });

  if (!client) return res.json({ ok: true, status: "inactive" });

  if (!client.licenseKey) {
    // إلا ما بغيتيش license حالياً
    return res.json({ ok: true, status: "active" });
  }

  if (key === client.licenseKey) {
    return res.json({
      ok: true,
      status: "active",
      clientId: client.id,
      couponCode: client.popup?.coupon || "",
    });
  }

  return res.json({ ok: true, status: "inactive" });
});

/**
 * =========================================
 * 5) Popup config حسب domain
 * GET /api/popup-config
 * =========================================
 */
app.get("/api/popup-config", (req, res) => {
  const domain = getReqDomain(req);

  const client = getClientByDomain(domain);
  if (!client) {
    return res.json({
      active: false,
      title: "",
      text: "",
      coupon: "",
      reason: "unknown_domain",
    });
  }

  return res.json({
    active: !!client.popup?.active,
    title: client.popup?.title || "",
    text: client.popup?.text || "",
    coupon: client.popup?.coupon || "",
    clientId: client.id,
  });
});

/**
 * =========================================
 * 6) Anti-duplicate
 * كنبلوكي duplication (store+email) لمدة 24 ساعة
 * =========================================
 */
const seen = new Map();
// key -> timestamp
function isDuplicate(key) {
  const now = Date.now();
  const ttl = 24 * 60 * 60 * 1000; // 24h
  const last = seen.get(key);
  if (last && now - last < ttl) return true;
  seen.set(key, now);
  return false;
}

/**
 * =========================================
 * 7) Receive lead
 * POST /api/lead
 * body: { store, email, coupon, page }
 * =========================================
 */
app.post("/api/lead", (req, res) => {
  const { store, email, coupon, page } = req.body || {};

  const cleanStore = (store || "").trim().toLowerCase();
  const cleanEmail = (email || "").trim().toLowerCase();

  if (!cleanStore || !cleanEmail) {
    console.log("⛔ BAD LEAD:", { body: req.body });
    return res.status(400).json({ ok: false, error: "missing_store_or_email" });
  }

  const client = getClientByDomain(cleanStore);
  if (!client) {
    console.log("⛔ LEAD FROM UNKNOWN STORE:", { store: cleanStore, email: cleanEmail });
    return res.status(403).json({ ok: false, error: "unknown_store" });
  }

  // duplicate key per day
  const dupKey = client.id + "|" + cleanStore + "|" + cleanEmail;

  if (isDuplicate(dupKey)) {
    console.log("⛔ DUPLICATE BLOCKED:", dupKey);
    return res.json({ ok: true, duplicate: true });
  }

  console.log("✅ NEW LEAD:", {
    clientId: client.id,
    store: cleanStore,
    email: cleanEmail,
    coupon: (coupon || "").trim(),
    page: (page || "").trim(),
    time: new Date().toISOString(),
  });

  // دابا غير logs (من بعد غادي ندوزوه لـ Google Sheets)
  return res.json({ ok: true });
});

/**
 * =========================================
 * 8) popup.js (single script for all clients)
 * GET /popup.js
 * =========================================
 */
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  try {
    var script = document.currentScript || (function(){ var s=document.getElementsByTagName('script'); return s[s.length-1]; })();
    var base = new URL(script.src).origin;

    // anti-load twice
    if (window.__YOUCAN_POPUP_LOADED__) return;
    window.__YOUCAN_POPUP_LOADED__ = true;

    // fetch config
    fetch(base + "/api/popup-config", { credentials: "omit" })
      .then(function(r){ return r.json(); })
      .then(function(cfg){
        if (!cfg || !cfg.active) return;

        // show once
        if (localStorage.getItem("youcan_popup_done_v1")) return;

        // UI
        var overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;";
        overlay.innerHTML =
          '<div style="background:#fff;border-radius:14px;max-width:360px;width:100%;padding:16px;font-family:Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
              '<div style="font-size:16px;font-weight:700">' + (cfg.title || "") + '</div>' +
              '<button id="yc_close" style="border:none;background:transparent;font-size:20px;cursor:pointer;line-height:1">×</button>' +
            '</div>' +
            '<div style="margin-top:10px;color:#333;font-size:14px;line-height:1.5">' + (cfg.text || "") + '</div>' +
            '<input id="yc_email" type="email" placeholder="Email" style="margin-top:12px;width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none" />' +
            '<button id="yc_btn" style="margin-top:12px;width:100%;padding:12px;border:none;border-radius:10px;background:#111;color:#fff;font-weight:700;font-size:14px;cursor:pointer">خذ الكود</button>' +
            '<div style="margin-top:8px;font-size:12px;color:#777">* غادي يبان ليك الكوبون مباشرة</div>' +
          '</div>';

        document.body.appendChild(overlay);

        document.getElementById("yc_close").onclick = function(){
          overlay.remove();
        };

        var sending = false;
        document.getElementById("yc_btn").onclick = function(){
          if (sending) return;
          sending = true;

          var email = (document.getElementById("yc_email").value || "").trim();
          if (!email) { sending = false; return alert("كتب الإيميل أولاً"); }

          fetch(base + "/api/lead", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
              store: window.location.host,
              email: email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          }).then(function(){
            localStorage.setItem("youcan_popup_done_v1", "1");
            alert("🎉 Coupon: " + (cfg.coupon || ""));
            overlay.remove();
          }).catch(function(e){
            console.log("LEAD POST ERROR:", e);
            sending = false;
            alert("وقع مشكل، عاود حاول");
          });
        };
      })
      .catch(function(e){ console.log("POPUP ERROR:", e); });
  } catch(e) {
    console.log("POPUP INIT ERROR:", e);
  }
})();`);
});

/**
 * =========================================
 * 9) Render PORT
 * =========================================
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
