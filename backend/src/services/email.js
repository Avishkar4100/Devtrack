const nodemailer = require('nodemailer')

/**
 * Send email using Resend (preferred — free 3000/month) or Gmail SMTP.
 * Set RESEND_API_KEY in .env for Resend, or SMTP_USER + SMTP_PASS for Gmail.
 */
const sendEmail = async ({ to, subject, html }) => {
  // ── Option 1: Resend (resend.com — free, easy, modern) ──────────────────
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'your_resend_api_key') {
    const { Resend } = require('resend') // lazy-load to avoid SES intrinsics error
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM || 'DevTrack <onboarding@resend.dev>'
    const result = await resend.emails.send({ from, to, subject, html })
    if (result.error) throw new Error(result.error.message)
    return result
  }

  // ── Option 2: Gmail SMTP (or any SMTP provider) ─────────────────────────
  if (
    process.env.SMTP_USER &&
    process.env.SMTP_USER !== 'your_email@gmail.com' &&
    process.env.SMTP_PASS &&
    process.env.SMTP_PASS !== 'your_email_password'
  ) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    return transporter.sendMail({
      from: `"DevTrack" <${process.env.SMTP_USER}>`,
      to, subject, html,
    })
  }

  // ── Neither configured ───────────────────────────────────────────────────
  throw new Error('EMAIL_NOT_CONFIGURED')
}

