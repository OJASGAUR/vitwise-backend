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

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Ensure saved timetable folder exists
const SAVED_DIR = path.join(__dirname, "saved_timetables");
if (!fs.existsSync(SAVED_DIR)) fs.mkdirSync(SAVED_DIR, { recursive: true });

// Validate OpenAI Key
if (!process.env.OPENAI_API_KEY && process.env.ALLOW_NO_OPENAI !== "1") {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

app.get("/", (req, res) => {
  res.send("Vitwise Backend Running Successfully!");
});

app.get("/ping", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.post("/api/upload", upload.single("image"), async (req, res) => {
  const uploadedPath = req.file?.path;

  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const extracted = await extractCourses(uploadedPath);
    const warnings = [];

    const courses = extracted.map((row) => ({
      courseCode: row.courseCode,
      courseName: row.courseName || courseNames[row.courseCode] || row.courseCode,
      type: row.type,
      venue: row.venue,
      rawSlotString: row.slotString,
      slots: parseSlots(row.slotString),
    }));

    // validate slots
    courses.forEach((c) => {
      c.slots.forEach((s) => {
        if (!slotsLookup[s]) warnings.push({ type: "missing_slot", slot: s, course: c.courseCode });
      });
    });

    const timetable = generateTimetable(courses);

    res.json({ timetable, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (uploadedPath) fs.unlink(uploadedPath, () => {});
  }
});

// simple in-memory login
const users = {};
const otps = {};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post("/api/signup", (req, res) => {
  const { username, password, phone } = req.body;
  if (!username || !password || !phone) return res.status(400).json({ error: "Missing fields" });

  if (users[phone]) return res.status(409).json({ error: "User exists" });

  users[phone] = { username, password, phone };
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { phone, password } = req.body;
  const u = users[phone];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.password !== password) return res.status(401).json({ error: "Invalid credentials" });

  const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64");
  res.json({ token, username: u.username });
});

app.post("/api/send-otp", (req, res) => {
  const { phone } = req.body;
  const code = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  otps[phone] = { code, expiresAt };
  res.json({ ok: true, otp: code }); // Debug mode
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, code } = req.body;

  const record = otps[phone];
  if (!record) return res.status(404).json({ error: "OTP not found" });
  if (Date.now() > record.expiresAt) return res.status(410).json({ error: "Expired" });
  if (record.code !== code) return res.status(401).json({ error: "Invalid" });

  delete otps[phone];
  res.json({ ok: true });
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
  fs.writeFileSync(file, JSON.stringify(req.body, null, 2));

  res.json({ ok: true });
});

app.get("/api/load-timetable", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const phone = phoneFromToken(token);

  const file = path.join(SAVED_DIR, `${phone}.json`);

  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });

  res.json(JSON.parse(fs.readFileSync(file, "utf8")));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => console.log(`Backend running on ${PORT}`));
