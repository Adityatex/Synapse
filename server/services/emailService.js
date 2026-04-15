const nodemailer = require('nodemailer');
const dns = require('dns');

let cachedTransporter = null;
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const TRANSIENT_SMTP_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNECTION',
  'ECONNREFUSED',
]);

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder(process.env.DNS_RESULT_ORDER || 'ipv4first');
}

function getMailerConfig() {
  const user = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM || user || 'mock@synapse.local';
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT || 30000);
  const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT || 30000);
  const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT || 30000);
  const requireTls = String(process.env.SMTP_REQUIRE_TLS || 'true').toLowerCase() === 'true';
  const deliveryMode = String(process.env.OTP_DELIVERY_MODE || 'auto').toLowerCase();

  return {
    user: user || 'mock',
    pass,
    from,
    host,
    port,
    secure,
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    requireTls,
    deliveryMode,
    isMocked: !user || !pass,
  };
}

function createSmtpTransport(config, override = {}) {
  const host = override.host || config.host;

  return nodemailer.createTransport({
    host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    requireTLS: config.requireTls,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    tls: {
      // Preserve certificate hostname verification when connecting to raw IPv4 address.
      servername: config.host,
    },
  });
}

async function resolveIpv4Host(host) {
  try {
    const lookup = await dns.promises.lookup(host, { family: 4 });
    return lookup?.address || null;
  } catch {
    return null;
  }
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getMailerConfig();
  const { user, pass, isMocked } = config;

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

  cachedTransporter = createSmtpTransport(config);

  return cachedTransporter;
}

async function sendOtpEmail({ email, otp, purpose }) {
  const transporter = getTransporter();
  const mailerConfig = getMailerConfig();
  const { from, deliveryMode } = mailerConfig;
  const actionLabel = purpose === 'signup' ? 'complete your signup' : 'complete your login';
  const expiryMinutes = process.env.OTP_EXPIRY_MINUTES || 10;

  const mailOptions = {
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
  };

  try {
    await transporter.sendMail(mailOptions);
    return { delivered: true, mocked: false };
  } catch (error) {
    const shouldRetryWithIpv4 =
      TRANSIENT_SMTP_ERROR_CODES.has(error?.code) ||
      /ENETUNREACH|ETIMEDOUT|Local \(:::\d+\)/i.test(error?.message || '');

    if (shouldRetryWithIpv4 && !mailerConfig.isMocked) {
      const ipv4Address = await resolveIpv4Host(mailerConfig.host);

      if (ipv4Address) {
        try {
          const ipv4Transporter = createSmtpTransport(mailerConfig, { host: ipv4Address });
          await ipv4Transporter.sendMail(mailOptions);
          console.warn(
            `WARNING: OTP SMTP fallback succeeded via IPv4 (${ipv4Address}) after ${error?.code || 'unknown'} for ${email}.`
          );
          return { delivered: true, mocked: false, retriedWithIpv4: true };
        } catch (retryError) {
          // Keep original error context and continue existing fallback/throw handling.
          error = retryError;
        }
      }
    }

    const fallbackEligible =
      !isProduction &&
      deliveryMode !== 'smtp' &&
      (error?.code === 'EAUTH' ||
        TRANSIENT_SMTP_ERROR_CODES.has(error?.code) ||
        /BadCredentials|Username and Password not accepted/i.test(error?.message || ''));

    if (!fallbackEligible) {
      throw error;
    }

    console.warn(
      `WARNING: OTP email delivery failed for ${email} (${error?.code || error?.name || 'unknown error'}). Falling back to console logging because NODE_ENV is not production.`
    );
    console.log(`\n============== OTP FALLBACK ==============\nTo: ${email}\nPurpose: ${purpose}\nOTP: ${otp}\nExpires in: ${expiryMinutes} minutes\n==========================================\n`);
    return { delivered: false, mocked: true, fallbackReason: error?.message || 'Email delivery failed' };
  }
}

module.exports = {
  sendOtpEmail,
};
