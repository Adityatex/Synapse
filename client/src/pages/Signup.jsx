import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle, User } from 'lucide-react';

export default function Signup() {
  const { signup } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  function validate() {
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

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    if (!validate()) return;

    setIsLoading(true);
    try {
      await signup(formData.name, formData.email, formData.password);
    } catch (err) {
      setServerError(err.message || 'Signup failed. Please try again.');
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
          <div className="auth-logo-icon" />
          <span className="auth-logo-text">Synapse</span>
        </Link>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-header">
            <h1 className="auth-title">Create your account</h1>
            <p className="auth-subtitle">
              Start coding collaboratively in seconds
            </p>
          </div>

          {/* Server error */}
          {serverError && (
            <div className="auth-error-banner">
              <AlertCircle size={16} />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
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
              {errors.name && (
                <p className="auth-field-error">{errors.name}</p>
              )}
            </div>

            {/* Email */}
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
              {errors.email && (
                <p className="auth-field-error">{errors.email}</p>
              )}
            </div>

            {/* Password */}
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
              {errors.password && (
                <p className="auth-field-error">{errors.password}</p>
              )}
            </div>

            {/* Confirm Password */}
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
              {errors.confirmPassword && (
                <p className="auth-field-error">{errors.confirmPassword}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="auth-btn"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="auth-btn-loading">
                  <span className="auth-spinner" />
                  Creating account...
                </span>
              ) : (
                <span className="auth-btn-content">
                  Create Account
                  <ArrowRight size={18} />
                </span>
              )}
            </button>
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
          By creating an account, you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}
