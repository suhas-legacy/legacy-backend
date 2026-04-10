const nodemailer = require('nodemailer');
require('dotenv').config();

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

const sendNotificationEmail = async (formData) => {
  const transporter = createTransporter();
  
  const emailContent = `
    New Contact Form Submission
    
    Name: ${formData.name}
    Email: ${formData.email || 'Not provided'}
    Phone: ${formData.phone || 'Not provided'}
    City: ${formData.city || 'Not provided'}
    Account Type: ${formData.account}
    Message: ${formData.message}
    
    Submitted on: ${new Date().toLocaleString()}
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: 'contact@legacyglobalbank.com',
    subject: `New Contact Form Submission from ${formData.name}`,
    text: emailContent,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Contact Form Submission</h2>
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <p><strong>Name:</strong> ${formData.name}</p>
          <p><strong>Email:</strong> ${formData.email || 'Not provided'}</p>
          <p><strong>Phone:</strong> ${formData.phone || 'Not provided'}</p>
          <p><strong>City:</strong> ${formData.city || 'Not provided'}</p>
          <p><strong>Account Type:</strong> ${formData.account}</p>
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap;">${formData.message}</p>
        </div>
        <p style="margin-top: 20px; color: #666; font-size: 12px;">
          Submitted on: ${new Date().toLocaleString()}
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Notification email sent successfully');
  } catch (error) {
    console.error('Error sending notification email:', error);
    throw error;
  }
};

const sendAutoReplyEmail = async (formData) => {
  const transporter = createTransporter();
  
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: formData.email,
    subject: 'Thank you for contacting Legacy Global Bank',
    text: `
      Dear ${formData.name},
      
      Thank you for reaching out to Legacy Global Bank. We have received your message and will get back to you shortly.
      
      Your message:
      ${formData.message}
      
      If you have any urgent inquiries, please contact us at support@legacyglobalbank.com.
      
      Best regards,
      Legacy Global Bank Team
    `,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; text-align: center;">
          <h1 style="color: #2c3e50; margin-bottom: 20px;">Legacy Global Bank</h1>
          <h2 style="color: #34495e; margin-bottom: 30px;">Thank You for Contacting Us</h2>
        </div>
        
        <div style="padding: 20px;">
          <p>Dear <strong>${formData.name}</strong>,</p>
          
          <p>Thank you for reaching out to Legacy Global Bank. We have received your message and will get back to you shortly.</p>
          
          <div style="background-color: #ecf0f1; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0;">
            <p style="margin: 0;"><strong>Your message:</strong></p>
            <p style="white-space: pre-wrap; margin: 10px 0 0 0;">${formData.message}</p>
          </div>
          
          <p>If you have any urgent inquiries, please contact us at <a href="mailto:support@legacyglobalbank.com">support@legacyglobalbank.com</a>.</p>
          
          <p>Best regards,<br>
          <strong>Legacy Global Bank Team</strong></p>
        </div>
        
        <div style="background-color: #34495e; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
          <p style="margin: 0; font-size: 12px;">© 2026 Legacy Global Bank. All rights reserved.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Auto-reply email sent successfully');
  } catch (error) {
    console.error('Error sending auto-reply email:', error);
    throw error;
  }
};

module.exports = {
  sendNotificationEmail,
  sendAutoReplyEmail
};
