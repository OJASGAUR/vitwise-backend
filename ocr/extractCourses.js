// backend/ocr/extractCourses.js
const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Using response_format to force valid JSON from model.
 */
module.exports = async function extractCourses(imagePath) {
  try {
    const base64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",   // ✅ FIXED MODEL NAME
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract ALL timetable rows. Return JSON ONLY.\n" +
            "Format: { \"rows\": [ { \"courseCode\":\"\", \"courseName\":\"\", \"slotString\":\"\", \"type\":\"\", \"venue\":\"\" } ] }"
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract rows from the timetable image." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64}`
              }
            }
          ]
        }
      ]
    });

    const json = JSON.parse(response.choices[0].message.content);

    if (!json.rows || !Array.isArray(json.rows)) {
      throw new Error("OCR returned invalid structure");
    }

    return json.rows;

  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
