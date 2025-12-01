require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require('fs')
const os = require('os')
const mkdirp = require('mkdirp')

const extractCourses = require("./ocr/extractCourses");
const parseSlots = require("./timetable/parseSlots");
const generateTimetable = require("./timetable/generateTimetable");
const slotsLookup = require("./slots/slots.json");
const courseNames = require("./courses/courses.json");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Ensure OPENAI key exists — backend relies on OpenAI Vision for OCR
// Allow a developer bypass by setting ALLOW_NO_OPENAI=1. This is ONLY for local
// development and testing (it prevents the process from exiting when the key
// is missing). Do NOT enable this in production.
if (!process.env.OPENAI_API_KEY) {
  if (process.env.ALLOW_NO_OPENAI === '1') {
    console.warn('WARNING: OPENAI_API_KEY is not set. Running in dev mode with limited OCR functionality (ALLOW_NO_OPENAI=1).');
  } else {
    console.error('ERROR: OPENAI_API_KEY is not set. The backend requires an OpenAI API key to run OCR.');
    console.error('Set it in your environment (do NOT commit .env to git). Example (Windows cmd):');
    console.error('  set OPENAI_API_KEY=sk-REPLACE_WITH_YOUR_KEY');
    console.error('Or to run locally without an OpenAI key (dev only): set ALLOW_NO_OPENAI=1');
    process.exit(1);
  }
}

// Ensure saved timetables directory exists
const SAVED_DIR = path.join(__dirname, 'saved_timetables')
mkdirp.sync(SAVED_DIR)

app.get("/", (req, res) => {
  res.send("Backend running with OpenAI Vision!");
});

// Simple ping endpoint for mobile app connectivity checks
app.get('/ping', (req, res) => {
  res.json({ ok: true, time: Date.now(), message: 'pong' })
})

app.post("/api/upload", upload.single("image"), async (req, res) => {
  const uploadedPath = req.file && req.file.path
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Uploaded file:", req.file.path);

    const extracted = await extractCourses(req.file.path);
    console.log("Extracted (raw rows):", JSON.stringify(extracted, null, 2));

    const warnings = []

    const courses = extracted.map(row => ({
      courseCode: row.courseCode,
      courseName: row.courseName || courseNames[row.courseCode] || row.courseCode,
      type: row.type,
      venue: row.venue,
      rawSlotString: row.slotString,
      slots: parseSlots(row.slotString)
    }));

    console.log(`Mapped ${courses.length} course(s). Debugging parsed slots and lookup:`);
    courses.forEach(c => {
      console.log(`- ${c.courseCode} | name="${c.courseName}" | rawSlotString="${c.rawSlotString}" | parsed slots=${JSON.stringify(c.slots)}`);
      // report any tokens that do not exist in slots lookup
      c.slots.forEach(s => {
        if (!slotsLookup[s]) {
          console.warn(`  MISSING SLOT MAPPING: slot='${s}' (course ${c.courseCode})`);
          warnings.push({ type: 'missing_slot', slot: s, course: c.courseCode })
        }
      });
    });

    const timetable = generateTimetable(courses);

    // report counts per day for easier debugging
    const counts = Object.fromEntries(Object.keys(timetable).map(d => [d, timetable[d].length]));
    console.log('Timetable counts by day:', counts);

    res.json({ timetable, warnings });
  } catch (err) {
    console.error("Error in /api/upload:", err);
    res.status(500).json({ error: err.message });
  } finally {
    // best-effort cleanup of uploaded file
    if (uploadedPath) {
      fs.unlink(uploadedPath, (e) => { if (e) console.warn('Cleanup failed for', uploadedPath, e.message) })
    }
  }
});

// --- Simple auth endpoints (development/mock) ---
// In-memory stores (reset on server restart)
const users = {}; // phone -> { username, phone, password }
const otps = {}; // phone -> { code, expiresAt }

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/api/signup', (req, res) => {
  const { username, password, phone } = req.body || {}
  if (!username || !password || !phone) return res.status(400).json({ error: 'username,password,phone required' })
  if (users[phone]) return res.status(409).json({ error: 'User already exists' })
  users[phone] = { username, password, phone }
  console.log('User signed up:', phone)
  return res.json({ ok: true })
})

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body || {}
  const u = users[phone]
  if (!u) return res.status(404).json({ error: 'User not found' })
  if (u.password !== password) return res.status(401).json({ error: 'Invalid credentials' })
  // issue a simple token (not secure) — for demo only
  const token = Buffer.from(`${phone}:${Date.now()}`).toString('base64')
  return res.json({ token, username: u.username })
})

