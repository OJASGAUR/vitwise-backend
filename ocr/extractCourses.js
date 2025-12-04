// backend/ocr/extractCourses.js
const fs = require("fs");
const OpenAI = require("openai");
const { createWorker } = require("tesseract.js");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function extractCourses(imagePath) {
  try {
    // STEP 1: Local OCR (free)
    const worker = await createWorker();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const { data } = await worker.recognize(imagePath);
    await worker.terminate();

    const rawText = data.text;

    if (!rawText || rawText.trim().length === 0) {
      throw new Error("OCR returned empty text");
    }

    // STEP 2: Convert raw text into structured JSON (cheap)
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",  // cheap text model
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract timetable rows from raw OCR text.\n" +
            "Return EXACT strings without changing characters.\n\n" +
            "Return ONLY JSON in this format:\n" +
            "{ \"rows\": [ { \"courseCode\":\"\", \"courseName\":\"\", \"slotString\":\"\", \"type\":\"\", \"venue\":\"\" } ] }"
        },
        {
          role: "user",
          content:
            "Raw OCR text:\n\n" + rawText
        }
      ]
    });

    const json = JSON.parse(response.choices[0].message.content);

    if (!json.rows || !Array.isArray(json.rows)) {
      throw new Error("Invalid JSON returned");
    }

    return json.rows;

  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
