import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand shadow-[0_8px_24px_rgba(179,87,15,0.25)] hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-line hover:bg-raised hover:border-faint',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-surface',
};

const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-xs gap-1.5 rounded-xl',
  md: 'min-h-11 px-4 text-sm gap-2 rounded-2xl',
  lg: 'min-h-14 px-6 text-base gap-2 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Full width. */
  block?: boolean;
}

/** The app's button: one look per role, a visible focus ring, at least 36px to tap. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center font-bold transition-all active:scale-[0.98]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas
        disabled:opacity-50 disabled:pointer-events-none
        ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    />
  );
});

export default Button;
