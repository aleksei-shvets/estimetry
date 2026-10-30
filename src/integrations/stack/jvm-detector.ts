import type { StackDetector } from '../../application/contracts/stack-detector.js';

const SPRING_BOOT = /org\.springframework\.boot/;

export const mavenDetector: StackDetector = {
  manifests: ['pom.xml'],
  detect(_name, content) {
    if (!/<project[\s>]/.test(content)) {
      throw new Error('expected a <project> element');
    }
    return [
      'java',
      'maven',
      ...(SPRING_BOOT.test(content) ? ['spring-boot'] : []),
      ...(/kotlin-maven-plugin/.test(content) ? ['kotlin'] : []),
    ];
  },
};

export const gradleDetector: StackDetector = {
  manifests: ['build.gradle', 'build.gradle.kts'],
  detect(name, content) {
    const kotlin = name.endsWith('.kts') || /kotlin\(|org\.jetbrains\.kotlin|kotlin-android/.test(content);
    return [
      'gradle',
      kotlin ? 'kotlin' : 'java',
      ...(/com\.android\.(application|library)/.test(content) ? ['android'] : []),
      ...(SPRING_BOOT.test(content) ? ['spring-boot'] : []),
    ];
  },
};
