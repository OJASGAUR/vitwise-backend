const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Enhanced timetable extraction with improved accuracy
 * Input: path to uploaded image
 * Output: array of extracted rows
 */
module.exports = async function extractCourses(imagePath) {
  try {
    // Validate input
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    // Read file into base64
    const base64 = fs.readFileSync(imagePath, { encoding: "base64" });
    
    // Use gpt-4o (latest model) for better accuracy
    const response = await client.chat.completions.create({
      model: "gpt-4o", // Using the more capable model
      response_format: { type: "json_object" },
      temperature: 0.1, // Lower temperature for more consistent output
      max_tokens: 2000, // Ensure enough tokens for complete response
      
      messages: [
        {
          role: "system",
          content: `
CRITICAL INSTRUCTIONS - READ CAREFULLY:

You are extracting data from a university timetable image. Follow these rules PRECISELY:

1. SLOT CODE PRESERVATION (MOST IMPORTANT):
   - Extract slot codes EXACTLY as they appear in the image
   - NEVER modify slot codes in any way
   - Examples of what to AVOID:
     * "TAA1" → "TA1" (WRONG - NEVER do this)
     * "L31+L32" → "L31, L32" (WRONG - preserve exact format)
     * "D1+D2" → "D1, D2" (WRONG - preserve exact format)
     * "TA1" → "TAA1" (WRONG - don't expand abbreviations)
   - Preserve all punctuation, plus signs, commas exactly

2. DATA EXTRACTION RULES:
   - Extract ALL rows from the timetable
   - If a field is empty or not visible, use empty string ""
   - For courseName: extract full course name even if truncated
   - For type: extract exactly as shown (Theory, Lab, Tutorial, etc.)
   - For venue: extract room/building exactly as shown

3. CHARACTER ACCURACY:
   - Distinguish carefully between: 0 vs O, 1 vs I, 2 vs Z
   - Preserve all spaces and special characters
   - If uncertain about a character, mark with [UNCERTAIN] prefix

4. OUTPUT FORMAT - STRICT JSON ONLY:
{
  "rows": [
    {
      "courseCode": "CSE101",
      "courseName": "Introduction to Computer Science",
      "slotString": "A1+TA1",
      "type": "Theory",
      "venue": "LT-101"
    }
  ]
}

5. VALIDATION CHECK:
   - Before returning, verify each row has all required fields
   - Ensure slotString is preserved exactly from the image
   - If slotString appears to be modified, re-examine the image

REMEMBER: Slot code accuracy is CRITICAL. Double-check every slot code against the image.
`
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Extract ALL timetable rows from this image with 100% accuracy. Pay special attention to slot codes - they must be EXACT matches to what's in the image. Return ONLY valid JSON." 
            },
            {
              type: "image_url",
              image_url: { 
                url: `data:image/jpeg;base64,${base64}`,
                detail: "high" // High detail for better OCR accuracy
              }
            }
          ]
        }
      ],
    });

    // Parse and validate response
    if (!response.choices?.[0]?.message?.content) {
      throw new Error("No response content received from OpenAI");
    }

    const content = response.choices[0].message.content;
    
    // Extract JSON from response (in case there's additional text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const json = JSON.parse(jsonMatch[0]);

    // Enhanced validation
    if (!json.rows || !Array.isArray(json.rows)) {
      throw new Error("JSON missing required 'rows' array");
    }

    // Post-process validation
    const validatedRows = json.rows.map((row, index) => {
      // Ensure all required fields exist
      const validatedRow = {
        courseCode: row.courseCode || "",
        courseName: row.courseName || "",
        slotString: row.slotString || "",
        type: row.type || "",
        venue: row.venue || ""
      };

      // Log warnings for potentially problematic slot strings
      if (validatedRow.slotString) {
        // Check for common misinterpretations
        const originalSlot = validatedRow.slotString;
        const commonMistakes = [
          { pattern: /^TA\d+$/, warning: "Possible misinterpretation: TA instead of TAA" },
          { pattern: /^A\d+$/, warning: "Possible misinterpretation: A instead of AA" },
          { pattern: /^L\d+,?\s*L\d+$/, warning: "Possible misinterpretation: Check plus signs in lab slots" }
        ];

        commonMistakes.forEach(({ pattern, warning }) => {
          if (pattern.test(originalSlot)) {
            console.warn(`Row ${index + 1} slot warning: ${warning} - "${originalSlot}"`);
          }
        });
      }

      return validatedRow;
    });

    // Return with metadata for debugging
    return {
      rows: validatedRows,
      _metadata: {
        extractedAt: new Date().toISOString(),
        modelUsed: "gpt-4o",
        totalRows: validatedRows.length
      }
    }.rows; // Return just the rows to maintain compatibility

  } catch (error) {
    console.error("extractCourses ERROR:", {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // Re-throw with more context but same format
    throw new Error(`Timetable extraction failed: ${error.message}`);
  }
};