import { type InputHTMLAttributes, forwardRef, useId, useState } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type?: "text" | "password" | "search" | "email";
  label?: string;
  description?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { type = "text", label, description, error, className = "", id: propId, ...rest },
  ref,
) {
  const autoId = useId();
  const id = propId ?? autoId;
  const [showPassword, setShowPassword] = useState(false);

  const inputType = type === "password" && showPassword ? "text" : type;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </label>
      )}
      {description && (
        <p className="text-xs text-[var(--text-muted)]">{description}</p>
      )}
      {type === "password" ? (
        <div
          className={`flex items-center rounded-md bg-[var(--bg-input)] border transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:border-transparent ${
            error
              ? "border-[var(--danger)] focus-within:ring-[var(--danger)]"
              : "border-[var(--border)] hover:border-[var(--accent-muted)]"
          }`}
        >
          <input
            ref={ref}
            id={id}
            type={inputType}
            className={`flex-1 min-w-0 px-4 py-2 text-sm bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none ${className}`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="shrink-0 flex items-center px-3 py-2 border-l border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={inputType}
            className={`w-full px-4 py-2 text-sm rounded-md bg-[var(--bg-input)] border text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent ${
              error
                ? "border-[var(--danger)] focus:ring-[var(--danger)]"
                : "border-[var(--border)] hover:border-[var(--accent-muted)]"
            } ${className}`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            {...rest}
          />
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export default Input;
