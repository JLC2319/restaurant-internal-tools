import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type {
  AuthUser,
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
  MembershipSummary,
  RegisterInput,
  UpdateMeInput,
} from '@rit/shared';
import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { User, SAFE_USER_FIELDS } from './auth.model';
import { listMembershipsForUser } from '../tenancy/tenancy.service';
import type { IUser } from '../../types/index';

const BCRYPT_ROUNDS = 12;

function signToken(user: { _id: unknown; email: string }): string {
  return jwt.sign({ sub: String(user._id), email: user.email }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as SignOptions);
}

function toAuthUser(user: {
  _id: unknown;
  name: IUser['name'];
  email: string;
  emailVerified: boolean;
  platformRole: IUser['platformRole'];
  status: IUser['status'];
  preferredLocale: IUser['preferredLocale'];
  phone?: string | null;
  jobTitle?: string | null;
}): AuthUser {
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    platformRole: user.platformRole,
    status: user.status,
    preferredLocale: user.preferredLocale,
    phone: user.phone ?? null,
    jobTitle: user.jobTitle ?? null,
  };
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw new AppError('An account with that email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    preferredLocale: input.preferredLocale,
  });

  return toAuthUser(user);
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  // `passwordHash` is `select: false`, so it has to be asked for explicitly.
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  // Compare against a dummy hash when the account does not exist so that a
  // missing account and a wrong password take the same time to answer.
  const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const passwordMatches = await bcrypt.compare(input.password, hash);

  if (!user || !passwordMatches) {
    throw new AppError('Invalid email or password', 401);
  }
  if (user.status === 'suspended') {
    // Checked here as well as in `authenticate` so a suspended account cannot
    // mint a fresh token to ride out the 7-day window.
    throw new AppError('Your account has been suspended.', 403);
  }

  user.lastLoginAt = new Date();
  await user.save();

  const memberships = await listMembershipsForUser(String(user._id));

  return { token: signToken(user), user: toAuthUser(user), memberships };
}

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await User.findById(userId).select(SAFE_USER_FIELDS).lean();
  if (!user) throw new AppError('User not found', 404);
  return toAuthUser(user);
}

export async function getMyMemberships(userId: string): Promise<MembershipSummary[]> {
  return listMembershipsForUser(userId);
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<AuthUser> {
  const user = await User.findByIdAndUpdate(userId, input, {
    new: true,
    runValidators: true,
  })
    .select(SAFE_USER_FIELDS)
    .lean();

  if (!user) throw new AppError('User not found', 404);
  return toAuthUser(user);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new AppError('User not found', 404);

  const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!matches) throw new AppError('Current password is incorrect', 401);

  user.passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await user.save();
}
