import { Intent, User } from '../src/types';
import { backendDuckDB } from './backendDuckDB';

export interface ValidationResult {
  valid: boolean;
  reject_reason?: string;
  error_details?: string;
}

export function validateIntent(intent: Intent, user: User): ValidationResult {
  // 1. Check View Freeze (Workspace Administrator freeze)
  const viewFreeze = backendDuckDB.getViewFreezeState();
  if (viewFreeze.frozen) {
    return {
      valid: false,
      reject_reason: 'VIEW_FROZEN_BY_ADMIN',
      error_details: `The entire dataset view was frozen by Workspace Administrator (${viewFreeze.frozen_by || 'Admin'}) at ${viewFreeze.frozen_at}. Reason: "${viewFreeze.reason}". New mutations are suspended to ensure consistent reporting.`,
    };
  }

  // 2. Role-based permission checks
  if (user.role === 'typical_user') {
    return {
      valid: false,
      reject_reason: 'INSUFFICIENT_ROLE_PERMISSIONS',
      error_details: 'Typical Users have read-only consumer access. Only Contributors, Release Managers, or Admins can submit mutations.',
    };
  }

  // 3. Granular Lock check (Release Manager Curator lock)
  const locks = backendDuckDB.getGranularLocks();
  const currentLock = locks[intent.entity_id];

  if (currentLock && currentLock.locked) {
    if (user.role !== 'release_manager' && user.role !== 'workspace_admin') {
      return {
        valid: false,
        reject_reason: 'RECORD_LOCKED_BY_CURATOR',
        error_details: `Record ${intent.entity_id} is locked by Release Manager (${currentLock.locked_by}). Only Release Managers can modify or unlock it.`,
      };
    }
  }

  // 4. Payload structure validation
  if (intent.operation === 'create' || intent.operation === 'update') {
    if (!intent.payload) {
      return {
        valid: false,
        reject_reason: 'INVALID_PAYLOAD',
        error_details: 'Mutation payload cannot be null or empty.',
      };
    }

    if (intent.entity_type === 'dataset_record') {
      if (!intent.payload.title || typeof intent.payload.title !== 'string' || intent.payload.title.trim().length === 0) {
        return {
          valid: false,
          reject_reason: 'VALIDATION_FAILED',
          error_details: 'Record title is required and must be non-empty.',
        };
      }

      if (intent.payload.metric_value !== undefined && isNaN(Number(intent.payload.metric_value))) {
        return {
          valid: false,
          reject_reason: 'VALIDATION_FAILED',
          error_details: 'Metric value must be a valid number.',
        };
      }
    }
  }

  return { valid: true };
}
