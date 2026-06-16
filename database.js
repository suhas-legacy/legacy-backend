const { Pool } = require('pg');
require('dotenv').config();

// Postgres Connection Pool Configuration
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'crm',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
};

class DatabaseService {
  constructor() {
    this.pool = null;
  }

  // Initialize database pool and create schema & tables
  async init() {
    console.log('Initializing PostgreSQL Database connection...');
    this.pool = new Pool(poolConfig);

    // Verify connection
    try {
      const client = await this.pool.connect();
      console.log('Connected to PostgreSQL database successfully');
      client.release();
      
      // Setup tables
      await this.createTables();
    } catch (err) {
      console.error('Error connecting to PostgreSQL database:', err.message);
      throw err;
    }
  }

  // Create necessary schema and tables
  async createTables() {
    try {
      // 1. Create schema if not exists
      await this.pool.query('CREATE SCHEMA IF NOT EXISTS legacy_website');

      // 2. Create email_tracking table
      const createEmailTrackingTable = `
        CREATE TABLE IF NOT EXISTS legacy_website.email_tracking (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          session_id TEXT,
          user_id TEXT,
          ip_address TEXT,
          country TEXT,
          city TEXT,
          device_type TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          email_type TEXT NOT NULL,
          UNIQUE(email, email_type, timestamp)
        )
      `;

      // 3. Create contact_submissions table
      const createContactSubmissionsTable = `
        CREATE TABLE IF NOT EXISTS legacy_website.contact_submissions (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT,
          city TEXT,
          message TEXT NOT NULL,
          account TEXT,
          priority TEXT DEFAULT 'medium',
          connect TEXT DEFAULT 'Sales Support',
          ip_address TEXT,
          user_agent TEXT,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(email, message, timestamp)
        )
      `;

      // 4. Create visitor_requests table
      const createVisitorRequestsTable = `
        CREATE TABLE IF NOT EXISTS legacy_website.visitor_requests (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          email TEXT NOT NULL,
          meeting_type TEXT NOT NULL,
          meeting_date TEXT,
          formatted_date TEXT,
          meeting_time TEXT,
          status TEXT DEFAULT 'PENDING_APPROVAL',
          meeting_url TEXT,
          calendar_event_id TEXT,
          calendar_id TEXT,
          confirmed_at TIMESTAMP,
          approved_by TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      // 5. Create used_tokens table
      const createUsedTokensTable = `
        CREATE TABLE IF NOT EXISTS legacy_website.used_tokens (
          token TEXT PRIMARY KEY,
          used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;

      await this.pool.query(createEmailTrackingTable);
      await this.pool.query(createContactSubmissionsTable);
      await this.pool.query(createVisitorRequestsTable);
      await this.pool.query(createUsedTokensTable);
      
      console.log('Database tables created/verified successfully under legacy_website schema');
    } catch (err) {
      console.error('Error creating database tables:', err);
      throw err;
    }
  }

  // Check if email was already sent recently (within last 24 hours)
  async wasEmailSentRecently(email, emailType, hours = 24) {
    const query = `
      SELECT COUNT(*) as count 
      FROM legacy_website.email_tracking 
      WHERE email = $1 AND email_type = $2 AND timestamp > NOW() - ($3 * INTERVAL '1 hour')
    `;
    const res = await this.pool.query(query, [email, emailType, hours]);
    return parseInt(res.rows[0].count, 10) > 0;
  }

  // Check if contact submission already exists
  async wasContactSubmitted(email, message, hours = 1) {
    const query = `
      SELECT COUNT(*) as count 
      FROM legacy_website.contact_submissions 
      WHERE email = $1 AND message = $2 AND timestamp > NOW() - ($3 * INTERVAL '1 hour')
    `;
    const res = await this.pool.query(query, [email, message, hours]);
    return parseInt(res.rows[0].count, 10) > 0;
  }

  // Record email tracking
  async recordEmailSent(email, emailType, metadata = {}) {
    const query = `
      INSERT INTO legacy_website.email_tracking (
        email, session_id, user_id, ip_address, country, city, device_type, email_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    
    const params = [
      email,
      metadata.session_id || null,
      metadata.user_id || null,
      metadata.ip_address || null,
      metadata.country || null,
      metadata.city || null,
      metadata.device_type || null,
      emailType
    ];
    
    const res = await this.pool.query(query, params);
    return { id: res.rows[0].id, success: true };
  }

  // Record contact submission
  async recordContactSubmission(data) {
    const query = `
      INSERT INTO legacy_website.contact_submissions (
        name, email, phone, city, message, account, priority, connect, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;
    
    const params = [
      data.name,
      data.email,
      data.phone || null,
      data.city || null,
      data.message,
      data.account || null,
      data.priority || 'medium',
      data.connect || 'Sales Support',
      data.ip_address || null,
      data.user_agent || null
    ];
    
    const res = await this.pool.query(query, params);
    return { id: res.rows[0].id, success: true };
  }

  // Get email statistics
  async getEmailStats(days = 30) {
    const query = `
      SELECT 
        email_type,
        COUNT(*) as total_emails,
        COUNT(DISTINCT email) as unique_emails,
        (timestamp::date)::text as date
      FROM legacy_website.email_tracking 
      WHERE timestamp >= NOW() - ($1 * INTERVAL '1 day')
      GROUP BY email_type, timestamp::date
      ORDER BY date DESC
    `;
    
    const res = await this.pool.query(query, [days]);
    return res.rows;
  }

  // Get contact submission statistics
  async getContactStats(days = 30) {
    const query = `
      SELECT 
        COUNT(*) as total_submissions,
        COUNT(DISTINCT email) as unique_emails,
        priority,
        (timestamp::date)::text as date
      FROM legacy_website.contact_submissions 
      WHERE timestamp >= NOW() - ($1 * INTERVAL '1 day')
      GROUP BY priority, timestamp::date
      ORDER BY date DESC
    `;
    
    const res = await this.pool.query(query, [days]);
    return res.rows;
  }

  // Create a new visitor request
  async createVisitorRequest(data) {
    const query = `
      INSERT INTO legacy_website.visitor_requests (
        id, name, phone, email, meeting_type, meeting_date, formatted_date, meeting_time, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    
    const params = [
      data.id,
      data.name,
      data.phone,
      data.email,
      data.meeting_type,
      data.meeting_date || null,
      data.formatted_date || null,
      data.meeting_time || null,
      data.status || 'PENDING_APPROVAL'
    ];
    
    await this.pool.query(query, params);
    return { id: data.id, success: true };
  }

  // Get visitor request by id
  async getVisitorRequestById(id) {
    const query = `SELECT * FROM legacy_website.visitor_requests WHERE id = $1`;
    const res = await this.pool.query(query, [id]);
    return res.rows[0] || null;
  }

  // Get all visitor requests
  async getAllVisitorRequests() {
    const query = `SELECT * FROM legacy_website.visitor_requests ORDER BY created_at DESC`;
    const res = await this.pool.query(query);
    return res.rows;
  }

  // Get paginated + filtered visitor requests
  async getVisitorRequestsPaginated({ search = '', status = '', meetingType = '', page = 1, pageSize = 20 } = {}) {
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR id ILIKE $${idx})`);
    }
    if (status && status !== 'ALL') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (meetingType && meetingType !== 'ALL') {
      params.push(meetingType);
      conditions.push(`meeting_type = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count (for pagination metadata)
    const countQuery = `SELECT COUNT(*) FROM legacy_website.visitor_requests ${where}`;
    const countRes = await this.pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    // Paginated data
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);
    const dataQuery = `SELECT * FROM legacy_website.visitor_requests ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const dataRes = await this.pool.query(dataQuery, params);

    return { rows: dataRes.rows, total };
  }

  // Update visitor request
  async updateVisitorRequest(id, updates) {
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return { success: true };
    }
    
    const setClause = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
    const query = `UPDATE legacy_website.visitor_requests SET ${setClause} WHERE id = $${keys.length + 1}`;
    const params = [...keys.map(k => updates[k]), id];
    
    const res = await this.pool.query(query, params);
    return { success: true, changes: res.rowCount };
  }

  // Check if JWT token has been used
  async isTokenUsed(token) {
    const query = `SELECT COUNT(*) as count FROM legacy_website.used_tokens WHERE token = $1`;
    const res = await this.pool.query(query, [token]);
    return parseInt(res.rows[0].count, 10) > 0;
  }

  // Mark JWT token as used
  async markTokenAsUsed(token) {
    const query = `INSERT INTO legacy_website.used_tokens (token) VALUES ($1)`;
    await this.pool.query(query, [token]);
    return { success: true };
  }

  // Close database pool connection
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('PostgreSQL database pool closed');
    }
  }
}

// Create singleton instance
const dbService = new DatabaseService();

module.exports = dbService;
