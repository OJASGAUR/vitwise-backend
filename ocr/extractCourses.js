const extractText = require("./ocrSpace");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function extractCourses(imagePath) {
  try {
    // 1) Do OCR (free, raw text)
    const text = await extractText(imagePath);

    // 2) Send to GPT for structuring
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You will be given timetable RAW text.

STRICT RULES:
- Do NOT correct codes.
- Do NOT remove repeated letters.
- Do NOT convert "TAA2" to "TA2".
- Return EXACT text as-is.

Return JSON only:

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
          content: text
        }
      ]
    });

    const json = JSON.parse(response.choices[0].message.content);

    if (!json.rows || !Array.isArray(json.rows)) {
      throw new Error("OCR JSON invalid");
    }

    return json.rows;

  } catch (err) {
    console.error("extractCourses ERROR:", err);
    throw new Error("OCR failed: " + err.message);
  }
};
