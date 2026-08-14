import type { Request, Response } from 'express';
import type {
  CreateLocationInput,
  CreateOrganizationInput,
  CreatePropertyInput,
  InviteMemberInput,
  PaginationInput,
  UpdateLocationInput,
  UpdateMembershipInput,
  UpdateOrganizationInput,
  UpdatePropertyInput,
} from '@rit/shared';
import * as tenancyService from './tenancy.service';
import { pathParam, queryParam } from '../../lib/params';

export async function createOrganization(req: Request, res: Response): Promise<void> {
  const org = await tenancyService.createOrganization(
    req.userId!,
    req.body as CreateOrganizationInput,
  );
  res.status(201).json(org);
}

export async function getOrganization(req: Request, res: Response): Promise<void> {
  const org = await tenancyService.getOrganization(req.tenant!);
  res.status(200).json(org);
}

export async function updateOrganization(req: Request, res: Response): Promise<void> {
  const org = await tenancyService.updateOrganization(
    req.tenant!,
    req.body as UpdateOrganizationInput,
  );
  res.status(200).json(org);
}

export async function getTenantTree(req: Request, res: Response): Promise<void> {
  const tree = await tenancyService.getTenantTree(req.tenant!);
  res.status(200).json(tree);
}

export async function createProperty(req: Request, res: Response): Promise<void> {
  const property = await tenancyService.createProperty(
    req.tenant!,
    req.body as CreatePropertyInput,
  );
  res.status(201).json(property);
}

export async function listProperties(req: Request, res: Response): Promise<void> {
  const properties = await tenancyService.listProperties(req.tenant!);
  res.status(200).json(properties);
}

export async function updateProperty(req: Request, res: Response): Promise<void> {
  const property = await tenancyService.updateProperty(
    req.tenant!,
    pathParam(req, 'id'),
    req.body as UpdatePropertyInput,
  );
  res.status(200).json(property);
}

export async function createLocation(req: Request, res: Response): Promise<void> {
  const location = await tenancyService.createLocation(
    req.tenant!,
    req.body as CreateLocationInput,
  );
  res.status(201).json(location);
}

export async function listLocations(req: Request, res: Response): Promise<void> {
  const propertyId = queryParam(req, 'propertyId');
  const locations = await tenancyService.listLocations(req.tenant!, propertyId);
  res.status(200).json(locations);
}

export async function updateLocation(req: Request, res: Response): Promise<void> {
  const location = await tenancyService.updateLocation(
    req.tenant!,
    pathParam(req, 'id'),
    req.body as UpdateLocationInput,
  );
  res.status(200).json(location);
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.validatedQuery as PaginationInput;
  const members = await tenancyService.listMembers(req.tenant!, page, limit);
  res.status(200).json(members);
}

export async function inviteMember(req: Request, res: Response): Promise<void> {
  const result = await tenancyService.inviteMember(
    req.tenant!,
    req.userId!,
    req.body as InviteMemberInput,
  );
  res.status(201).json(result);
}

export async function updateMembership(req: Request, res: Response): Promise<void> {
  await tenancyService.updateMembership(
    req.tenant!,
    pathParam(req, 'id'),
    req.body as UpdateMembershipInput,
  );
  res.status(204).send();
}

export async function revokeMembership(req: Request, res: Response): Promise<void> {
  await tenancyService.revokeMembership(req.tenant!, pathParam(req, 'id'));
  res.status(204).send();
}