const resetPasswordEmail = (resetUrl, userName) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 36px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px;margin-right:10px;">
              <span style="color:white;font-size:20px;font-weight:bold;">⚡</span>
            </td>
            <td style="padding-left:12px;">
              <span style="color:white;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Dev<span style="opacity:0.85;">Track</span></span>
            </td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px;">
          <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;font-weight:700;">Reset your password</h2>
          <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
            Hi ${userName}, we received a request to reset your DevTrack password.
            Click the button below — this link expires in <strong>15 minutes</strong>.
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td>
            <a href="${resetUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;box-shadow:0 4px 14px rgba(99,102,241,0.35);">
              Reset Password
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">
            If you didn't request this, you can safely ignore this email. Your password won't change.
          </p>
          <hr style="border:none;border-top:1px solid #f1f5f9;margin:24px 0;">
          <p style="margin:0;color:#cbd5e1;font-size:11px;">Or copy this link: <span style="color:#6366f1;">${resetUrl}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const otpEmail = (otp, userName) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 36px;">
          <span style="color:white;font-size:20px;font-weight:700;">&#9889; DevTrack</span>
        </td></tr>
        <tr><td style="padding:36px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:22px;">Verify your email</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${userName || 'there'}, use the code below to confirm your email address. It expires in <strong>10 minutes</strong>.</p>
          <div style="background:#f5f3ff;border:2px dashed #a78bfa;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 6px;color:#7c3aed;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Your verification code</p>
            <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#4f46e5;font-family:monospace;">${otp}</div>
          </div>
          <p style="margin:0;color:#9ca3af;font-size:12px;">If you didn't create a DevTrack account, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const storyCreatedEmail = (storyTitle, storyDescription, epicTitle, projectName, reporterName) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="550" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#10b981,#059669);padding:28px 36px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px;margin-right:10px;">
              <span style="color:white;font-size:20px;">✨</span>
            </td>
            <td style="padding-left:12px;">
              <span style="color:white;font-size:18px;font-weight:700;">New Story Created</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:36px;">
          <h3 style="margin:0 0 12px;color:#1e293b;font-size:18px;font-weight:700;">${storyTitle}</h3>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">${storyDescription || 'No description provided'}</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:10px;border-left:4px solid #10b981;margin:20px 0;">
            <tr><td style="padding:14px 16px;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="color:#64748b;font-size:13px;font-weight:600;width:80px;">Epic:</td>
                <td style="color:#1e293b;font-size:13px;font-weight:600;">${epicTitle || 'Unassigned'}</td>
              </tr><tr>
                <td style="color:#64748b;font-size:13px;font-weight:600;padding-top:8px;">Project:</td>
                <td style="color:#1e293b;font-size:13px;font-weight:600;padding-top:8px;">${projectName}</td>
              </tr><tr>
                <td style="color:#64748b;font-size:13px;font-weight:600;padding-top:8px;">By:</td>
                <td style="color:#1e293b;font-size:13px;font-weight:600;padding-top:8px;">${reporterName}</td>
              </tr></table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;">Log in to DevTrack to view details and start working on this story.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const storyAssignedEmail = (storyTitle, assigneeName, projectName, reporterName, details = {}) => {
  const epicTitle = details.epicTitle || 'Unassigned'
  const priority = details.priority || 'medium'
  const dueDate = details.dueDate ? new Date(details.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'
  const storyPoints = details.storyPoints || '—'
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  
  const priorityColor = {
    highest: '#dc2626',
    high: '#ea580c',
    medium: '#f59e0b',
    low: '#10b981',
    lowest: '#0ea5e9',
  }[priority] || '#f59e0b'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="550" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);padding:28px 36px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 12px;margin-right:12px;">
              <span style="color:white;font-size:20px;">📋</span>
            </td>
            <td style="padding-left:4px;">
              <span style="color:white;font-size:18px;font-weight:700;">Task Assigned</span><br>
              <span style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">You have a new story in your queue</span>
            </td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px;">
          <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Hi <strong style="color:#1e293b;">${assigneeName}</strong>,</p>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
            <strong style="color:#1e293b;">${reporterName}</strong> has assigned you a new story:
          </p>

          <!-- Story Card -->
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin:0 0 24px;overflow:hidden;">
            <tr><td style="padding:20px;">
              <!-- Title -->
              <h2 style="margin:0 0 14px;color:#1e293b;font-size:16px;font-weight:700;line-height:1.4;">${storyTitle}</h2>

              <!-- Details Grid -->
              <table cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="padding:8px 0;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Epic:</span>
                    <span style="color:#1e293b;font-weight:600;margin-left:8px;">${epicTitle}</span>
                  </td>
                  <td style="padding:8px 0 8px 16px;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Priority:</span>
                    <span style="display:inline-block;background:${priorityColor}22;color:${priorityColor};padding:3px 8px;border-radius:4px;font-weight:700;margin-left:8px;font-size:11px;text-transform:capitalize;">${priority}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Project:</span>
                    <span style="color:#1e293b;font-weight:600;margin-left:8px;">${projectName}</span>
                  </td>
                  <td style="padding:8px 0 8px 16px;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Due:</span>
                    <span style="color:#1e293b;font-weight:600;margin-left:8px;">${dueDate}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Story Points:</span>
                    <span style="color:#1e293b;font-weight:600;margin-left:8px;">${storyPoints}</span>
                  </td>
                  <td style="padding:8px 0 8px 16px;font-size:13px;">
                    <span style="color:#64748b;font-weight:600;">Assigned by:</span>
                    <span style="color:#1e293b;font-weight:600;margin-left:8px;">${reporterName}</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Action Button -->
          <table cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0;">
            <tr><td align="center">
              <a href="${appUrl}/" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 4px 12px rgba(59,130,246,0.35);">
                Open in DevTrack
              </a>
            </td></tr>
          </table>

          <!-- Footer Info -->
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f0f4ff;border-radius:8px;border-left:4px solid #3b82f6;padding:14px 16px;margin:20px 0;">
            <tr><td>
              <p style="margin:0;color:#1e457b;font-size:13px;line-height:1.5;">
                📌 <strong>Quick tip:</strong> Update the story status as you work through it. Your team will see real-time updates.
              </p>
            </td></tr>
          </table>

          <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">
            If you have any questions about this assignment, reach out to ${reporterName} or your team lead.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
          <p style="margin:0;">DevTrack &bull; Collaborative Project Management<br>
          <a href="${appUrl}/" style="color:#64748b;text-decoration:none;">Launch Dashboard</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

