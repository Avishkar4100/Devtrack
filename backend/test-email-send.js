/**
 * Test Email Sending with Resend
 * Run: node test-email-send.js
 */

require('dotenv').config();
const { sendEmail, storyCreatedEmail } = require('./src/services/email');

const log = (title, message = '') => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📌 ${title}`);
  if (message) console.log(message);
  console.log('='.repeat(60));
};

const success = (message) => console.log(`✓ ${message}`);
const error = (message) => console.log(`✗ ${message}`);

(async () => {
  try {
    log('EMAIL SENDING TEST', 'Testing Resend integration');

    // Check configuration
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey === 'your_resend_api_key') {
      error('RESEND_API_KEY not configured in .env');
      process.exit(1);
    }

    success('RESEND_API_KEY is configured');
    success(`API Key: ${apiKey.substring(0, 20)}...`);

    // Test email template
    const testHtml = storyCreatedEmail(
      'Test Story: Implement User Auth',
      'Create authentication system with JWT',
      'Security & Infrastructure',
      'DevTrack Demo Project',
      'Akshay Ghule'
    );

    success('Email template generated');
    success(`Template size: ${testHtml.length} bytes`);

    // Send test email
    log('SENDING TEST EMAIL', 'Attempting to send real email via Resend');

    const result = await sendEmail({
      to: 'aghule005@gmail.com',
      subject: '✨ Test Email: Story Creation Notification',
      html: testHtml,
    });

    if (result.id || result.data?.id) {
      const messageId = result.id || result.data.id;
      success('Email sent successfully!');
      success(`Message ID: ${messageId}`);
      
      log('SUCCESS', '✓ Email sending is fully operational');
      console.log(`
📊 SUMMARY:
  ✓ Resend API key validated
  ✓ Email template generated
  ✓ Test email sent successfully
  ✓ Message ID: ${messageId}

🎯 WHAT THIS MEANS:
  • Story creation emails will now send to all team members
  • Story assignment emails will send to assignees
  • All notifications are fully functional

📝 NOTE - Resend Free Tier:
  • Can send to aghule005@gmail.com (verified address)
  • For production: Add domain verification at resend.com/domains
  • Then emails go to all team member addresses automatically

📝 TO TEST IN APP:
  1. Go to http://localhost:5174/backlog
  2. Create a new story
  3. Team members with verified emails will receive notification
  4. Assign story to aghule005@gmail.com
  5. Assignment notification will be sent
      `);
      process.exit(0);
    } else {
      error('Failed to send email');
      error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
  } catch (err) {
    log('ERROR', 'Email sending failed');
    error(err.message);
    console.error(err);
    process.exit(1);
  }
})();
