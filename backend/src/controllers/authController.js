const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { sendEmail, resetPasswordEmail, otpEmail } = require('../services/email');
const logger = require('../config/logger');

const maskEmail = (email) => {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'unknown';
  const [name, domain] = email.split('@');
  if (!name) return `***@${domain}`;
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
};

const maskSecret = (value) => {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
};

const toSafeUserPayload = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar,
  jiraEmail: user.jiraEmail,
  jiraDomain: user.jiraDomain,
  githubUsername: user.githubUsername,
  hasJiraToken: Boolean(user.jiraApiToken),
  hasGithubToken: Boolean(user.githubToken),
  jiraTokenPreview: maskSecret(user.jiraApiToken || ''),
  githubTokenPreview: maskSecret(user.githubToken || ''),
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
});

// Verify email deliverability via AbstractAPI Email Reputation
const verifyEmailDeliverability = async (email) => {
  const apiKey = process.env.ABSTRACT_API_KEY;
  if (!apiKey || apiKey === 'your_abstract_api_key') return; // skip if not configured
  try {
    const { data } = await axios.get('https://emailreputation.abstractapi.com/v1/', {
      params: { api_key: apiKey, email },
      timeout: 5000,
    });
    // data.deliverability: 'DELIVERABLE' | 'UNDELIVERABLE' | 'RISKY' | 'UNKNOWN'
    if (data.deliverability === 'UNDELIVERABLE') {
      throw new Error(`The email address "${email}" does not exist or cannot receive emails.`);
    }
    // data.is_disposable_email.value — block throwaway addresses
    if (data.is_disposable_email && data.is_disposable_email.value === true) {
      throw new Error('Disposable/temporary email addresses are not allowed. Please use a real email.');
    }
  } catch (err) {
    if (err.message.startsWith('The email') || err.message.startsWith('Disposable')) throw err;
    // Network/API errors — fail open (don't block registration)
    logger.warn(`AbstractAPI email check failed (fail-open): ${err.message}`);
  }
};

// @desc    Register user — sends OTP, requires email verification
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  const { name, email, password, role } = req.body;
  logger.info(`Register attempt: ${maskEmail(email)} role=${role || 'manager'}`);

  if (!name || !email || !password) {
    logger.warn(`Register validation failed (missing fields): ${maskEmail(email)}`);
    return res.status(400).json({ success: false, message: 'Please provide name, email and password' });
  }

  const allowedRoles = ['manager', 'scrum_master'];
  const normalizedRole = allowedRoles.includes(role) ? role : 'manager';

  // Level 2: AbstractAPI — verify the mailbox actually exists
  try {
    await verifyEmailDeliverability(email);
  } catch (err) {
    logger.warn(`Register blocked by email deliverability check for ${maskEmail(email)}: ${err.message}`);
    return res.status(400).json({ success: false, message: err.message });
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    if (!existingUser.isEmailVerified) {
      // Account exists but unverified — resend OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      existingUser.emailOTP = otp;
      existingUser.emailOTPExpire = Date.now() + 10 * 60 * 1000;
      await existingUser.save({ validateBeforeSave: false });
      try { await sendEmail({ to: email, subject: 'DevTrack — Verify your email', html: otpEmail(otp, name) }); } catch (_) {}
      logger.info(`Register existing unverified user, OTP resent: ${maskEmail(email)}`);
      return res.status(200).json({ success: true, requiresVerification: true, email, message: 'OTP resent. Please verify your email.' });
    }
    logger.warn(`Register rejected, email already registered: ${maskEmail(email)}`);
    return res.status(400).json({ success: false, message: 'Email already registered' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const user = await User.create({
    name,
    email,
    password,
    role: normalizedRole,
    isEmailVerified: false,
    emailOTP: otp,
    emailOTPExpire: Date.now() + 10 * 60 * 1000,
  });
  logger.info(`Register user created: ${maskEmail(email)} id=${user._id}`);

  try {
    await sendEmail({ to: email, subject: 'DevTrack — Verify your email', html: otpEmail(otp, name) });
    logger.info(`Register OTP email sent: ${maskEmail(email)}`);
  } catch (err) {
    logger.error(`Register OTP email failed for ${maskEmail(email)}: ${err.message}`);
    // In dev, return the OTP directly so developer can test without email
    if (process.env.NODE_ENV === 'development') {
      logger.warn(`Register continuing in development with devOTP for ${maskEmail(email)}`);
      return res.status(200).json({ success: true, requiresVerification: true, email, devOTP: otp, message: 'Email could not be sent. Use devOTP to verify.' });
    }
  }

  return res.status(200).json({ success: true, requiresVerification: true, email, message: 'Account created! Check your email for the 6-digit verification code.' });
};

// @desc    Verify email with OTP
// @route   POST /api/auth/verify-email
// @access  Public
const verifyEmail = async (req, res) => {
  const { email, otp } = req.body;
  logger.info(`Verify email attempt: ${maskEmail(email)}`);
  if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ success: false, message: 'Account not found.' });
  if (user.isEmailVerified) return await sendTokenResponse(user, 200, res);

  if (!user.emailOTP || user.emailOTP !== otp.toString()) {
    return res.status(400).json({ success: false, message: 'Invalid OTP. Please check your email or request a new code.' });
  }
  if (user.emailOTPExpire < Date.now()) {
    return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new code.' });
  }

  user.isEmailVerified = true;
  user.emailOTP = undefined;
  user.emailOTPExpire = undefined;
  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  logger.info(`Verify email success: ${maskEmail(email)} id=${user._id}`);

  await sendTokenResponse(user, 200, res);
};

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOTP = async (req, res) => {
  const { email } = req.body;
  logger.info(`Resend OTP attempt: ${maskEmail(email)}`);
  if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

  const user = await User.findOne({ email });
  if (!user) return res.status(200).json({ success: true, message: 'If that account exists, a new code has been sent.' });
  if (user.isEmailVerified) return res.status(400).json({ success: false, message: 'Email already verified.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  user.emailOTP = otp;
  user.emailOTPExpire = Date.now() + 10 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  try {
    await sendEmail({ to: email, subject: 'DevTrack — New verification code', html: otpEmail(otp, user.name) });
    logger.info(`Resend OTP email sent: ${maskEmail(email)}`);
  } catch (err) {
    logger.error(`Resend OTP email failed for ${maskEmail(email)}: ${err.message}`);
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({ success: true, devOTP: otp, message: 'Email failed. Use devOTP.' });
    }
  }

  return res.status(200).json({ success: true, message: 'New verification code sent to your email.' });
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  const { email, password } = req.body;
  logger.info(`Login attempt: ${maskEmail(email)}`);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide email and password' });
  }

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // If password is correct, they own the account — auto-verify and log in
  user.lastLogin = Date.now();
  if (user.isEmailVerified === false) {
    user.isEmailVerified = true;
    user.emailOTP = undefined;
    user.emailOTPExpire = undefined;
  }
  await user.save({ validateBeforeSave: false });

  logger.info(`Login success: ${maskEmail(email)} id=${user._id}`);

  await sendTokenResponse(user, 200, res);
};

