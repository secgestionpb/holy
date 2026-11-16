import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { KPI_GROUPS, KPI_KEYS_BY_GROUP, KPI_TITLES } from '@/lib/m7'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  allowedKeys: Set<string>
  visibleKeys: Set<string>
  onToggle: (kpiKey: string, visible: boolean) => void
}

export default function PersonalizeDialog({ open, onOpenChange, allowedKeys, visibleKeys, onToggle }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Personalizar dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {KPI_GROUPS.map((group) => {
            const keys = KPI_KEYS_BY_GROUP[group.key].filter((k) => allowedKeys.has(k))
            if (keys.length === 0) return null
            return (
              <div key={group.key}>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                <div className="space-y-2">
                  {keys.map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2.5 text-[13.5px]">
                      <Checkbox
                        checked={visibleKeys.has(k)}
                        onCheckedChange={(checked) => onToggle(k, checked === true)}
                        aria-label={KPI_TITLES[k] ?? k}
                      />
                      {KPI_TITLES[k] ?? k}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[12px] text-muted-foreground">El orden de los widgets es fijo; solo controlas la visibilidad.</p>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Guardar y cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