const bulkAssignmentEmail = (assigneeName, projectName, stories = [], reporterName) => {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const storyCount = stories.length
  const totalPoints = stories.reduce((sum, s) => sum + (s.storyPoints || 0), 0)

  const storiesHtml = stories.slice(0, 5).map((story, i) => `
    <tr style="border-bottom:${i < 4 ? '1px solid #e2e8f0' : 'none'};">
      <td style="padding:12px 0;color:#1e293b;font-size:13px;font-weight:600;">
        ${i + 1}. ${story.title}
      </td>
      <td style="padding:12px 0 12px 16px;text-align:right;color:#64748b;font-size:12px;">
        <span style="background:#dbeafe;color:#0c4a6e;padding:2px 8px;border-radius:4px;font-weight:600;">${story.storyPoints || 0} pts</span>
      </td>
    </tr>
  `).join('')

  const moreText = storyCount > 5 ? `<tr><td colspan="2" style="padding:8px 0;color:#3b82f6;font-size:12px;font-weight:600;">+ ${storyCount - 5} more stories...</td></tr>` : ''

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table width="550" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 36px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 12px;margin-right:12px;">
              <span style="color:white;font-size:20px;">📚</span>
            </td>
            <td>
              <span style="color:white;font-size:18px;font-weight:700;">Bulk Assignment</span><br>
              <span style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">${storyCount} stories assigned to you</span>
            </td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px;">
          <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Hi <strong style="color:#1e293b;">${assigneeName}</strong>,</p>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
            <strong style="color:#1e293b;">${reporterName}</strong> has assigned <strong>${storyCount}</strong> new stories to you in the <strong>${projectName}</strong> project.
          </p>

          <!-- Summary Cards -->
          <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;">
            <tr>
              <td style="padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bfdbfe;margin-right:12px;flex:1;text-align:center;">
                <p style="margin:0;color:#0c4a6e;font-size:24px;font-weight:700;">${storyCount}</p>
                <p style="margin:4px 0 0;color:#0c4a6e;font-size:12px;font-weight:600;">Stories</p>
              </td>
              <td style="padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bfdbfe;text-align:center;">
                <p style="margin:0;color:#0c4a6e;font-size:24px;font-weight:700;">${totalPoints}</p>
                <p style="margin:4px 0 0;color:#0c4a6e;font-size:12px;font-weight:600;">Story Points</p>
              </td>
            </tr>
          </table>

          <!-- Stories List -->
          <h3 style="margin:24px 0 14px;color:#1e293b;font-size:14px;font-weight:700;">Stories Assigned:</h3>
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;padding:14px 16px;">
            <table cellpadding="0" cellspacing="0" style="width:100%;">
              ${storiesHtml}
              ${moreText}
            </table>
          </table>

          <!-- Action Button -->
          <table cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0;">
            <tr><td align="center">
              <a href="${appUrl}/" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(99,102,241,0.35);">
                View All Assignments
              </a>
            </td></tr>
          </table>

          <!-- Tips -->
          <table cellpadding="0" cellspacing="0" style="width:100%;background:#f5f0ff;border-radius:8px;border-left:4px solid #8b5cf6;padding:14px 16px;">
            <tr><td>
              <p style="margin:0;color:#4c1d95;font-size:13px;line-height:1.5;">
                💡 <strong>Tip:</strong> Sort by story points to prioritize high-value work, or filter by epic to see related work together.
              </p>
            </td></tr>
          </table>

          <p style="margin:20px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">
            Questions about these assignments? Reach out to ${reporterName} or your team lead.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 36px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
          <p style="margin:0;">DevTrack &bull; Collaborative Project Management</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

module.exports = { sendEmail, resetPasswordEmail, otpEmail, storyCreatedEmail, storyAssignedEmail, bulkAssignmentEmail }