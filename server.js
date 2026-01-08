app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`(function () {
  async function run() {
    try {
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;

      // ✅ خذ client info من window.YOUCAN_POPUP
      const cfgClient = (window.YOUCAN_POPUP || {});
      const clientId = String(cfgClient.clientId || "").trim();
      const key = String(cfgClient.key || "").trim();

      if (!clientId || !key) {
        console.log("POPUP: missing clientId/key");
        return;
      }

      // ✅ Verify (باش ما يخدمش إلا key صحيح + domain صحيح)
      const vr = await fetch(base + "/api/verify?clientId=" + encodeURIComponent(clientId)
        + "&store=" + encodeURIComponent(window.location.hostname)
        + "&key=" + encodeURIComponent(key));
      const vj = await vr.json();
      if (!vj || vj.status !== "active") {
        console.log("POPUP: inactive license");
        return;
      }

      // ✅ Get popup config ديال هاد client
      const r = await fetch(base + "/api/popup-config?clientId=" + encodeURIComponent(clientId));
      const cfg = await r.json();
      if (!cfg || !cfg.active) return;

      // ✅ ما يطلعش مرة ثانية
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