app.post('/api/send-otp', (req, res) => {
  const { phone } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'phone required' })
  const code = generateOtp()
  const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes
  otps[phone] = { code, expiresAt }

  // If Twilio credentials are present, send SMS via Twilio
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      const message = `Your Vitwise OTP is ${code}. It is valid for 5 minutes.`
      twilio.messages.create({ body: message, from: process.env.TWILIO_FROM, to: phone })
        .then(() => {
          console.log(`Sent OTP to ${phone} via Twilio`)
        })
        .catch(err => {
          console.error('Twilio send error:', err)
        })

      // For development, optionally expose the OTP in the response when SHOW_OTP=1
      const resp = { ok: true }
      if (process.env.SHOW_OTP === '1' || process.env.NODE_ENV !== 'production') resp.otp = code
      return res.json(resp)
    } catch (err) {
      console.error('Twilio integration failed:', err)
      // fallback to dev behaviour below
    }
  }

  // No SMS provider configured — log OTP for dev and optionally return it
  console.log(`OTP for ${phone}: ${code} (valid 5m)`) // for dev/testing only
  if (process.env.SHOW_OTP === '1' || process.env.NODE_ENV !== 'production') {
    return res.json({ ok: true, otp: code })
  }
  return res.json({ ok: true })
})

app.post('/api/verify-otp', (req, res) => {
  const { phone, code } = req.body || {}
  if (!phone || !code) return res.status(400).json({ error: 'phone and code required' })
  const record = otps[phone]
  if (!record) return res.status(404).json({ error: 'OTP not found' })
  if (Date.now() > record.expiresAt) return res.status(410).json({ error: 'OTP expired' })
  if (record.code !== code) return res.status(401).json({ error: 'Invalid OTP' })
  // OTP verified — optionally clear
  delete otps[phone]
  return res.json({ ok: true })
})

// Helper to derive phone from demo token generated at login (token = base64(phone:timestamp))
function phoneFromToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    const parts = decoded.split(':')
    return parts[0]
  } catch (e) {
    return null
  }
}

// Save timetable for the authenticated user (simple file-based store)
app.post('/api/save-timetable', (req, res) => {
  const auth = req.headers.authorization || req.body.token
  if (!auth) return res.status(401).json({ error: 'Missing token' })
  const token = (auth.startsWith('Bearer ') ? auth.slice(7) : auth)
  const phone = phoneFromToken(token)
  if (!phone) return res.status(401).json({ error: 'Invalid token' })
  const timetable = req.body.timetable
  if (!timetable) return res.status(400).json({ error: 'timetable required' })
  const file = path.join(SAVED_DIR, `${phone}.json`)
  try {
    fs.writeFileSync(file, JSON.stringify({ timetable, savedAt: Date.now() }, null, 2))
    return res.json({ ok: true })
  } catch (e) {
    console.error('save-timetable failed', e)
    return res.status(500).json({ error: 'save failed' })
  }
})

app.get('/api/load-timetable', (req, res) => {
  const auth = req.headers.authorization || req.query.token
  if (!auth) return res.status(401).json({ error: 'Missing token' })
  const token = (auth.startsWith('Bearer ') ? auth.slice(7) : auth)
  const phone = phoneFromToken(token)
  if (!phone) return res.status(401).json({ error: 'Invalid token' })
  const file = path.join(SAVED_DIR, `${phone}.json`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
  try {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'))
    return res.json(content)
  } catch (e) {
    console.error('load-timetable failed', e)
    return res.status(500).json({ error: 'load failed' })
  }
})

const PORT = process.env.PORT || 3001;

// Bind explicitly to 0.0.0.0 so emulator/dev devices on the host can reach the
// server. Express defaults to all interfaces, but being explicit avoids surprises
// on some platforms/containers.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT} (bound to 0.0.0.0)`);
});
