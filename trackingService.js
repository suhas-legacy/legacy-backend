const nodemailer = require('nodemailer');
const dbService = require('./database');
require('dotenv').config();

// Rate limiting store (in-memory for simplicity, use Redis in production)
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10;

  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  
  let ip = 'unknown';
  
  if (forwardedFor) {
    ip = forwardedFor.split(',')[0].trim();
  } else if (realIp) {
    ip = realIp;
  } else if (cfConnectingIp) {
    ip = cfConnectingIp;
  } else {
    ip = req.ip || 'unknown';
  }
  
  // Handle IPv6 localhost addresses
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
    return '127.0.0.1'; // Normalize to IPv4 localhost
  }
  
  return ip;
}

async function getGeoLocation(ip) {
  if (ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return {
      country: 'Unknown',
      city: 'Local',
      region: 'Local',
      lat: 0,
      lon: 0,
      isp: 'Local',
      isVpn: false,
    };
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,region,lat,lon,isp,hosting,proxy,mobile`);
    const data = await response.json();

    if (data.status === 'success') {
      return {
        country: data.country,
        city: data.city,
        region: data.region,
        lat: data.lat,
        lon: data.lon,
        isp: data.isp,
        isVpn: data.hosting || data.proxy,
      };
    }
  } catch (error) {
    console.error('Geolocation error:', error);
  }

  return {
    country: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    lat: 0,
    lon: 0,
    isp: 'Unknown',
    isVpn: false,
  };
}

function sanitizeInput(data) {
  if (typeof data === 'string') {
    return data.replace(/[<>]/g, '');
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeInput);
  }
  if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const key in data) {
      sanitized[sanitizeInput(key)] = sanitizeInput(data[key]);
    }
    return sanitized;
  }
  return data;
}

function generateEmailHTML(data) {
  const {
    timestamp,
    ip_address,
    geo,
    device_type,
    session_id,
    user_id,
    is_returning_user,
    consent_choices,
    consent_decision_time_ms,
    time_on_page,
    scroll_depth_percent,
    click_count,
    form_interactions,
    page_url,
    referrer,
    utm_source,
    utm_medium,
    utm_campaign,
    browser_name,
    browser_version,
    os_name,
    os_version,
    screen_resolution,
    viewport_size,
    timezone,
    language,
    canvas_fingerprint,
    webgl_fingerprint,
    cookies,
  } = data;

  const vpnFlag = geo.isVpn ? '<span style="color: #ef4444; font-weight: bold;">⚠️ VPN/Proxy Detected</span>' : '<span style="color: #22c55e;">✓ Direct Connection</span>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: #f8fafc;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
    }
    .header p {
      margin: 8px 0 0 0;
      opacity: 0.9;
      font-size: 14px;
    }
    .section {
      padding: 20px;
      border-bottom: 1px solid #e5e7eb;
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title::before {
      content: '';
      width: 4px;
      height: 16px;
      background: #3b82f6;
      border-radius: 2px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
    }
    .field.full {
      grid-column: span 2;
    }
    .label {
      font-size: 12px;
      color: #6b7280;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .value {
      font-size: 14px;
      color: #1f2937;
      font-weight: 500;
      word-break: break-word;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success {
      background: #dcfce7;
      color: #166534;
    }
    .badge-warning {
      background: #fef3c7;
      color: #92400e;
    }
    .badge-danger {
      background: #fee2e2;
      color: #991b1b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    table th, table td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    table th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    table tr:last-child td {
      border-bottom: none;
    }
    details {
      margin-top: 12px;
    }
    summary {
      cursor: pointer;
      font-size: 13px;
      color: #3b82f6;
      font-weight: 500;
    }
    pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      margin: 8px 0 0 0;
    }
    .consent-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .consent-item:last-child {
      margin-bottom: 0;
    }
    @media (max-width: 600px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .field.full {
        grid-column: span 1;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 New Visitor Detected</h1>
      <p>${device_type.toUpperCase()} from ${geo.country} • ${new Date(timestamp).toLocaleString()}</p>
    </div>

    <div class="section">
      <h2 class="section-title">Identity</h2>
      <div class="grid">
        <div class="field">
          <span class="label">Session ID</span>
          <span class="value">${session_id}</span>
        </div>
        <div class="field">
          <span class="label">User ID</span>
          <span class="value">${user_id}</span>
        </div>
        <div class="field">
          <span class="label">Returning User</span>
          <span class="value">${is_returning_user ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-warning">No</span>'}</span>
        </div>
        <div class="field">
          <span class="label">Consent Decision Time</span>
          <span class="value">${consent_decision_time_ms ? `${consent_decision_time_ms}ms` : 'N/A'}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Location</h2>
      <div class="grid">
        <div class="field">
          <span class="label">IP Address</span>
          <span class="value">${ip_address}</span>
        </div>
        <div class="field">
          <span class="label">Country</span>
          <span class="value">${geo.country}</span>
        </div>
        <div class="field">
          <span class="label">City</span>
          <span class="value">${geo.city}</span>
        </div>
        <div class="field">
          <span class="label">Region</span>
          <span class="value">${geo.region}</span>
        </div>
        <div class="field">
          <span class="label">Coordinates</span>
          <span class="value">${geo.lat}, ${geo.lon}</span>
        </div>
        <div class="field">
          <span class="label">Connection Status</span>
          <span class="value">${vpnFlag}</span>
        </div>
        <div class="field full">
          <span class="label">ISP</span>
          <span class="value">${geo.isp}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Device & Browser</h2>
      <div class="grid">
        <div class="field">
          <span class="label">Device Type</span>
          <span class="value">${device_type.toUpperCase()}</span>
        </div>
        <div class="field">
          <span class="label">Browser</span>
          <span class="value">${browser_name} ${browser_version}</span>
        </div>
        <div class="field">
          <span class="label">OS</span>
          <span class="value">${os_name} ${os_version}</span>
        </div>
        <div class="field">
          <span class="label">Screen Resolution</span>
          <span class="value">${screen_resolution}</span>
        </div>
        <div class="field">
          <span class="label">Viewport Size</span>
          <span class="value">${viewport_size}</span>
        </div>
        <div class="field">
          <span class="label">Timezone</span>
          <span class="value">${timezone}</span>
        </div>
        <div class="field full">
          <span class="label">Language</span>
          <span class="value">${language}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Consent Status</h2>
      <div class="consent-item">
        <span class="value">Strictly Necessary</span>
        ${consent_choices.strictly_necessary ? '<span class="badge badge-success">✓ Enabled</span>' : '<span class="badge badge-danger">✗ Disabled</span>'}
      </div>
      <div class="consent-item">
        <span class="value">Analytics</span>
        ${consent_choices.analytics ? '<span class="badge badge-success">✓ Enabled</span>' : '<span class="badge badge-danger">✗ Disabled</span>'}
      </div>
      <div class="consent-item">
        <span class="value">Marketing</span>
        ${consent_choices.marketing ? '<span class="badge badge-success">✓ Enabled</span>' : '<span class="badge badge-danger">✗ Disabled</span>'}
      </div>
      <div class="consent-item">
        <span class="value">Personalization</span>
        ${consent_choices.personalization ? '<span class="badge badge-success">✓ Enabled</span>' : '<span class="badge badge-danger">✗ Disabled</span>'}
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Behavior</h2>
      <div class="grid">
        <div class="field">
          <span class="label">Time on Page</span>
          <span class="value">${Math.round(time_on_page / 1000)}s</span>
        </div>
        <div class="field">
          <span class="label">Scroll Depth</span>
          <span class="value">${scroll_depth_percent}%</span>
        </div>
        <div class="field">
          <span class="label">Click Count</span>
          <span class="value">${click_count}</span>
        </div>
        <div class="field">
          <span class="label">Form Interactions</span>
          <span class="value">${form_interactions.length > 0 ? form_interactions.join(', ') : 'None'}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Traffic Source</h2>
      <div class="grid">
        <div class="field full">
          <span class="label">Page URL</span>
          <span class="value"><a href="${page_url}" style="color: #3b82f6;">${page_url}</a></span>
        </div>
        <div class="field full">
          <span class="label">Referrer</span>
          <span class="value">${referrer || 'Direct'}</span>
        </div>
        <div class="field">
          <span class="label">UTM Source</span>
          <span class="value">${utm_source || 'N/A'}</span>
        </div>
        <div class="field">
          <span class="label">UTM Medium</span>
          <span class="value">${utm_medium || 'N/A'}</span>
        </div>
        <div class="field full">
          <span class="label">UTM Campaign</span>
          <span class="value">${utm_campaign || 'N/A'}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Fingerprints</h2>
      <div class="grid">
        <div class="field full">
          <span class="label">Canvas Fingerprint</span>
          <span class="value" style="font-family: monospace; font-size: 12px;">${canvas_fingerprint || 'N/A'}</span>
        </div>
        <div class="field full">
          <span class="label">WebGL Fingerprint</span>
          <span class="value" style="font-family: monospace; font-size: 12px;">${webgl_fingerprint || 'N/A'}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Cookies</h2>
      <table>
        <thead>
          <tr>
            <th>Cookie Name</th>
            <th>Value (truncated)</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(cookies).slice(0, 20).map(([key, value]) => `
            <tr>
              <td>${key}</td>
              <td>${value.length > 50 ? value.substring(0, 50) + '...' : value}</td>
            </tr>
          `).join('')}
          ${Object.keys(cookies).length > 20 ? `<tr><td colspan="2" style="text-align: center; color: #6b7280;">... and ${Object.keys(cookies).length - 20} more cookies</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2 class="section-title">Raw Payload</h2>
      <details>
        <summary>Click to view full JSON payload</summary>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  </div>
</body>
</html>
  `;
}

async function sendEmail(data) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_FROM;
  const email = data.user_id || data.ip_address || 'unknown@example.com';

  console.log(`[Tracking Service] Processing visitor: ${data.device_type?.toUpperCase() || 'Unknown'} from ${data.geo?.country || 'Unknown'}`);

  if (!adminEmail) {
    console.error('[Tracking Service] ADMIN_EMAIL or EMAIL_FROM environment variable is not set');
    return;
  }

  try {
    // Check if email was already sent recently for this visitor
    const wasSentRecently = await dbService.wasEmailSentRecently(email, 'visitor_tracking', 24);
    
    if (wasSentRecently) {
      console.log(`[Tracking Service] Email already sent recently for ${email}. Skipping duplicate.`);
      return;
    }

    // Create transporter using existing email configuration
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Send email
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: adminEmail,
      subject: `[New Visitor] ${data.device_type.toUpperCase()} from ${data.geo.country} — ${new Date(data.timestamp).toLocaleString()}`,
      html: generateEmailHTML(data),
    });

    // Record the email in database
    await dbService.recordEmailSent(email, 'visitor_tracking', {
      session_id: data.session_id,
      user_id: data.user_id,
      ip_address: data.ip_address,
      country: data.geo?.country,
      city: data.geo?.city,
      device_type: data.device_type
    });

    console.log(`[Tracking Service] Email sent and recorded successfully to: ${adminEmail}`);
  } catch (error) {
    console.error(`[Tracking Service] Failed to send email to ${adminEmail}:`, error);
  }
}

async function handleTracking(req, res) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please try again later.'
      });
    }

    // Parse and sanitize request body
    const rawData = req.body;
    
    // Validate request body
    if (!rawData || typeof rawData !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body'
      });
    }

    const data = sanitizeInput(rawData);

    // Ensure required fields exist
    if (!data.session_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: session_id'
      });
    }

    // Set default values for missing optional fields
    const normalizedData = {
      timestamp: data.timestamp || new Date().toISOString(),
      page_url: data.page_url || 'Unknown',
      referrer: data.referrer || '',
      utm_source: data.utm_source || '',
      utm_medium: data.utm_medium || '',
      utm_campaign: data.utm_campaign || '',
      user_agent: data.user_agent || req.headers['user-agent'] || 'Unknown',
      browser_name: data.browser_name || 'Unknown',
      browser_version: data.browser_version || 'Unknown',
      os_name: data.os_name || 'Unknown',
      os_version: data.os_version || 'Unknown',
      device_type: data.device_type || 'desktop',
      screen_resolution: data.screen_resolution || 'Unknown',
      viewport_size: data.viewport_size || 'Unknown',
      color_depth: data.color_depth || 'Unknown',
      timezone: data.timezone || 'Unknown',
      language: data.language || 'Unknown',
      languages: data.languages || [],
      cookies: data.cookies || {},
      localStorage_keys: data.localStorage_keys || [],
      sessionStorage_keys: data.sessionStorage_keys || [],
      connection_type: data.connection_type,
      battery_level: data.battery_level,
      battery_charging: data.battery_charging,
      canvas_fingerprint: data.canvas_fingerprint,
      webgl_fingerprint: data.webgl_fingerprint,
      fonts_detected: data.fonts_detected || [],
      plugins: data.plugins || [],
      do_not_track: data.do_not_track || false,
      session_id: data.session_id,
      user_id: data.user_id || 'Unknown',
      is_returning_user: data.is_returning_user || false,
      time_on_page: data.time_on_page || 0,
      scroll_depth_percent: data.scroll_depth_percent || 0,
      click_count: data.click_count || 0,
      form_interactions: data.form_interactions || [],
      consent_decision_time_ms: data.consent_decision_time_ms,
      consent_choices: data.consent_choices || {
        strictly_necessary: true,
        analytics: false,
        marketing: false,
        personalization: false,
      },
    };

    // Get IP geolocation
    const geo = await getGeoLocation(ip);

    // Enrich data with server-side information
    const enrichedData = {
      ...normalizedData,
      ip_address: ip,
      geo,
    };

    // Send email (non-blocking)
    sendEmail(enrichedData).catch(error => {
      console.error('Email sending failed:', error);
    });

    // Return success response with security headers
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });

    res.json({
      success: true,
      session_id: normalizedData.session_id,
    });
  } catch (error) {
    console.error('Tracking endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

module.exports = {
  handleTracking,
  checkRateLimit,
  getClientIp,
};
