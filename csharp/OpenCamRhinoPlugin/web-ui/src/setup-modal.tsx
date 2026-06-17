import { Button } from './components/ui/button'
import { Separator } from './components/ui/separator'

type SetupModalProps = {
  onClose: (result: 'ok' | 'cancel') => void
}

export function SetupModal({ onClose }: SetupModalProps) {
  return (
    <>
      <div className='flex flex-1 flex-col gap-3 p-3'>
        <div>
          <h1 className='text-base font-semibold'>Setup</h1>
          <p className='text-sm text-muted-foreground'>Configure OpenCAM setup options here.</p>
        </div>

        <div className='min-h-0 flex-1 rounded-md border bg-card p-3 text-sm text-muted-foreground'>
          Setup form placeholder
        </div>
      </div>

      <Separator />
      <div className='flex justify-end gap-2 p-2'>
        <Button variant='outline' onClick={() => onClose('cancel')}>
          Cancel
        </Button>
        <Button onClick={() => onClose('ok')}>
          OK
        </Button>
      </div>
    </>
  )
}
