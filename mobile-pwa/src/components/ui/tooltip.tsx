import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '../../lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipContentProps = TooltipPrimitive.TooltipContentProps

export function TooltipContent({ className, sideOffset = 6, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-md',
          'dark:bg-slate-100 dark:text-slate-900',
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}
