import { Router } from 'express';
import * as eventController from '../controllers/eventController.js';

/**
 * Event routes. Authentication and the password-change gate are applied where
 * this router is mounted; every member may create and read events, and the
 * controller/service pair enforces creator-or-admin on modify and delete.
 */
export function createEventsRouter(): Router {
  const router = Router();

  router.get('/', eventController.list);
  router.post('/', eventController.create);
  router.get('/:id', eventController.get);
  router.patch('/:id', eventController.update);
  router.delete('/:id', eventController.remove);

  return router;
}
