/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class TrueFalseGradingStrategy extends AbstractGradingStrategy<boolean> {
  constructor(
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
  }

  /**
   * Validate a true/false response
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    // For true/false questions, we expect to have a boolean answer choice
    if (
      requestDto.learnerAnswerChoice === null &&
      requestDto.learnerAnswerChoice === undefined
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedTrueFalse",
          requestDto.language,
        ),
      );
    }

    // If the learnerAnswerChoice is a string, try to parse it
    if (typeof requestDto.learnerAnswerChoice === "string") {
      const parsedChoice = this.parseBooleanResponse(
        requestDto.learnerAnswerChoice as string,
        requestDto.language || "en",
      );

      if (parsedChoice === undefined) {
        throw new BadRequestException(
          this.localizationService.getLocalizedString(
            "invalidTrueFalse",
            requestDto.language,
          ),
        );
      }
    }

    return true;
  }

  /**
   * Extract the true/false response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    // Handle case where the answer might be a string
    if (typeof requestDto.learnerAnswerChoice === "string") {
      const parsedChoice = this.parseBooleanResponse(
        requestDto.learnerAnswerChoice,
        requestDto.language || "en",
      );

      if (parsedChoice !== undefined) {
        return parsedChoice;
      }
    }

    // Handle boolean value
    return Boolean(requestDto.learnerAnswerChoice);
  }

  /**
   * Grade a true/false response
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: boolean,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Determine if the answer is correct
    const correctAnswer = question.answer;

    const isCorrect = learnerResponse === correctAnswer;
    console.log(
      "Grading TF question",
      question.id,
      "Learner response:",
      learnerResponse,
      "Correct answer:",
      correctAnswer,
      "Is correct:",
      isCorrect,
    );

    // Generate feedback
    const feedback = isCorrect
      ? this.localizationService.getLocalizedString(
          "correctTF",
          context.language,
        )
      : this.localizationService.getLocalizedString(
          "incorrectTF",
          context.language,
          {
            correctAnswer: correctAnswer
              ? this.localizationService.getLocalizedString(
                  "true",
                  context.language,
                )
              : this.localizationService.getLocalizedString(
                  "false",
                  context.language,
                ),
          },
        );

    // Calculate points
    const correctPoints = question.totalPoints || question.choices[0].points;
    const pointsAwarded = isCorrect ? correctPoints : 0;

    // Create response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = pointsAwarded;
    responseDto.feedback = [
      {
        feedback,
        choice: learnerResponse,
      },
    ];

    // Add metadata for auditing
    responseDto.metadata = {
      isCorrect,
      learnerResponse,
      correctAnswer,
      possiblePoints: correctPoints,
      awardedPoints: pointsAwarded,
    };

    return responseDto;
  }

  /**
   * Parse boolean response from text in different languages
   */
  private parseBooleanResponse(
    learnerChoice: string,
    language: string,
  ): boolean | undefined {
    const mapping: Record<string, Record<string, boolean>> = {
      en: {
        true: true,
        false: false,
        t: true,
        f: false,
        yes: true,
        no: false,
        y: true,
        n: false,
      },
      id: { benar: true, salah: false },
      de: { wahr: true, falsch: false, ja: true, nein: false },
      es: { verdadero: true, falso: false, sí: true, si: true, no: false },
      fr: { vrai: true, faux: false, oui: true, non: false },
      it: { vero: true, falso: false, sì: true, si: true, no: false },
      hu: { igaz: true, hamis: false, igen: true, nem: false },
      nl: { waar: true, onwaar: false, ja: true, nee: false },
      pl: { prawda: true, fałsz: false, tak: true, nie: false },
      pt: { verdadeiro: true, falso: false, sim: true, não: false, nao: false },
      sv: { sant: true, falskt: false, ja: true, nej: false },
      tr: { doğru: true, yanlış: false, evet: true, hayır: false },
      el: { αληθές: true, ψευδές: false, ναί: true, όχι: false },
      kk: { рас: true, жалған: false },
      ru: { правда: true, ложь: false, да: true, нет: false },
      uk: { правда: true, брехня: false, так: true, ні: false },
      ar: { صحيح: true, خطأ: false, نعم: true, لا: false },
      hi: { सही: true, गलत: false, हां: true, नहीं: false },
      th: { จริง: true, เท็จ: false, ใช่: true, ไม่: false },
      ko: { 참: true, 거짓: false, 예: true, 아니요: false },
      "zh-CN": { 真: true, 假: false, 是: true, 否: false },
      "zh-TW": { 真: true, 假: false, 是: true, 否: false },
      ja: { 正しい: true, 間違い: false, はい: true, いいえ: false },
    };

    // Add numeric string mappings for all languages
    for (const lang of Object.keys(mapping)) {
      mapping[lang]["1"] = true;
      mapping[lang]["0"] = false;
    }

    const langMapping = mapping[language] || mapping["en"];
    const normalized = learnerChoice.trim().toLowerCase();

    return langMapping[normalized];
  }
}
