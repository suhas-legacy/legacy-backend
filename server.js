const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sendNotificationEmail, sendAutoReplyEmail } = require('./emailService');
const { handleTracking, getClientIp } = require('./trackingService');
const dbService = require('./database');
const { getEmailStats } = require('./api-stats');

dbService.init().catch(err => {
  console.error('[DATABASE] Failed to initialize database connection on startup:', err);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const ALLOWED_ORIGIN_PATTERNS = [
  // Any Cloud Run service under this GCP project (any region)
  /^https:\/\/[\w-]+-151726525663\.[a-z0-9-]+\.run\.app$/,
  // Production domains (with and without www)
  /^https?:\/\/(www\.)?legacyglobalbank\.com$/,
  // Local development (any port)
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

app.use(cors({
  origin: (incomingOrigin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman, etc.)
    if (!incomingOrigin) return callback(null, true);
    const allowed = ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(incomingOrigin));
    if (allowed) {
      callback(null, incomingOrigin);   // reflect the exact origin
    } else {
      console.warn(`[CORS] Blocked origin: ${incomingOrigin}`);
      callback(null, false);            // don't throw — just omit CORS headers
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── SSE: Server-Sent Events for real-time push ──────────────────────────────
// Keeps a Set of active SSE response objects (one per connected admin tab).
const sseClients = new Set();

/**
 * Broadcasts a lightweight "data changed" event to all connected SSE clients.
 * The frontend re-fetches only when it receives this signal.
 */
function broadcastUpdate(type = 'update') {
  const payload = `data: ${JSON.stringify({ type, ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Email statistics endpoint
app.get('/api/stats', getEmailStats);

// Admin Login authentication endpoint
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@legacyglobalbank.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (email.toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
    // Generate a simple secure session token
    const sessionToken = `session_${Buffer.from(email + Date.now()).toString('base64url').substring(0, 24)}`;
    return res.json({
      success: true,
      token: sessionToken,
      email: adminEmail,
      message: 'Login successful'
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid email or password'
  });
});

// SSE endpoint — admin dashboard subscribes here for real-time push updates
app.get('/api/visitor/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders();

  // Send initial heartbeat so the browser knows the connection is alive
  res.write(': connected\n\n');

  // Keep-alive ping every 25 s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(keepAlive); }
  }, 25000);

  sseClients.add(res);

  // Clean up when the client disconnects
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Contact form submission endpoint
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, city, priority, connect, message } = req.body;

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required fields'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check for duplicate submissions (within last 1 hour)
    const isDuplicate = await dbService.wasContactSubmitted(email, message, 1);
    if (isDuplicate) {
      return res.status(429).json({
        success: false,
        message: 'You have already submitted this message recently. Please wait before submitting again.'
      });
    }

    // Record submission in database first
    await dbService.recordContactSubmission({
      name,
      email,
      phone: phone || '',
      city: city || '',
      message,
      account: 'Contact Form',
      priority: priority || 'medium',
      connect: connect || 'Sales Support',
      ip_address: req.ip || getClientIp(req),
      user_agent: req.headers['user-agent']
    });

    // Send notification email to admin
    await sendNotificationEmail({
      name,
      email,
      phone: phone || '',
      city: city || '',
      priority: priority || 'medium',
      connect: connect || 'Sales Support',
      message
    });

    // Send auto-reply to user
    await sendAutoReplyEmail({
      name,
      email,
      message
    });

    res.status(200).json({
      success: true,
      message: 'Your message has been sent successfully. We will get back to you soon!'
    });

  } catch (error) {
    console.error('Error processing contact form:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while sending your message. Please try again later.'
    });
  }
});

// Cookie consent & user data tracking endpoint
app.post('/api/track', handleTracking);

// Google Calendar Schedule Route
const scheduleRouter = require('./src/routes/schedule');
app.use('/api/schedule', scheduleRouter);

// ==========================================
// VISITOR PASS SYSTEM ENDPOINTS
// ==========================================

const visitorService = require('./visitorService');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// 0. GET Slot Availability (public — used by visitor form to block booked slots in real-time)
// Query: ?date=YYYY-MM-DD (optional, returns all future Fridays if omitted)
app.get('/api/visitor/slots', async (req, res) => {
  try {
    const calendarEmails = (process.env.MEETING_CALENDAR_EMAILS || 'meeting1@company.com,meeting2@company.com,meeting3@company.com')
      .split(',')
      .map(e => e.trim().replace(/^["']|["']$/g, ''));
    const capacity = calendarEmails.length; // max bookings per slot

    const timeSlots = [
      '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
      '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM',
      '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM',
      '4:00 PM', '4:30 PM'
    ];

    // Query all CONFIRMED online meetings from today onward, grouped by date+time
    const query = `
      SELECT meeting_date, meeting_time, COUNT(*) as booked_count
      FROM legacy_website.visitor_requests
      WHERE meeting_type = 'online'
        AND status = 'CONFIRMED'
        AND meeting_date >= CURRENT_DATE::text
      GROUP BY meeting_date, meeting_time
    `;
    const result = await dbService.pool.query(query);

    // Build a map: { "YYYY-MM-DD": { "1:00 PM": 2, "2:00 PM": 1, ... } }
    const bookingMap = {};
    for (const row of result.rows) {
      if (!bookingMap[row.meeting_date]) bookingMap[row.meeting_date] = {};
      bookingMap[row.meeting_date][row.meeting_time] = parseInt(row.booked_count, 10);
    }

    // Build response: per-date slot status
    // { date: "YYYY-MM-DD", slots: { "1:00 PM": { booked: 2, full: true }, ... }, dateFull: true }
    const dateStatuses = {};
    for (const [date, slots] of Object.entries(bookingMap)) {
      const slotStatus = {};
      let allFull = true;

      for (const slot of timeSlots) {
        const booked = slots[slot] || 0;
        const full = booked >= capacity;
        slotStatus[slot] = { booked, capacity, full };
        if (!full) allFull = false;
      }

      dateStatuses[date] = { slots: slotStatus, dateFull: allFull };
    }

    res.json({
      success: true,
      capacity,
      timeSlots,
      dates: dateStatuses  // only dates that have at least 1 booking
    });

  } catch (error) {
    console.error('Error fetching slot availability:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch slot availability' });
  }
});

// 1. Submit Request (Visitor side)
app.post('/api/visitor/request', async (req, res) => {
  try {
    const { 
      name, email, phone, meetingType, date, formattedDate, time,
      purposeOfVisit, referenceEmployee, preferredBranch, personToMeet, existingClient, tradingAccountId, additionalNotes
    } = req.body;

    if (!name || !email || !phone || !meetingType) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, phone, and meetingType are required fields'
      });
    }

    if (meetingType === 'online' && (!date || !time)) {
      return res.status(400).json({
        success: false,
        message: 'Meeting date and time slot are required for online meetings'
      });
    }

    if (!purposeOfVisit || !preferredBranch || !existingClient) {
      return res.status(400).json({
        success: false,
        message: 'Purpose of visit, preferred branch, and client status are required'
      });
    }

    if (existingClient === 'Yes' && !tradingAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Trading Account ID is required for existing clients'
      });
    }

    // Generate VIS-XXXX Request ID
    const allRequests = await dbService.getAllVisitorRequests();
    const nextIdNumber = allRequests.length > 0 
      ? Math.max(...allRequests.map(r => parseInt(r.id.split('-')[1]) || 0)) + 1 
      : 1001;
    const requestId = `VIS-${nextIdNumber}`;

    const newRequest = {
      id: requestId,
      name,
      phone,
      email,
      meeting_type: meetingType,
      meeting_date: meetingType === 'online' ? date : '',
      formatted_date: meetingType === 'online' ? formattedDate : 'N/A',
      meeting_time: meetingType === 'online' ? time : 'N/A',
      status: 'PENDING_APPROVAL',
      purpose_of_visit: purposeOfVisit,
      reference_employee: referenceEmployee || '',
      preferred_branch: preferredBranch,
      person_to_meet: personToMeet || '',
      existing_client: existingClient,
      trading_account_id: existingClient === 'Yes' ? tradingAccountId : '',
      additional_notes: additionalNotes || ''
    };

    // Store in SQLite/PostgreSQL
    await dbService.createVisitorRequest(newRequest);

    // Notify connected admin dashboards immediately
    broadcastUpdate('new_request');

    // Send notification email to admin team containing secure JWT tokens
    await visitorService.sendAdminRequestEmail(newRequest);

    // Generate checkin token for the client
    const checkinToken = visitorService.signToken({
      id: requestId,
      action: 'checkin',
      email: 'gate@legacyglobalbank.com',
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    });

    res.status(201).json({
      success: true,
      requestId: requestId,
      checkinToken: checkinToken,
      message: 'Visitor request registered successfully. Awaiting administrator approval.'
    });

  } catch (error) {
    console.error('Error recording visitor request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record visitor request'
    });
  }
});

// 2. Fetch All Requests (Admin Dashboard side)
app.get('/api/visitor/requests', async (req, res) => {
  try {
    // Parse query params — all optional; defaults match "show everything"
    const search    = (req.query.search    || '').trim();
    const status    = (req.query.status    || 'ALL').trim().toUpperCase();
    const meetingType = (req.query.type    || 'ALL').trim().toLowerCase();
    const page      = Math.max(1, parseInt(req.query.page     || '1',  10));
    const pageSize  = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));

    // Fetch from DB with filters + pagination applied at SQL level
    const { rows, total } = await dbService.getVisitorRequestsPaginated({
      search,
      status:      status      === 'ALL' ? '' : status,
      meetingType: meetingType === 'all' ? '' : meetingType,
      page,
      pageSize
    });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    
    // Map SQLite snake_case schema to camelCase matching frontend keys
    const mapped = rows.map(r => {
      const history = [
        { status: 'PENDING_APPROVAL', timestamp: r.created_at, note: 'Request submitted by visitor.' }
      ];
      
      if (r.status === 'REJECTED') {
        history.push({ status: 'REJECTED', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Request declined by administrator.' });
      } else if (r.status === 'APPROVED') {
        history.push({ status: 'APPROVED', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Offline meeting request approved.' });
      } else if (r.status === 'CONFIRMED') {
        history.push({ status: 'CONFIRMED', timestamp: r.confirmed_at || new Date().toISOString(), note: `Online meeting confirmed. Assigned to ${r.calendar_id || 'host'}.` });
      } else if (r.status === 'WAITING_RESCHEDULE') {
        history.push({ status: 'WAITING_RESCHEDULE', timestamp: new Date().toISOString(), note: 'No free calendar slot found. Admin reschedule needed.' });
      } else if (r.status === 'CANCELLED') {
        history.push({ status: 'CANCELLED', timestamp: new Date().toISOString(), note: 'Meeting event cancelled.' });
      } else if (r.status === 'COMPLETED') {
        history.push({ status: 'COMPLETED', timestamp: new Date().toISOString(), note: 'Meeting completed successfully.' });
      } else if (r.status === 'CHECKED_IN') {
        history.push({ status: 'CHECKED_IN', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Visitor checked in at branch office.' });
      }
    
      const approveToken = visitorService.signToken({ 
        id: r.id, 
        action: 'approve', 
        email: 'admin@legacyglobalbank.com', 
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 
      });
      const rejectToken = visitorService.signToken({ 
        id: r.id, 
        action: 'reject', 
        email: 'admin@legacyglobalbank.com', 
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 
      });

      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        meetingType: r.meeting_type,
        date: r.meeting_date,
        formattedDate: r.formatted_date,
        time: r.meeting_time,
        status: r.status,
        meetingUrl: r.meeting_url || '',
        calendarEventId: r.calendar_event_id || '',
        calendarId: r.calendar_id || '',
        confirmedAt: r.confirmed_at || '',
        approvedBy: r.approved_by || '',
        createdAt: r.created_at,
        approveToken,
        rejectToken,
        history,
        purposeOfVisit: r.purpose_of_visit || '',
        referenceEmployee: r.reference_employee || '',
        preferredBranch: r.preferred_branch || '',
        personToMeet: r.person_to_meet || '',
        existingClient: r.existing_client || '',
        tradingAccountId: r.trading_account_id || '',
        additionalNotes: r.additional_notes || ''
      };
    });

    res.json({
      success: true,
      requests: mapped,
      total,
      page,
      pageSize,
      totalPages
    });
  } catch (error) {
    console.error('Error fetching visitor requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve visitor requests'
    });
  }
});

// 2a. Fetch Single Request details (Frontend details sync side)
app.get('/api/visitor/request/:id', async (req, res) => {
  try {
    const r = await dbService.getVisitorRequestById(req.params.id);
    if (!r) {
      return res.status(404).json({
        success: false,
        message: 'Visitor request not found'
      });
    }

    const history = [
      { status: 'PENDING_APPROVAL', timestamp: r.created_at, note: 'Request submitted by visitor.' }
    ];
    
    if (r.status === 'REJECTED') {
      history.push({ status: 'REJECTED', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Request declined by administrator.' });
    } else if (r.status === 'APPROVED') {
      history.push({ status: 'APPROVED', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Offline meeting request approved.' });
    } else if (r.status === 'CONFIRMED') {
      history.push({ status: 'CONFIRMED', timestamp: r.confirmed_at || new Date().toISOString(), note: `Online meeting confirmed. Assigned to ${r.calendar_id || 'host'}.` });
    } else if (r.status === 'WAITING_RESCHEDULE') {
      history.push({ status: 'WAITING_RESCHEDULE', timestamp: new Date().toISOString(), note: 'No free calendar slot found. Admin reschedule needed.' });
    } else if (r.status === 'CANCELLED') {
      history.push({ status: 'CANCELLED', timestamp: new Date().toISOString(), note: 'Meeting event cancelled.' });
    } else if (r.status === 'COMPLETED') {
      history.push({ status: 'COMPLETED', timestamp: new Date().toISOString(), note: 'Meeting completed successfully.' });
    } else if (r.status === 'CHECKED_IN') {
      history.push({ status: 'CHECKED_IN', timestamp: r.confirmed_at || new Date().toISOString(), note: 'Visitor checked in at branch office.' });
    }

    const approveToken = visitorService.signToken({
      id: r.id,
      action: 'approve',
      email: 'admin@legacyglobalbank.com',
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
    });
    const rejectToken = visitorService.signToken({
      id: r.id,
      action: 'reject',
      email: 'admin@legacyglobalbank.com',
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
    });

    const checkinToken = visitorService.signToken({
      id: r.id,
      action: 'checkin',
      email: 'gate@legacyglobalbank.com',
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    });

    res.json({
      success: true,
      request: {
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        meetingType: r.meeting_type,
        date: r.meeting_date,
        formattedDate: r.formatted_date,
        time: r.meeting_time,
        status: r.status,
        meetingUrl: r.meeting_url || '',
        calendarEventId: r.calendar_event_id || '',
        calendarId: r.calendar_id || '',
        confirmedAt: r.confirmed_at || '',
        approvedBy: r.approved_by || '',
        createdAt: r.created_at,
        approveToken,
        rejectToken,
        checkinToken,
        history,
        purposeOfVisit: r.purpose_of_visit || '',
        referenceEmployee: r.reference_employee || '',
        preferredBranch: r.preferred_branch || '',
        personToMeet: r.person_to_meet || '',
        existingClient: r.existing_client || '',
        tradingAccountId: r.trading_account_id || '',
        additionalNotes: r.additional_notes || ''
      }
    });
  } catch (error) {
    console.error('Error fetching visitor request details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve visitor request details'
    });
  }
});

// 3. GET Callback: Approve via signed JWT link
app.get('/api/visitor/approve', async (req, res) => {
  const { id, token } = req.query;
  const isAjax = req.query.ajax === 'true' || req.query.redirect === 'false';

  if (!id || !token) {
    if (isAjax) return res.status(400).json({ success: false, error: 'missing_params' });
    return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id || ''}&token=${token || ''}&error=missing_params`);
  }

  try {
    // 1. Verify token
    const decoded = visitorService.verifyToken(token);
    if (!decoded || decoded.id !== id || decoded.action !== 'approve') {
      if (isAjax) return res.status(400).json({ success: false, error: 'invalid_token' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=invalid_token`);
    }

    // 2. Validate single-use constraint (Replay attack blocker)
    const isUsed = await dbService.isTokenUsed(token);
    if (isUsed) {
      if (isAjax) return res.status(400).json({ success: false, error: 'already_used' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=already_used`);
    }

    // Mark token as used
    await dbService.markTokenAsUsed(token);

    // Fetch visitor request
    const request = await dbService.getVisitorRequestById(id);
    if (!request) {
      if (isAjax) return res.status(404).json({ success: false, error: 'not_found' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=not_found`);
    }

    if (request.status !== 'PENDING_APPROVAL') {
      if (isAjax) return res.status(400).json({ success: false, error: 'processed' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=processed`);
    }

    // 3. Process Approval
    if (request.meeting_type === 'offline') {
      // Offline direct approval with optional visiting time
      const date = req.query.date || '';
      const time = req.query.time || '';
      const formattedDate = req.query.formattedDate || 'N/A';

      const updates = { 
        status: 'APPROVED',
        confirmed_at: new Date().toISOString(),
        approved_by: decoded.email
      };

      if (date && time) {
        updates.meeting_date = date;
        updates.meeting_time = time;
        updates.formatted_date = formattedDate;

        // Build active request context
        const activeRequest = {
          ...request,
          meeting_date: date,
          meeting_time: time,
          formatted_date: formattedDate
        };

        const calDetails = await visitorService.createOfflineCalendarEvent(activeRequest);
        if (calDetails) {
          updates.calendar_event_id = calDetails.calendarEventId;
          updates.calendar_id = calDetails.calendarId;
        }
      }

      await dbService.updateVisitorRequest(id, updates);

      // Fetch fresh record to send email
      const updated = await dbService.getVisitorRequestById(id);
      await visitorService.sendVisitorConfirmationEmail(updated, 'offline_approval');

    } else {
      // Online meeting: check calendar sync
      const check = await visitorService.checkCalendarAvailability(request.meeting_date, request.meeting_time, request.formatted_date);
      
      if (check.available) {
        // Build active request options, updating times if rescheduled
        const activeRequest = {
          ...request,
          meeting_date: check.rescheduled ? check.date : request.meeting_date,
          meeting_time: check.rescheduled ? check.time : request.meeting_time,
          calendar_id: check.calendarId
        };

        // Create Google Calendar event with Meet link
        const googleMeetDetails = await visitorService.createGoogleMeetEvent(activeRequest);

        const updates = {
          status: 'CONFIRMED',
          meeting_url: googleMeetDetails ? googleMeetDetails.meetingUrl : `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`,
          calendar_event_id: googleMeetDetails ? googleMeetDetails.calendarEventId : `evt_${Math.random().toString(36).substring(2, 12)}`,
          calendar_id: check.calendarId ? check.calendarId.replace(/^["']|["']$/g, '').trim() : 'primary',
          confirmed_at: new Date().toISOString(),
          approved_by: decoded.email
        };

        if (check.rescheduled) {
          updates.meeting_date = check.date;
          updates.meeting_time = check.time;
          updates.formatted_date = check.formattedDate;
        }

        await dbService.updateVisitorRequest(id, updates);

        const updated = await dbService.getVisitorRequestById(id);
        await visitorService.sendVisitorConfirmationEmail(updated, check.rescheduled ? 'alternative_slot' : 'online_confirmed');
      } else {
        // No slots available
        await dbService.updateVisitorRequest(id, {
          status: 'WAITING_RESCHEDULE'
        });

        const updated = await dbService.getVisitorRequestById(id);
        await visitorService.sendAdminWarningEmail(updated);
      }
    }

    // Success response
    broadcastUpdate('approved');
    if (isAjax) {
      return res.json({ success: true, message: 'Request approved successfully.' });
    }
    res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&status=success`);

  } catch (error) {
    console.error('API secure approval error:', error);
    if (isAjax) return res.status(500).json({ success: false, error: 'server_error' });
    res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=server_error`);
  }
});

// 4. GET Callback: Reject via signed JWT link
app.get('/api/visitor/reject', async (req, res) => {
  const { id, token } = req.query;
  const isAjax = req.query.ajax === 'true' || req.query.redirect === 'false';

  if (!id || !token) {
    if (isAjax) return res.status(400).json({ success: false, error: 'missing_params' });
    return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id || ''}&token=${token || ''}&error=missing_params`);
  }

  try {
    // Verify token
    const decoded = visitorService.verifyToken(token);
    if (!decoded || decoded.id !== id || decoded.action !== 'reject') {
      if (isAjax) return res.status(400).json({ success: false, error: 'invalid_token' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=invalid_token`);
    }

    // Single-use check
    const isUsed = await dbService.isTokenUsed(token);
    if (isUsed) {
      if (isAjax) return res.status(400).json({ success: false, error: 'already_used' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=already_used`);
    }

    await dbService.markTokenAsUsed(token);

    const request = await dbService.getVisitorRequestById(id);
    if (!request) {
      if (isAjax) return res.status(404).json({ success: false, error: 'not_found' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=not_found`);
    }

    if (request.status !== 'PENDING_APPROVAL') {
      if (isAjax) return res.status(400).json({ success: false, error: 'processed' });
      return res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=processed`);
    }

    // Reject record
    await dbService.updateVisitorRequest(id, {
      status: 'REJECTED',
      confirmed_at: new Date().toISOString(),
      approved_by: decoded.email
    });

    const updated = await dbService.getVisitorRequestById(id);
    await visitorService.sendVisitorConfirmationEmail(updated, 'rejection');

    broadcastUpdate('rejected');
    if (isAjax) {
      return res.json({ success: true, message: 'Request rejected successfully.' });
    }
    res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&status=success`);

  } catch (error) {
    console.error('API secure rejection error:', error);
    if (isAjax) return res.status(500).json({ success: false, error: 'server_error' });
    res.redirect(`${FRONTEND_URL}/visitor_form/api-mock?id=${id}&token=${token}&error=server_error`);
  }
});

// 5. Admin Manual Reschedule Slot
app.post('/api/visitor/reschedule', async (req, res) => {
  try {
    const { id, date, time, formattedDate } = req.body;

    if (!id || !date || !time) {
      return res.status(400).json({ success: false, message: 'ID, date, and time are required' });
    }

    const request = await dbService.getVisitorRequestById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Visitor request not found' });
    }

    const updates = {
      meeting_date: date,
      meeting_time: time,
      formatted_date: formattedDate || date,
      status: 'CONFIRMED'
    };

    // If online meeting, create/re-create Google Calendar event with Meet link
    if (request.meeting_type === 'online') {
      const updatedRequest = {
        ...request,
        meeting_date: date,
        meeting_time: time,
        calendar_id: request.calendar_id ? request.calendar_id.replace(/^["']|["']$/g, '').trim() : null
      };
      
      const googleMeetDetails = await visitorService.createGoogleMeetEvent(updatedRequest);

      updates.meeting_url = googleMeetDetails ? googleMeetDetails.meetingUrl : `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
      updates.calendar_event_id = googleMeetDetails ? googleMeetDetails.calendarEventId : `evt_${Math.random().toString(36).substring(2, 12)}`;
      updates.calendar_id = updatedRequest.calendar_id || (googleMeetDetails ? googleMeetDetails.calendarId : 'primary');
      updates.confirmed_at = new Date().toISOString();
      updates.approved_by = 'admin@legacyglobalbank.com';
    }

    await dbService.updateVisitorRequest(id, updates);

    const updated = await dbService.getVisitorRequestById(id);
    // Send rescheduled email alert to visitor
    await visitorService.sendVisitorConfirmationEmail(updated, 'alternative_slot');

    broadcastUpdate('rescheduled');
    res.json({ success: true, message: 'Visitor request rescheduled successfully' });

  } catch (error) {
    console.error('Error rescheduling request:', error);
    res.status(500).json({ success: false, message: 'Failed to reschedule visitor request' });
  }
});

// 6. Admin Cancel Meeting Event
app.post('/api/visitor/cancel', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

    const request = await dbService.getVisitorRequestById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Visitor request not found' });

    await dbService.updateVisitorRequest(id, { status: 'CANCELLED' });
    broadcastUpdate('cancelled');
    res.json({ success: true, message: 'Visitor meeting cancelled successfully' });

  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel visitor request' });
  }
});

// 7. Admin Archive/Complete Meeting
app.post('/api/visitor/complete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

    const request = await dbService.getVisitorRequestById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Visitor request not found' });

    await dbService.updateVisitorRequest(id, { status: 'COMPLETED' });
    broadcastUpdate('completed');
    res.json({ success: true, message: 'Visitor request marked as completed' });

  } catch (error) {
    console.error('Error completing request:', error);
    res.status(500).json({ success: false, message: 'Failed to complete visitor request' });
  }
});

// 8. Secure Visitor Pass Check-In (via QR code scan)
app.post('/api/visitor/checkin', async (req, res) => {
  try {
    const { id, token } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'Pass ID is required' });

    if (!token) {
      return res.status(400).json({ success: false, message: 'Authorization token is required to perform check-in.' });
    }

    const decoded = visitorService.verifyToken(token);
    if (!decoded || decoded.id !== id || decoded.action !== 'checkin') {
      return res.status(400).json({ success: false, message: 'Invalid or expired check-in authorization token.' });
    }

    const request = await dbService.getVisitorRequestById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Visitor pass not found.' });
    }

    let statusUpdate = 'CHECKED_IN';
    let updates = { status: statusUpdate, confirmed_at: new Date().toISOString() };

    if (request.status === 'PENDING_APPROVAL') {
      updates.approved_by = decoded.email || 'gate@legacyglobalbank.com';
    }

    await dbService.updateVisitorRequest(id, updates);
    broadcastUpdate('checked_in');

    res.json({
      success: true,
      message: request.status === 'PENDING_APPROVAL' 
        ? 'Visitor pass approved and checked in successfully.'
        : 'Visitor checked in successfully.'
    });

  } catch (error) {
    console.error('Error during visitor check-in:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred during check-in.' });
  }
});

// 8a. Admin Direct Check-In (without token, called from Admin Dashboard)
app.post('/api/visitor/checkin-direct', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, message: 'Pass ID is required' });

    const request = await dbService.getVisitorRequestById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Visitor pass not found.' });

    let statusUpdate = 'CHECKED_IN';
    let updates = { status: statusUpdate, confirmed_at: new Date().toISOString() };

    if (request.status === 'PENDING_APPROVAL') {
      updates.approved_by = 'admin@legacyglobalbank.com';
    }

    await dbService.updateVisitorRequest(id, updates);
    broadcastUpdate('checked_in');

    res.json({
      success: true,
      message: request.status === 'PENDING_APPROVAL' 
        ? 'Visitor pass approved and checked in successfully.'
        : 'Visitor checked in successfully.'
    });

  } catch (error) {
    console.error('Error during admin direct check-in:', error);
    res.status(500).json({ success: false, message: 'Failed to complete visitor check-in.' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/api/health`);
});
