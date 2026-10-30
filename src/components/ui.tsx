import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import type { Bilingual } from '@/lib/i18n/messages';

export function Label({ htmlFor, hi, en }: { htmlFor: string; hi: string; en: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-base font-semibold">
      {hi} / {en}
    </label>
  );
}

export function TextField({
  id,
  hi,
  en,
  hint,
  ...rest
}: { id: string; hi: string; en: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label htmlFor={id} hi={hi} en={en} />
      <input
        id={id}
        name={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-12 w-full rounded border-2 border-line bg-white px-3 text-base text-ink"
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: { variant?: 'primary' | 'secondary' | 'danger' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'bg-accent text-white border-accent hover:bg-accent-dark',
    secondary: 'bg-white text-ink border-line hover:bg-gray-100',
    danger: 'bg-danger text-white border-danger',
  }[variant];
  return (
    <button
      className={`min-h-12 rounded border-2 px-4 text-base font-semibold disabled:opacity-60 ${styles} ${className}`}
      {...rest}
    />
  );
}

export function ErrorBox({ message }: { message: Bilingual | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded border-2 border-danger p-3 text-danger">
      <p>{message.hi}</p>
      <p>{message.en}</p>
    </div>
  );
}

export function NoticeBox({ message }: { message: Bilingual }) {
  return (
    <div role="status" className="rounded border-2 border-line bg-notice p-3">
      <p>{message.hi}</p>
      <p>{message.en}</p>
    </div>
  );
}
