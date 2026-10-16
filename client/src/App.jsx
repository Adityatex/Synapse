import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// P1-11: route-level code splitting — each page is its own chunk.
// Landing stays eager-adjacent (first paint); app pages lazy-load.
import LandingPage from './pages/LandingPage';

const EditorPage = lazy(() => import('./pages/EditorPage'));
const Signup = lazy(() => import('./pages/Signup'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CreateRoom = lazy(() => import('./pages/CreateRoom'));
const JoinRoom = lazy(() => import('./pages/JoinRoom'));
const RoomPage = lazy(() => import('./pages/RoomPage'));

function PageFallback() {
  return (
    <div className="auth-loading-screen">
      <div className="auth-loading-spinner" />
      <p className="auth-loading-text">Loading…</p>
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
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
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
