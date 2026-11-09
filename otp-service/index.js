import express from 'express';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json());

// ── Config ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;
const OTP_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const MAX_ATTEMPTS = 3;
const CLEANUP_INTERVAL = 60 * 1000;      // sweep expired every minute

if (!API_KEY) {
  console.error('FATAL: API_KEY env var is required');
  process.exit(1);
}

// ── SMTP transporter ────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER;

// ── In-memory OTP store ─────────────────────────────────────
// Key: challengeId → { otp, email, username, appName, expiresAt, attempts }
const store = new Map();

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now > entry.expiresAt) store.delete(id);
  }
}, CLEANUP_INTERVAL);

// ── Health (before auth) ────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', challenges: store.size });
});

// ── Auth middleware ──────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers.authorization?.replace('Bearer ', '');
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(requireApiKey);

// ── POST /otp/send ──────────────────────────────────────────
app.post('/otp/send', async (req, res) => {
  const { email, username, appName } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  // Generate 6-digit OTP
  const otp = String(crypto.randomInt(100000, 999999));
  const challengeId = crypto.randomBytes(24).toString('hex');

  store.set(challengeId, {
    otp,
    email,
    username: username || 'User',
    appName: appName || 'KT Ticketing',
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  // Send OTP email
  try {
    await transporter.sendMail({
      from: FROM_ADDRESS,
      to: email,
      subject: `Your verification code: ${otp}`,
      html: otpEmailHtml(otp, username || 'User', appName || 'KT Ticketing'),
      text: `Your verification code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
    });

    console.log(`OTP sent to ${maskEmail(email)} [${challengeId.slice(0, 8)}…]`);
    res.json({ challengeId });
  } catch (err) {
    console.error('Failed to send OTP email:', err.message);
    store.delete(challengeId);
    res.status(502).json({ error: 'Failed to send email' });
  }
});

// ── POST /otp/verify ────────────────────────────────────────
app.post('/otp/verify', async (req, res) => {
  const { challengeId, otp } = req.body;

  if (!challengeId || !otp) {
    return res.status(400).json({ error: 'challengeId and otp are required' });
  }

  const entry = store.get(challengeId);

  if (!entry) {
    return res.status(404).json({ valid: false, error: 'Challenge not found or expired' });
  }

  if (Date.now() > entry.expiresAt) {
    store.delete(challengeId);
    return res.status(410).json({ valid: false, error: 'OTP expired' });
  }

  // Check OTP
  if (entry.otp === String(otp).trim()) {
    store.delete(challengeId);
    console.log(`OTP verified for ${maskEmail(entry.email)} [${challengeId.slice(0, 8)}…]`);
    return res.json({ valid: true });
  }

  // Wrong OTP
  entry.attempts++;
  const attemptsLeft = MAX_ATTEMPTS - entry.attempts;

  console.warn(`Bad OTP attempt ${entry.attempts}/${MAX_ATTEMPTS} for ${maskEmail(entry.email)}`);

  if (attemptsLeft <= 0) {
    store.delete(challengeId);

    // Send alert email — someone exhausted all attempts
    try {
      await transporter.sendMail({
        from: FROM_ADDRESS,
        to: entry.email,
        subject: `⚠️ Failed login attempt — ${entry.appName}`,
        html: alertEmailHtml(entry.username, entry.appName),
        text: `Someone tried to log in to your ${entry.appName} Super Admin account and failed OTP verification ${MAX_ATTEMPTS} times. If this was you, request a new code. If not, change your password immediately.`,
      });
      console.warn(`Alert email sent to ${maskEmail(entry.email)}`);
    } catch (err) {
      console.error('Failed to send alert email:', err.message);
    }

    return res.status(403).json({ valid: false, error: 'Too many attempts. Alert sent.', attemptsLeft: 0 });
  }

  res.status(401).json({ valid: false, attemptsLeft });
});

// ── Email templates ─────────────────────────────────────────
function otpEmailHtml(otp, username, appName) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 440px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 28px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">${appName} — Verification Code</h1>
      </div>
      <div style="background: #fff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 14px; margin: 0 0 16px;">Hi <strong>${username}</strong>,</p>
        <p style="color: #374151; font-size: 14px; margin: 0 0 24px;">Your one-time verification code is:</p>
        <div style="text-align: center; margin: 0 0 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111827; font-family: 'Courier New', monospace;">${otp}</span>
        </div>
        <p style="color: #6b7280; font-size: 12px; margin: 0 0 8px;">This code expires in 5 minutes.</p>
        <p style="color: #6b7280; font-size: 12px; margin: 0;">If you did not request this, you can safely ignore this email.</p>
      </div>
    </div>`;
}

function alertEmailHtml(username, appName) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 440px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%); padding: 28px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 18px;">⚠️ Security Alert</h1>
      </div>
      <div style="background: #fff; padding: 28px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 14px; margin: 0 0 16px;">Hi <strong>${username}</strong>,</p>
        <p style="color: #374151; font-size: 14px; margin: 0 0 16px;">Someone attempted to log in to your <strong>${appName}</strong> Super Admin account and <strong>failed OTP verification ${MAX_ATTEMPTS} times</strong>.</p>
        <p style="color: #374151; font-size: 14px; margin: 0 0 16px;">If this was you, please request a new verification code.</p>
        <p style="color: #DC2626; font-size: 14px; font-weight: 600; margin: 0;">If this was NOT you, change your password immediately.</p>
      </div>
    </div>`;
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return local[0] + '***@' + domain;
}

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OTP service running on port ${PORT}`);
});
