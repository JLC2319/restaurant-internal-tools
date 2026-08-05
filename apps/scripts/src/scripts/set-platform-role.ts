/**
 * Grants or removes platform staff access. `superAdmin` bypasses tenant role
 * checks everywhere, so this is us, never a customer.
 *
 *   pnpm -F @rit/scripts set-platform-role -- someone@example.com superAdmin
 *   pnpm -F @rit/scripts set-platform-role -- someone@example.com user
 */
import { platformRoleValues } from '@rit/shared';
import type { PlatformRole } from '@rit/shared';
import { User } from '@api/features/auth/auth.model';
import { run } from '../lib/db';

const [email, role] = process.argv.slice(2);

await run(async () => {
  if (!email || !role) {
    throw new Error(`Usage: set-platform-role -- <email> <${platformRoleValues.join('|')}>`);
  }
  if (!platformRoleValues.includes(role as PlatformRole)) {
    throw new Error(`Unknown role '${role}'. Expected one of: ${platformRoleValues.join(', ')}`);
  }

  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { platformRole: role },
    { new: true }
  )
    .select('email platformRole')
    .lean();

  if (!user) throw new Error(`No user found with email '${email}'`);

  console.log(`${user.email} → ${user.platformRole}`);
});
