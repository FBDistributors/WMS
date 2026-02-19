import type { ButtonHTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'danger'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  fullWidth?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  default: 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600',
  secondary:
    'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  outline:
    'border border-slate-200 text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800',
  ghost: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}

export function Button({
  className,
  variant = 'default',
  fullWidth,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variantStyles[variant],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    />
  )
}
