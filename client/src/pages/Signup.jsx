import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { requestSignupOtp } from '../services/authService';
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, User, KeyRound } from 'lucide-react';
import SynapseInteractiveBackground from '../components/SynapseInteractiveBackground';
import SynapseLogo from '../components/SynapseLogo';

export default function Signup() {
  const { completeSignup } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [otp, setOtp] = useState('');
  const [otpStep, setOtpStep] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    document.body.style.backgroundColor = '#05070d';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  function validateCredentials() {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Username is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
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
      const data = await requestSignupOtp(formData.name, formData.email, formData.password);
      setOtpStep(true);
      setOtp('');
      setStatusMessage(data.message || `OTP sent to ${data.email}`);
    } catch (err) {
      setServerError(err.message || 'Signup failed. Please try again.');
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
      await completeSignup(formData.email, otp.trim());
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
      const data = await requestSignupOtp(formData.name, formData.email, formData.password);
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
      // Clear field error on change
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: '' }));
      }
      if (serverError) setServerError('');
      if (statusMessage) setStatusMessage('');
    };
  }

  return (
    <div className="auth-page">
      <SynapseInteractiveBackground />

      <div className="auth-container">
        {/* Logo */}
        <Link to="/" className="auth-logo-link">
          <div className="auth-logo-icon">
            <SynapseLogo size={24} color="#ffffff" nodeColor="#ffffff" />
          </div>
          <span className="auth-logo-text">Synapse</span>
        </Link>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-header">
            <h1 className="auth-title">{otpStep ? 'Verify your email' : 'Create your account'}</h1>
            <p className="auth-subtitle">
              {otpStep
                ? `Enter the 6-digit code sent to ${formData.email}`
                : 'Start coding collaboratively in seconds'}
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
                  <label htmlFor="signup-name" className="auth-label">
                    Username
                  </label>
                  <div className={`auth-input-wrapper ${errors.name ? 'auth-input-error' : ''}`}>
                    <User size={18} className="auth-input-icon" />
                    <input
                      id="signup-name"
                      type="text"
                      placeholder="Your username"
                      value={formData.name}
                      onChange={handleChange('name')}
                      className="auth-input"
                      autoComplete="username"
                      autoFocus
                    />
                  </div>
                  {errors.name && <p className="auth-field-error">{errors.name}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="signup-email" className="auth-label">
                    Email address
                  </label>
                  <div className={`auth-input-wrapper ${errors.email ? 'auth-input-error' : ''}`}>
                    <Mail size={18} className="auth-input-icon" />
                    <input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={formData.email}
                      onChange={handleChange('email')}
                      className="auth-input"
                      autoComplete="email"
                    />
                  </div>
                  {errors.email && <p className="auth-field-error">{errors.email}</p>}
                </div>

                <div className="auth-field">
                  <label htmlFor="signup-password" className="auth-label">
                    Password
                  </label>
                  <div className={`auth-input-wrapper ${errors.password ? 'auth-input-error' : ''}`}>
                    <Lock size={18} className="auth-input-icon" />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="At least 6 characters"
                      value={formData.password}
                      onChange={handleChange('password')}
                      className="auth-input"
                      autoComplete="new-password"
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

                <div className="auth-field">
                  <label htmlFor="signup-confirm" className="auth-label">
                    Confirm password
                  </label>
                  <div className={`auth-input-wrapper ${errors.confirmPassword ? 'auth-input-error' : ''}`}>
                    <Lock size={18} className="auth-input-icon" />
                    <input
                      id="signup-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Re-enter your password"
                      value={formData.confirmPassword}
                      onChange={handleChange('confirmPassword')}
                      className="auth-input"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="auth-input-toggle"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.confirmPassword && <p className="auth-field-error">{errors.confirmPassword}</p>}
                </div>

                <button type="submit" className="auth-btn" disabled={isLoading}>
                  {isLoading ? (
                    <span className="auth-btn-loading">
                      <span className="auth-spinner" />
                      Sending OTP...
                    </span>
                  ) : (
                    <span className="auth-btn-content">
                      Send OTP
                      <ArrowRight size={18} />
                    </span>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="auth-field">
                  <label htmlFor="signup-otp" className="auth-label">
                    Email OTP
                  </label>
                  <div className={`auth-input-wrapper ${errors.otp ? 'auth-input-error' : ''}`}>
                    <KeyRound size={18} className="auth-input-icon" />
                    <input
                      id="signup-otp"
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
                    We only create your account after the OTP is verified.
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
                      Verify and Create Account
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
                    Edit details
                  </button>
                </div>
              </>
            )}
          </form>

          {/* Footer link */}
          <div className="auth-card-footer">
            <p>
              Already have an account?{' '}
              <Link to="/login" className="auth-link">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* Bottom text */}
        <p className="auth-bottom-text">
          {otpStep
            ? 'Use a Gmail app password on the server to deliver OTP emails reliably.'
            : 'By creating an account, you agree to our Terms of Service'}
        </p>
      </div>
    </div>
  );
}
