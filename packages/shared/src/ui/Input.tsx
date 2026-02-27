import { type InputHTMLAttributes, forwardRef, useId, useState } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  type?: "text" | "password" | "search";
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
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={inputType}
          className={`w-full px-3 py-2 text-sm rounded-md bg-[var(--bg-input)] border text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent ${
            error
              ? "border-[var(--danger)] focus:ring-[var(--danger)]"
              : "border-[var(--border)] hover:border-[var(--accent-muted)]"
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...rest}
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            tabIndex={-1}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

export default Input;
