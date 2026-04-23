const dbService = require('./database');

// Get email statistics endpoint
async function getEmailStats(req, res) {
  try {
    const days = parseInt(req.query.days) || 30;
    
    const [emailStats, contactStats] = await Promise.all([
      dbService.getEmailStats(days),
      dbService.getContactStats(days)
    ]);

    res.json({
      success: true,
      data: {
        email_tracking: emailStats,
        contact_submissions: contactStats,
        summary: {
          total_visitor_emails: emailStats.reduce((sum, item) => sum + item.total_emails, 0),
          unique_visitor_emails: emailStats.reduce((sum, item) => sum + item.unique_emails, 0),
          total_contact_submissions: contactStats.reduce((sum, item) => sum + item.total_submissions, 0),
          unique_contact_emails: contactStats.reduce((sum, item) => sum + item.unique_emails, 0),
          period_days: days
        }
      }
    });
  } catch (error) {
    console.error('Error fetching email stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email statistics'
    });
  }
}

module.exports = { getEmailStats };
