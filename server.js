app.get("/popup.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");

  res.send(`
(function () {
  async function run() {
    try {
      // ✅ يجيب base من رابط السكريبت نفسه
      const script = document.currentScript || Array.from(document.scripts).slice(-1)[0];
      const base = new URL(script.src).origin;

      const r = await fetch(base + "/api/popup-config");
      const cfg = await r.json();

      if (!cfg.active) return;
      if (localStorage.getItem("popup_done")) return;

      const wrap = document.createElement("div");
      wrap.innerHTML = \`
        <div style="
          position:fixed;bottom:20px;right:20px;background:#fff;padding:18px;
          box-shadow:0 0 15px rgba(0,0,0,.2);z-index:999999;max-width:320px;
          border-radius:12px;font-family:Arial,sans-serif">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>\${cfg.title}</strong>
            <button id="popup_close" style="border:none;background:none;font-size:18px;cursor:pointer">×</button>
          </div>
          <p style="margin:10px 0">\${cfg.text}</p>
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
      document.getElementById("popup_btn").onclick = () => {
        localStorage.setItem("popup_done", "1");
        alert("🎉 Coupon: " + cfg.coupon);
        wrap.remove();
      };
    } catch (e) {
      console.log("POPUP ERROR:", e);
    }
  }

  setTimeout(run, 1200);
})();
`);
});
