import type { Request, Response } from 'express';
import type { TranslationLocaleInput, UpdateTrainingTranslationInput } from '@rit/shared';
import * as trainingTranslationService from './trainingTranslation.service';
import { pathParam } from '../../lib/params';

export async function getTrainingTranslationState(req: Request, res: Response): Promise<void> {
  const state = await trainingTranslationService.getTrainingTranslationState(
    req.tenant!,
    pathParam(req, 'trainingId'),
    (req.validatedQuery as TranslationLocaleInput).locale
  );
  res.status(200).json(state);
}

export async function requestTrainingTranslation(req: Request, res: Response): Promise<void> {
  const translation = await trainingTranslationService.requestTrainingTranslation(
    req.tenant!,
    req.userId!,
    pathParam(req, 'trainingId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}

export async function updateTrainingTranslation(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateTrainingTranslationInput;
  const translation = await trainingTranslationService.updateTrainingTranslation(
    req.tenant!,
    pathParam(req, 'trainingId'),
    input.locale,
    input.payload
  );
  res.status(200).json(translation);
}

export async function approveTrainingTranslation(req: Request, res: Response): Promise<void> {
  const translation = await trainingTranslationService.approveTrainingTranslation(
    req.tenant!,
    req.userId!,
    pathParam(req, 'trainingId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}

export async function rejectTrainingTranslation(req: Request, res: Response): Promise<void> {
  const translation = await trainingTranslationService.rejectTrainingTranslation(
    req.tenant!,
    pathParam(req, 'trainingId'),
    (req.body as TranslationLocaleInput).locale
  );
  res.status(200).json(translation);
}
