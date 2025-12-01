const slots = require("../slots/slots.json");
const parseSlots = require("./parseSlots");

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

module.exports = function generateTimetable(courses) {
  const timetable = {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: []
  };

  for (const course of courses) {
    // Parse slots: prefer pre-parsed `course.slots` (set by the upload handler),
    // otherwise fall back to parsing `course.slotString`.
    const courseSlots = Array.isArray(course.slots) && course.slots.length > 0
      ? course.slots
      : parseSlots(course.slotString || "");
    
    for (const slot of courseSlots) {
      const info = slots[slot];
      if (!info) {
        console.warn(`generateTimetable: missing slot mapping for token='${slot}' (course ${course.courseCode})`);
        continue;
      }

      for (const session of info) {
        if (!timetable.hasOwnProperty(session.day)) {
          console.warn(`generateTimetable: unknown day '${session.day}' for slot='${slot}' (course ${course.courseCode})`);
          continue;
        }

        timetable[session.day].push({
          courseCode: course.courseCode,
          courseName: course.courseName || course.courseCode,
          venue: course.venue, // Use the venue from course data
          slot: slot,
          start: session.start,
          end: session.end,
          type: session.type
        });
      }
    }
  }

  for (const day of Object.keys(timetable)) {
    timetable[day].sort(
      (a, b) => toMinutes(a.start) - toMinutes(b.start)
    );
  }

  return timetable;
};