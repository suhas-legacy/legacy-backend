const crypto = require('crypto');
const nodemailer = require('nodemailer');
const dbService = require('./database');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
require('dotenv').config();
const { getCalendarClient } = require('./src/config/googleCalendar');


// JWT Cryptographic Constants
const JWT_SECRET = process.env.JWT_SECRET || 'legacy_global_bank_secret_key_2026_xyz';

/**
 * Generate a secure base64url-encoded JWT token
 */
function signToken(payload, secret = JWT_SECRET) {
  const header = { alg: "HS256", typ: "JWT" };
  
  const base64UrlEncode = (str) => {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
    
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify signature, expiration, and parse token payload
 */
function verifyToken(token, secret = JWT_SECRET) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, signature] = parts;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
      
    if (signature !== expectedSignature) {
      console.error('[JWT] Cryptographic signature mismatch');
      return null;
    }
    
    // Base64Url decode payload
    const decodedPayload = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(decodedPayload);
    
    // Check expiration (exp in seconds)
    const currentSecs = Math.floor(Date.now() / 1000);
    if (payload.exp && currentSecs > payload.exp) {
      console.warn('[JWT] Token expired');
      return null;
    }
    
    return payload;
  } catch (err) {
    console.error('[JWT] Token verification error:', err);
    return null;
  }
}

/**
 * SMTP Mail Transporter Creator
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

/**
 * Dispatch notification email to internal team
 */
async function sendAdminRequestEmail(request) {
  const transporter = createTransporter();
  const approveToken = signToken({ id: request.id, action: 'approve', email: 'admin@legacyglobalbank.com', exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 });
  const rejectToken = signToken({ id: request.id, action: 'reject', email: 'admin@legacyglobalbank.com', exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 });

  const hostUrl = process.env.BACKEND_API_URL || `http://localhost:${process.env.PORT || 3001}`;
  const approveLink = `${hostUrl}/api/visitor/approve?id=${request.id}&token=${approveToken}`;
  const rejectLink = `${hostUrl}/api/visitor/reject?id=${request.id}&token=${rejectToken}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: process.env.SUPPORT_EMAIL || 'admin@legacyglobalbank.com',
    subject: `New Visitor Meeting Request [${request.id}]`,
    text: `New Visitor Meeting Request\n\nName: ${request.name}\nPhone: ${request.phone}\nEmail: ${request.email}\nMeeting Type: ${request.meeting_type === 'online' ? 'Online' : 'Offline'}\nRequested Date: ${request.formatted_date}\nRequested Time: ${request.meeting_time}\nRequest ID: ${request.id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #D9DCE6; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
        <div style="background: #0A0A0A; padding: 30px 20px; text-align: center; border-bottom: 3px solid #C9A227;">
          <img src="cid:logo" alt="Legacy Global Bank Logo" style="height: 60px; width: auto; display: block; margin: 0 auto 15px auto;" />
          <h1 style="color: #E2C86C; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; font-family: 'Georgia', serif;">LEGACY GLOBAL BANK</h1>
          <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.8; letter-spacing: 1px;">NEW VISITOR MEETING REQUEST</p>
        </div>
        <div style="padding: 25px; background: #F8F6F2; color: #0A0A0A;">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold; width: 35%;">Request ID</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #8B6914; font-family: monospace; font-weight: bold;">${request.id}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Name</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A;">${request.name}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Phone</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A;">${request.phone}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Email</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A;">${request.email}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Meeting Type</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A; text-transform: capitalize;">${request.meeting_type}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Requested Date</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A;">${request.formatted_date}</td>
            </tr>
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #6E7285; font-weight: bold;">Requested Time</td>
              <td style="padding: 12px 0; border-bottom: 1px solid #D9DCE6; color: #0A0A0A;">${request.meeting_time}</td>
            </tr>
          </table>
          
          <div style="display: flex; gap: 15px; justify-content: center; margin-top: 10px;">
            <a href="${approveLink}" style="background: #2E7D32; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-family: monospace; display: inline-block; text-align: center; flex: 1;">Approve</a>
            <a href="${rejectLink}" style="background: #C62828; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-family: monospace; display: inline-block; text-align: center; flex: 1;">Reject</a>
          </div>
          
          <p style="color: #6E7285; font-size: 11px; text-align: center; margin-top: 20px; line-height: 1.4;">
            This link is secure, signed with JWT, and expires in 24 hours. Single-use only.
          </p>
        </div>
        <div style="background: #0A0A0A; padding: 20px; text-align: center;">
          <p style="color: #C9A227; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 1px;">
            © 2026 Legacy Global Bank. All rights reserved.
          </p>
        </div>
      </div>
    `,
    attachments: [{
      filename: 'logo.svg',
      path: path.join(__dirname, 'logo copy.svg'),
      cid: 'logo'
    }]
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Admin notification sent for request: ${request.id} (From: ${mailOptions.from} -> To: ${mailOptions.to})`);
  } catch (err) {
    console.error(`[Email] Failed to send admin email (From: ${mailOptions.from}):`, err);
  }
}

