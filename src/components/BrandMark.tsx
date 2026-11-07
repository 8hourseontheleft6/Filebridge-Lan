import blackLogo from '../assets/brand/filebridge-lan-logo-black.svg';
import whiteLogo from '../assets/brand/filebridge-lan-logo-white.svg';
import appIcon from '../assets/brand/filebridge-lan-app-icon.png';

type BrandMarkProps = {
  tone?: 'ink' | 'inverse';
  variant?: 'mark' | 'app';
  size?: number;
  className?: string;
};

/**
 * Single source of truth for the Filebridge-Lan mark. The approved vector logos
 * are the only artwork; tone picks the black mark on light surfaces and the
 * white mark on dark ones. No letter tile, background, shadow or gradient.
 */
export function BrandMark({ tone = 'ink', variant = 'mark', size = 32, className }: BrandMarkProps) {
  const source = variant === 'app' ? appIcon : tone === 'inverse' ? whiteLogo : blackLogo;
  return (
    <img
      className={`brand-mark${className ? ` ${className}` : ''}`}
      src={source}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
