/**
 * Marks an account's email as verified. Email sending is not built yet (see
 * §9 of AGENTS.md), so until it lands this is how an account gets verified.
 *
 *   pnpm -F @rit/scripts verify-email someone@example.com
 */
import { User } from '@api/features/auth/auth.model';
import { run } from '../lib/db';

const [email] = process.argv.slice(2);

await run(async () => {
  if (!email) throw new Error('Usage: verify-email <email>');

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { emailVerified: true, $unset: { emailVerificationToken: 1 } },
    { new: true }
  )
    .select('email emailVerified')
    .lean();

  if (!user) throw new Error(`No user found with email '${email}'`);

  console.log(`${user.email} emailVerified=${user.emailVerified}`);
});
