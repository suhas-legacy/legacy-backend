'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { scheduleController } = require('../controllers/scheduleController');

const router = express.Router();

// ── Rate limiter: max 5 scheduling requests per IP per 15 minutes ─────────────
const scheduleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many meeting requests from this IP. Please try again in 15 minutes.',
  },
});

// POST /api/schedule
router.post('/', scheduleLimiter, scheduleController);

module.exports = router;
