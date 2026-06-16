'use strict';

const { google } = require('googleapis');
require('dotenv').config();

/**
 * Creates and returns an authenticated Google Calendar client.
 *
 * Auth strategy: OAuth2 Client Credentials & Refresh Token
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 */
const getCalendarClient = async () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
};

module.exports = { getCalendarClient };
