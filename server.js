const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sendNotificationEmail, sendAutoReplyEmail } = require('./emailService');
const { handleTracking, getClientIp } = require('./trackingService');
const dbService = require('./database');
const { getEmailStats } = require('./api-stats');

dbService.init();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://legacy-website-popup-151726525663.asia-south1.run.app',
    'http://localhost:3000',
    'http://legacyglobalbank.com'
  ],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Email statistics endpoint
app.get('/api/stats', getEmailStats);

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