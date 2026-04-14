const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getMailerConfig() {
  const user = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM || user || 'mock@synapse.local';

  return { user: user || 'mock', pass, from, isMocked: !user || !pass };
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const { user, pass, isMocked } = getMailerConfig();

  if (isMocked) {
    console.warn("WARNING: Email service not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing). Falling back to logging OTPs to console.");
    cachedTransporter = {
      sendMail: async (mailOptions) => {
        console.log(`\n============== MOCK EMAIL =============`);
        console.log(`To: ${mailOptions.to}`);
        console.log(`Subject: ${mailOptions.subject}`);
        console.log(`Text: ${mailOptions.text}`);
        console.log(`=======================================\n`);
        return true;
      }
    };
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass,
    },
  });

  return cachedTransporter;
}

async function sendOtpEmail({ email, otp, purpose }) {
  const transporter = getTransporter();
  const { from } = getMailerConfig();
  const actionLabel = purpose === 'signup' ? 'complete your signup' : 'complete your login';
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 10;

  await transporter.sendMail({
    from,
    to: email,
    subject: `Your Synapse ${purpose === 'signup' ? 'signup' : 'login'} OTP`,
    text: `Your Synapse OTP is ${otp}. It expires in ${expiryMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
        <h2 style="margin-bottom: 12px;">Verify your Synapse account</h2>
        <p style="margin-bottom: 16px;">Use the OTP below to ${actionLabel}.</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; padding: 16px 20px; background: #eff6ff; color: #1d4ed8; border-radius: 12px; display: inline-block;">
          ${otp}
        </div>
        <p style="margin-top: 16px;">This code expires in ${expiryMinutes} minutes.</p>
        <p style="margin-top: 8px; color: #64748b;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = {
  sendOtpEmail,
};
