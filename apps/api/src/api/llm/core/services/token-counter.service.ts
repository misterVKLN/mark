// src/llm/core/services/token-counter.service.ts
import { Injectable } from "@nestjs/common";
import { get_encoding, Tiktoken } from "@dqbd/tiktoken";
import { ITokenCounter } from "../interfaces/token-counter.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Inject } from "@nestjs/common";
import { Logger } from "winston";

@Injectable()
export class TokenCounterService implements ITokenCounter {
  private readonly encoding: Tiktoken;
  private readonly logger: Logger;

  constructor(@Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger) {
    this.logger = parentLogger.child({ context: TokenCounterService.name });
    // Initialize with gpt2 encoding which is commonly used for token counting
    this.encoding = get_encoding("gpt2");
  }

  /**
   * Count the number of tokens in the given text
   */
  countTokens(text: string): number {
    if (!text) return 0;

    try {
      return this.encoding.encode(text).length;
    } catch (error) {
      this.logger.error(
        `Error encoding text: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // If there's an error encoding, make a best effort to estimate tokens
      // (1 token is roughly 4 characters for English text)
      return Math.ceil(text.length / 4);
    }
  }
}
