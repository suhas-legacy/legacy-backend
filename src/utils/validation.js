'use strict';

// Manual validator — no external library needed.
// All rules mirror the spec (Zod-equivalent).

const MEETING_TYPES = ['online', 'offline'];

/**
 * Validates the incoming contact/meeting form body.
 * Returns { error: string } on failure or { value: sanitizedBody } on success.
 *
 * @param {object} body - raw req.body
 */
const validateMeetingRequest = (body) => {
  const errors = [];

  // name
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    errors.push('Full name is required.');
  }

  // email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!body.email || !emailRegex.test(String(body.email).trim())) {
    errors.push('A valid email address is required.');
  }

  // phone  (simple E.164-style check — at least 7 digits)
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');
  if (!body.phone || phoneDigits.length < 7) {
    errors.push('A valid phone number is required.');
  }

  // meetingDate  — must be a valid ISO date and not in the past
  if (!body.meetingDate) {
    errors.push('Meeting date is required.');
  } else {
    const dateObj = new Date(body.meetingDate);
    if (isNaN(dateObj.getTime())) {
      errors.push('Meeting date must be a valid date (YYYY-MM-DD).');
    } else {
      // Compare calendar dates only (ignore time)
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (body.meetingDate < todayStr) {
        errors.push('Meeting date must be today or a future date.');
      }
    }
  }

  // meetingTime  — HH:MM 24-hour; must be in the future if today
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!body.meetingTime || !timeRegex.test(body.meetingTime)) {
    errors.push('Meeting time is required and must be in HH:MM format (24-hour).');
  } else if (body.meetingDate) {
    // Ensure the combined date-time is in the future (IST)
    const [h, m] = body.meetingTime.split(':').map(Number);
    const [year, month, day] = body.meetingDate.split('-').map(Number);
    // Build a UTC timestamp for the given IST datetime  (IST = UTC+5:30)
    const istOffsetMinutes = 330;
    const meetingUtcMs =
      Date.UTC(year, month - 1, day, h, m) - istOffsetMinutes * 60_000;
    if (meetingUtcMs <= Date.now()) {
      errors.push('Meeting time must be in the future.');
    }
  }

  // meetingType
  if (!body.meetingType || !MEETING_TYPES.includes(String(body.meetingType).toLowerCase())) {
    errors.push(`Meeting type must be one of: ${MEETING_TYPES.join(', ')}.`);
  }

  // message  — optional, but cap length
  if (body.message && String(body.message).length > 2000) {
    errors.push('Message must not exceed 2000 characters.');
  }

  if (errors.length) {
    return { error: errors.join(' ') };
  }

  // Return sanitized value
  return {
    value: {
      name: String(body.name).trim(),
      email: String(body.email).trim().toLowerCase(),
      phone: String(body.phone).trim(),
      meetingDate: String(body.meetingDate).trim(),
      meetingTime: String(body.meetingTime).trim(),
      meetingType: String(body.meetingType).trim().toLowerCase(),
      message: body.message ? String(body.message).trim() : '',
    },
  };
};

module.exports = { validateMeetingRequest };
