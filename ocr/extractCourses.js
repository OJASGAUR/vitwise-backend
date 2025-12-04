// backend/ocr/extractCourses.js
const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * STRICT OCR extraction of timetable rows
 * ZERO normalisation, abbreviation, interpretation or correction
 */
module.exports = async function extractCourses(imagePath) {
  try {
    // Read & encode image
    const base64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },

      messages: [
        {
          role: "system",
          content:
            "You are performing STRICT OCR extraction from an image. " +
            "You MUST return text EXACTLY as printed, including repeated letters, " +
            "digits, punctuation, spacing, and capitalization. " +
            "Do NOT guess, interpret, fix, shorten, or normalize text. " +
            "If a slot is printed as 'TAA2', it MUST be returned as 'TAA2', not 'TA2'. " +
            "Do NOT change 'L16' to 'L6', do NOT fix typos, do NOT remove characters. " +
            "If uncertain, copy literally.\n\n" +

            "Extract ALL timetable rows visible.\n\n" +

            "Return ONLY valid JSON in the EXACT format:\n" +
            "{ \"rows\": [ { \"courseCode\":\"\", \"courseName\":\"\", \"slotString\":\"\", \"type\":\"\", \"venue\":\"\" } ] }\n\n" +

            "rules:\n" +
            "- courseCode: EXACT text, no normalization\n" +
            "- courseName: EXACT text, no paraphrasing\n" +
            "- slotString: EXACT text, including repeating characters\n" +
            "- type: EXACT text\n" +
            "- venue: EXACT text\n\n" +

            "The output must contain ONLY JSON with no commentary."
        },

        {
          role: "user",
          content: [
            { type: "text", text: "Perform STRICT OCR. Return exact text. No corrections." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64}`
              }
            }
          ]
        }
      ],

      // Do not let model explain anything
      temperature: 0,
      stop: ["Note:", "Explanation:", "```"]
    });

    // Parse
    let rawJson = response.choices?.[0]?.message?.content;

    if (!rawJson) {
      throw new Error("Missing response content from OpenAI");
    }

    let json;

    try {
      json = JSON.parse(rawJson);
    } catch (err) {
      console.error("JSON parse fail:", rawJson);
      throw new Error("OCR returned invalid JSON");
    }

    if (!json.rows || !Array.isArray(json.rows)) {
      console.error("Invalid JSON structure:", json);
      throw new Error("OCR returned invalid structure");
    }

    return json.rows;

  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
