import { PRODUCT_NAME } from '@/config';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="cartao w-full max-w-sm p-8">
        <p className="text-lg font-bold text-destaque">{PRODUCT_NAME}</p>
        <h1 className="mt-1 text-xl font-semibold">Entrar no painel</h1>
        <LoginForm />
      </div>
    </main>
  );
}
