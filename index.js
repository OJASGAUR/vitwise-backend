// backend/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const extractCourses = require("./ocr/extractCourses");
const parseSlots = require("./timetable/parseSlots");
const generateTimetable = require("./timetable/generateTimetable");
const slotsLookup = require("./slots/slots.json");
const courseNames = require("./courses/courses.json");

const app = express();
app.use(cors());
app.use(express.json());

// Multer uploads folder
const upload = multer({ dest: "uploads/" });

// Ensure uploads and saved directories exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const SAVED_DIR = path.join(__dirname, "saved_timetables");
if (!fs.existsSync(SAVED_DIR)) fs.mkdirSync(SAVED_DIR, { recursive: true });

// Validate OpenAI Key (dev bypass)
if (!process.env.OPENAI_API_KEY && process.env.ALLOW_NO_OPENAI !== "1") {
  console.error("ERROR: Missing OPENAI_API_KEY and ALLOW_NO_OPENAI!==1 — backend will exit.");
  process.exit(1);
}

app.get("/", (req, res) => res.send("Vitwise Backend Running Successfully!"));
app.get("/ping", (req, res) => {
  console.log('PING hit', { time: Date.now(), ip: req.ip, headers: { host: req.headers.host, 'user-agent': req.headers['user-agent'] } });
  res.json({ ok: true, time: Date.now() });
});
app.get("/healthz", (req, res) => res.json({ ok: true }));

// upload endpoint
app.post("/api/upload", upload.single("image"), async (req, res) => {
  console.log('UPLOAD hit', { url: req.originalUrl, method: req.method, ip: req.ip, filePresent: !!req.file, headersSnippet: { host: req.headers.host, 'content-type': req.headers['content-type'] } });
  const uploadedPath = req.file?.path;
  try {
    if (!req.file) {
      console.warn("Upload called with no file");
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Uploaded file:", req.file.path);

    // Extract using OCR helper
    const extracted = await extractCourses(req.file.path);
    if (!Array.isArray(extracted)) {
      console.error("OCR returned invalid structure:", extracted);
      return res.status(500).json({ error: "OCR returned invalid structure" });
    }

    const warnings = [];
    const courses = extracted.map((row) => ({
      courseCode: row.courseCode,
      courseName: row.courseName || courseNames[row.courseCode] || row.courseCode,
      type: row.type,
      venue: row.venue,
      rawSlotString: row.slotString,
      slots: parseSlots(row.slotString),
    }));

    // Validate slots
    courses.forEach((c) => {
      (c.slots || []).forEach((s) => {
        if (!slotsLookup[s]) warnings.push({ type: "missing_slot", slot: s, course: c.courseCode });
      });
    });

    const timetable = generateTimetable(courses);

    const counts = Object.fromEntries(Object.keys(timetable).map((d) => [d, timetable[d].length]));
    console.log("Timetable counts by day:", counts);

    return res.json({ timetable, warnings });
  } catch (err) {
    console.error("Error in /api/upload:", err && err.stack ? err.stack : err);
    // Prevent leaking sensitive tokens (like OpenAI keys) to clients
    const rawMessage = err && err.message ? String(err.message) : "Internal server error";
    const safeMessage = rawMessage.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-REDACTED');
    return res.status(500).json({ error: safeMessage });
  } finally {
    // best-effort cleanup
    if (uploadedPath) {
      fs.unlink(uploadedPath, (e) => e && console.warn("Cleanup failed for", uploadedPath, e.message));
    }
  }
});

// --- simple auth & save/load endpoints (unchanged behavior but safer)
const users = {};
const otps = {};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/api/signup", (req, res) => {
  const { username, password, phone } = req.body || {};
  if (!username || !password || !phone) return res.status(400).json({ error: "username,password,phone required" });
  if (users[phone]) return res.status(409).json({ error: "User already exists" });
  users[phone] = { username, password, phone };
  return res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { phone, password } = req.body || {};
  const u = users[phone];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.password !== password) return res.status(401).json({ error: "Invalid credentials" });
  const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64");
  return res.json({ token, username: u.username });
});

app.post("/api/send-otp", (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "phone required" });
  const code = generateOtp();
  otps[phone] = { code, expiresAt: Date.now() + 5 * 60 * 1000 };
  // dev mode: return code
  return res.json({ ok: true, otp: code });
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: "phone and code required" });
  const record = otps[phone];
  if (!record) return res.status(404).json({ error: "OTP not found" });
  if (Date.now() > record.expiresAt) return res.status(410).json({ error: "OTP expired" });
  if (record.code !== code) return res.status(401).json({ error: "Invalid OTP" });
  delete otps[phone];
  return res.json({ ok: true });
});

function phoneFromToken(token) {
  try {
    return Buffer.from(token, "base64").toString("utf8").split(":")[0];
  } catch {
    return null;
  }
}

app.post("/api/save-timetable", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const phone = phoneFromToken(token);
  if (!phone) return res.status(401).json({ error: "Invalid token" });
  const file = path.join(SAVED_DIR, `${phone}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify({ timetable: req.body.timetable || req.body, savedAt: Date.now() }, null, 2));
    return res.json({ ok: true });
  } catch (e) {
    console.error("save-timetable failed", e);
    return res.status(500).json({ error: "save failed" });
  }
});

app.get("/api/load-timetable", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const phone = phoneFromToken(token);
  if (!phone) return res.status(401).json({ error: "Invalid token" });
  const file = path.join(SAVED_DIR, `${phone}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  try {
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    return res.json(content);
  } catch (e) {
    console.error("load-timetable failed", e);
    return res.status(500).json({ error: "load failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => console.log(`Backend running on ${PORT}`));
