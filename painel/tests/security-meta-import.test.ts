import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, keyFingerprint } from '@/lib/crypto';
import { checkCredentials, hashPassword, loadUsers, verifyPassword } from '@/lib/password';
import { allowedEmails, signSession, verifySession } from '@/lib/session';
import { activationFor, balanceCents, parseInsight } from '@/lib/meta';
import { buildPurchaseEvent, fbcFrom, normalizePhone } from '@/lib/capi';
import { parseCsv, parseStatus, resolveColumns, rowsToSales } from '@/lib/importer';

const KEY = randomBytes(32).toString('base64');
const SECRET = 'x'.repeat(40);

describe('cifragem AES-256-GCM', () => {
  it('ida e volta, e chave trocada falha com mensagem clara', () => {
    const blob = encrypt('EAAtoken', KEY);
    expect(blob).not.toContain('EAAtoken');
    expect(decrypt(blob, KEY)).toBe('EAAtoken');
    expect(() => decrypt(blob, randomBytes(32).toString('base64'))).toThrow(/ENCRYPTION_KEY mudou/);
    expect(keyFingerprint(KEY)).toHaveLength(16);
    expect(() => encrypt('x', 'curta')).toThrow();
  });
});

describe('login', () => {
  it('scrypt e AUTH_USERS', async () => {
    const hash = await hashPassword('s3nha-forte');
    expect(await verifyPassword('s3nha-forte', hash)).toBe(true);
    expect(await verifyPassword('errada', hash)).toBe(false);
    const users = loadUsers(JSON.stringify([{ email: 'A@B.com', hash }]));
    expect(await checkCredentials('a@b.com', 's3nha-forte', users)).toBe('a@b.com');
    expect(await checkCredentials('a@b.com', 'errada', users)).toBeNull();
    expect(await checkCredentials('outro@b.com', 's3nha-forte', users)).toBeNull();
    expect(loadUsers('não é json')).toEqual([]);
    // formato novo, sem "$" (que o build pode expandir e corromper)
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('$');
    // aspas curvas e crases coladas por engano
    const curly = '`[{\u201Cemail\u201D:\u201Ca@b.com\u201D,\u201Chash\u201D:\u201C' + hash + '\u201D}]`';
    expect(await checkCredentials('a@b.com', 's3nha-forte', loadUsers(curly))).toBe('a@b.com');
    expect(allowedEmails(curly).has('a@b.com')).toBe(true);
  });

  it('sessão assinada: adulterada ou expirada é recusada', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const tok = await signSession({ email: 'a@b.com', exp }, SECRET);
    expect((await verifySession(tok, SECRET))?.email).toBe('a@b.com');
    expect(await verifySession(tok, 'y'.repeat(40))).toBeNull();
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'hacker@x.com', exp })).toString('base64url');
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${body}.${sig}`, SECRET, (exp + 1) * 1000)).toBeNull();
    expect(allowedEmails(JSON.stringify([{ email: 'A@b.com' }])).has('a@b.com')).toBe(true);
  });
});

describe('Meta', () => {
  it('conta nova entra INATIVA quando o token enxerga mais de uma', () => {
    const r = activationFor(['act_1', 'act_2', 'act_3'], new Map());
    expect([...r.values()]).toEqual([false, false, false]);
  });

  it('uma única conta entra ativa', () => {
    expect(activationFor(['act_1'], new Map()).get('act_1')).toBe(true);
  });

  it('reconectar não desfaz a seleção feita', () => {
    const known = new Map([
      ['act_1', false],
      ['act_2', true],
    ]);
    const r = activationFor(['act_1', 'act_2', 'act_9'], known);
    expect(r.get('act_1')).toBe(false);
    expect(r.get('act_2')).toBe(true);
    expect(r.get('act_9')).toBe(false);
    // mesmo que agora o token enxergue só uma, a escolha anterior vale
    expect(activationFor(['act_1'], known).get('act_1')).toBe(false);
  });

  it('gasto em texto decimal vira centavos exatos', () => {
    const p = parseInsight({ campaign_id: '1', campaign_name: 'C', date_start: '2026-03-10', spend: '979.85', impressions: '1200', clicks: '33' });
    expect(p).toMatchObject({ spendCents: 97985, impressions: 1200, clicks: 33 });
    expect(balanceCents('97985')).toBe(97985);
    expect(balanceCents(undefined)).toBeNull();
  });
});

describe('Conversions API', () => {
  const s = {
    platform: 'wiapy',
    externalId: 'PAY-1',
    grossCents: 11690,
    productName: 'Mapas',
    customerEmail: ' Ana@Ex.com ',
    customerPhone: '(11) 99999-8888',
    customerName: 'Ana Maria Souza',
    orderedAt: new Date('2026-03-10T12:00:00Z'),
    paidAt: new Date('2026-03-10T12:05:00Z'),
    fbclid: 'IwAR1',
    fbc: null,
    fbp: 'fb.1.123.456',
    clientIp: '1.2.3.4',
    userAgent: 'Mozilla',
  };

  it('monta o evento com identificadores de atribuição', () => {
    const e = buildPurchaseEvent(s);
    expect(e.event_id).toBe('wiapy:PAY-1');
    expect(e.custom_data.value).toBe(116.9);
    expect(e.user_data.fbc).toBe(`fb.1.${s.orderedAt.getTime()}.IwAR1`);
    expect(e.user_data.fbp).toBe('fb.1.123.456');
    expect(e.user_data.client_user_agent).toBe('Mozilla');
    expect((e.user_data.em as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(e)).not.toContain('ana@ex.com');
  });

  it('fbc vindo do checkout tem prioridade; telefone ganha DDI', () => {
    expect(fbcFrom({ ...s, fbc: 'fb.1.9.Q' })).toBe('fb.1.9.Q');
    expect(normalizePhone('(11) 99999-8888')).toBe('5511999998888');
  });
});

describe('importação de histórico', () => {
  const csv =
    '﻿ID da venda;Status;Produto;Cliente;Email;Método de pagamento;Valor total;Valor líquido;Data de criação;Data de aprovação\n' +
    'a1;Aprovada;Curso;Ana;ana@x.com;Cartão de crédito;"1.234,56";"1.100,00";10/03/2026 21:30;10/03/2026 21:31\n' +
    'a2;Aguardando pagamento;Curso;Bia;bia@x.com;Pix;97,00;90,50;10/03/2026 10:00;\n' +
    'a3;Reembolsada;Curso;Caio;c@x.com;Boleto;2,00;-0,11;01/03/2026 10:00;01/03/2026 11:00\n' +
    'a4;???;Curso;Dani;d@x.com;Pix;1,00;1,00;01/03/2026 10:00;\n';

  it('lê CSV brasileiro com ponto-e-vírgula, aspas e BOM', () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    const { map, missing } = resolveColumns(Object.keys(rows[0]));
    expect(missing).toEqual([]);
    const { sales, errors } = rowsToSales(rows, map);
    expect(errors).toEqual([{ line: 5, error: 'status não reconhecido: "???"' }]);
    expect(sales[0]).toMatchObject({ externalId: 'a1', status: 'approved', grossCents: 123456, netCents: 110000, paymentMethod: 'card' });
    expect(sales[0].paidAt!.toISOString()).toBe('2026-03-11T00:31:00.000Z'); // 21h31 de Brasília
    expect(sales[1]).toMatchObject({ status: 'pending', paidAt: null, paymentMethod: 'pix', grossCents: 9700 });
    expect(sales[2]).toMatchObject({ status: 'refunded', netCents: -11 });
    // sem atribuição inventada
    expect(sales.every((s) => s.tracking.utmSource === null && s.tracking.utmCampaign === null)).toBe(true);
  });

  it('coluna obrigatória faltando é informada, não adivinhada', () => {
    expect(resolveColumns(['Status', 'Produto']).missing).toEqual(['id', 'gross', 'net', 'ordered']);
  });

  it('status em português', () => {
    expect(parseStatus('Paga')).toBe('approved');
    expect(parseStatus('Chargeback')).toBe('chargeback');
    expect(parseStatus('Pix expirado')).toBe('canceled');
    expect(parseStatus('Reembolso solicitado')).toBe('refunded');
  });
});

describe('importação — colunas da Hubla', () => {
  it('reconhece ID da fatura, Data da criação e Receita líquida', () => {
    const rows = parseCsv(
      'Valor total;Status;ID da fatura;Cliente;Produto;Data da criação;Receita líquida;Método de pagamento\n' +
        'R$ 97,00;Paga;6f286f23-aaaa;Genezio;Novena;22/11/2026 10:15;R$ 85,88;Pix\n' +
        'R$ 97,00;Paga;b52bd717-bbbb;Darcilia;Novena;21/11/2026 21:40;R$ 85,88;Cartão de crédito\n',
    );
    const { map, missing } = resolveColumns(Object.keys(rows[0]));
    expect(missing).toEqual([]);
    expect(map.id).toBe('ID da fatura');
    const { sales, errors } = rowsToSales(rows, map);
    expect(errors).toEqual([]);
    expect(sales.map((s) => [s.externalId, s.grossCents, s.netCents, s.paymentMethod])).toEqual([
      ['6f286f23-aaaa', 9700, 8588, 'pix'],
      ['b52bd717-bbbb', 9700, 8588, 'card'],
    ]);
    // 21h40 de Brasília continua no dia 21
    expect(sales[1].paidAt!.toISOString()).toBe('2026-11-22T00:40:00.000Z');
  });
});

describe('importação — exportação real da Hubla (cabeçalhos de nov/2026)', () => {
  const header =
    'ID da fatura;Tipo de fatura;Status da fatura;Método de pagamento;Data de criação;Data de pagamento;Data de reembolso;' +
    'Nome da oferta;ID do produto;Nome do produto;Nome do cliente;Email do cliente;Telefone do cliente;Valor total;' +
    'Taxa Hubla variável;Valor Líquido;Valor da sua comissão;UTM Origem;UTM Mídia;UTM Campanha;UTM Conteúdo;UTM Termo;' +
    'Cookie fbclid;Cookie fbp;Cookie fbc;URL de Compra';
  const csv =
    header + '\n' +
    'inv-1;sell;Paga;pix;21/11/2026 21:40;21/11/2026 21:42;;Oferta;prod-1;Novena;Darcilia;d@x.com;+5511;97,00;11,12;85,88;80,00;FB;paid;STAGE03|120200000000001;ad1;;IwZZ;fb.1.1.2;;https://pay.hub.la/x\n' +
    'inv-2;sell;unpaid;pix;22/11/2026 10:00;;;Oferta;prod-1;Novena;Hery;h@x.com;;97,00;;;;;;;;;;;;\n';

  it('mapeia status da fatura, sua comissão (não o líquido total) e UTM/cookies reais', () => {
    const rows = parseCsv(csv);
    const { map, missing } = resolveColumns(Object.keys(rows[0]));
    expect(missing).toEqual([]);
    expect([map.status, map.net, map.ordered, map.paid]).toEqual([
      'Status da fatura',
      'Valor da sua comissão',
      'Data de criação',
      'Data de pagamento',
    ]);
    const { sales, errors } = rowsToSales(rows, map);
    expect(errors).toEqual([]);
    expect(sales[1]).toMatchObject({ externalId: 'inv-2', status: 'pending', netCents: 0, paidAt: null });
    const s = sales[0];
    expect(s).toMatchObject({ externalId: 'inv-1', status: 'approved', grossCents: 9700, netCents: 8000, productId: 'prod-1' });
    expect(s.paidAt!.toISOString()).toBe('2026-11-22T00:42:00.000Z');
    expect(s.tracking).toMatchObject({ utmSource: 'FB', utmCampaign: 'STAGE03|120200000000001', fbclid: 'IwZZ', fbp: 'fb.1.1.2', utmTerm: null });
  });

  it('paga sem líquido continua sendo erro (não grava R$ 0 de receita)', () => {
    const rows = parseCsv(header + '\ninv-3;sell;Paga;pix;21/11/2026 10:00;21/11/2026 10:01;;O;p;N;C;c@x;;97,00;;;;;;;;;;;;\n');
    const { map } = resolveColumns(Object.keys(rows[0]));
    expect(rowsToSales(rows, map).errors).toEqual([{ line: 2, error: 'Valor ausente' }]);
  });

  it('"unpaid" é pendente, não paga (contém "paid")', () => {
    expect(parseStatus('unpaid')).toBe('pending');
    expect(parseStatus('Não paga')).toBe('pending');
    expect(parseStatus('paid')).toBe('approved');
  });
});
