/** Generates unique ids for journal records. Task ids are issued by the task repository. */
export interface IdGenerator {
  next(): string;
}
