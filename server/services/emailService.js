const nodemailer = require('nodemailer');
const dns = require('dns');
const net = require('net');

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
  const connectionTimeout = Number(process.env.SMTP_CONNECTION_TIMEOUT || 60000);
  const greetingTimeout = Number(process.env.SMTP_GREETING_TIMEOUT || 60000);
  const socketTimeout = Number(process.env.SMTP_SOCKET_TIMEOUT || 60000);
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
  const port = Number(override.port || config.port);
  const secure = typeof override.secure === 'boolean' ? override.secure : config.secure;
  const requireTls = typeof override.requireTls === 'boolean' ? override.requireTls : config.requireTls;
  const tlsServername = override.tlsServername || config.host;
  const tlsConfig = net.isIP(String(tlsServername || '').trim())
    ? undefined
    : {
      servername: tlsServername,
    };

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    requireTLS: requireTls,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    ...(tlsConfig ? { tls: tlsConfig } : {}),
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

async function resolveIpv4Hosts(host) {
  try {
    const records = await dns.promises.resolve4(host);
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }
    return [...new Set(records.filter(Boolean))];
  } catch {
    const single = await resolveIpv4Host(host);
    return single ? [single] : [];
  }
}

function isLikelyGmailHost(host) {
  return /(^|\.)gmail\.com$/i.test(String(host || '').trim());
}

async function tryAlternateSmtpRoutes({ config, mailOptions, firstError, email }) {
  const ipv4Hosts = await resolveIpv4Hosts(config.host);
  const fallbackTimeout = Number(process.env.SMTP_FALLBACK_TIMEOUT || 12000);
  const maxFallbackAttempts = Math.max(1, Number(process.env.SMTP_MAX_FALLBACK_ATTEMPTS || 2));
  const attempts = [];
  const primaryIpv4 = ipv4Hosts[0] || null;

  if (primaryIpv4) {
    attempts.push({
      label: `ipv4:${primaryIpv4}:${config.port}`,
      override: {
        host: primaryIpv4,
        tlsServername: config.host,
      },
    });
  }

  if (isLikelyGmailHost(config.host) && Number(config.port) !== 465) {
    attempts.push({
      label: 'gmail:465:implicit-tls',
      override: {
        port: 465,
        secure: true,
        requireTls: false,
      },
    });

    if (primaryIpv4) {
      attempts.push({
        label: `gmail:ipv4:${primaryIpv4}:465:implicit-tls`,
        override: {
          host: primaryIpv4,
          port: 465,
          secure: true,
          requireTls: false,
          tlsServername: config.host,
        },
      });
    }
  }

  const plannedAttempts = attempts.slice(0, maxFallbackAttempts);
  let latestError = firstError;

  for (const attempt of plannedAttempts) {
    try {
      const transport = createSmtpTransport(
        {
          ...config,
          connectionTimeout: fallbackTimeout,
          greetingTimeout: fallbackTimeout,
          socketTimeout: fallbackTimeout,
        },
        attempt.override
      );
      await transport.sendMail(mailOptions);
      console.warn(
        `WARNING: OTP SMTP fallback succeeded via ${attempt.label} after ${firstError?.code || 'unknown'} for ${email}.`
      );
      return { delivered: true, mocked: false, retriedWithFallbackRoute: attempt.label };
    } catch (attemptError) {
      latestError = attemptError;
    }
  }

  throw latestError;
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
      try {
        return await tryAlternateSmtpRoutes({
          config: mailerConfig,
          mailOptions,
          firstError: error,
          email,
        });
      } catch (retryError) {
        // Keep original flow for non-production fallback and final throw path.
        error = retryError;
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
