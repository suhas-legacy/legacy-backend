'use strict';

const { v4: uuidv4 } = require('crypto');
const { getCalendarClient } = require('../config/googleCalendar');
require('dotenv').config();

// ─── Constants ────────────────────────────────────────────────────────────────
const TIMEZONE = 'Asia/Kolkata';
const DURATION_MINUTES = 30;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'contact@legacyglobalbank.com';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const OFFICE_ADDRESS =
  process.env.OFFICE_ADDRESS ||
  'Legacy Global Bank, Financial District, Hyderabad, Telangana, India';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a local IST date+time string into a Google Calendar dateTime object.
 *
 * @param {string} dateStr  'YYYY-MM-DD'
 * @param {string} timeStr  'HH:MM'
 * @param {number} addMins  offset in minutes (default 0; use DURATION_MINUTES for end)
 * @returns {{ dateTime: string, timeZone: string }}
 */
const toCalendarDateTime = (dateStr, timeStr, addMins = 0) => {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMins = h * 60 + m + addMins;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;

  const pad = (n) => String(n).padStart(2, '0');
  const dateTime = `${dateStr}T${pad(endH)}:${pad(endM)}:00`;

  return { dateTime, timeZone: TIMEZONE };
};

/**
 * Builds the event description from submitted form data.
 */
const buildDescription = (data) => {
  const lines = [
    `Customer Name  : ${data.name}`,
    `Customer Email : ${data.email}`,
    `Customer Phone : ${data.phone}`,
    `Meeting Type   : ${data.meetingType.charAt(0).toUpperCase() + data.meetingType.slice(1)}`,
  ];

  if (data.meetingType === 'offline') {
    lines.push(`Office Address : ${OFFICE_ADDRESS}`);
  }

  if (data.message) {
    lines.push(``, `Customer Message:`, data.message);
  }

  lines.push(``, `Scheduled via Legacy Global Bank Website`);

  return lines.join('\n');
};

// ─── Core service ─────────────────────────────────────────────────────────────

/**
 * Creates a Google Calendar event with an optional Google Meet link.
 *
 * @param {object} data - sanitized form data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.phone
 * @param {string} data.meetingDate  'YYYY-MM-DD'
 * @param {string} data.meetingTime  'HH:MM'
 * @param {'online'|'offline'} data.meetingType
 * @param {string} [data.message]
 *
 * @returns {Promise<{ eventId: string, meetLink?: string, htmlLink: string }>}
 */
const scheduleMeeting = async (data) => {
  const calendar = await getCalendarClient();

  const isOnline = data.meetingType === 'online';

  const event = {
    summary: 'Legacy Global Bank Consultation',
    description: buildDescription(data),
    start: toCalendarDateTime(data.meetingDate, data.meetingTime),
    end: toCalendarDateTime(data.meetingDate, data.meetingTime, DURATION_MINUTES),
    attendees: [
      { email: ADMIN_EMAIL },
      { email: data.email, displayName: data.name },
    ],
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },  // 1 day before
        { method: 'email', minutes: 60 },         // 1 hour before
        { method: 'popup', minutes: 10 },
      ],
    },
  };

  // Attach Google Meet conference request for online meetings
  if (isOnline) {
    event.conferenceData = {
      createRequest: {
        requestId: `lgb-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event,
    conferenceDataVersion: isOnline ? 1 : 0,
    sendUpdates: 'all',  // Google sends email invitations to all attendees
  });

  const createdEvent = response.data;

  const result = {
    eventId: createdEvent.id,
    htmlLink: createdEvent.htmlLink,
  };

  if (isOnline && createdEvent.conferenceData?.entryPoints?.length) {
    const videoEntry = createdEvent.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === 'video'
    );
    if (videoEntry) {
      result.meetLink = videoEntry.uri;
    }
  }

  return result;
};

module.exports = { scheduleMeeting };