/**
 * Dispatch confirmation email to the visitor
 */
async function sendVisitorConfirmationEmail(request, type) {
  const transporter = createTransporter();
  let subject = "";
  let headerSubtitle = "";
  let innerHTML = "";

  if (type === "rejection") {
    subject = "Meeting Request Declined";
    headerSubtitle = "MEETING REQUEST UPDATES";
    innerHTML = `
      <p>Dear ${request.name},</p>
      <p>We regret to inform you that your request for a visitor pass (ID: <strong>${request.id}</strong>) has been declined.</p>
      <p>If you have any questions or would like to submit a new request, please contact us at <a href="mailto:support@legacyglobalbank.com" style="color: #C9A227; font-weight: bold; text-decoration: none;">support@legacyglobalbank.com</a>.</p>
    `;
  } else if (request.meeting_type === "offline") {
    subject = "Your Offline Meeting Has Been Approved";
    headerSubtitle = "MEETING CONFIRMATION";
    innerHTML = `
      <p>Dear ${request.name},</p>
      <p>Your offline meeting request has been approved.</p>
      <div style="background: #ffffff; padding: 20px; border-left: 4px solid #C9A227; margin: 20px 0; border-radius: 0 6px 6px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <strong style="color: #0A0A0A;">Pass ID:</strong> <span style="font-family: monospace; color: #8B6914; font-weight: bold;">${request.id}</span><br>
        <p style="margin: 8px 0 0 0; color: #6E7285;">Our team will contact you shortly with further instructions.</p>
      </div>
      <p>Please carry a valid photo identification card for entry verification at our branch office.</p>
    `;
  } else {
    // Online confirmed
    const isRescheduled = type === "alternative_slot";
    subject = isRescheduled ? "Rescheduled: Meeting slot update" : "Your Online Meeting Has Been Confirmed";
    headerSubtitle = "MEETING CONFIRMATION";
    innerHTML = `
      <p>Hello ${request.name},</p>
      <p>${isRescheduled ? "Your requested slot was unavailable. We have scheduled the nearest available slot." : "Your meeting has been approved and scheduled."}</p>
      
      <div style="background: #ffffff; padding: 20px; border-left: 4px solid #C9A227; margin: 20px 0; border-radius: 0 6px 6px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); line-height: 1.6;">
        <strong style="color: #6E7285;">Meeting ID:</strong> <span style="font-family: monospace; color: #8B6914; font-weight: bold;">${request.id}</span><br>
        <strong style="color: #6E7285;">Date:</strong> <span style="color: #0A0A0A; font-weight: 500;">${request.formatted_date}</span><br>
        <strong style="color: #6E7285;">Time:</strong> <span style="color: #0A0A0A; font-weight: 500;">${request.meeting_time}</span><br>
        <strong style="color: #6E7285;">Duration:</strong> <span style="color: #0A0A0A; font-weight: 500;">30 Minutes</span><br>
        <strong style="color: #6E7285;">Google Meet Link:</strong> <a href="${request.meeting_url}" style="color: #8B6914; font-weight: bold; text-decoration: none;">${request.meeting_url}</a>
      </div>
      
      <p>A calendar invitation has been attached and synced to your email address.</p>
    `;
  }

  const bodyHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #D9DCE6; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
      <!-- Header -->
      <div style="background: #0A0A0A; padding: 30px 20px; text-align: center; border-bottom: 3px solid #C9A227;">
        <img src="cid:logo" alt="Legacy Global Bank Logo" style="height: 60px; width: auto; display: block; margin: 0 auto 15px auto;" />
        <h1 style="color: #E2C86C; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; font-family: 'Georgia', serif;">LEGACY GLOBAL BANK</h1>
        <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.8; letter-spacing: 1px;">${headerSubtitle}</p>
      </div>
      
      <!-- Content -->
      <div style="padding: 30px 25px; background: #F8F6F2; color: #0A0A0A; line-height: 1.6;">
        ${innerHTML}
        <br>
        <p style="color: #6E7285; font-size: 12px; border-top: 1px solid #D9DCE6; padding-top: 15px; margin-top: 20px;">
          Legacy Global Bank Team
        </p>
      </div>

      <!-- Footer -->
      <div style="background: #0A0A0A; padding: 20px; text-align: center;">
        <p style="color: #C9A227; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 1px;">
          © 2026 Legacy Global Bank. All rights reserved.
        </p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: request.email,
    subject: subject,
    html: bodyHTML,
    attachments: [{
      filename: 'logo.svg',
      path: path.join(__dirname, 'logo copy.svg'),
      cid: 'logo'
    }]
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Visitor confirmation email dispatched (From: ${mailOptions.from} -> To: ${request.email}) [Type: ${type}]`);
  } catch (err) {
    console.error(`[Email] Failed to send visitor email (From: ${mailOptions.from}):`, err);
  }
}

/**
 * Dispatch manual reschedule alert to admin
 */
async function sendAdminWarningEmail(request) {
  const transporter = createTransporter();
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: process.env.SUPPORT_EMAIL || 'admin@legacyglobalbank.com',
    subject: `ALERT: Manual scheduling required [${request.id}]`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #C62828; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
        <div style="background: #0A0A0A; padding: 30px 20px; text-align: center; border-bottom: 3px solid #C62828;">
          <img src="cid:logo" alt="Legacy Global Bank Logo" style="height: 60px; width: auto; display: block; margin: 0 auto 15px auto;" />
          <h1 style="color: #E2C86C; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; font-family: 'Georgia', serif;">LEGACY GLOBAL BANK</h1>
          <p style="color: #FF5252; margin: 8px 0 0 0; font-size: 14px; font-weight: bold; letter-spacing: 1px;">MANUAL SCHEDULING REQUIRED</p>
        </div>
        <div style="padding: 25px; background: #F8F6F2; color: #0A0A0A;">
          <p><strong>No slots available</strong> for this request. System auto-reschedule scan failed to find a free calendar slot on the requested Friday or the next Friday.</p>
          
          <div style="background: #ffffff; padding: 20px; border-left: 4px solid #C62828; margin: 20px 0; border-radius: 0 6px 6px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <strong>Request ID:</strong> <span style="font-family: monospace; font-weight: bold; color: #C62828;">${request.id}</span><br>
            <strong>Visitor Name:</strong> ${request.name}<br>
            <strong>Email:</strong> ${request.email}<br>
            <strong>Phone:</strong> ${request.phone}<br>
            <strong>Requested Slot:</strong> ${request.formatted_date} at ${request.meeting_time}
          </div>
          
          <p>Please open the admin dashboard to manually assign an available slot for this request.</p>
        </div>
        <div style="background: #0A0A0A; padding: 20px; text-align: center;">
          <p style="color: #C9A227; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 1px;">
            © 2026 Legacy Global Bank. All rights reserved.
          </p>
        </div>
      </div>
    `,
    attachments: [{
      filename: 'logo.svg',
      path: path.join(__dirname, 'logo copy.svg'),
      cid: 'logo'
    }]
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Admin manual warning dispatched (From: ${mailOptions.from} -> To: ${mailOptions.to}) for request: ${request.id}`);
  } catch (err) {
    console.error(`[Email] Failed to send admin warning (From: ${mailOptions.from}):`, err);
  }
}

async function checkCalendarAvailability(dateStr, timeStr, formattedDate) {
  const calendarEmails = (process.env.MEETING_CALENDAR_EMAILS || "meeting1@company.com,meeting2@company.com,meeting3@company.com")
    .split(",")
    .map(e => e.trim().replace(/^["']|["']$/g, ''));

  // Helper query: Get all confirmed meetings on a specific date & time
  const getConfirmedMeetings = async (checkDate, checkTime) => {
    const query = `
      SELECT calendar_id 
      FROM legacy_website.visitor_requests 
      WHERE meeting_date = $1 AND meeting_time = $2 AND status = 'CONFIRMED'
    `;
    const res = await dbService.pool.query(query, [checkDate, checkTime]);
    return res.rows || [];
  };

  // Step 1: Check requested slot
  let confirmedRows = await getConfirmedMeetings(dateStr, timeStr);
  let bookedCalendars = confirmedRows.map(r => r.calendar_id);
  
  // Find first free calendar email
  let freeCalendar = calendarEmails.find(email => !bookedCalendars.includes(email));
  if (freeCalendar) {
    return {
      available: true,
      calendarId: freeCalendar,
      date: dateStr,
      formattedDate: formattedDate,
      time: timeStr,
      rescheduled: false
    };
  }

  // Step 2: Slot occupied! Run search logic
  console.log(`[Availability Engine] Slot ${dateStr} at ${timeStr} is fully booked. Searching alternates...`);
  const timeSlots = [
    "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
    "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
    "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM",
    "4:00 PM", "4:30 PM"
  ];
  const currentIdx = timeSlots.indexOf(timeStr);

  // Try +30, +60, +90 minutes on same Friday (which are offset 1, 2, 3 in slots array)
  const offsets = [1, 2, 3];
  for (let offset of offsets) {
    const nextIdx = currentIdx + offset;
    if (nextIdx < timeSlots.length) {
      const altTime = timeSlots[nextIdx];
      confirmedRows = await getConfirmedMeetings(dateStr, altTime);
      bookedCalendars = confirmedRows.map(r => r.calendar_id);
      freeCalendar = calendarEmails.find(email => !bookedCalendars.includes(email));

      if (freeCalendar) {
        return {
          available: true,
          calendarId: freeCalendar,
          date: dateStr,
          formattedDate: formattedDate,
          time: altTime,
          rescheduled: true
        };
      }
    }
  }

  // Step 3: Not found on same Friday. Check next Friday.
  console.log(`[Availability Engine] Same-day offsets booked. Checking next Friday...`);
  const dateObj = new Date(dateStr);
  dateObj.setDate(dateObj.getDate() + 7); // Add 7 days
  // Build YYYY-MM-DD in LOCAL time to avoid UTC midnight shift (e.g. IST +5:30)
  const pad = (n) => String(n).padStart(2, '0');
  const nextFridayStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
  const nextFridayFormatted = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  // Try same requested time on next Friday
  confirmedRows = await getConfirmedMeetings(nextFridayStr, timeStr);
  bookedCalendars = confirmedRows.map(r => r.calendar_id);
  freeCalendar = calendarEmails.find(email => !bookedCalendars.includes(email));
  if (freeCalendar) {
    return {
      available: true,
      calendarId: freeCalendar,
      date: nextFridayStr,
      formattedDate: nextFridayFormatted,
      time: timeStr,
      rescheduled: true
    };
  }

  // Scan all slots on next Friday
  for (let altTime of timeSlots) {
    confirmedRows = await getConfirmedMeetings(nextFridayStr, altTime);
    bookedCalendars = confirmedRows.map(r => r.calendar_id);
    freeCalendar = calendarEmails.find(email => !bookedCalendars.includes(email));
    
    if (freeCalendar) {
      return {
        available: true,
        calendarId: freeCalendar,
        date: nextFridayStr,
        formattedDate: nextFridayFormatted,
        time: altTime,
        rescheduled: true
      };
    }
  }

  // Step 4: No slot available anywhere
  console.warn(`[Availability Engine] No free calendar slot found in search window.`);
  return { available: false };
}

module.exports = {
  signToken,
  verifyToken,
  sendAdminRequestEmail,
  sendVisitorConfirmationEmail,
  sendAdminWarningEmail,
  checkCalendarAvailability
};

/**
 * Converts slot chips like "2:30 PM" to 24-hour time "14:30"
 */
function convertTo24Hour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '12:00';
  const parts = timeStr.trim().split(/\s+/);
  if (parts.length !== 2) return '12:00';
  
  const [time, modifier] = parts;
  let [hours, minutes] = time.split(':');
  
  if (hours === '12') {
    hours = '00';
  }
  
  if (modifier === 'PM') {
    hours = parseInt(hours, 10) + 12;
  }
  
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

/**
 * Adds minutes to 24-hour time string
 */
function addMinutesToTime(time24h, minutesToAdd) {
  if (!time24h || typeof time24h !== 'string') return '12:30';
  const [hours, minutes] = time24h.split(':').map(Number);
  let newMinutes = minutes + minutesToAdd;
  let newHours = hours;
  
  if (newMinutes >= 60) {
    newHours += Math.floor(newMinutes / 60);
    newMinutes = newMinutes % 60;
  }
  
  if (newHours >= 24) {
    newHours = newHours % 24;
  }
  
  return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

/**
 * Initializes Google OAuth2/JWT auth client using local file or GCP ADC
 */
function getGoogleAuthClient() {
  const scopes = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const impersonatedEmail = process.env.GOOGLE_IMPERSONATED_EMAIL;
  
  let keyFilePath = null;
  if (envPath) {
    // Strip any leading '.' that may have been accidentally added in .env
    const cleanEnvPath = envPath.replace(/^[.\/\\]+(?=[A-Za-z]:)/, '');
    const absoluteEnvPath = path.isAbsolute(cleanEnvPath) ? cleanEnvPath : path.resolve(__dirname, cleanEnvPath);
    console.log(`[Google Calendar] Checking credential path: ${absoluteEnvPath}`);
    if (fs.existsSync(absoluteEnvPath)) {
      keyFilePath = absoluteEnvPath;
    } else {
      console.warn(`[Google Calendar] Credential file NOT found at: ${absoluteEnvPath}`);
    }
  }

  if (!keyFilePath) {
    // Use the actual filename present in the secret directory
    const defaultLocalPath = path.join(__dirname, 'secret', 'legacy-website-494205-1c7f1c06ab96.json');
    console.log(`[Google Calendar] Trying default credential path: ${defaultLocalPath}`);
    if (fs.existsSync(defaultLocalPath)) {
      keyFilePath = defaultLocalPath;
    } else {
      console.warn(`[Google Calendar] Default credential file NOT found at: ${defaultLocalPath}`);
    }
  }

  if (keyFilePath) {
    console.log(`[Google Calendar] Authenticating locally using credential JSON: ${keyFilePath}`);
    
    if (impersonatedEmail && impersonatedEmail !== 'contact@legacyglobalbank.com') {
      try {
        console.log(`[Google Calendar] Using Domain-Wide Delegation to impersonate: ${impersonatedEmail}`);
        const keyData = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
        return new google.auth.JWT(
          keyData.client_email,
          null,
          keyData.private_key,
          scopes,
          impersonatedEmail
        );
      } catch (err) {
        console.warn('[Google Calendar] Failed to parse JSON key file for impersonation, falling back to standard GoogleAuth:', err.message);
      }
    }

    return new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes
    });
  }

  console.log('[Google Calendar] No local credential key file found. Using GCP Application Default Credentials (ADC)...');
  return new google.auth.GoogleAuth({
    scopes
  });
}

/**
 * Connects to Google Calendar API and creates a real Google Meet event
 */
async function createGoogleMeetEvent(request) {
  try {
    let calendar;
    const isOAuth2Configured = process.env.GOOGLE_REFRESH_TOKEN && 
                               process.env.GOOGLE_REFRESH_TOKEN !== 'your-google-refresh-token' &&
                               process.env.GOOGLE_CLIENT_ID && 
                               process.env.GOOGLE_CLIENT_ID !== 'your-google-client-id' &&
                               process.env.GOOGLE_CLIENT_SECRET &&
                               process.env.GOOGLE_CLIENT_SECRET !== 'your-google-client-secret';

    if (isOAuth2Configured) {
      console.log('[Google Calendar] Authenticating using OAuth2 Refresh Token...');
      console.log(`[Google Calendar] Using Client ID: ${process.env.GOOGLE_CLIENT_ID?.substring(0, 20)}...`);
      console.log(`[Google Calendar] Refresh token present: ${!!process.env.GOOGLE_REFRESH_TOKEN}, length: ${process.env.GOOGLE_REFRESH_TOKEN?.length}`);
      calendar = await getCalendarClient();
    } else {
      console.log('[Google Calendar] OAuth2 not configured. Falling back to Service Account auth...');
      const auth = getGoogleAuthClient();
      calendar = google.calendar({ version: 'v3', auth });
    }

    const start24h = convertTo24Hour(request.meeting_time);
    const end24h = addMinutesToTime(start24h, 30);

    const startDateTime = `${request.meeting_date}T${start24h}:00`;
    const endDateTime = `${request.meeting_date}T${end24h}:00`;
    const timeZone = process.env.MEETING_TIMEZONE || 'Asia/Kolkata';

    console.log(`[Google Calendar] Scheduling event for visitor: ${request.email} from ${startDateTime} to ${endDateTime}...`);

    const hostEmail = process.env.GOOGLE_IMPERSONATED_EMAIL || 'contact@legacyglobalbank.com';
    const allocatedHostEmail = request.calendar_id ? request.calendar_id.replace(/^["']|["']$/g, '').trim() : null;

    const attendees = [
      { email: hostEmail, responseStatus: 'accepted' },
      { email: request.email }
    ];

    if (allocatedHostEmail && allocatedHostEmail !== hostEmail && allocatedHostEmail !== request.email) {
      attendees.push({ email: allocatedHostEmail });
    }

    const event = {
      summary: `Legacy Global Bank Consultation - ${request.name}`,
      description: `Visitor Pass ID: ${request.id}\nMeeting Type: Online Video Sync\nAuthorized securely by administrator.`,
      start: {
        dateTime: startDateTime,
        timeZone: timeZone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: timeZone,
      },
      attendees: attendees,
      conferenceData: {
        createRequest: {
          requestId: `meet_${request.id}_${Date.now()}`,
          conferenceSolutionKey: {
            type: 'hangoutsMeet'
          }
        }
      }
    };

    let response;
    try {
      response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all'
      });
    } catch (insertErr) {
      if (insertErr.message?.includes('invite attendees') || insertErr.message?.includes('delegation')) {
        console.warn('[Google Calendar] Service account has no domain-wide delegation. Retrying event creation WITHOUT attendees...');
        const eventNoAttendees = { ...event };
        delete eventNoAttendees.attendees;
        response = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: eventNoAttendees,
          conferenceDataVersion: 1
        });
      } else {
        throw insertErr;
      }
    }

    const meetUrl = response.data.hangoutLink || response.data.conferenceData?.entryPoints?.[0]?.uri;
    
    if (meetUrl) {
      console.log(`[Google Calendar] Real Google Meet URL generated successfully: ${meetUrl}`);
      return {
        meetingUrl: meetUrl,
        calendarEventId: response.data.id,
        calendarId: response.data.organizer?.email || 'primary'
      };
    } else {
      console.warn('[Google Calendar] Event created, but Google Meet link was not returned by API.');
      return null;
    }
  } catch (err) {
    console.error('[Google Calendar] Error creating meeting event:', err.message);
    return null;
  }
}

// Export functions
module.exports.createGoogleMeetEvent = createGoogleMeetEvent;
