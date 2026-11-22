import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getEnabledProvider } from '@/lib/providers';
import { parseCsv, parseXlsx, resolveColumns, rowsToSales } from '@/lib/importer';
import { upsertSale } from '@/lib/sales';

export const maxDuration = 60;
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ ok: false, error: 'não autenticado' }, { status: 401 });
  }
  const fd = await req.formData();
  const file = fd.get('file');
  const platform = String(fd.get('platform') ?? '');
  const mode = fd.get('mode') === 'commit' ? 'commit' : 'preview';
  if (!getEnabledProvider(platform)) return NextResponse.json({ ok: false, error: 'Plataforma não habilitada.' });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Envie um arquivo.' });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Arquivo maior que 15 MB.' });

  const buf = await file.arrayBuffer();
  let rows;
  try {
    rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(buf) : parseCsv(new TextDecoder('utf-8').decode(buf));
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Não consegui ler o arquivo: ${(e as Error).message}` });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: 'Planilha vazia.' });

  const headers = Object.keys(rows[0]);
  const { map, missing } = resolveColumns(headers);
  if (missing.length) {
    return NextResponse.json({
      ok: false,
      error:
        `Colunas obrigatórias não encontradas: ${missing.join(', ')}.\n` +
        `Colunas do arquivo: ${headers.join(' | ')}\n` +
        'Mande esta mensagem para ajustar o mapeamento — nada foi gravado.',
    });
  }
  const { sales, errors } = rowsToSales(rows, map);

  if (mode === 'preview') {
    const byStatus: Record<string, number> = {};
    for (const s of sales) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    return NextResponse.json({
      ok: true,
      columns: map,
      total: rows.length,
      valid: sales.length,
      errors,
      byStatus,
      approvedNetCents: sales.filter((s) => s.status === 'approved').reduce((t, s) => t + s.netCents, 0),
    });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of sales) {
    const r = await upsertSale(platform, s, 'import');
    if (r.skipped) skipped++;
    else if (r.created) created++;
    else updated++;
  }
  return NextResponse.json({ ok: true, created, updated, skipped });
}
