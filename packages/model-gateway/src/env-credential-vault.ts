import type { CredentialVault } from "./contracts.js";

export class EnvCredentialVault implements CredentialVault {
  readonly #environment: Readonly<Record<string, string | undefined>>;

  constructor(environment: Readonly<Record<string, string | undefined>> = process.env) {
    this.#environment = environment;
  }

  get(credentialRef: string): string | null {
    if (credentialRef !== "school-key") return null;
    const value = this.#environment.WFILL_SCHOOL_API_KEY?.trim();
    return value ? value : null;
  }
}