// @desc    Admin login user
// @route   POST /api/auth/admin-login
// @access  Public
const adminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide email and password' });
  }

  const envAdminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const envAdminPassword = process.env.ADMIN_PASSWORD || '';
  if (!envAdminEmail || !envAdminPassword) {
    return res.status(500).json({ success: false, message: 'Admin credentials are not configured in environment variables.' });
  }

  if (email.toLowerCase().trim() !== envAdminEmail || password !== envAdminPassword) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
  }

  let user = await User.findOne({ email: envAdminEmail }).select('+password');
  if (!user) {
    user = await User.create({
      name: 'Platform Admin',
      email: envAdminEmail,
      password: envAdminPassword,
      role: 'admin',
      isEmailVerified: true,
    });
  }

  if (user.role !== 'admin') {
    user.role = 'admin';
  }

  user.lastLogin = Date.now();
  await user.save({ validateBeforeSave: false });

  logger.info(`Admin login success: ${maskEmail(envAdminEmail)} id=${user._id}`);
  await sendTokenResponse(user, 200, res);
};

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  const user = await User.findById(req.user.id).select('+jiraApiToken +githubToken');
  res.status(200).json({ success: true, data: toSafeUserPayload(user) });
};

// @desc    Update profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
  const { name, jiraEmail, jiraDomain, githubUsername } = req.body;

  const fieldsToUpdate = {};
  if (name) fieldsToUpdate.name = name;
  if (jiraEmail) fieldsToUpdate.jiraEmail = jiraEmail;
  if (jiraDomain) fieldsToUpdate.jiraDomain = jiraDomain;
  if (githubUsername) fieldsToUpdate.githubUsername = githubUsername;

  const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({ success: true, data: user });
};

// @desc    Update integrations (Jira / GitHub tokens)
// @route   PUT /api/auth/integrations
// @access  Private
const updateIntegrations = async (req, res) => {
  const { jiraApiToken, jiraEmail, jiraDomain, githubToken, githubUsername } = req.body;

  const user = await User.findById(req.user.id).select('+jiraApiToken +githubToken');
  const normalizeDomain = (value = '') =>
    value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/g, '');

  if (jiraApiToken !== undefined) user.jiraApiToken = jiraApiToken;
  if (jiraEmail !== undefined) user.jiraEmail = jiraEmail;
  if (jiraDomain !== undefined) user.jiraDomain = normalizeDomain(jiraDomain);
  if (githubToken !== undefined) user.githubToken = githubToken;
  if (githubUsername !== undefined) user.githubUsername = githubUsername;

  await user.save({ validateBeforeSave: false });

  logger.info(`Integration settings updated for ${maskEmail(user.email)}`);

  res.status(200).json({
    success: true,
    message: 'Integration credentials updated successfully',
    data: toSafeUserPayload(user),
  });
};

// @desc    Logout
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out successfully' });
};

