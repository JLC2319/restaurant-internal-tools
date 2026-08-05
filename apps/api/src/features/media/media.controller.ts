import type { Request, Response } from 'express';
import * as mediaService from './media.service';
import { pathParam } from '../../lib/params';

export async function uploadPhoto(req: Request, res: Response): Promise<void> {
  const asset = await mediaService.uploadPhoto(req.tenant!, req.userId!, req.file);
  res.status(201).json(asset);
}

export async function uploadVideo(req: Request, res: Response): Promise<void> {
  const asset = await mediaService.recordVideoUpload(req.tenant!, req.userId!, req.file);
  res.status(201).json(asset);
}

export async function deleteAsset(req: Request, res: Response): Promise<void> {
  await mediaService.deleteAsset(req.tenant!, pathParam(req, 'id'));
  res.status(204).send();
}
