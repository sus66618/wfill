import {
  ModelPlayerController,
  ModelTurnRequiredError,
  StaticControllerRegistry,
  type ModelTextGateway,
  type PlayerController,
} from "@wfill/application";
import type { CredentialVault, ModelAccount } from "@wfill/model-gateway";
import type { SeatId } from "@wfill/contracts";
import type { SessionSeatModelBinding } from "@wfill/persistence";

class MissingCredentialController implements PlayerController {
  async request(): Promise<never> {
    // 重启后密钥缺失时暂停在当前必需动作，不伪造玩家决定。
    throw new ModelTurnRequiredError();
  }
}

export const createModelControllers = (input: {
  readonly account: ModelAccount;
  readonly bindings: readonly SessionSeatModelBinding[];
  readonly gateway: ModelTextGateway;
  readonly credentialVault: CredentialVault;
}): StaticControllerRegistry => {
  const configured = input.credentialVault.get(input.account.credentialRef) !== null;
  const controllers = new Map<SeatId, PlayerController>();
  for (const binding of input.bindings) {
    controllers.set(binding.seat, configured
      ? new ModelPlayerController({ account: input.account, modelId: binding.modelId, gateway: input.gateway })
      : new MissingCredentialController());
  }
  return new StaticControllerRegistry(controllers);
};
