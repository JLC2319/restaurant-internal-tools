import type { Request, Response } from 'express';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateMeInput,
} from '@rit/shared';
import * as authService from './auth.service';

export async function register(req: Request, res: Response): Promise<void> {
  const user = await authService.register(req.body as RegisterInput);
  res.status(201).json(user);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  res.status(200).json(result);
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await authService.getMe(req.userId!);
  res.status(200).json(user);
}

export async function getMyMemberships(req: Request, res: Response): Promise<void> {
  const memberships = await authService.getMyMemberships(req.userId!);
  res.status(200).json(memberships);
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = await authService.updateMe(req.userId!, req.body as UpdateMeInput);
  res.status(200).json(user);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(req.userId!, req.body as ChangePasswordInput);
  res.status(204).send();
}
