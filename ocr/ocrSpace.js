const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

module.exports = async function extractText(imagePath) {
  try {
    const data = fs.readFileSync(imagePath);

    const form = new FormData();
    form.append("file", data, imagePath);
    form.append("language", "eng");
    form.append("scale", "true");
    form.append("isOverlayRequired", "false");
    form.append("apikey", process.env.OCR_API_KEY);

    const res = await axios.post(
      "https://api.ocr.space/parse/image",
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000
      }
    );

    const result = res.data.ParsedResults?.[0]?.ParsedText;

    if (!result) throw new Error("OCR returned no text");

    return result;

  } catch (err) {
    console.error("OCRSpace ERROR:", err.response?.data || err.message);
    throw new Error("OCR failed: " + err.message);
  }
};
