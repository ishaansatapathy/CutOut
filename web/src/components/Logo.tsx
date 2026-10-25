/* eslint-disable @next/next/no-img-element */

export function Logo({ dark = false, size = 34 }: { dark?: boolean; size?: number }) {
  if (dark) return <img src="/logo.png" alt="CutOut :)" className="logo-full" style={{ height: size }} />;
  return (
    <span className="logo" style={{ ["--s" as string]: `${size}px` }}>
      <span className="logo-tile"><img src="/mark.png" alt="" /></span>
      <span className="logo-word">Cut<span className="hl">Out</span> :)</span>
    </span>
  );
}
