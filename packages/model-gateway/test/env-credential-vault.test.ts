import { describe, expect, it } from "vitest";
import {
  APPROVED_PLAYABLE_MODELS,
  EnvCredentialVault,
  modelAccountSchema,
} from "../src/index.js";

describe("模型目录与环境密钥边界", () => {
  it("只开放首批七个纯文本模型", () => {
    expect(APPROVED_PLAYABLE_MODELS.map((model) => model.id)).toEqual([
      "Qwen3.5-9B",
      "Qwen3.5-35B-A3B",
      "Qwen3.5-122B-A10B",
      "DeepSeek-V3.1-W8A8",
      "GLM-4.6-W8A8",
      "MiniMax-M2.7-bf16",
      "Qwen3-235B-A22B",
    ]);
    expect(APPROVED_PLAYABLE_MODELS.every((model) => model.capability === "text-chat")).toBe(true);
  });

  it("通过固定引用读取密钥且对象不可序列化泄密", () => {
    const vault = new EnvCredentialVault({ WFILL_SCHOOL_API_KEY: "school-secret" });
    expect(vault.get("school-key")).toBe("school-secret");
    expect(vault.get("unknown-key")).toBeNull();
    expect(JSON.stringify(vault)).not.toContain("school-secret");
  });

  it("缺失或空白密钥均视为未配置", () => {
    expect(new EnvCredentialVault({}).get("school-key")).toBeNull();
    expect(new EnvCredentialVault({ WFILL_SCHOOL_API_KEY: "   " }).get("school-key")).toBeNull();
  });

  it("模型账户只能保存凭据引用而不能夹带明文密钥", () => {
    expect(modelAccountSchema.parse({
      accountId: "school-account",
      displayName: "学校网关",
      providerKind: "openai-compatible",
      baseUrl: "http://aigw.dlut.edu.cn/v1",
      credentialRef: "school-key",
    }).credentialRef).toBe("school-key");
    expect(modelAccountSchema.safeParse({
      accountId: "school-account",
      displayName: "学校网关",
      providerKind: "openai-compatible",
      baseUrl: "http://aigw.dlut.edu.cn/v1",
      credentialRef: "school-key",
      apiKey: "secret",
    }).success).toBe(false);
  });
});
