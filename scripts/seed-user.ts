import readline from 'readline';
import { Writable } from 'stream';
import { getDb } from '../server/db.js';
import { hashPassword } from '../server/services/auth.js';

function prompt(question: string, hidden = false): Promise<string> {
  const mutable = new Writable({
    write(chunk, _enc, cb) {
      if (!hidden) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: mutable, terminal: true });
  return new Promise(resolve => {
    process.stdout.write(question);
    rl.question('', answer => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const email = (await prompt('E-mail: ')).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Ongeldige e-mail');
    process.exit(1);
  }
  const password = await prompt('Wachtwoord: ', true);
  if (password.length < 12) {
    console.error('Wachtwoord moet minimaal 12 tekens zijn');
    process.exit(1);
  }
  const confirm = await prompt('Bevestig wachtwoord: ', true);
  if (password !== confirm) {
    console.error('Wachtwoorden komen niet overeen');
    process.exit(1);
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
  const hash = hashPassword(password);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`Wachtwoord bijgewerkt voor ${email}`);
  } else {
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
    console.log(`Gebruiker aangemaakt: ${email}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
