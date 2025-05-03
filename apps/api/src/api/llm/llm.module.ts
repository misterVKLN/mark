import { Global, Module } from "@nestjs/common";

// Constants
import {
  PROMPT_PROCESSOR,
  MODERATION_SERVICE,
  TOKEN_COUNTER,
  USAGE_TRACKER,
  TEXT_GRADING_SERVICE,
  FILE_GRADING_SERVICE,
  IMAGE_GRADING_SERVICE,
  URL_GRADING_SERVICE,
  PRESENTATION_GRADING_SERVICE,
  VIDEO_PRESENTATION_GRADING_SERVICE,
  QUESTION_GENERATION_SERVICE,
  RUBRIC_SERVICE,
  TRANSLATION_SERVICE,
  VALIDATOR_SERVICE,
  ALL_LLM_PROVIDERS,
} from "./llm.constants";

// Core services
import { OpenAiLlmService } from "./core/services/openai-llm.service";
import { PromptProcessorService } from "./core/services/prompt-processor.service";
import { ModerationService } from "./core/services/moderation.service";
import { TokenCounterService } from "./core/services/token-counter.service";

// Facade service
import { LlmFacadeService } from "./llm-facade.service";
import { PrismaService } from "src/prisma.service";
import { UsageTrackerService } from "./core/services/usage-tracking.service";
import { FileGradingService } from "./features/grading/services/file-grading.service";
import { ImageGradingService } from "./features/grading/services/image-grading.service";
import { PresentationGradingService } from "./features/grading/services/presentation-grading.service";
import { TextGradingService } from "./features/grading/services/text-grading.service";
import { UrlGradingService } from "./features/grading/services/url-grading.service";
import { VideoPresentationGradingService } from "./features/grading/services/video-grading.service";
import { QuestionGenerationService } from "./features/question-generation/services/question-generation.service";
import { RubricService } from "./features/rubric/services/rubric.service";
import { TranslationService } from "./features/translation/services/translation.service";
import { QuestionValidatorService } from "./features/question-generation/services/question-validator.service";
import { OpenAiLlmMiniService } from "./core/services/openai-llm-mini.service";
import { LlmRouter } from "./core/services/llm-router.service";
@Global()
@Module({
  providers: [
    PrismaService,
    // llm providers
    OpenAiLlmService,
    OpenAiLlmMiniService,
    LlmRouter,
    {
      provide: ALL_LLM_PROVIDERS,
      useFactory: (p1: OpenAiLlmService, p2: OpenAiLlmMiniService) => [p1, p2],
      inject: [OpenAiLlmService, OpenAiLlmMiniService],
    },
    // Core services with their interfaces
    {
      provide: VALIDATOR_SERVICE,
      useClass: QuestionValidatorService,
    },
    {
      provide: PROMPT_PROCESSOR,
      useClass: PromptProcessorService,
    },
    {
      provide: MODERATION_SERVICE,
      useClass: ModerationService,
    },
    {
      provide: TOKEN_COUNTER,
      useClass: TokenCounterService,
    },
    {
      provide: USAGE_TRACKER,
      useClass: UsageTrackerService,
    },

    // Feature services
    {
      provide: TEXT_GRADING_SERVICE,
      useClass: TextGradingService,
    },
    {
      provide: FILE_GRADING_SERVICE,
      useClass: FileGradingService,
    },
    {
      provide: IMAGE_GRADING_SERVICE,
      useClass: ImageGradingService,
    },
    {
      provide: URL_GRADING_SERVICE,
      useClass: UrlGradingService,
    },
    {
      provide: PRESENTATION_GRADING_SERVICE,
      useClass: PresentationGradingService,
    },
    {
      provide: VIDEO_PRESENTATION_GRADING_SERVICE,
      useClass: VideoPresentationGradingService,
    },
    {
      provide: QUESTION_GENERATION_SERVICE,
      useClass: QuestionGenerationService,
    },
    {
      provide: RUBRIC_SERVICE,
      useClass: RubricService,
    },
    {
      provide: TRANSLATION_SERVICE,
      useClass: TranslationService,
    },

    // Facade service
    LlmFacadeService,
  ],
  exports: [
    // Export the facade service for controllers to use
    LlmFacadeService,

    // Also export individual services in case direct access is needed
    ALL_LLM_PROVIDERS,
    LlmRouter,
    PROMPT_PROCESSOR,
    MODERATION_SERVICE,
    TOKEN_COUNTER,
    USAGE_TRACKER,
    TEXT_GRADING_SERVICE,
    FILE_GRADING_SERVICE,
    IMAGE_GRADING_SERVICE,
    URL_GRADING_SERVICE,
    PRESENTATION_GRADING_SERVICE,
    VIDEO_PRESENTATION_GRADING_SERVICE,
    QUESTION_GENERATION_SERVICE,
    RUBRIC_SERVICE,
    TRANSLATION_SERVICE,
  ],
})
export class LlmModule {}
