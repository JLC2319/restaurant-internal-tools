/**
 * Prints a per-tenant summary of what is in the database.
 *
 *   pnpm -F @rit/scripts stats
 */
import { User } from '@api/features/auth/auth.model';
import { Organization } from '@api/features/tenancy/organization.model';
import { Property } from '@api/features/tenancy/property.model';
import { Location } from '@api/features/tenancy/location.model';
import { Membership } from '@api/features/tenancy/membership.model';
import { run } from '../lib/db';

await run(async () => {
  const [users, orgs] = await Promise.all([User.countDocuments(), Organization.find().lean()]);

  console.log(`users  ${users}`);
  console.log(`orgs   ${orgs.length}\n`);

  for (const org of orgs) {
    const [properties, locations, members] = await Promise.all([
      Property.countDocuments({ orgId: org._id }),
      Location.countDocuments({ orgId: org._id }),
      Membership.countDocuments({ orgId: org._id, status: 'active' }),
    ]);
    // Every tier is a billed seat, so this line is also the invoice preview.
    console.log(
      `${org.name}  (${org.slug})\n` +
        `  properties ${properties}\n` +
        `  locations  ${locations}\n` +
        `  members    ${members}\n` +
        `  seats      ${1 + properties + locations}`,
    );
  }
});
