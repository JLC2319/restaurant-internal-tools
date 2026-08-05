import type { Request, Response } from 'express';
import type { CreateTrainingInput, ListTrainingsQuery, UpdateTrainingInput } from '@rit/shared';
import * as trainingService from './trainingModule.service';
import { pathParam } from '../../lib/params';

export async function listTrainings(req: Request, res: Response): Promise<void> {
  const trainings = await trainingService.listTrainings(
    req.tenant!,
    req.userId!,
    req.validatedQuery as ListTrainingsQuery
  );
  res.status(200).json(trainings);
}

export async function getTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.getTraining(req.tenant!, req.userId!, pathParam(req, 'id'));
  res.status(200).json(training);
}

export async function createTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.createTraining(
    req.tenant!,
    req.userId!,
    req.body as CreateTrainingInput
  );
  res.status(201).json(training);
}

export async function updateTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.updateTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id'),
    req.body as UpdateTrainingInput
  );
  res.status(200).json(training);
}

export async function publishTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.publishTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id')
  );
  res.status(200).json(training);
}

export async function unpublishTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.unpublishTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id')
  );
  res.status(200).json(training);
}

export async function archiveTraining(req: Request, res: Response): Promise<void> {
  await trainingService.archiveTraining(req.tenant!, pathParam(req, 'id'));
  res.status(204).send();
}

export async function unarchiveTraining(req: Request, res: Response): Promise<void> {
  const training = await trainingService.unarchiveTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id')
  );
  res.status(200).json(training);
}

export async function completeTraining(req: Request, res: Response): Promise<void> {
  const state = await trainingService.completeTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id')
  );
  res.status(200).json(state);
}

export async function uncompleteTraining(req: Request, res: Response): Promise<void> {
  const state = await trainingService.uncompleteTraining(
    req.tenant!,
    req.userId!,
    pathParam(req, 'id')
  );
  res.status(200).json(state);
}

export async function listCompletions(req: Request, res: Response): Promise<void> {
  const rows = await trainingService.listCompletions(req.tenant!, pathParam(req, 'id'));
  res.status(200).json(rows);
}
