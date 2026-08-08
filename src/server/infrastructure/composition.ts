import type { InfrastructureServices } from "./contracts.ts";
import {
  DeterministicAcceleventsService,
  DeterministicClock,
  DeterministicEmailService,
  DeterministicPersistence,
  DeterministicTokenGenerator,
  InMemoryFileStorage,
} from "./fakes.ts";

export interface DeterministicInfrastructure<TRepositories extends object>
  extends InfrastructureServices<TRepositories> {
  readonly persistence: DeterministicPersistence<TRepositories>;
  readonly email: DeterministicEmailService;
  readonly fileStorage: InMemoryFileStorage;
  readonly clock: DeterministicClock;
  readonly tokenGenerator: DeterministicTokenGenerator;
  readonly accelevents: DeterministicAcceleventsService;
}

export interface DeterministicInfrastructureOptions<TRepositories extends object> {
  readonly repositories: TRepositories;
  readonly now?: Date | string | number;
  readonly tokenSeed?: string;
}

export function composeInfrastructure<TRepositories extends object>(
  services: InfrastructureServices<TRepositories>,
): Readonly<InfrastructureServices<TRepositories>> {
  return Object.freeze({ ...services });
}

export function createDeterministicInfrastructure<TRepositories extends object>(
  options: DeterministicInfrastructureOptions<TRepositories>,
): DeterministicInfrastructure<TRepositories> {
  const clock = new DeterministicClock(options.now);

  return {
    persistence: new DeterministicPersistence(options.repositories),
    email: new DeterministicEmailService(clock),
    fileStorage: new InMemoryFileStorage(),
    clock,
    tokenGenerator: new DeterministicTokenGenerator(options.tokenSeed),
    accelevents: new DeterministicAcceleventsService(),
  };
}
