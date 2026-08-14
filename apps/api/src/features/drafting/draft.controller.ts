import type { Request, Response } from 'express';
import type { DraftRecipesInput, DraftTrainingsInput } from '@rit/shared';
import * as draftService from './draft.service';
import * as trainingDraftService from './trainingDraft.service';
import { env } from '../../config/env';

export function getConfig(_req: Request, res: Response): void {
  res.status(200).json({ enabled: env.aiDraftingEnabled });
}

export async function draftRecipes(req: Request, res: Response): Promise<void> {
  const result = await draftService.draftRecipesFromPhotos(
    req.tenant!,
    req.files as Express.Multer.File[] | undefined,
    (req.body as DraftRecipesInput).hint,
  );
  res.status(200).json(result);
}

export async function draftTrainings(req: Request, res: Response): Promise<void> {
  const result = await trainingDraftService.draftTrainingsFromMaterials(
    req.tenant!,
    req.files as Express.Multer.File[] | undefined,
    (req.body as DraftTrainingsInput).description,
  );
  res.status(200).json(result);
}
