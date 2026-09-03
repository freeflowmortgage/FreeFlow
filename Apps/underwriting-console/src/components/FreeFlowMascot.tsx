export default function FreeFlowMascot({
  size = 96,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/freeflow-mascot.png"
      alt="FreeFlow, the house-robot mascot for FreeFlow Mortgage Solutions"
      width={size}
      height={size}
      className={`object-contain object-center ${className}`}
    />
  );
}
