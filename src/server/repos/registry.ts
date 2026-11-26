import type { Repo } from './repo.ts';

/**
 * The repositories this server knows about, by id. In M0 that is the one
 * passed on the command line; recents and scan roots arrive in M4.
 */
export class RepoRegistry {
  readonly #byId = new Map<string, Repo>();

  add(repo: Repo): Repo {
    this.#byId.set(repo.id, repo);
    return repo;
  }

  get(id: string): Repo | undefined {
    return this.#byId.get(id);
  }

  list(): Repo[] {
    return [...this.#byId.values()];
  }
}
