require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");

const extractCourses = require("./ocr/extractCourses");
const parseSlots = require("./timetable/parseSlots");
const generateTimetable = require("./timetable/generateTimetable");
const slotsLookup = require("./slots/slots.json");
const courseNames = require("./courses/courses.json");

// ----------------------
// INITIAL SETUP
// ----------------------
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// uploads folder (safe)
const upload = multer({ dest: "uploads/" });

// Ensure required OpenAI key
if (!process.env.OPENAI_API_KEY) {
  if (process.env.ALLOW_NO_OPENAI === "1") {
    console.warn(
      "WARNING: OPENAI_API_KEY missing. Running in DEV MODE (ALLOW_NO_OPENAI=1)."
    );
  } else {
    console.error("ERROR: OPENAI_API_KEY missing.");
    process.exit(1);
  }
}

// Ensure folder exists (mkdirp removed completely)
const SAVED_DIR = path.join(__dirname, "saved_timetables");
if (!fs.existsSync(SAVED_DIR)) {
  fs.mkdirSync(SAVED_DIR, { recursive: true });
}

// Render health check
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// Basic route
app.get("/", (req, res) => {
  res.send("Vitwise backend running on Render!");
});

// Simple connectivity test (mobile app uses this)
app.get("/ping", (req, res) => {
  res.json({ ok: true, time: Date.now(), message: "pong" });
});

// ----------------------
// UPLOAD TIMETABLE IMAGE → OCR → TIMETABLE
// ----------------------
app.post("/api/upload", upload.single("image"), async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Uploaded file:", uploadedPath);

    const extracted = await extractCourses(uploadedPath);

    const warnings = [];

    const courses = extracted.map((row) => ({
      courseCode: row.courseCode,
      courseName:
        row.courseName || courseNames[row.courseCode] || row.courseCode,
      type: row.type,
      venue: row.venue,
      rawSlotString: row.slotString,
      slots: parseSlots(row.slotString),
    }));

    courses.forEach((c) => {
      c.slots.forEach((slot) => {
        if (!slotsLookup[slot]) {
          warnings.push({
            type: "missing_slot",
            slot,
            course: c.courseCode,
          });
        }
      });
    });

    const timetable = generateTimetable(courses);

    res.json({ timetable, warnings });
  } catch (err) {
    console.error("upload error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (uploadedPath) {
      fs.unlink(uploadedPath, () => {});
    }
  }
});

// ----------------------
// SIMPLE AUTH MOCK (NOT FOR PRODUCTION)
// ----------------------
const users = {};
const otps = {};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/api/signup", (req, res) => {
  const { username, password, phone } = req.body || {};
  if (!username || !password || !phone)
    return res.status(400).json({ error: "Missing fields" });

  if (users[phone])
    return res.status(409).json({ error: "User already exists" });

  users[phone] = { username, password, phone };
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { phone, password } = req.body;
  const u = users[phone];

  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.password !== password)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64");
  res.json({ token, username: u.username });
});

app.post("/api/send-otp", (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });

  const code = generateOtp();
  otps[phone] = { code, expiresAt: Date.now() + 5 * 60000 };

  console.log(`OTP for ${phone}: ${code}`);

  res.json({ ok: true, otp: process.env.NODE_ENV !== "production" ? code : undefined });
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code)
    return res.status(400).json({ error: "Missing phone/code" });

  const r = otps[phone];
  if (!r) return res.status(404).json({ error: "OTP not found" });
  if (Date.now() > r.expiresAt)
    return res.status(410).json({ error: "OTP expired" });
  if (r.code !== code)
    return res.status(401).json({ error: "Invalid OTP" });

  delete otps[phone];
  res.json({ ok: true });
});

// token helper
function phoneFromToken(token) {
  try {
    return Buffer.from(token, "base64").toString().split(":")[0];
  } catch {
    return null;
  }
}

// ----------------------
// SAVE TIMETABLE
// ----------------------
app.post("/api/save-timetable", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const phone = phoneFromToken(token);

  if (!phone) return res.status(401).json({ error: "Invalid token" });

  const file = path.join(SAVED_DIR, `${phone}.json`);
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        { timetable: req.body.timetable, savedAt: Date.now() },
        null,
        2
      )
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Save failed" });
  }
});

// ----------------------
// LOAD TIMETABLE
// ----------------------
app.get("/api/load-timetable", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const phone = phoneFromToken(token);

  if (!phone) return res.status(401).json({ error: "Invalid token" });

  const file = path.join(SAVED_DIR, `${phone}.json`);
  if (!fs.existsSync(file))
    return res.status(404).json({ error: "Not found" });

  try {
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    res.json(content);
  } catch {
    res.status(500).json({ error: "Load failed" });
  }
});

// ----------------------
// START SERVER
// ----------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vitwise backend running on ${PORT}`);
});
