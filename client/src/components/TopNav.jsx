import { Link } from 'react-router-dom';
import SynapseLogo from './SynapseLogo';

// The one top bar used by the landing page and the dashboard: wordmark on
// the left, plain links and a single action on the right (passed as children).
// `overlay` floats it over the landing hero instead of taking up space.
export default function TopNav({ overlay = false, label = 'Main', children }) {
  return (
    <header className={`lp-nav ${overlay ? 'lp-nav--overlay' : ''}`}>
      <Link to="/" className="brand-link" aria-label="Synapse home">
        <span className="brand-mark">
          <SynapseLogo size={22} color="#0d2a1c" nodeColor="#0d2a1c" />
        </span>
        <span className="brand-name">Synapse</span>
      </Link>
      <nav className="lp-nav-links" aria-label={label}>
        {children}
      </nav>
    </header>
  );
}
