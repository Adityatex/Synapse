export default function SynapseLogo({
  size = 100,
  color = '#3b82f6',
  nodeColor = '#ffffff',
  className = '',
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Synapse Logo"
      role="img"
    >
      <path
        d="M30 40C30 31.7157 36.7157 25 45 25H60C65.5228 25 70 29.4772 70 35V38C70 43.5228 65.5228 48 60 48H55"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M70 60C70 68.2843 63.2843 75 55 75H40C34.4772 75 30 70.5228 30 65V62C30 56.4772 34.4772 52 40 52H45"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
      />
      <circle cx="50" cy="50" r="4.5" fill={nodeColor} />
    </svg>
  );
}