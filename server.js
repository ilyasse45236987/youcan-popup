console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ CORS (سمح غير لمواقعك)
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

// ✅ Health
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ Status
app.get("/api/status", (req, res) => res.json({ ok: true, status: "active" }));

// ✅ Verify (test license)
app.get("/api/verify", (req, res) => {
  const store = (req.query.store || "").trim();
  const key = (req.query.key || "").trim();

  console.log("VERIFY HIT:", { store, key, time: new Date().toISOString() });

  if (store === "client-test.shop" && key === "TEST-123") {
    return res.json({ ok: true, status: "active", couponCode: "TEST10" });
  }

  return res.json({ ok: true, status: "inactive" });
});

// ✅ Popup config
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ Receive lead (for now: log to Render)
app.post("/api/lead", (req, res) => {
  const { store, email, coupon, page } = req.body || {};
  console.log("✅ NEW LEAD:", {
    store,
    email,
    coupon,
    page,
    time: new Date().toISOString(),
  });
  res.json({ ok: true });
});

// ✅ External popup script for YouCan
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`
(function () {
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
        <div style="
          position:fixed;bottom:20px;right:20px;background:#fff;padding:18px;
          box-shadow:0 0 15px rgba(0,0,0,.2);z-index:999999;max-width:320px;
          border-radius:12px;font-family:Arial,sans-serif">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>\${cfg.title || ""}</strong>
            <button id="popup_close" style="border:none;background:none;font-size:18px;cursor:pointer">×</button>
          </div>
          <p style="margin:10px 0">\${cfg.text || ""}</p>
          <input id="popup_email" type="email" placeholder="Email"
            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px"/>
          <button id="popup_btn"
            style="margin-top:10px;width:100%;padding:10px;border:none;border-radius:8px;background:#111;color:#fff;cursor:pointer">
            خد الخصم
          </button>
        </div>
      \`;

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
              store: window.location.host,
              email,
              coupon: cfg.coupon || "",
              page: window.location.href
            })
          });

          localStorage.setItem("popup_done", "1");
          alert("🎉 Coupon: " + (cfg.coupon || ""));
          wrap.remove();
        } catch(e) {
          console.log("LEAD POST ERROR:", e);
          alert("وقع مشكل، عاود حاول");
        }
      };

    } catch (e) {
      console.log("POPUP ERROR:", e);
    }
  }

  setTimeout(run, 1200);
})();
`);
});

// ✅ Render PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
