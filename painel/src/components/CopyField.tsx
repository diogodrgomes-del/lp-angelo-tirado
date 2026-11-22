'use client';

import { useState } from 'react';

export default function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-3">
      <input readOnly value={value} className="campo flex-1 bg-fundo font-mono text-sm" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="botao-sec shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}
