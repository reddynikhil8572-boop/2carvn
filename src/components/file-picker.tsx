import { useId, useRef } from 'react';
import { UploadCloud, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * Compact file picker for object-storage uploads. The parent owns the upload
 * (presign → bytes → confirm) and reports `uploading` + `progress`; the chosen
 * filename is surfaced through the `name` prop, which the parent clears on
 * success (or a `resetKey` remount is used).
 */
interface FilePickerProps {
  accept?: string;
  /** Display name of the pending/uploaded file, or null when none is chosen. */
  name: string | null;
  onFile: (file: File) => void;
  /** Clear the pending file without uploading. */
  onClear: () => void;
  uploading?: boolean;
  progress?: number;
  label?: string;
  error?: boolean;
}

export function FilePicker({
  accept,
  name,
  onFile,
  onClear,
  uploading = false,
  progress = 0,
  label = 'Choose file',
  error = false,
}: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const picking = uploading && !name;

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          aria-label={label}
        >
          <UploadCloud className="mr-1 h-3.5 w-3.5" aria-hidden />
          {picking ? 'Uploading…' : label}
        </Button>
        {name ? (
          <span className={cn('min-w-0 flex-1 truncate text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
            {name}
          </span>
        ) : null}
        {name && !uploading ? (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClear}
            aria-label={`Remove ${name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {uploading ? <Progress value={progress} className="h-1.5" aria-label={`Upload progress ${progress}%`} /> : null}
    </div>
  );
}