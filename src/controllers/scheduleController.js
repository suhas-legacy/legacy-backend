'use strict';

const { validateMeetingRequest } = require('../utils/validation');
const { scheduleMeeting } = require('../services/calendarService');

/**
 * POST /api/schedule
 *
 * Accepts a meeting request, validates it, creates a Google Calendar event,
 * and returns a success payload (with Meet link when meetingType=online).
 */
const scheduleController = async (req, res) => {
  try {
    // ── 1. Validate ──────────────────────────────────────────────────────────
    const { error, value } = validateMeetingRequest(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    // ── 2. Schedule via Google Calendar ──────────────────────────────────────
    const result = await scheduleMeeting(value);

    // ── 3. Respond ───────────────────────────────────────────────────────────
    const isOnline = value.meetingType === 'online';

    const response = {
      success: true,
      message: isOnline
        ? 'Online meeting scheduled successfully. Calendar invitations have been sent to all attendees.'
        : 'Offline meeting scheduled successfully. Calendar invitations have been sent to all attendees.',
      calendarLink: result.htmlLink,
    };

    if (isOnline && result.meetLink) {
      response.meetingLink = result.meetLink;
    }

    return res.status(200).json(response);

  } catch (err) {
    console.error('[scheduleController] Error:', err);

    // Surface Google API errors helpfully without leaking internals
    if (err.code === 401 || err.code === 403) {
      return res.status(500).json({
        success: false,
        message:
          'Server is not authorized to access Google Calendar. Please contact support.',
      });
    }

    if (err.message?.includes('credentials')) {
      return res.status(500).json({
        success: false,
        message: 'Calendar service is not configured yet. Please contact support.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while scheduling the meeting. Please try again.',
    });
  }
};

module.exports = { scheduleController };
