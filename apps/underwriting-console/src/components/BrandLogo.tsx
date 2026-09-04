export default function BrandLogo({
  onClick,
  compact = false,
}: {
  onClick?: () => void;
  compact?: boolean;
}) {
  const mark = (
    <svg viewBox="0 0 40 40" className={compact ? 'h-9 w-9' : 'h-11 w-11'} aria-hidden>
      <rect width="40" height="40" rx="10" fill="#059669" />
      <path
        d="M11 12h14c2.2 0 4 1.6 4 3.6 0 1.6-1 2.9-2.6 3.4 1.8.5 3 1.9 3 3.7 0 2.2-1.9 4.3-4.8 4.3H11V12zm5.2 5.2v2.4h7.1c.7 0 1.2-.5 1.2-1.2 0-.7-.5-1.2-1.2-1.2H16.2zm0 6.2v2.6h8c.8 0 1.4-.6 1.4-1.3s-.6-1.3-1.4-1.3h-8z"
        fill="white"
      />
    </svg>
  );

  const wordmark = (
    <span className="text-left leading-none">
      <span className={`block font-black tracking-tight text-slate-950 ${compact ? 'text-lg' : 'text-[1.65rem]'}`}>
        FreeFlow
      </span>
      <span className={`mt-1 block font-medium uppercase tracking-[0.18em] text-slate-500 ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
        Mortgage Solutions
      </span>
    </span>
  );

  const className = 'inline-flex items-center gap-3 text-slate-950';

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} rounded-xl text-left`} aria-label="FreeFlow home">
        {mark}
        {wordmark}
      </button>
    );
  }

  return (
    <div className={className}>
      {mark}
      {wordmark}
    </div>
  );
}
