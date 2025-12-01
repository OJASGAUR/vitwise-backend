require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const OpenAI = require("openai");     // ✅ NEW (official SDK)
const client = new OpenAI();

const parseSlots = require("./timetable/parseSlots");
const generateTimetable = require("./timetable/generateTimetable");
const slotsLookup = require("./slots/slots.json");
const courseNames = require("./courses/courses.json");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Ensure folders
const UPLOADS = path.join(__dirname, "uploads");
const SAVED = path.join(__dirname, "saved_timetables");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(SAVED)) fs.mkdirSync(SAVED, { recursive: true });

// Health check for Render
app.get("/healthz", (req, res) => res.json({ ok: true }));

// =============================
// 📌 FIXED OCR FUNCTION
// =============================
async function extractCourses(imagePath) {
  try {
    const img = fs.readFileSync(imagePath, { encoding: "base64" });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an OCR engine. Extract rows of courses strictly in JSON. Each row MUST have: courseCode, courseName, type, venue, slotString."
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Extract this timetable." },
            { type: "input_image", image_url: `data:image/png;base64,${img}` }
          ]
        }
      ]
    });

    const raw = response.choices[0].message.content.trim();

    // **Absolute fix** for bad AI formatting
    const clean = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(clean);
    return parsed.rows || parsed;
  } catch (err) {
    console.error("OCR ERROR:", err);
    throw new Error("OCR failed: Invalid JSON");
  }
}

// =============================
// 📌 UPLOAD ENDPOINT
// =============================
app.post("/api/upload", upload.single("image"), async (req, res) => {
  const file = req.file?.path;
  if (!file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const extracted = await extractCourses(file);
    const warnings = [];

    const courses = extracted.map((row) => ({
      courseCode: row.courseCode,
      courseName: row.courseName || courseNames[row.courseCode] || row.courseCode,
      type: row.type,
      venue: row.venue || "NIL",
      rawSlotString: row.slotString,
      slots: parseSlots(row.slotString)
    }));

    // Validate slots
    courses.forEach((c) => {
      c.slots.forEach((s) => {
        if (!slotsLookup[s])
          warnings.push({ slot: s, course: c.courseCode });
      });
    });

    const timetable = generateTimetable(courses);

    res.json({ timetable, warnings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (file) fs.unlink(file, () => {});
  }
});

// =============================
// 📌 START SERVER
// =============================
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log("Backend running on:", PORT)
);
