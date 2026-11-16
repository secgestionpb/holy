import { Wrench } from 'lucide-react'

type WordmarkProps = {
  className?: string
  compact?: boolean
}

export function Wordmark({ className = '', compact = false }: WordmarkProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Wrench className="size-4" aria-hidden />
      </span>
      <span className={compact ? 'text-[15px]' : 'text-base'}>
        <span className="font-heading font-bold tracking-tight">CMMS Hotelero</span>
      </span>
    </span>
  )
}
