console.log("✅ server.js t9ra");

const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ بدّل هاد الدومين لدومين موقعك
const ALLOWED_ORIGINS = [
  "https://gastello.shop",
  "https://www.gastello.shop",
];

app.use(
  cors({
    origin: function (origin, cb) {
      // يسمح للطلبات اللي ما فيهاش origin (بحال Postman) + الدومينات المسموح بها
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

// ✅ health check
app.get("/", (req, res) => res.send("🚀 Server khdam mzyan"));

// ✅ status endpoint (باش YouCan يشوف واش Active)
app.get("/api/status", (req, res) => {
  res.json({ ok: true, status: "active" });
});

// ✅ PORT ديال Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
