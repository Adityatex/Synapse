import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { Sentry } from './config/sentry.js';
import LandingPage from './pages/LandingPage';
import EditorPage from './pages/EditorPage';
import Signup from './pages/Signup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import RoomPage from './pages/RoomPage';

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/create-room" element={<CreateRoom />} />
        <Route path="/join-room" element={<JoinRoom />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* P0-10: render errors reach Sentry with the release tag. */}
        <Sentry.ErrorBoundary
          fallback={
            <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
              <h1>Something went wrong.</h1>
              <p>Please reload the page. If the problem persists, contact support.</p>
              <button type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          }
        >
          <AppRoutes />
        </Sentry.ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
