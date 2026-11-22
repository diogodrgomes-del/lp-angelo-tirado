'use client';

import { useState } from 'react';

interface Preview {
  ok: boolean;
  error?: string;
  columns?: Record<string, string>;
  missing?: string[];
  headers?: string[];
  total?: number;
  valid?: number;
  errors?: { line: number; error: string }[];
  byStatus?: Record<string, number>;
  approvedNetCents?: number;
  withCampaign?: number;
  created?: number;
  skipped?: number;
  updated?: number;
  sample?: { externalId: string; status: string; grossCents: number; netCents: number; orderedAt: string; paidAt: string | null }[];
}

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Importa a exportação da plataforma. Sempre mostra a prévia primeiro
 * (colunas reconhecidas, totais, erros por linha) e só grava ao confirmar.
 */
export default function ImportForm({ platforms }: { platforms: { id: string; label: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState(platforms[0]?.id ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(mode: 'preview' | 'commit') {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('platform', platform);
    fd.set('mode', mode);
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    setPreview((await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as Preview);
    setBusy(false);
  }

  if (!platforms.length) return <p className="text-sm text-suave">Nenhuma plataforma de checkout habilitada.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {platforms.length > 1 && (
          <select className="campo w-auto" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Plataforma">
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="text-sm text-suave file:mr-3 file:rounded-lg file:border file:border-borda file:bg-cartao2 file:px-4 file:py-2 file:text-texto"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
        />
        <button type="button" className="botao-sec" disabled={!file || busy} onClick={() => send('preview')}>
          {busy ? 'Lendo…' : 'Ver prévia'}
        </button>
      </div>

      {preview && !preview.ok && <p className="whitespace-pre-line text-sm text-vermelho">{preview.error}</p>}
      {preview?.ok && preview.created === undefined && (
        <div className="space-y-3 rounded-lg border border-borda bg-cartao2 p-4 text-sm">
          <p>
            {preview.valid} de {preview.total} linha(s) válidas · aprovadas somam <strong>{brl(preview.approvedNetCents ?? 0)}</strong> líquido
          </p>
          <p className="text-suave">
            Com utm_campaign: {preview.withCampaign ?? 0} de {preview.valid}
          </p>
          <p className="text-suave">
            Por status:{' '}
            {Object.entries(preview.byStatus ?? {})
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ')}
          </p>
          <p className="text-suave">
            Colunas lidas:{' '}
            {Object.entries(preview.columns ?? {})
              .map(([k, v]) => `${k} ← "${v}"`)
              .join(' · ')}
          </p>
          {!!preview.errors?.length && (
            <details>
              <summary className="cursor-pointer text-amarelo">{preview.errors.length} linha(s) com erro (não serão importadas)</summary>
              <ul className="mt-2 max-h-48 overflow-auto text-xs text-suave">
                {preview.errors.slice(0, 200).map((e) => (
                  <li key={e.line}>
                    linha {e.line}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-suave">
            Confira o total com a exportação antes de confirmar. Vendas que já vieram pelo webhook não são alteradas. Campanha só
            quando a exportação traz a UTM — nunca inventada.
          </p>
          <button type="button" className="botao" disabled={busy || !preview.valid} onClick={() => send('commit')}>
            {busy ? 'Importando…' : `Importar ${preview.valid} venda(s)`}
          </button>
        </div>
      )}
      {preview?.ok && preview.created !== undefined && (
        <p className="text-sm text-verde">
          Importado: {preview.created} nova(s), {preview.updated} atualizada(s), {preview.skipped} já vinham do webhook.
        </p>
      )}
    </div>
  );
}
