const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(helmet());

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 200,
  })
);

// ✅ بدّل هاد MONGO_URI ديالك (خليه كيف هو عندك)
const MONGO_URI =
  "mongodb+srv://ilyasse45236987:Afaam%402025@cluster0.17g8eos.mongodb.net/youcan_popup?retryWrites=true&w=majority";

// ✅ مفتاح ادمن باش غير انت تفعّل الناس (بدلو لأي كلمة طويلة)
const ADMIN_KEY = "CHANGE_THIS_ADMIN_KEY_123";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ===== Models =====
const StoreSchema = new mongoose.Schema(
  {
    storeDomain: { type: String, unique: true, index: true },
    licenseKey: { type: String, index: true },
    status: { type: String, enum: ["active", "inactive"], default: "inactive" },
    couponCode: { type: String, default: "GASTELLO10" },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: true }
);

const Store = mongoose.model("Store", StoreSchema);

// ===== Helpers =====
function normalizeDomain(d) {
  return String(d || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function getRequestDomain(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  return normalizeDomain(origin || referer);
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  if (!key || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

// ===== 1) Verify License (API) =====
app.get("/api/verify", async (req, res) => {
  const storeParam = normalizeDomain(req.query.store);
  const key = String(req.query.key || "").trim();
  const reqDomain = getRequestDomain(req);

  // Domain lock: خاص الطلب يجي من نفس الدومين
  if (!storeParam || !reqDomain || storeParam !== reqDomain) {
    return res.json({ ok: true, status: "inactive" });
  }

  const store = await Store.findOne({ storeDomain: storeParam }).lean();
  if (!store) return res.json({ ok: true, status: "inactive" });
  if (store.licenseKey !== key) return res.json({ ok: true, status: "inactive" });

  return res.json({
    ok: true,
    status: store.status,
    couponCode: store.couponCode || "GASTELLO10",
  });
});

// ===== 2) Loader.js (تركبو فـ Youcan) =====
app.get("/loader.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  const base = `${req.protocol}://${req.get("host")}`;

  res.send(`(function(){
try{
  var s=document.currentScript; if(!s) return;
  var store=(s.getAttribute("data-store")||"").trim().toLowerCase();
  var key=(s.getAttribute("data-key")||"").trim();
  if(!store||!key) return;

  fetch("${base}/api/verify?store="+encodeURIComponent(store)+"&key="+encodeURIComponent(key))
    .then(r=>r.json())
    .then(function(resp){
      if(!resp || resp.status!=="active") return;
      window.__YOUPUP_COUPON__ = resp.couponCode || "GASTELLO10";
      var p=document.createElement("script");
      p.src="${base}/popup.js";
      p.async=true;
      document.head.appendChild(p);
    })
    .catch(function(){});
}catch(e){}
})();`);
});

// ===== 3) popup.js (الكود الحقيقي) =====
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function(){
if(window.__YOUPUP_LOADED__) return;
window.__YOUPUP_LOADED__=true;

var coupon=window.__YOUPUP_COUPON__||"GASTELLO10";

var st=document.createElement("style");
st.innerHTML=\`
#youcanEmailPopupOverlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:999999}
#youcanEmailPopup{width:min(420px,92vw);background:#fff;border-radius:16px;padding:18px 16px;font-family:system-ui;box-shadow:0 10px 30px rgba(0,0,0,.2);position:relative}
#youcanEmailPopup h3{margin:0 0 6px;font-size:18px}
#youcanEmailPopup p{margin:0 0 12px;font-size:14px;opacity:.85;line-height:1.4}
#youcanEmailPopup input{width:100%;padding:12px;border:1px solid #ddd;border-radius:12px;font-size:14px;outline:none}
#youcanEmailPopup button{margin-top:10px;width:100%;padding:12px;border:0;border-radius:12px;background:#111;color:#fff;font-size:15px;cursor:pointer}
#youcanEmailPopup .x{position:absolute;right:14px;top:10px;cursor:pointer;font-size:18px;opacity:.6}
#youcanEmailPopup .note{margin-top:8px;font-size:12px;opacity:.75}
\`;
document.head.appendChild(st);

function show(){
  if(localStorage.getItem("youcan_popup_seen")) return;
  localStorage.setItem("youcan_popup_seen","1");

  var ov=document.createElement("div");
  ov.id="youcanEmailPopupOverlay";
  var box=document.createElement("div");
  box.id="youcanEmailPopup";
  box.innerHTML=\`
    <div class="x" id="youcanPopClose">✕</div>
    <h3>خصم خاص لك</h3>
    <p>دخل بريدك الإلكتروني وخد كوبون التخفيض دابا.</p>
    <input id="youcanPopEmail" type="email" placeholder="name@example.com" />
    <button id="youcanPopBtn">خد الكوبون</button>
    <div class="note" id="youcanPopMsg"></div>
  \`;
  ov.appendChild(box);
  document.body.appendChild(ov);

  function close(){ ov.remove(); }
  ov.addEventListener("click", function(e){ if(e.target===ov) close(); });
  box.querySelector("#youcanPopClose").addEventListener("click", close);

  box.querySelector("#youcanPopBtn").addEventListener("click", function(){
    var email=(box.querySelector("#youcanPopEmail").value||"").trim();
    if(!email || email.indexOf("@")===-1){
      box.querySelector("#youcanPopMsg").textContent="دخل إيميل صحيح.";
      return;
    }
    box.querySelector("#youcanPopMsg").textContent="كوبونك هو: "+coupon;
  });
}

setTimeout(show, 6000);
})();`);
});

// ===== 4) Admin: create/activate store =====
app.post("/admin/store", requireAdmin, async (req, res) => {
  const storeDomain = normalizeDomain(req.body.storeDomain);
  const licenseKey = String(req.body.licenseKey || "").trim();
  const status = req.body.status === "active" ? "active" : "inactive";
  const couponCode = String(req.body.couponCode || "GASTELLO10").trim();

  if (!storeDomain || !licenseKey) {
    return res.status(400).json({ ok: false, error: "missing storeDomain/licenseKey" });
  }

  await Store.updateOne(
    { storeDomain },
    { $set: { storeDomain, licenseKey, status, couponCode } },
    { upsert: true }
  );

  res.json({ ok: true });
});

app.get("/", (req, res) => res.send("✅ API running"));

app.listen(3000, () => console.log("✅ Server running on http://localhost:3000"));
