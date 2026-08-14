/**
 * Creates an account directly, already email-verified — for test accounts and
 * for operators who need one ahead of the (unbuilt) verification-email flow.
 * Produces the same document as POST /api/auth/register, plus emailVerified.
 *
 *   pnpm -F @rit/scripts create-user someone@example.com 'a-long-password' [First] [Last]
 *
 * Note: this writes through Mongoose, which does not enforce the zod email
 * format — an address the API would reject (e.g. no TLD) can be created here
 * but will never pass validation on the login or register endpoints.
 */
import bcrypt from 'bcryptjs';
import { User } from '@api/features/auth/auth.model';
import { run } from '../lib/db';

const [email, password, first = 'Test', last = 'User'] = process.argv.slice(2);

await run(async () => {
  if (!email || !password) {
    throw new Error("Usage: create-user <email> '<password>' [first] [last]");
  }
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters (matches registerSchema)');
  }

  const existing = await User.findOne({ email: email.toLowerCase() }).select('_id').lean();
  if (existing) {
    throw new Error(`A user with email '${email}' already exists (${existing._id})`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name: { first, last },
    email: email.toLowerCase(),
    passwordHash,
    emailVerified: true,
  });

  console.log(
    `created ${user.email} (${user._id}) emailVerified=${user.emailVerified} status=${user.status}`,
  );
});
