app.get("/api/verify", (req, res) => {
  const store = (req.query.store || "").trim();
  const key = (req.query.key || "").trim();
  const origin = req.headers.origin || "";

  console.log("VERIFY HIT:", { store, key, origin, time: new Date().toISOString() });

  // ✅ Test بسيط: بدّلهم بحال client
  if (store === "client-test.shop" && key === "TEST-123") {
    return res.json({ ok: true, status: "active", couponCode: "TEST10" });
  }

  return res.json({ ok: true, status: "inactive" });
});