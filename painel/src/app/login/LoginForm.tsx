'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? 'Não foi possível entrar.');
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="rotulo">E-mail</span>
        <input name="email" type="email" autoComplete="username" required className="campo mt-1.5" />
      </label>
      <label className="block">
        <span className="rotulo">Senha</span>
        <input name="password" type="password" autoComplete="current-password" required className="campo mt-1.5" />
      </label>
      {error && <p className="text-sm text-vermelho">{error}</p>}
      <button className="botao w-full" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
