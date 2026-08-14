import type { Request, Response } from 'express';
import type {
  PlatformCreateOrganizationInput,
  PlatformListQuery,
  PlatformUpdateOrganizationInput,
  PlatformUpdateUserInput,
} from '@rit/shared';
import * as platformService from './platform.service';
import { pathParam } from '../../lib/params';

export async function getStats(_req: Request, res: Response): Promise<void> {
  const stats = await platformService.getStats();
  res.status(200).json(stats);
}

export async function listOrganizations(req: Request, res: Response): Promise<void> {
  const page = await platformService.listOrganizations(req.validatedQuery as PlatformListQuery);
  res.status(200).json(page);
}

export async function createOrganization(req: Request, res: Response): Promise<void> {
  const org = await platformService.createOrganizationForOwner(
    req.body as PlatformCreateOrganizationInput,
  );
  res.status(201).json(org);
}

export async function getOrganizationDetail(req: Request, res: Response): Promise<void> {
  const detail = await platformService.getOrganizationDetail(pathParam(req, 'id'));
  res.status(200).json(detail);
}

export async function updateOrganization(req: Request, res: Response): Promise<void> {
  const org = await platformService.updateOrganization(
    pathParam(req, 'id'),
    req.body as PlatformUpdateOrganizationInput,
  );
  res.status(200).json(org);
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const page = await platformService.listUsers(req.validatedQuery as PlatformListQuery);
  res.status(200).json(page);
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const user = await platformService.updateUser(
    req.userId!,
    pathParam(req, 'id'),
    req.body as PlatformUpdateUserInput,
  );
  res.status(200).json(user);
}
