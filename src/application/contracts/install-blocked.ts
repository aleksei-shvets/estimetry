import { DomainError } from '../../domain/shared/domain-error.js';

/** An installer cannot plan safely, e.g. the settings file it must change is not valid JSON. Nothing is written. */
export class InstallBlocked extends DomainError {
  readonly code = 'install-blocked';
}
