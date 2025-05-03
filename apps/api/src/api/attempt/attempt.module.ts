// attempt.module.ts
import { Module } from "@nestjs/common";

// Controllers
import { AttemptControllerV2 } from "./attempt.controller";

// Main services
import { AttemptFeedbackService } from "./services/attempt-feedback.service";
import { AttemptGradingService } from "./services/attempt-grading.service";
import { AttemptRegradingService } from "./services/attempt-regrading.service";
import { AttemptReportingService } from "./services/attempt-reporting.service";
import { AttemptSubmissionService } from "./services/attempt-submission.service";
import { AttemptValidationService } from "./services/attempt-validation.service";
import { AttemptServiceV2 } from "./services/attempt.service";

// Response handling services

import { QuestionResponseService } from "./services/question-response/question-response.service";

// Support services
import { LocalizationService } from "./common/utils/localization.service";
import { QuestionVariantService } from "./services/question-variant/question-variant.service";

// Guards
import { LlmModule } from "../llm/llm.module";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { TranslationService } from "./services/translation/translation.service";
import { QuestionService } from "../assignment/question/question.service";
import { AssignmentModuleV2 } from "../assignment/v2/modules/assignment.module";
import { AssignmentRepository } from "../assignment/v2/repositories/assignment.repository";
import { GradingFactoryService } from "./services/grading-factory.service";
import { FileGradingStrategy } from "./common/strategies/file-grading.strategy";
import { TextGradingStrategy } from "./common/strategies/text-grading.strategy";
import { UrlGradingStrategy } from "./common/strategies/url-grading.strategy";
import { PresentationGradingStrategy } from "./common/strategies/presentation-grading.strategy";
import { ChoiceGradingStrategy } from "./common/strategies/choice-grading.strategy";
import { TrueFalseGradingStrategy } from "./common/strategies/true-false-grading.strategy";
import { GradingAuditService } from "./services/question-response/grading-audit.service";

@Module({
  imports: [LlmModule, AssignmentModuleV2],
  controllers: [AttemptControllerV2],
  providers: [
    // Core services
    AttemptServiceV2,
    AttemptSubmissionService,
    AttemptValidationService,
    AttemptGradingService,
    AttemptFeedbackService,
    AttemptRegradingService,
    AttemptReportingService,
    TranslationService,
    QuestionService,
    GradingFactoryService,
    TextGradingStrategy,
    FileGradingStrategy,
    UrlGradingStrategy,
    PresentationGradingStrategy,
    ChoiceGradingStrategy,
    TrueFalseGradingStrategy,
    GradingAuditService,
    // Repositories
    AssignmentRepository,
    // Question response services
    QuestionResponseService,
    // Support services
    QuestionVariantService,
    LocalizationService,

    // Guards
    AssignmentAttemptAccessControlGuard,
  ],
  exports: [
    AttemptServiceV2,
    AttemptSubmissionService,
    AttemptValidationService,
    AttemptGradingService,
    AttemptFeedbackService,
    AttemptRegradingService,
    AttemptReportingService,
    QuestionResponseService,
  ],
})
export class AttemptModule {}
