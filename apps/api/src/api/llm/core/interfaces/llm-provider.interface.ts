import { AIMessage, HumanMessage } from "@langchain/core/messages";
// src/llm/core/interfaces/llm-provider.interface.ts
export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  modelName?: string;
}

export interface LlmResponse {
  content: string;
  tokenUsage: {
    input: number;
    output: number;
  };
}

export interface ILlmProvider {
  /**
   * Send a request to the LLM and get a response
   */
  invoke(
    messages: HumanMessage[],
    options?: LlmRequestOptions,
  ): Promise<LlmResponse>;
  readonly key: string;

  /**
   * Send a request with image content to the LLM
   */
  invokeWithImage(
    textContent: string,
    imageData: string,
    options?: LlmRequestOptions,
  ): Promise<LlmResponse>;
}