// @desc    Forgot password — send reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Please provide an email address.' });

  const user = await User.findOne({ email });
  // Always respond success to avoid user-enumeration
  if (!user) {
    return res.status(200).json({ success: true, message: 'If that email is registered, you will receive a reset link shortly.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 min
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'DevTrack — Reset Your Password',
      html: resetPasswordEmail(resetUrl, user.name),
    });
    return res.status(200).json({ success: true, message: 'Password reset link sent to your email.' });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    logger.error(`Forgot password email failed for ${maskEmail(email)}: ${err.message}`);
    // In dev, still return the URL so developer can test
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({
        success: true,
        message: 'SMTP not configured — use the devResetUrl below to test.',
        devResetUrl: resetUrl,
      });
    }
    return res.status(500).json({ success: false, message: 'Email could not be sent. Please configure SMTP settings in .env (SMTP_HOST, SMTP_USER, SMTP_PASS).' });
  }
};

// @desc    Reset password using token
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ success: false, message: 'Invalid or expired reset link. Please request a new one.' });
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  await sendTokenResponse(user, 200, res);
};

// @desc    Redirect to GitHub OAuth
// @route   GET /api/auth/github
// @access  Public
const githubOAuth = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId || clientId === 'your_github_client_id') {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=github_not_configured`);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'user:email',
    redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/github/callback`,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
};

// @desc    Handle GitHub OAuth callback
// @route   GET /api/auth/github/callback
// @access  Public
const githubCallback = async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (error || !code) return res.redirect(`${frontendUrl}/login?error=${error || 'no_code'}`);

  try {
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      { client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code },
      { headers: { Accept: 'application/json' } }
    );
    const accessToken = tokenRes.data.access_token;
    if (!accessToken) throw new Error('No access token from GitHub');

    const [userRes, emailsRes] = await Promise.all([
      axios.get('https://api.github.com/user', { headers: { Authorization: `Bearer ${accessToken}` } }),
      axios.get('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);

    const gh = userRes.data;
    const primaryEmail = (emailsRes.data.find((e) => e.primary && e.verified) || emailsRes.data[0])?.email;
    if (!primaryEmail) throw new Error('No verified email from GitHub');

    let user = await User.findOne({ email: primaryEmail });
    if (!user) {
      user = await User.create({
        name: gh.name || gh.login,
        email: primaryEmail,
        password: crypto.randomBytes(32).toString('hex'),
        githubUsername: gh.login,
        avatar: gh.avatar_url,
      });
    } else {
      user.githubUsername = gh.login;
      if (gh.avatar_url && !user.avatar) user.avatar = gh.avatar_url;
      await user.save({ validateBeforeSave: false });
    }

    const token = user.getSignedJwtToken();
    const userData = encodeURIComponent(JSON.stringify({
      id: user._id, name: user.name, email: user.email,
      role: user.role, avatar: user.avatar, githubUsername: user.githubUsername,
    }));
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${userData}`);
  } catch (err) {
    logger.error(`GitHub OAuth error: ${err.message}`);
    res.redirect(`${frontendUrl}/login?error=github_auth_failed`);
  }
};

// @desc    Redirect to Google OAuth
// @route   GET /api/auth/google
// @access  Public
const googleOAuth = (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === 'your_google_client_id') {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_not_configured`);
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

// @desc    Handle Google OAuth callback
// @route   GET /api/auth/google/callback
// @access  Public
const googleCallback = async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (error || !code) return res.redirect(`${frontendUrl}/login?error=${error || 'no_code'}`);

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    });
    const { access_token } = tokenRes.data;

    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = profileRes.data;

    let user = await User.findOne({ email: profile.email });
    if (!user) {
      user = await User.create({
        name: profile.name,
        email: profile.email,
        password: crypto.randomBytes(32).toString('hex'),
        avatar: profile.picture,
        isEmailVerified: true,
      });
    } else {
      if (profile.picture && !user.avatar) user.avatar = profile.picture;
      user.isEmailVerified = true;
      await user.save({ validateBeforeSave: false });
    }

    const token = user.getSignedJwtToken();
    const userData = encodeURIComponent(JSON.stringify({
      id: user._id, name: user.name, email: user.email,
      role: user.role, avatar: user.avatar,
    }));
    res.redirect(`${frontendUrl}/auth/callback?token=${token}&user=${userData}`);
  } catch (err) {
    logger.error(`Google OAuth error: ${err.message}`);
    res.redirect(`${frontendUrl}/login?error=google_auth_failed`);
  }
};

const sendTokenResponse = async (user, statusCode, res) => {
  const token = user.getSignedJwtToken();
  const hydratedUser = await User.findById(user._id).select('+jiraApiToken +githubToken');

  res.status(statusCode).json({
    success: true,
    token,
    user: toSafeUserPayload(hydratedUser || user),
  });
};

module.exports = {
  register, login, adminLogin, getMe, updateProfile, updateIntegrations, logout,
  forgotPassword, resetPassword,
  verifyEmail, resendOTP,
  githubOAuth, githubCallback,
  googleOAuth, googleCallback,
};
