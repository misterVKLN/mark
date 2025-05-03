// src/llm/core/services/prompt-processor.service.ts
import { Injectable, Inject } from "@nestjs/common";
import { PromptTemplate } from "@langchain/core/prompts";
import { HumanMessage } from "@langchain/core/messages";
import { AIUsageType } from "@prisma/client";
import { Logger } from "winston";

import { IPromptProcessor } from "../interfaces/prompt-processor.interface";

import { USAGE_TRACKER } from "../../llm.constants";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { IUsageTracker } from "../interfaces/user-tracking.interface";
import { decodeFields, decodeIfBase64 } from "src/helpers/decoder";
import { LlmRouter } from "./llm-router.service";

@Injectable()
export class PromptProcessorService implements IPromptProcessor {
  private readonly logger: Logger;

  constructor(
    private readonly router: LlmRouter,
    @Inject(USAGE_TRACKER) private readonly usageTracker: IUsageTracker,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: PromptProcessorService.name });
  }

  /**
   * Process a text prompt and return the LLM response
   */
  async processPrompt(
    prompt: PromptTemplate,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey = "gpt-4o",
  ): Promise<string> {
    try {
      const llm = this.router.get(llmKey ?? "gpt-4o");
      // Decode any base64 encoded partialVariables if they exist
      if (prompt.partialVariables) {
        const stringVariables: { [key: string]: string | null } = {};

        // Extract string variables that might need decoding
        for (const key in prompt.partialVariables) {
          const value = prompt.partialVariables[key];
          if (
            (typeof value === "string" || value === null) &&
            typeof value !== "function"
          ) {
            stringVariables[key] = value;
          }
        }

        // Decode the extracted string variables
        const decodedVariables = decodeFields(stringVariables);

        // Update the original partialVariables with decoded values
        for (const key in decodedVariables) {
          prompt.partialVariables[key] = decodedVariables[key];
        }
      }

      let input: string;
      try {
        input = await prompt.format({});
        // Also check if the formatted input itself is base64 encoded
        input = decodeIfBase64(input) || input;
      } catch (formatError: unknown) {
        const errorMessage =
          formatError instanceof Error ? formatError.message : "Unknown error";
        this.logger.error(`Error formatting prompt: ${errorMessage}`, {
          stack:
            formatError instanceof Error
              ? formatError.stack
              : "No stack trace available",
          promptDetails: {
            template: JSON.stringify(prompt.template).slice(0, 100) + "...",
            partialVariables:
              JSON.stringify(prompt.partialVariables || {}).slice(0, 200) +
              "...",
          },
        });
        throw formatError;
      }

      // Invoke the LLM
      const result = await llm.invoke([new HumanMessage(input)]);

      // Clean up the response
      const response = this.cleanResponse(result.content);

      // Track usage
      await this.usageTracker.trackUsage(
        assignmentId,
        usageType,
        result.tokenUsage.input,
        result.tokenUsage.output,
      );

      return response;
    } catch (error) {
      // Create a detailed error log with full error information
      this.logger.error(
        `Error processing prompt: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          stack:
            error instanceof Error ? error.stack : "No stack trace available",
          assignmentId,
          usageType,
          errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
      );

      // Rethrow a more specific error
      const error_ =
        error instanceof Error
          ? error
          : new Error(`Failed to process prompt: ${JSON.stringify(error)}`);
      throw error_;
    }
  }

  /**
   * Process a prompt with image data and return the LLM response
   */
  /**
   * Process a prompt with image data and return the LLM response
   */
  async processPromptWithImage(
    prompt: PromptTemplate,
    imageData: string,
    assignmentId: number,
    usageType: AIUsageType,
    llmKey = "gpt-4o",
  ): Promise<string> {
    try {
      const llm = this.router.get(llmKey ?? "gpt-4o");
      // Decode any base64 encoded partialVariables if they exist
      if (prompt.partialVariables) {
        const stringVariables: { [key: string]: string | null } = {};

        // Extract string variables that might need decoding
        for (const key in prompt.partialVariables) {
          const value = prompt.partialVariables[key];
          if (
            (typeof value === "string" || value === null) &&
            typeof value !== "function"
          ) {
            stringVariables[key] = value;
          }
        }

        // Decode the extracted string variables
        const decodedVariables = decodeFields(stringVariables);

        // Update the original partialVariables with decoded values
        for (const key in decodedVariables) {
          prompt.partialVariables[key] = decodedVariables[key];
        }
      }

      // Format the text content using the template
      let textContent = await prompt.format({});
      // Also check if the formatted input itself is base64 encoded
      textContent = decodeIfBase64(textContent) || textContent;

      // Check if imageData is base64 encoded (beyond the normal base64 encoding for images)
      const decodedImageData = decodeIfBase64(imageData) || imageData;

      // Invoke the LLM with image
      const result = await llm.invokeWithImage(textContent, decodedImageData);

      // Clean up the response
      const response = this.cleanResponse(result.content);

      // Track usage
      await this.usageTracker.trackUsage(
        assignmentId,
        usageType,
        result.tokenUsage.input,
        result.tokenUsage.output,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Error processing prompt with image: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          stack:
            error instanceof Error ? error.stack : "No stack trace available",
          assignmentId,
          usageType,
          errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        },
      );

      const error_ =
        error instanceof Error
          ? error
          : new Error(
              `Failed to process prompt with image: ${JSON.stringify(error)}`,
            );
      throw error_;
    }
  }

  /**
   * Clean the LLM response by removing code blocks and other formatting
   */
  private cleanResponse(response: string): string {
    return response
      .replaceAll("```json", "") // Remove json code blocks
      .replaceAll("```", "") // Remove any remaining code blocks
      .replaceAll("`", "") // Remove single backticks
      .trim(); // Trim whitespace
  }
}
