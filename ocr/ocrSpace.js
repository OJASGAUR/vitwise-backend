const fs = require("fs");
const axios = require("axios");

module.exports = async function extractText(imagePath) {
  try {
    const base64 = fs.readFileSync(imagePath, "base64");

    const res = await axios.post("https://api.ocr.space/parse/image", null, {
      params: {
        apikey: process.env.OCR_API_KEY,
        base64Image: "data:image/png;base64," + base64,
        language: "eng",
        scale: true,
        isOverlayRequired: false
      },
      timeout: 20000
    });

    const result = res.data.ParsedResults?.[0]?.ParsedText;

    if (!result) throw new Error("OCR returned no text");

    return result;

  } catch (err) {
    console.error("OCRSpace ERROR:", err.response?.data || err.message);
    throw new Error("OCR failed: " + err.message);
  }
};
