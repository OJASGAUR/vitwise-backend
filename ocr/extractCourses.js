const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

module.exports = async function extractCourses(imagePath) {
  try {
    const imageData = fs.readFileSync(imagePath).toString("base64");

    // Prompt the model to extract rows and the full course name
    const prompt = [
      'You are an OCR assistant. Analyze the provided timetable image and extract each row as a JSON object.',
      '',
      'Return a JSON array where each entry has these fields exactly:',
      '{',
      '  "courseCode": "<COURSE_CODE>",',
      '  "courseName": "<FULL COURSE NAME>",',
      '  "type": "Theory Only | Lab Only | Embedded Theory | Embedded Lab | Regular",',
      '  "venue": "<ROOM CODE or NIL>",',
      '  "slotString": "<A2+TA2+TAA2>"',
      '}',
      '',
      'IMPORTANT RULES (apply exactly):',
      '- Preserve every character in `slotString` exactly as seen. DO NOT collapse repeated letters ("TAA2" must remain "TAA2").',
      '- If slot and venue appear together like "A2+TA2+TAA2 - MB306A", set `slotString` to the text before the hyphen and `venue` to the text after the hyphen (trimmed).',
      '- Extract the full course title into `courseName` (example: "Mechanics of Materials"). If the name is not visible, you may leave `courseName` equal to the course code.',
      '- If venue is missing or not found, set `venue` to "NIL".',
      '- Output JSON ONLY. NO markdown, NO extra text, NO backticks.',
      '',
      'Example output (single row):',
      '[',
      '  {',
      '    "courseCode": "BAMEE201",',
      '    "courseName": "Mechanics of Materials",',
      '    "type": "Embedded Theory",',
      '    "venue": "MB218",',
      '    "slotString": "C2+TC2"',
      '  }',
      ']',
    ].join('\n');

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${imageData}` }
            }
          ]
        }
      ]
    });

    let json = response.choices[0].message.content.trim();

    if (json.startsWith("```")) {
      json = json.replace(/```json|```/g, "").trim();
    }

    const parsed = JSON.parse(json);
    return parsed;
  } catch (err) {
    console.error("OCR JSON error:", err);
    throw new Error("OCR failed: Invalid JSON");
  }
};