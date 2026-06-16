const nodemailer = require('nodemailer');
const path = require('path');
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
    Priority: ${formData.priority}
    Connect: ${formData.connect}
    Message: ${formData.message}

    Submitted on: ${new Date().toLocaleString()}
  `;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: 'contact@legacyglobalbank.com',
    subject: `New Contact Form Submission from ${formData.name}`,
    text: emailContent,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border: 1px solid #D9DCE6; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
        <!-- Header -->
        <div style="background: #0A0A0A; padding: 35px 20px; text-align: center; border-bottom: 3px solid #ffd700;">
          <img src="cid:logo" alt="Legacy Global Bank Logo" style="height: 60px; width: auto; display: block; margin: 0 auto 15px auto;" />
          <h1 style="color: #ffd700; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; font-family: 'Georgia', serif;">
            LEGACY GLOBAL BANK
          </h1>
          <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.8; letter-spacing: 1px;">
            NEW CONTACT FORM SUBMISSION
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 35px 30px; background: #f8f9fa;">
          <!-- Contact Info Card -->
          <div style="background: #ffffff; border-radius: 12px; padding: 25px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08); margin-bottom: 25px;">
            <h3 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #ffd700; padding-bottom: 10px;">
              Contact Information
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600; width: 40%;">Name</td>
                <td style="padding: 12px 0; color: #1a1a2e; font-weight: 500;">${formData.name}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600;">Email</td>
                <td style="padding: 12px 0; color: #1a1a2e; font-weight: 500;">${formData.email || 'Not provided'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600;">Phone</td>
                <td style="padding: 12px 0; color: #1a1a2e; font-weight: 500;">${formData.phone || 'Not provided'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600;">City</td>
                <td style="padding: 12px 0; color: #1a1a2e; font-weight: 500;">${formData.city || 'Not provided'}</td>
              </tr>
            </table>
          </div>

          <!-- Priority Info Card -->
          <div style="background: #ffffff; border-radius: 12px; padding: 25px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08); margin-bottom: 25px;">
            <h3 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #ffd700; padding-bottom: 10px;">
              Priority Details
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600; width: 40%;">Priority</td>
                <td style="padding: 12px 0; color: #1a1a2e; font-weight: 500;">${formData.priority}</td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #6c757d; font-weight: 600;">Connect</td>
                <td style="padding: 12px 0;">
                  <span style="background: linear-gradient(135deg, #ffd700 0%, #ffb700 100%); color: #1a1a2e; padding: 6px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; display: inline-block;">
                    ${formData.connect}
                  </span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Message Card -->
          <div style="background: #ffffff; border-radius: 12px; padding: 25px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
            <h3 style="color: #1a1a2e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #ffd700; padding-bottom: 10px;">
              Message
            </h3>
            <div style="background: #f8f9fa; border-left: 4px solid #ffd700; padding: 20px; border-radius: 0 8px 8px 0;">
              <p style="color: #1a1a2e; margin: 0; line-height: 1.6; white-space: pre-wrap; font-size: 15px;">
                ${formData.message}
              </p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #0A0A0A; padding: 25px 30px; text-align: center; border-radius: 0 0 12px 12px;">
          <p style="color: #ffffff; margin: 0 0 10px 0; font-size: 14px; opacity: 0.8;">
            Submitted on: ${new Date().toLocaleString()}
          </p>
          <p style="color: #ffd700; margin: 0; font-size: 12px; font-weight: 600;">
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
    console.log(`Notification email sent successfully (From: ${mailOptions.from} -> To: ${mailOptions.to})`);
  } catch (error) {
    console.error(`Error sending notification email (From: ${mailOptions.from}):`, error);
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #D9DCE6; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
        <!-- Header -->
        <div style="background: #0A0A0A; padding: 35px 20px; text-align: center; border-bottom: 3px solid #ffd700;">
          <img src="cid:logo" alt="Legacy Global Bank Logo" style="height: 60px; width: auto; display: block; margin: 0 auto 15px auto;" />
          <h1 style="color: #ffd700; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1.5px; font-family: 'Georgia', serif;">
            LEGACY GLOBAL BANK
          </h1>
          <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.8; letter-spacing: 1px;">
            THANK YOU FOR CONTACTING US
          </p>
        </div>
        
        <div style="padding: 30px 25px; background: #F8F6F2; color: #0A0A0A; line-height: 1.6;">
          <p>Dear <strong>${formData.name}</strong>,</p>
          
          <p>Thank you for reaching out to Legacy Global Bank. We have received your message and will get back to you shortly.</p>
          
          <div style="background-color: #ffffff; padding: 20px; border-left: 4px solid #ffd700; margin: 20px 0; border-radius: 0 6px 6px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <p style="margin: 0; color: #6E7285;"><strong>Your message:</strong></p>
            <p style="white-space: pre-wrap; margin: 10px 0 0 0; color: #0A0A0A;">${formData.message}</p>
          </div>
          
          <p>If you have any urgent inquiries, please contact us at <a href="mailto:support@legacyglobalbank.com" style="color: #ffd700; font-weight: bold; text-decoration: none;">support@legacyglobalbank.com</a>.</p>
          
          <p style="margin-top: 25px;">Best regards,<br>
          <strong>Legacy Global Bank Team</strong></p>
        </div>
        
        <!-- Footer -->
        <div style="background: #0A0A0A; padding: 20px; text-align: center;">
          <p style="color: #ffd700; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 1px;">
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
    console.log(`Auto-reply email sent successfully (From: ${mailOptions.from} -> To: ${mailOptions.to})`);
  } catch (error) {
    console.error(`Error sending auto-reply email (From: ${mailOptions.from}):`, error);
    throw error;
  }
};

module.exports = {
  sendNotificationEmail,
  sendAutoReplyEmail
};
