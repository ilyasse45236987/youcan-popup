console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ CORS (خلّيه مفتوح دابا للتجارب، من بعد نسدو)
app.use(cors({ origin: true }));

// ✅ Normalize domain: يحيد www و https و / و port
function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0];
  s = s.split(":")[0];
  s = s.replace(/^www\./, "");
  return s;
}

// ✅ Health
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ Verify (test حاليا) — بدّلهم لاحقا بالقراءة من Admin Sheet
app.get("/api/verify", (req, res) => {
  const clientId = String(req.query.clientId || "").trim().toLowerCase();
  const storeRaw = String(req.query.store || "").trim();
  const key = String(req.query.key || "").trim();

  const store = normalizeDomain(storeRaw);

  console.log("VERIFY HIT:", { clientId, storeRaw, store, key, time: new Date().toISOString() });

  // ✅ مثال ديال gastello
  if (clientId === "gastello" && store === "gastello.shop" && key === "KEY-123") {
    return res.json({ ok: true, status: "active", couponCode: "GASTELLO10" });
  }

  // ✅ مثال ديال www حتى هو كيتحوّل لبلا www ف normalize
  if (clientId === "gastello" && store === "gastello.shop" && key === "KEY-123") {
    return res.json({ ok: true, status: "active", couponCode: "GASTELLO10" });
  }

  return res.json({ ok: true, status: "inactive" });
});

// ✅ Popup config (ثابت حاليا) — لاحقا نخليه per-client
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ Lead (دابا كنسجلو فـ logs مع clientId)
app.post("/api/lead", (req, res) => {
  const { clientId, store, email, coupon, page } = req.body || {};

  console.log("✅ NEW LEAD:", {
    clientId: String(clientId || "").trim().toLowerCase(),
    store: normalizeDomain(store || ""),
    email: String(email || "").trim().toLowerCase(),
    coupon: String(coupon || "").trim(),
    page: String(page || "").trim(),
    time: new Date().toISOString(),
  });

  // ⚠️ هنا من بعد غادي نزيدو الكتابة للـ Google Sheets
  res.json({ ok: true });
});

// ✅ Serve popup.js (مهم: كيبعث clientId + key)
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.send(`(function () {
  async function run() {
    try {
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;

      const settings = (window.YOUCAN_POPUP || {});
      const clientId = String(settings.clientId || "").trim();
      const key = String(settings.key || "").trim();

      if (!clientId || !key) {
        console.log("POPUP: missing clientId/key");
        return;
      }

      // ✅ verify license
      const vr = await fetch(base + "/api/verify?clientId=" + encodeURIComponent(clientId)
        + "&store=" + encodeURIComponent(window.location.hostname)
        + "&key=" + encodeURIComponent(key));
      const vj = await vr.json();
      if (!vj || vj.status !== "active") {
        console.log("POPUP: inactive");
        return;
      }

      const r = await fetch(base + "/api/popup-config");
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

        await fetch(base + "/api/lead", {
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

        localStorage.setItem("popup_done","1");
        alert("🎉 Coupon: " + (cfg.coupon || ""));
        wrap.remove();
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
