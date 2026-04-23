const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database file path
const DB_PATH = path.join(__dirname, 'email_tracking.db');

class DatabaseService {
  constructor() {
    this.db = null;
  }

  // Initialize database connection and create tables
  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }
        console.log('Connected to SQLite database');
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  // Create necessary tables
  async createTables() {
    return new Promise((resolve, reject) => {
      const createEmailTrackingTable = `
        CREATE TABLE IF NOT EXISTS email_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          session_id TEXT,
          user_id TEXT,
          ip_address TEXT,
          country TEXT,
          city TEXT,
          device_type TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          email_type TEXT NOT NULL,
          UNIQUE(email, email_type, timestamp)
        )
      `;

      const createContactSubmissionsTable = `
        CREATE TABLE IF NOT EXISTS contact_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(email, message, timestamp)
        )
      `;

      this.db.run(createEmailTrackingTable, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.db.run(createContactSubmissionsTable, (err) => {
          if (err) {
            reject(err);
            return;
          }
          console.log('Database tables created successfully');
          resolve();
        });
      });
    });
  }

  // Check if email was already sent recently (within last 24 hours)
  async wasEmailSentRecently(email, emailType, hours = 24) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT COUNT(*) as count 
        FROM email_tracking 
        WHERE email = ? AND email_type = ? AND timestamp > datetime('now', '-${hours} hours')
      `;
      
      this.db.get(query, [email, emailType], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row.count > 0);
      });
    });
  }

  // Check if contact submission already exists
  async wasContactSubmitted(email, message, hours = 1) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT COUNT(*) as count 
        FROM contact_submissions 
        WHERE email = ? AND message = ? AND timestamp > datetime('now', '-${hours} hours')
      `;
      
      this.db.get(query, [email, message], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row.count > 0);
      });
    });
  }

  // Record email tracking
  async recordEmailSent(email, emailType, metadata = {}) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO email_tracking (
          email, session_id, user_id, ip_address, country, city, device_type, email_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ id: this.lastID, success: true });
      });
    });
  }

  // Record contact submission
  async recordContactSubmission(data) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO contact_submissions (
          name, email, phone, city, message, account, priority, connect, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ id: this.lastID, success: true });
      });
    });
  }

  // Get email statistics
  async getEmailStats(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          email_type,
          COUNT(*) as total_emails,
          COUNT(DISTINCT email) as unique_emails,
          DATE(timestamp) as date
        FROM email_tracking 
        WHERE timestamp >= datetime('now', '-${days} days')
        GROUP BY email_type, DATE(timestamp)
        ORDER BY date DESC
      `;
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  // Get contact submission statistics
  async getContactStats(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          COUNT(*) as total_submissions,
          COUNT(DISTINCT email) as unique_emails,
          priority,
          DATE(timestamp) as date
        FROM contact_submissions 
        WHERE timestamp >= datetime('now', '-${days} days')
        GROUP BY priority, DATE(timestamp)
        ORDER BY date DESC
      `;
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
      });
    }
  }
}

// Create singleton instance
const dbService = new DatabaseService();

module.exports = dbService;
