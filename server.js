const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

// 🔓 خليه يسمح بالتحميل من أي دومين (YouCan)
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

// ✅ Health check
app.get("/", (req, res) => res.send("OK"));

// ✅ Popup config (ثابت)
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ استقبال الإيميل + Log فـ Render
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

// ✅ popup.js (كيخدم فـ YouCan)
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

        const r = await fetch(base + "/api/popup-config");
        const cfg = await r.json();
        if(!cfg || !cfg.active) return;

        // 🔁 للتست: خليه يطلع ديما
        // localStorage.removeItem("popup_done");

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
                page: location.href
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
