const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

// ✅ Security بدون ما نبلوكي تحميل السكريبت من دومينات أخرى
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// ✅ خلي السكريبت يقدر يتقرا من أي دومين (YouCan)
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.use(cors({ origin: true }));
app.use(express.json());

// ✅ Health
app.get("/", (req, res) => res.send("OK"));

// ✅ Config ديال popup (ثابت وبسيط)
app.get("/api/popup-config", (req, res) => {
  res.json({
    active: true,
    title: "🔥 خصم خاص!",
    text: "دخل الإيميل ديالك وخد 10% دابا",
    coupon: "GASTELLO10",
  });
});

// ✅ Popup JS (مضمون يطلع فـ YouCan)
app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.send(`(function () {
    function ready(fn){
      if(document.readyState === "complete" || document.readyState === "interactive") return setTimeout(fn, 50);
      document.addEventListener("DOMContentLoaded", fn);
    }

    function show(cfg){
      // ✅ تمنع التكرار
      if (window.__YOUCAN_POPUP_SHOWN__) return;
      window.__YOUCAN_POPUP_SHOWN__ = true;

      // ✅ حتى إلا كان popup_done، للتست نطلّعو (تقدر تحيد هاد السطر من بعد)
      // localStorage.removeItem("popup_done");

      if (localStorage.getItem("popup_done")) return;

      var wrap = document.createElement("div");
      wrap.id = "youcan_popup_wrap";
      wrap.innerHTML =
      '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483647;">' +
        '<div style="background:#fff;padding:16px;min-width:320px;max-width:90vw;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:Arial,sans-serif">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
            '<strong style="font-size:16px">' + (cfg.title || "") + '</strong>' +
            '<button id="youcan_popup_close" style="border:none;background:none;font-size:20px;cursor:pointer;line-height:1">×</button>' +
          '</div>' +
          '<div style="margin-top:10px;font-size:14px;opacity:.9">' + (cfg.text || "") + '</div>' +
          '<input id="youcan_popup_email" type="email" placeholder="Email" style="margin-top:12px;width:100%;padding:10px;border:1px solid #ddd;border-radius:10px;font-size:14px"/>' +
          '<button id="youcan_popup_btn" style="margin-top:10px;width:100%;padding:10px;border:none;background:#111;color:#fff;border-radius:10px;cursor:pointer;font-size:14px">Get coupon</button>' +
        '</div>' +
      '</div>';

      document.body.appendChild(wrap);

      document.getElementById("youcan_popup_close").onclick = function(){ wrap.remove(); };

      document.getElementById("youcan_popup_btn").onclick = function(){
        var email = (document.getElementById("youcan_popup_email").value || "").trim();
        if(!email) return alert("كتب الإيميل أولاً");
        localStorage.setItem("popup_done","1");
        alert("🎉 Coupon: " + (cfg.coupon || ""));
        wrap.remove();
      };
    }

    async function run(){
      try{
        var script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
        var base = new URL(script.src).origin;

        // ✅ جرب مرات متعددة حيث YouCan مرات كيأخر DOM
        for (var i=0;i<3;i++){
          try{
            var r = await fetch(base + "/api/popup-config", { cache: "no-store" });
            var cfg = await r.json();
            if(cfg && cfg.active){
              ready(function(){ setTimeout(function(){ show(cfg); }, 400); });
              return;
            }
          }catch(e){}
          await new Promise(res=>setTimeout(res, 700));
        }
      }catch(e){
        // silent
      }
    }

    run();
  })();`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Server running on port " + PORT));
