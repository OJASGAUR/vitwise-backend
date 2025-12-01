module.exports = function parseSlots(slotString) {
  if (!slotString || slotString === "NIL") return [];

  // If slotString contains venue (format: "E2+TE2 - MB307"), extract only slots part
  if (slotString.includes("-")) {
    slotString = slotString.split("-")[0].trim();
  }

  return slotString
    .replace(/\s+/g, "")
    .split("+")
    .filter(Boolean);
};