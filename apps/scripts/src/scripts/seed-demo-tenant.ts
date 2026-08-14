/**
 * Seeds a demo tenant so the app is walkable immediately after a fresh clone:
 * one org, two properties, three locations, and an owner account.
 *
 *   pnpm -F @rit/scripts seed-demo-tenant owner@example.com 'a-long-password'
 *
 * Idempotent — re-running updates the existing records rather than duplicating
 * them, so it is safe to point at a database you have already seeded.
 */
import bcrypt from 'bcryptjs';
import { toSlug } from '@rit/shared';
import { User } from '@api/features/auth/auth.model';
import { Organization } from '@api/features/tenancy/organization.model';
import { Property } from '@api/features/tenancy/property.model';
import { Location } from '@api/features/tenancy/location.model';
import { Membership } from '@api/features/tenancy/membership.model';
import { run } from '../lib/db';

const [email, password] = process.argv.slice(2);

const ORG_NAME = 'Demo Restaurant Group';
const PROPERTIES = [
  { name: '60 Vines', locations: ['60 Vines Plano', '60 Vines Dallas'] },
  { name: 'Demo Steakhouse', locations: ['Demo Steakhouse Uptown'] },
];

await run(async () => {
  if (!email || !password) {
    throw new Error("Usage: seed-demo-tenant <owner-email> '<password>'");
  }
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters (matches registerSchema)');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      $setOnInsert: {
        name: { first: 'Demo', last: 'Owner' },
        email: email.toLowerCase(),
        passwordHash,
        emailVerified: true,
        platformRole: 'user',
        status: 'active',
        preferredLocale: 'en',
      },
    },
    { new: true, upsert: true },
  );
  console.log(`user       ${user.email} (${user._id})`);

  const org = await Organization.findOneAndUpdate(
    { slug: toSlug(ORG_NAME) },
    { $setOnInsert: { name: ORG_NAME, slug: toSlug(ORG_NAME), locales: ['en', 'es'] } },
    { new: true, upsert: true },
  );
  console.log(`org        ${org.name} (${org._id})`);

  await Membership.findOneAndUpdate(
    { userId: user._id, orgId: org._id, propertyId: null, locationId: null },
    {
      $setOnInsert: {
        userId: user._id,
        orgId: org._id,
        propertyId: null,
        locationId: null,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      },
    },
    { new: true, upsert: true },
  );
  console.log('membership owner @ org scope');

  for (const spec of PROPERTIES) {
    const property = await Property.findOneAndUpdate(
      { orgId: org._id, slug: toSlug(spec.name) },
      { $setOnInsert: { orgId: org._id, name: spec.name, slug: toSlug(spec.name) } },
      { new: true, upsert: true },
    );
    console.log(`property   ${property.name} (${property._id})`);

    for (const locationName of spec.locations) {
      const location = await Location.findOneAndUpdate(
        { orgId: org._id, slug: toSlug(locationName) },
        {
          $setOnInsert: {
            orgId: org._id,
            propertyId: property._id,
            name: locationName,
            slug: toSlug(locationName),
            timezone: 'America/Chicago',
          },
        },
        { new: true, upsert: true },
      );
      console.log(`location     ${location.name} (${location._id})`);
    }
  }

  console.log('\nDone. Sign in at http://localhost:6218/login');
});
