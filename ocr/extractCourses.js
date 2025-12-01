const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function extractCourses(imagePath) {
  try {
    const imgData = fs.readFileSync(imagePath, { encoding: "base64" });

    const prompt = `
Extract all course rows from this timetable screenshot.
Return ONLY JSON. Do NOT return explanations.

Format:
[
  {
    "courseCode": "CSE2001",
    "courseName": "Data Structures",
    "slotString": "A1+TA1",
    "type": "Theory/Lab",
    "venue": "AB1-201"
  }
]

IMPORTANT:
- If something is missing, set it to an empty string.
- Ensure the output is VALID JSON.
`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini-vision",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: `data:image/jpeg;base64,${imgData}`,
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    let raw = response.choices[0].message.content.trim();

    // FIX 1: Remove markdown ```json blocks
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    // FIX 2: Validate JSON
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      console.error("RAW OCR OUTPUT:", raw);
      throw new Error("OCR returned invalid JSON");
    }

    return json;
  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
