console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ CORS (زيد دومينات ديال clients هنا ولا خليها * فالأول للتجارب)
const ALLOWED_ORIGINS = [
  "https://gastello.shop",
  "https://www.gastello.shop",
];

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      // للتجارب: سمح للجميع
      // return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

// ✅ Normalize domain: يحيد www و يحيد البروتوكول و / و يحيد البورت
function normalizeDomain(input) {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();

  // حيد protocol
  s = s.replace(/^https?:\/\//, "");
  // خذ غير الدومين قبل /
  s = s.split("/")[0];
  // حيد port
  s = s.split(":")[0];
  // حيد www.
  s = s.replace(/^www\./, "");

  return s;
}

// ✅ Health
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ Popup config (حالياً ثابت)
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ Verify (حالياً: test + normalisation)
// دابا كنخليوه يفعّل Gastello حتى إلا جاك store بـ www
app.get("/api/verify", (req, res) => {
  const storeRaw = (req.query.store || "").trim();
  const key = (req.query.key || "").trim();

  const store = normalizeDomain(storeRaw);

  console.log("VERIFY HIT:", { storeRaw, store, key, time: new Date().toISOString() });

  // ✅ Test example (بدّلها لاحقاً باش تولي من Google Sheet)
  // كنقارن على "gastello.shop" بلا www، وراه normalized كيديرها تلقائياً
  if (store === "gastello.shop" && key === "KEY-123") {
    return res.json({ ok: true, status: "active", couponCode: "GASTELLO10" });
  }

  return res.json({ ok: true, status: "inactive" });
});

// ✅ Receive lead (كتسجل فـ Logs د Render)
app.post("/api/lead", (req, res) => {
  const body = req.body || {};

  // أفضل: نستعمل hostname بلا بورت
  const store = normalizeDomain(body.store || "");
  const email = String(body.email || "").trim().toLowerCase();
  const coupon = String(body.coupon || "").trim();
  const page = String(body.page || "").trim();

  console.log("✅ NEW LEAD:", {
    store,
    email,
    coupon,
    page,
    time: new Date().toISOString(),
  });

  res.json({ ok: true });
});

// ✅ Serve popup.js
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
              store: window.location.hostname,   // ✅ هنا مضمونة
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
