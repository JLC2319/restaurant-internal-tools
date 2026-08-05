import type { Document, Types } from 'mongoose';
import type {
  Locale,
  MembershipStatus,
  PlatformRole,
  TenantContext,
  TenantRole,
  TenantStatus,
  UserName,
  UserStatus,
} from '@rit/shared';

// Re-export the shared domain types so feature modules can import everything
// they need from '../../types/index' without reaching past the shared barrel.
export type {
  Locale,
  MembershipStatus,
  PlatformRole,
  TenantContext,
  TenantRole,
  TenantStatus,
  UserName,
  UserStatus,
};

/**
 * The scope stamped on every tenant-owned document, in its Mongoose form.
 * See lib/scope.ts — `propertyId` and `locationId` are explicit null, not absent.
 */
export interface IScope {
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId | null;
  locationId: Types.ObjectId | null;
}

export interface IUser extends Document {
  name: UserName;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  platformRole: PlatformRole;
  status: UserStatus;
  preferredLocale: Locale;
  lastLoginAt?: Date;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IOrganization extends Document {
  name: string;
  slug: string;
  status: TenantStatus;
  /** Locales this org publishes in. `en` is the authoring locale and always present. */
  locales: Locale[];
  createdAt: Date;
  modifiedAt: Date;
}

export interface IProperty extends Document {
  orgId: Types.ObjectId;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IAddress {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface ILocation extends Document {
  orgId: Types.ObjectId;
  propertyId: Types.ObjectId;
  name: string;
  slug: string;
  /** IANA zone. Line checks and prep lists are day-bounded, so this is load-bearing. */
  timezone: string;
  address?: IAddress;
  status: TenantStatus;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IMembership extends Document {
  userId: Types.ObjectId;
  orgId: Types.ObjectId;
  /** Null for an org-wide membership. */
  propertyId: Types.ObjectId | null;
  /** Null unless the membership is pinned to a single location. */
  locationId: Types.ObjectId | null;
  role: TenantRole;
  status: MembershipStatus;
  invitedBy?: Types.ObjectId;
  joinedAt?: Date;
  createdAt: Date;
  modifiedAt: Date;
}

// Extend the Express request with what our middleware attaches.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate` / `optionalAuthenticate` — the JWT `sub` claim. */
      userId?: string;
      /** Set by `resolveTenant` — the caller's position in the hierarchy. */
      tenant?: TenantContext;
      /** Set by `validateQuery` — Express 5 makes `req.query` read-only. */
      validatedQuery?: unknown;
    }
  }
}
