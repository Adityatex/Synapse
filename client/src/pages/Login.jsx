import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { requestLoginOtp } from '../services/authService';
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, KeyRound, Code2 } from 'lucide-react';

export default function Login() {
  const { completeLogin } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  function validateCredentials() {
    const newErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function validateOtp() {
    const newErrors = {};

    if (!otp.trim()) {
      newErrors.otp = 'OTP is required';
    } else if (!/^\d{6}$/.test(otp.trim())) {
      newErrors.otp = 'OTP must be 6 digits';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleRequestOtp(e) {
    e.preventDefault();
    setServerError('');
    setStatusMessage('');

    if (!validateCredentials()) return;

    setIsLoading(true);
    try {
      const data = await requestLoginOtp(formData.email, formData.password);
      setOtpStep(true);
      setOtp('');
      setStatusMessage(data.message || `OTP sent to ${data.email}`);
    } catch (err) {
      setServerError(err.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    setServerError('');
    setStatusMessage('');

    if (!validateOtp()) return;

    setIsLoading(true);
    try {
      await completeLogin(formData.email, otp.trim());
    } catch (err) {
      setServerError(err.message || 'OTP verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResendOtp() {
    setServerError('');
    setStatusMessage('');
    setIsLoading(true);
    try {
      const data = await requestLoginOtp(formData.email, formData.password);
      setStatusMessage(data.message || `OTP resent to ${data.email}`);
    } catch (err) {
      setServerError(err.message || 'Unable to resend OTP. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleChange(field) {
    return (e) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: '' }));
      }
      if (serverError) setServerError('');
      if (statusMessage) setStatusMessage('');
    };
  }

  return (
    <div className="auth-page">
      {/* Background effects */}
      <div className="auth-bg-effects">
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>

      <div className="auth-container">
        {/* Logo */}
        <Link to="/" className="auth-logo-link">
          <div className="auth-logo-icon">
            <Code2 size={24} className="text-white" />
          </div>
          <span className="auth-logo-text">Synapse</span>
        </Link>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-header">
            <h1 className="auth-title">{otpStep ? 'Enter your OTP' : 'Welcome back'}</h1>
            <p className="auth-subtitle">
              {otpStep
                ? `Enter the 6-digit code sent to ${formData.email}`
                : 'Sign in to continue to your workspace'}
            </p>
          </div>

          {statusMessage && (
            <div className="auth-info-banner">
              <Mail size={16} />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Server error */}
          {serverError && (
            <div className="auth-error-banner">
              <AlertCircle size={16} />
              <span>{serverError}</span>
            </div>
          )}

          <form
            onSubmit={otpStep ? handleVerifyOtp : handleRequestOtp}
            className="auth-form"
            noValidate
          >
            {!otpStep ? (
              <>
                <div className="auth-field">
                  <label htmlFor="login-email" className="auth-label">
                    Email address
                  </label>
                  <div className={`auth-input-wrapper ${errors.email ? 'auth-input-error' : ''}`}>
                    <Mail size={18} className="auth-input-icon" />
                    <input
                      id="login-email"
                      type="email"
                      placeholder="you@example.com"
                      value={formData.email}
                      onChange={handleChange('email')}
                      className="auth-input"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                  {errors.email && <p className="auth-field-error">{errors.email}</p>}
                </div>

                <div className="auth-field">
                  <div className="auth-label-row">
                    <label htmlFor="login-password" className="auth-label">
                      Password
                    </label>
                  </div>
                  <div className={`auth-input-wrapper ${errors.password ? 'auth-input-error' : ''}`}>
                    <Lock size={18} className="auth-input-icon" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={handleChange('password')}
                      className="auth-input"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="auth-input-toggle"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.password && <p className="auth-field-error">{errors.password}</p>}
                </div>

                <button type="submit" className="auth-btn" disabled={isLoading}>
                  {isLoading ? (
                    <span className="auth-btn-loading">
                      <span className="auth-spinner" />
                      Sending OTP...
                    </span>
                  ) : (
                    <span className="auth-btn-content">
                      Continue with OTP
                      <ArrowRight size={18} />
                    </span>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="auth-field">
                  <label htmlFor="login-otp" className="auth-label">
                    Email OTP
                  </label>
                  <div className={`auth-input-wrapper ${errors.otp ? 'auth-input-error' : ''}`}>
                    <KeyRound size={18} className="auth-input-icon" />
                    <input
                      id="login-otp"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => {
                        setOtp(e.target.value.replace(/\D/g, ''));
                        if (errors.otp) {
                          setErrors((prev) => ({ ...prev, otp: '' }));
                        }
                        if (serverError) setServerError('');
                        if (statusMessage) setStatusMessage('');
                      }}
                      className="auth-input"
                      autoComplete="one-time-code"
                      autoFocus
                    />
                  </div>
                  {errors.otp && <p className="auth-field-error">{errors.otp}</p>}
                  <p className="auth-field-help">
                    Your password is checked first, then the OTP completes login.
                  </p>
                </div>

                <button type="submit" className="auth-btn" disabled={isLoading}>
                  {isLoading ? (
                    <span className="auth-btn-loading">
                      <span className="auth-spinner" />
                      Verifying OTP...
                    </span>
                  ) : (
                    <span className="auth-btn-content">
                      Verify and Sign In
                      <ArrowRight size={18} />
                    </span>
                  )}
                </button>

                <div className="auth-inline-actions">
                  <button type="button" className="auth-text-button" onClick={handleResendOtp} disabled={isLoading}>
                    Resend OTP
                  </button>
                  <button
                    type="button"
                    className="auth-text-button"
                    onClick={() => {
                      setOtpStep(false);
                      setOtp('');
                      setErrors({});
                      setServerError('');
                      setStatusMessage('');
                    }}
                    disabled={isLoading}
                  >
                    Change login details
                  </button>
                </div>
              </>
            )}
          </form>

          {/* Footer link */}
          <div className="auth-card-footer">
            <p>
              Don&apos;t have an account?{' '}
              <Link to="/signup" className="auth-link">
                Create one
              </Link>
            </p>
          </div>
        </div>

        {/* Bottom text */}
        <p className="auth-bottom-text">
          {otpStep ? 'JWT session starts only after OTP verification succeeds.' : 'Secure login powered by password + email OTP'}
        </p>
      </div>
    </div>
  );
}
