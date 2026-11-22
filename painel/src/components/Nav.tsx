'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Resumo' },
  { href: '/vendas', label: 'Vendas' },
  { href: '/campanhas', label: 'Campanhas' },
  { href: '/integracoes', label: 'Integrações' },
];

export default function Nav({ product }: { product: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  // os filtros acompanham a troca de aba (menos na de integrações)
  const qs = sp.toString();
  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-borda pb-4 sm:flex-nowrap sm:gap-6">
      <Link href={qs ? `/?${qs}` : '/'} className="mr-2 shrink-0 text-lg font-bold text-destaque">
        {product}
      </Link>
      <nav className="order-last -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
        {TABS.map((t) => {
          const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
          const href = qs && t.href !== '/integracoes' ? `${t.href}?${qs}` : t.href;
          return (
            <Link
              key={t.href}
              href={href}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-[15px] transition ${
                active ? 'bg-cartao2 text-texto' : 'text-suave hover:text-texto'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <form action="/api/auth/logout" method="post" className="ml-auto sm:ml-0">
        <button className="text-[15px] text-suave hover:text-texto">Sair</button>
      </form>
    </header>
  );
}
