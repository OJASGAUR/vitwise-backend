const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Input: path to uploaded image
 * Output: array of extracted rows
 *  [
 *    {
 *      courseCode: "",
 *      courseName: "",
 *      slotString: "",
 *      type: "",
 *      venue: ""
 *    }
 *  ]
 */
module.exports = async function extractCourses(imagePath) {
  try {
    // Read file into base64
    const base64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },

      messages: [
        {
          role: "system",
          content: `
You will be given an image of a university timetable.
Extract ALL rows accurately.

IMPORTANT RULES (STRICT):
- NEVER correct slot codes.
- NEVER remove repeated letters.
- DO NOT convert TAA1 to TA1 .
- Keep all codes EXACT as written.
- If text is unclear, copy EXACTLY as seen.
- DO NOT invent missing data.

Output must be ONLY JSON:

{
  "rows":[
    {
      "courseCode":"",
      "courseName":"",
      "slotString":"",
      "type":"",
      "venue":""
    }
  ]
}
`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract timetable rows from this image." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}` }
            }
          ]
        }
      ],
    });

    // Parse JSON
    let json;
    try {
      json = JSON.parse(response.choices[0].message.content);
    } catch (e) {
      throw new Error("GPT did not return valid JSON");
    }

    // Ensure the structure exists
    if (!json.rows || !Array.isArray(json.rows)) {
      throw new Error("JSON missing rows[]");
    }

    return json.rows;
  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
