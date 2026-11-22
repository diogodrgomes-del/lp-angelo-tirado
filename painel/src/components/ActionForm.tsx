'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

type State = { ok: boolean; msg: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

/** Formulário de server action com mensagem de retorno. */
export default function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, run] = useActionState<State, FormData>(action, { ok: true, msg: '' });
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.msg && (
        <p role="status" className={`mt-3 whitespace-pre-line text-sm ${state.ok ? 'text-verde' : 'text-vermelho'}`}>
          {state.msg}
        </p>
      )}
    </form>
  );
}

/** Botão que trava e troca o texto enquanto a ação roda. */
export function Submit({
  children,
  busy = 'Salvando…',
  variant = 'primario',
  name,
  value,
}: {
  children: React.ReactNode;
  busy?: string;
  variant?: 'primario' | 'secundario' | 'link';
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === 'primario'
      ? 'botao'
      : variant === 'secundario'
        ? 'botao-sec'
        : 'text-[15px] text-texto/80 hover:text-texto disabled:opacity-50';
  return (
    <button type="submit" className={cls} disabled={pending} name={name} value={value}>
      {pending ? busy : children}
    </button>
  );
}
