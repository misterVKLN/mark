/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../prisma.service";
import { Choice } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";

@Injectable()
export class QuestionVariantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create question variants for an attempt
   * @param attemptId Assignment attempt ID
   * @param questions Array of questions
   */
  async createAttemptQuestionVariants(
    attemptId: number,
    questions: QuestionDto[],
  ): Promise<void> {
    const attemptQuestionVariantsData = questions.map((question) => {
      // Initialize variants array - empty if no variants
      const variants = question.variants || [];

      // Combine with undefined (no variant) as the first option
      const questionAndVariants = [undefined, ...variants];

      // Randomly select one variant (or no variant)
      const randomIndex = Math.floor(
        Math.random() * questionAndVariants.length,
      );
      const chosenVariant = questionAndVariants[randomIndex];

      let variantId: number | null = null;
      let randomizedChoices: string | null = null;

      if (chosenVariant) {
        // Using a variant
        variantId = chosenVariant.id ?? null;
        randomizedChoices = this.maybeShuffleChoices(
          this.getChoices(chosenVariant.choices),
          chosenVariant.randomizedChoices === true,
        );
      } else {
        // Using the original question
        randomizedChoices = this.maybeShuffleChoices(
          this.getChoices(question.choices),
          question.randomizedChoices === true,
        );
      }

      return {
        assignmentAttemptId: attemptId,
        questionId: question.id,
        questionVariantId: variantId,
        randomizedChoices,
      };
    });

    // Create all question-variant mappings in a single operation
    await this.prisma.assignmentAttemptQuestionVariant.createMany({
      data: attemptQuestionVariantsData,
    });
  }

  /**
   * Shuffle choices if needed
   * @param choices Array of choices
   * @param shouldShuffle Whether to shuffle
   * @returns JSON string of choices (shuffled if requested)
   */
  private maybeShuffleChoices(
    choices: Choice[] | string | null | undefined,
    shouldShuffle: boolean,
  ): string | null {
    if (!choices) return null;

    let parsedChoices: Choice[];

    // Parse choices if they're in string format
    if (typeof choices === "string") {
      try {
        const temporary = JSON.parse(choices) as Choice[];
        if (!Array.isArray(temporary)) {
          return null;
        }
        parsedChoices = temporary;
      } catch {
        return null;
      }
    } else {
      parsedChoices = choices;
    }

    if (!Array.isArray(parsedChoices)) {
      return null;
    }

    // Shuffle if requested
    if (shouldShuffle) {
      parsedChoices = [...parsedChoices];
      parsedChoices.sort(() => Math.random() - 0.5);
    }

    return JSON.stringify(parsedChoices);
  }

  /**
   * Get choices from different possible formats
   * @param choices Choices in various formats
   * @returns Array of Choice objects
   */
  private getChoices(choices: any): Choice[] {
    if (!choices) return [];

    if (typeof choices === "string") {
      try {
        return JSON.parse(choices) as Choice[];
      } catch {
        return [];
      }
    }

    return choices as Choice[];
  }
}
