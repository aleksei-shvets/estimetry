import { parse } from 'yaml';
import type { StackDetector } from '../../application/contracts/stack-detector.js';

/** Tag ← name fragments of an image, matched against its last path part without the tag. */
const SERVICES: readonly (readonly [string, readonly string[]])[] = [
  ['postgres', ['postgres']],
  ['mysql', ['mysql', 'mariadb']],
  ['mongodb', ['mongo']],
  ['redis', ['redis']],
  ['kafka', ['kafka']],
  ['rabbitmq', ['rabbitmq']],
  ['elasticsearch', ['elasticsearch']],
  ['clickhouse', ['clickhouse']],
];

export const composeDetector: StackDetector = {
  manifests: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  detect(_name, content) {
    const document = parse(content) as { services?: Record<string, { image?: unknown }> } | null;
    const images = Object.values(document?.services ?? {})
      .map((service) => (typeof service?.image === 'string' ? imageName(service.image) : ''))
      .filter((image) => image !== '');
    return ['docker', ...SERVICES.filter(([, names]) => images.some((image) => names.some((n) => image.includes(n)))).map(([tag]) => tag)];
  },
};

/** `docker.io/bitnami/postgresql:16@sha256:…` → `postgresql`. */
function imageName(image: string): string {
  const last = image.split('@')[0]?.split('/').at(-1) ?? '';
  return last.split(':')[0]?.toLowerCase() ?? '';
}
