const express = require('express');
const router = express.Router();
const {
  register, login, adminLogin, getMe, updateProfile, updateIntegrations, logout,
  forgotPassword, resetPassword,
  verifyEmail, resendOTP,
  githubOAuth, githubCallback,
  googleOAuth, googleCallback,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', adminLogin);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/integrations', protect, updateIntegrations);

// Password reset
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);

// Email verification
router.post('/verify-email', verifyEmail);
router.post('/resend-otp', resendOTP);

// OAuth — GitHub
router.get('/github', githubOAuth);
router.get('/github/callback', githubCallback);

// OAuth — Google
router.get('/google', googleOAuth);
router.get('/google/callback', googleCallback);

module.exports = router;
