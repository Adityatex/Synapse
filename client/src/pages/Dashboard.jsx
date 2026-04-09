import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Code2, Users, Plus, LogOut, Terminal, Sparkles } from 'lucide-react';

export default function Dashboard() {
  const { user, logout } = useAuth();

  const quickActions = [
    {
      id: 'editor',
      title: 'Open Editor',
      description: 'Launch the full-featured code editor with multi-language support',
      icon: Terminal,
      to: '/editor',
      gradient: 'from-blue-600 to-cyan-500',
      shadow: 'rgba(37, 99, 235, 0.3)',
    },
    {
      id: 'create-room',
      title: 'Create a Room',
      description: 'Start a new collaborative coding session for your team',
      icon: Plus,
      to: '/create-room',
      gradient: 'from-emerald-600 to-teal-500',
      shadow: 'rgba(16, 185, 129, 0.3)',
    },
    {
      id: 'join-room',
      title: 'Join a Room',
      description: 'Enter an existing room using a shared invite code',
      icon: Users,
      to: '/join-room',
      gradient: 'from-violet-600 to-purple-500',
      shadow: 'rgba(139, 92, 246, 0.3)',
    },
  ];

  return (
    <div className="dashboard-page">
      {/* Background effects */}
      <div className="auth-bg-effects">
        <div className="auth-bg-orb auth-bg-orb-1" />
        <div className="auth-bg-orb auth-bg-orb-2" />
        <div className="auth-bg-orb auth-bg-orb-3" />
      </div>

      {/* Header */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <Link to="/" className="auth-logo-link">
            <div className="auth-logo-icon" />
            <span className="auth-logo-text">Synapse</span>
          </Link>

          <div className="dashboard-header-right">
            <div className="dashboard-user-badge">
              <div className="dashboard-avatar">
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <span className="dashboard-user-email">{user?.name}</span>
            </div>
            <button onClick={logout} className="dashboard-logout-btn">
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="dashboard-main">
        <div className="dashboard-welcome">
          <div className="dashboard-welcome-icon">
            <Sparkles size={28} />
          </div>
          <h1 className="dashboard-welcome-title">
            Welcome back, {user?.name || user?.email?.split('@')[0] || 'Developer'}
          </h1>
          <p className="dashboard-welcome-subtitle">
            What would you like to work on today?
          </p>
        </div>

        {/* Quick Actions Grid */}
        <div className="dashboard-grid">
          {quickActions.map((action) => (
            <Link to={action.to} key={action.id} className="dashboard-card">
              <div
                className={`dashboard-card-icon bg-gradient-to-br ${action.gradient}`}
                style={{ boxShadow: `0 8px 32px -8px ${action.shadow}` }}
              >
                <action.icon size={24} />
              </div>
              <h3 className="dashboard-card-title">{action.title}</h3>
              <p className="dashboard-card-desc">{action.description}</p>
              <div className="dashboard-card-arrow">
                <Code2 size={16} />
              </div>
            </Link>
          ))}
        </div>

        {/* Status bar */}
        <div className="dashboard-status">
          <div className="dashboard-status-dot" />
          <span>All systems operational</span>
          <span className="dashboard-status-sep">·</span>
          <span>Collaborative features coming soon</span>
        </div>
      </main>
    </div>
  );
}
