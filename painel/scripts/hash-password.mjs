// Gera a linha de AUTH_USERS para um e-mail. A senha é pedida sem aparecer na tela.
//   npm run hash-password -- pessoa@exemplo.com
import { randomBytes, scrypt } from 'node:crypto';
import { createInterface } from 'node:readline';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Uso: npm run hash-password -- pessoa@exemplo.com');
  process.exit(1);
}

function ask(q) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(q)) rl.output.write(q);
    };
    rl.question(q, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolve(a);
    });
  });
}

const pass = await ask('Senha (mínimo 10 caracteres): ');
if (pass.length < 10) {
  console.error('Senha curta demais.');
  process.exit(1);
}
const again = await ask('Repita a senha: ');
if (pass !== again) {
  console.error('As senhas não conferem.');
  process.exit(1);
}

const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
scrypt(pass, salt, 64, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
  if (err) throw err;
  const hash = ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
  console.log('\nAdicione este objeto à lista em AUTH_USERS:\n');
  console.log(JSON.stringify({ email, hash }));
});
