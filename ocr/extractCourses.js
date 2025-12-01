// backend/ocr/extractCourses.js
const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * The ONLY fully reliable solution:
 * Use response_format: json_object
 * → The model is *forced* to return valid JSON.
 */
module.exports = async function extractCourses(imagePath) {
  try {
    const base64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini-vision",
      response_format: { type: "json_object" },   // FORCE VALID JSON
      messages: [
        {
          role: "system",
          content:
            "Extract ALL timetable rows. Return JSON ONLY. The JSON MUST match the format: { \"rows\": [ { \"courseCode\":\"\", \"courseName\":\"\", \"slotString\":\"\", \"type\":\"\", \"venue\":\"\" } ] }. Missing fields MUST be empty strings."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract rows from this timetable image." },
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

    // The model ALWAYS returns valid JSON when response_format is used
    const data = JSON.parse(response.choices[0].message.content);

    if (!data.rows || !Array.isArray(data.rows)) {
      throw new Error("JSON missing rows array");
    }

    return data.rows;

  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
