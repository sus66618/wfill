import {
  APPROVED_PLAYABLE_MODELS,
  ModelGatewayError,
  type CredentialVault,
  type ModelAccount,
  type ModelCallResult,
} from "@wfill/model-gateway";
import { SqliteModelRepository, type StoredModel } from "@wfill/persistence";

export interface ModelHealthGateway {
  checkModel(account: ModelAccount, modelId: string, signal?: AbortSignal): Promise<ModelCallResult>;
}

export interface ModelHealthView {
  readonly id: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly health: "unchecked" | "healthy" | "unhealthy";
  readonly lastCheckedAt: string | null;
  readonly errorCode: string | null;
}

export interface ModelRuntimeOptions {
  readonly repository: SqliteModelRepository;
  readonly credentialVault: CredentialVault;
  readonly gateway: ModelHealthGateway;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now?: () => string;
}

export class ModelRuntime {
  readonly account: ModelAccount;
  private readonly errors = new Map<string, string>();
  private readonly now: () => string;

  constructor(private readonly options: ModelRuntimeOptions) {
    this.account = {
      accountId: "school-account",
      displayName: "学校网关",
      providerKind: "openai-compatible",
      baseUrl: options.environment.WFILL_SCHOOL_API_BASE_URL?.trim() || "http://aigw.dlut.edu.cn/v1",
      credentialRef: "school-key",
    };
    this.now = options.now ?? (() => new Date().toISOString());
    options.repository.upsertAccount(this.account, this.configured());
    if (options.repository.listModelsForAccount(this.account.accountId).length === 0) {
      options.repository.replaceModels(this.account.accountId, APPROVED_PLAYABLE_MODELS.map((model) => ({
        modelId: model.id,
        displayName: model.displayName,
        enabled: model.enabled,
        health: "unchecked",
        lastCheckedAt: null,
      })));
    }
  }

  configured(): boolean {
    return this.options.credentialVault.get(this.account?.credentialRef ?? "school-key") !== null;
  }

  catalog(): readonly ModelHealthView[] {
    return this.options.repository.listModelsForAccount(this.account.accountId).map((model) => ({
      id: model.modelId,
      displayName: model.displayName,
      enabled: model.enabled,
      health: model.health,
      lastCheckedAt: model.lastCheckedAt,
      errorCode: this.errors.get(model.modelId) ?? null,
    }));
  }

  async check(modelId: string): Promise<ModelHealthView> {
    if (!this.configured()) throw new Error("credential_not_configured");
    const model = this.findModel(modelId);
    const checkedAt = this.now();
    try {
      await this.options.gateway.checkModel(this.account, modelId);
      this.options.repository.setModelHealth(this.account.accountId, modelId, "healthy", checkedAt);
      this.errors.delete(modelId);
    } catch (error) {
      const code = error instanceof ModelGatewayError ? error.code : "unknown";
      this.options.repository.setModelHealth(this.account.accountId, modelId, "unhealthy", checkedAt);
      this.errors.set(modelId, code);
    }
    return this.catalog().find((candidate) => candidate.id === model.modelId)!;
  }

  async checkAll(): Promise<readonly ModelHealthView[]> {
    if (!this.configured()) throw new Error("credential_not_configured");
    const results: ModelHealthView[] = [];
    for (const model of this.catalog()) results.push(await this.check(model.id));
    return results;
  }

  private findModel(modelId: string): StoredModel {
    const model = this.options.repository.listModelsForAccount(this.account.accountId)
      .find((candidate) => candidate.modelId === modelId);
    if (!model) throw new Error("model_not_found");
    return model;
  }
}
